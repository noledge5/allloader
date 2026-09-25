"use strict";

// --- helpers ------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v; // only used for the fixed icon SVGs below
    else if (["value", "checked", "disabled", "hidden"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// replaceChildren() that accepts nested arrays and skips null/false.
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return el;
}

const PATHS = {
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  video: "M4 6h12v12H4zM16 10l4-2v8l-4-2",
  audio: "M9 18V6l10-2v12M9 18a3 3 0 11-6 0 3 3 0 016 0zm10-2a3 3 0 11-6 0 3 3 0 016 0z",
  pause: "M8 5v14M16 5v14",
  play: "M8 5l11 7-11 7z",
  stop: "M7 7h10v10H7z",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  folder: "M3 7h7l2 2h9v10H3z",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  close: "M6 6l12 12M18 6L6 18",
  up: "M12 19V5M6 11l6-6 6 6",
  plus: "M12 5v14M5 12h14",
  check: "M5 12l5 5L20 7",
  chevron: "M9 6l6 6-6 6",
};

function icon(name, cls = "") {
  return h("span", {
    class: "icon-wrap",
    html: `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`,
  });
}

function human(n) {
  if (n == null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

function fmtEta(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.round(s);
  const hrs = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (hrs) return `${hrs} h ${m} min`;
  if (m) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

function toast(message, error = false) {
  const el = h("div", { class: `toast${error ? " error" : ""}` }, message);
  document.getElementById("toast-root").append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 2600);
}

function openSheet(title, content) {
  const root = document.getElementById("sheet-root");
  const close = () => {
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    setTimeout(() => wrap.remove(), 250);
  };
  const backdrop = h("div", { class: "sheet-backdrop", onclick: close });
  const body = h("div", { class: "sheet-body" }, content);
  const panel = h(
    "div",
    { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-grip" }),
    h("div", { class: "sheet-head" }, h("h2", null, title), h("button", { class: "icon-btn", type: "button", "aria-label": "Schließen", onclick: close }, icon("close"))),
    body
  );
  const wrap = h("div", { class: "sheet-wrap" }, backdrop, panel);
  root.append(wrap);
  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    panel.classList.add("open");
  });
  return { close, body };
}

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(path, { cache: "no-store", ...options });
  } catch {
    document.body.classList.add("offline");
    throw new Error("Keine Verbindung zum allloader.");
  }
  document.body.classList.remove("offline");
  if (res.status === 401) {
    location.href = "/login?next=" + encodeURIComponent(location.pathname + location.search);
    throw new Error("Anmeldung nötig.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

function postJson(path, body) {
  return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
}

function store(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) || "null");
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return null;
  }
  return value;
}

// --- state --------------------------------------------------------------------

const state = {
  config: null,
  kind: "auto",
  target: null, // {path, label}
  filter: "active",
  tasks: [],
};

const LABELS = {
  queued: "Wartet",
  downloading: "Lädt",
  paused: "Pausiert",
  completed: "Fertig",
  error: "Fehler",
  canceled: "Abgebrochen",
};

const HINTS = {
  auto: "Videoseiten (YouTube, Vimeo, …) werden erkannt, alles andere als Datei geladen.",
  file: "Direkter Datei-Link, z.B. ein Modell von Hugging Face. Pausieren und Fortsetzen geht jederzeit.",
  video: "Video in bester Qualität (per yt-dlp), Bild und Ton zusammengeführt.",
  audio: "Nur die Tonspur, als MP3.",
};

const ACTIVE = ["queued", "downloading", "paused", "error"];

// --- target folder ------------------------------------------------------------------

function rootFor(path) {
  return (state.config.roots || []).find((r) => path === r.path || path.startsWith(r.path.replace(/\/$/, "") + "/"));
}

function labelFor(path) {
  const root = rootFor(path);
  if (!root) return path;
  const rest = path.slice(root.path.length).replace(/^\/+/, "");
  return rest ? `${root.name} / ${rest.split("/").join(" / ")}` : root.name;
}

function setTarget(path) {
  state.target = { path, label: labelFor(path) };
  store("allloader.target", path);
  document.querySelector(".target-text").textContent = state.target.label;
}

function openFolderPicker() {
  const roots = state.config.roots;
  const list = h("div", { class: "folder-list" });
  const crumbs = h("div", { class: "crumbs" });
  const sheet = openSheet("Speichern in", [
    roots.length > 1
      ? h(
          "div",
          { class: "segmented small roots" },
          roots.map((r) => h("button", { type: "button", "data-path": r.path, onclick: () => show(r.path) }, r.name))
        )
      : null,
    crumbs,
    list,
    h(
      "div",
      { class: "sheet-actions" },
      h("button", { type: "button", class: "btn", onclick: () => newFolder() }, icon("plus"), "Neuer Ordner"),
      h("button", { type: "button", class: "btn primary", onclick: () => (setTarget(current), sheet.close()) }, icon("check"), "Hier speichern")
    ),
  ]);
  let current = state.target?.path || roots[0].path;

  async function show(path) {
    fill(list, h("div", { class: "spinner" }));
    let data;
    try {
      data = await api(`/api/folders?path=${encodeURIComponent(path)}`);
    } catch (e) {
      fill(list, h("p", { class: "error-text" }, e.message));
      return;
    }
    current = data.path;
    for (const b of sheet.body.querySelectorAll(".roots button")) b.classList.toggle("on", b.dataset.path === data.root?.path);
    const isRoot = data.root && data.path === data.root.path;
    fill(
      crumbs,
      isRoot ? null : h("button", { type: "button", class: "icon-btn outline", "aria-label": "Nach oben", onclick: () => show(data.path.replace(/\/[^/]+\/?$/, "") || "/") }, icon("up")),
      h("span", { class: "crumb-text" }, labelFor(data.path))
    );
    fill(
      list,
      data.folders.length ? null : h("p", { class: "muted pad" }, "Keine Unterordner."),
      data.folders.map((name) =>
        h("button", { type: "button", class: "folder-item", onclick: () => show(`${data.path.replace(/\/$/, "")}/${name}`) }, icon("folder"), h("span", null, name), icon("chevron", "muted"))
      )
    );
  }

  async function newFolder() {
    const name = window.prompt("Name des neuen Ordners:");
    if (!name) return;
    try {
      const res = await postJson("/api/folders", { path: current, name: name.trim() });
      show(res.path);
    } catch (e) {
      toast(e.message, true);
    }
  }

  show(current);
}

// --- form ---------------------------------------------------------------------

function setKind(kind) {
  state.kind = kind;
  for (const b of document.querySelectorAll("#kind button")) {
    const on = b.dataset.kind === kind;
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  }
  document.getElementById("kind-hint").textContent = HINTS[kind];
  for (const el of document.querySelectorAll("[data-for]")) {
    const f = el.dataset.for;
    el.hidden = !(f === "file" ? kind === "file" || kind === "auto" : kind === "video" || kind === "auto");
  }
}

async function submit(e) {
  e.preventDefault();
  const url = document.getElementById("url").value.trim();
  if (!url) return;
  const outputDir = state.config.roots.length ? state.target.path : document.getElementById("output_dir").value.trim();
  const btn = document.getElementById("submit-btn");
  btn.disabled = true;
  try {
    await postJson("/api/tasks", {
      kind: state.kind,
      url,
      output_dir: outputDir,
      filename: document.getElementById("filename").value,
      header: document.getElementById("header").value,
      quality: document.getElementById("quality").value,
    });
    if (!state.config.roots.length) store("allloader.output_dir", outputDir);
    document.getElementById("url").value = "";
    document.getElementById("filename").value = "";
    state.filter = "active";
    toast("Download gestartet");
    refresh();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

// --- task list ------------------------------------------------------------------

async function act(task, action) {
  try {
    if (action === "remove") await api(`/api/tasks/${task.id}`, { method: "DELETE" });
    else await postJson(`/api/tasks/${task.id}/${action}`);
  } catch (e) {
    toast(e.message, true);
  }
  refresh();
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast("Link kopiert");
  } catch {
    window.prompt("Link kopieren:", url);
  }
}

function taskCard(t) {
  const pct = t.pct != null ? t.pct : t.status === "completed" ? 100 : null;
  const meta = [];
  if (pct != null && t.status !== "completed") meta.push(`${pct.toFixed(0)} %`);
  if (t.total) meta.push(t.status === "completed" ? human(t.total) : `${human(t.downloaded)} / ${human(t.total)}`);
  else if (t.downloaded) meta.push(human(t.downloaded));
  if (t.status === "downloading" && t.speed) meta.push(`${human(t.speed)}/s`);
  if (t.status === "downloading" && t.eta != null) meta.push(`noch ${fmtEta(t.eta)}`);
  const kindIcon = t.kind === "video" ? (t.audio_only ? "audio" : "video") : "file";
  const button = (name, label, action) => h("button", { type: "button", class: "icon-btn", "aria-label": label, title: label, onclick: () => action() }, icon(name));
  return h(
    "li",
    { class: `task ${t.status}` },
    h(
      "div",
      { class: "task-head" },
      icon(kindIcon, "kind"),
      h("div", { class: "task-title" }, h("div", { class: "task-name" }, t.filename || t.url), t.output_dir ? h("div", { class: "task-dir" }, labelFor(t.output_dir)) : null),
      h("span", { class: `chip ${t.status}` }, LABELS[t.status] || t.status)
    ),
    t.status === "completed" ? null : h("div", { class: `bar${pct == null && t.status === "downloading" ? " indeterminate" : ""}` }, h("div", { class: "bar-fill", style: `width:${pct ?? 0}%` })),
    h("div", { class: "task-foot" },
      h("div", { class: "meta" }, t.error ? h("span", { class: "error-text" }, t.error) : meta.join(" · ")),
      h("div", { class: "actions" },
        t.status === "downloading" ? button("pause", "Pausieren", () => act(t, "pause")) : null,
        ["paused", "error"].includes(t.status) ? button("play", "Fortsetzen", () => act(t, "resume")) : null,
        ACTIVE.includes(t.status) ? button("stop", "Abbrechen", () => act(t, "cancel")) : null,
        state.config.can_open_folder ? button("folder", "Ordner öffnen", () => act(t, "open-folder")) : null,
        button("link", "Link kopieren", () => copyLink(t.url)),
        !["queued", "downloading"].includes(t.status) ? button("trash", "Entfernen", () => act(t, "remove")) : null
      )
    )
  );
}

function render() {
  const active = state.tasks.filter((t) => ACTIVE.includes(t.status));
  const done = state.tasks.filter((t) => !ACTIVE.includes(t.status));
  document.querySelector('[data-count="active"]').textContent = active.length ? String(active.length) : "";
  document.querySelector('[data-count="done"]').textContent = done.length ? String(done.length) : "";
  for (const b of document.querySelectorAll("#filter button")) b.classList.toggle("on", b.dataset.filter === state.filter);
  const shown = state.filter === "active" ? active : state.filter === "done" ? done : state.tasks;
  document.getElementById("tasks").replaceChildren(...shown.slice().reverse().map(taskCard));
  const empty = document.getElementById("empty");
  empty.hidden = shown.length > 0;
  empty.textContent = state.filter === "active" ? "Gerade läuft kein Download." : "Noch nichts fertig.";
  document.getElementById("clear-btn").hidden = !(done.length && state.filter !== "active");
}

let timer = null;
async function refresh() {
  clearTimeout(timer);
  try {
    state.tasks = await api("/api/tasks");
    render();
  } catch {
    // shown via the offline indicator
  }
  const busy = state.tasks.some((t) => t.status === "downloading" || t.status === "queued");
  const delay = document.visibilityState !== "visible" ? 15000 : busy ? 1000 : 4000;
  timer = setTimeout(refresh, delay);
}

// --- help / iOS shortcut ------------------------------------------------------------

function openHelp() {
  const origin = location.origin;
  openSheet("Links vom iPhone schicken", [
    h("p", null, "Mit einem Kurzbefehl schickst du Links direkt aus dem Teilen-Menü (Safari, YouTube-App, …) an den allloader – ohne die App zu öffnen."),
    h("ol", { class: "steps" },
      h("li", null, "App ", h("strong", null, "Kurzbefehle"), " öffnen → ", h("strong", null, "+"), " → oben auf den Namen tippen → ", h("strong", null, "„In Teilen-Menü anzeigen“"), " einschalten, Eingabe: URLs."),
      h("li", null, "Aktion ", h("strong", null, "„Inhalte von URL abrufen“"), " hinzufügen. URL:", h("code", { class: "copy" }, `${origin}/api/tasks`)),
      h("li", null, "Dort ", h("strong", null, "Methode: POST"), ", ", h("strong", null, "Hauptteil: JSON"), " und zwei Felder anlegen: ", h("code", null, "url"), " = Kurzbefehleingabe, ", h("code", null, "kind"), " = ", h("code", null, "auto"), " (oder ", h("code", null, "audio"), ")."),
      state.config.auth
        ? h("li", null, "Bei ", h("strong", null, "Header"), " eintragen: ", h("code", null, "Authorization"), " = ", h("code", null, "Bearer DEIN-PASSWORT"), ".")
        : null,
      h("li", null, "Optional: ", h("strong", null, "„Mitteilung zeigen“"), " anhängen, z.B. „Download gestartet“.")
    ),
    h("p", { class: "muted small" }, "Zielordner ist der Standardordner des Containers. Einen anderen gibst du mit dem Feld ", h("code", null, "output_dir"), " an (z.B. ", h("code", null, state.config.default_dir), ")."),
    h("p", { class: "muted small" }, "Alternativ öffnet der Link ", h("code", null, `${origin}/?url=…`), " die App mit bereits eingefügtem Link."),
    state.config.auth ? h("form", { method: "post", action: "/logout" }, h("button", { type: "submit", class: "btn ghost block" }, "Abmelden")) : null,
  ]);
}

// --- start --------------------------------------------------------------------------

async function start() {
  try {
    state.config = await api("/api/config");
  } catch (e) {
    toast(e.message, true);
    setTimeout(start, 3000);
    return;
  }
  const cfg = state.config;
  if (cfg.roots.length) {
    const saved = store("allloader.target");
    const initial = saved && rootFor(saved) ? saved : cfg.default_dir;
    document.getElementById("target-btn").hidden = false;
    document.getElementById("target-btn").addEventListener("click", openFolderPicker);
    setTarget(rootFor(initial) ? initial : cfg.roots[0].path);
  } else {
    const input = document.getElementById("output_dir");
    input.hidden = false;
    input.value = store("allloader.output_dir") || cfg.default_dir;
  }

  const params = new URLSearchParams(location.search);
  if (params.get("url")) {
    document.getElementById("url").value = params.get("url");
    history.replaceState(null, "", location.pathname);
  }
  if (navigator.clipboard?.readText) {
    const paste = document.getElementById("paste-btn");
    paste.hidden = false;
    paste.addEventListener("click", async () => {
      try {
        document.getElementById("url").value = (await navigator.clipboard.readText()).trim();
      } catch {
        toast("Kein Zugriff auf die Zwischenablage.", true);
      }
    });
  }
  for (const b of document.querySelectorAll("#kind button")) b.addEventListener("click", () => setKind(b.dataset.kind));
  for (const b of document.querySelectorAll("#filter button")) {
    b.addEventListener("click", () => {
      state.filter = b.dataset.filter;
      render();
    });
  }
  document.getElementById("clear-btn").addEventListener("click", async () => {
    await postJson("/api/tasks/clear-finished").catch((e) => toast(e.message, true));
    refresh();
  });
  document.getElementById("help-btn").addEventListener("click", openHelp);
  document.getElementById("add-form").addEventListener("submit", submit);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && refresh());
  setKind("auto");
  refresh();
}

start();
