// Small DOM helpers: element builder, icons, toasts, bottom sheets, pickers
// and the full-screen media viewer.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "icon") el.prepend(icon(v));
    else if (["value", "checked", "disabled", "selected", "multiple", "indeterminate"].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

const ICONS = {
  create: "M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3zm6 11l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14zM6 15l.7 1.6 1.6.7-1.6.7L6 19.6l-.7-1.6-1.6-.7 1.6-.7L6 15z",
  queue: "M4 6h16M4 12h16M4 18h10",
  gallery: "M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 16M15.5 9.5h.01",
  system: "M4 5h16v10H4zM9 19h6M12 15v4",
  chevron: "M9 6l6 6-6 6",
  down: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  dice: "M5 5h14v14H5zM9 9h.01M15 9h.01M12 12h.01M9 15h.01M15 15h.01",
  star: "M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9l-5.3 2.7 1-5.8-4.2-4.1 5.9-.9L12 3.5z",
  trash: "M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6",
  play: "M8 5l11 7-11 7z",
  stop: "M7 7h10v10H7z",
  upload: "M12 16V4M7 9l5-5 5 5M5 20h14",
  open: "M14 4h6v6M20 4l-9 9M18 14v5H5V6h5",
  swap: "M7 7h12l-3-3M17 17H5l3 3",
  folder: "M3 7h7l2 2h9v10H3z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  info: "M12 8h.01M11 12h1v5h1M12 21a9 9 0 110-18 9 9 0 010 18z",
  check: "M5 12l5 5L20 7",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  image: "M4 5h16v14H4zM4 15l4.5-4.5 4 4 3-3L20 16",
  history: "M4 12a8 8 0 108-8 8 8 0 00-7.4 5M4 4v5h5M12 8v4l3 2",
  save: "M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6",
  reuse: "M4 12a8 8 0 0114-5.3L20 9M20 12a8 8 0 01-14 5.3L4 15M20 4v5h-5M4 20v-5h5",
  layers: "M12 4l8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4",
  bolt: "M13 3L5 13h6l-1 8 8-10h-6l1-8z",
};

export function icon(name, cls = "") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", `icon ${cls}`.trim());
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", ICONS[name] ?? "");
  svg.append(path);
  return svg;
}

// --- toasts --------------------------------------------------------------------

export function toast(message, { error = false, duration = 2600 } = {}) {
  const root = document.getElementById("toast-root");
  const el = h("div", { class: `toast${error ? " error" : ""}`, role: "status" }, message);
  root.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// --- bottom sheets -----------------------------------------------------------

export function openSheet({ title, content, actions, onClose, tall = false }) {
  const root = document.getElementById("sheet-root");
  const body = h("div", { class: "sheet-body" }, content);
  const close = () => {
    panel.classList.remove("open");
    backdrop.classList.remove("open");
    setTimeout(() => wrap.remove(), 250);
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => e.key === "Escape" && close();
  const backdrop = h("div", { class: "sheet-backdrop", onclick: close });
  const panel = h(
    "div",
    { class: `sheet${tall ? " tall" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "sheet-grip" }),
    h(
      "div",
      { class: "sheet-head" },
      h("h2", null, title),
      actions,
      h("button", { class: "icon-btn", "aria-label": "Schließen", onclick: close }, icon("close"))
    ),
    body
  );
  const wrap = h("div", { class: "sheet-wrap" }, backdrop, panel);
  root.append(wrap);
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => {
    backdrop.classList.add("open");
    panel.classList.add("open");
  });
  addSwipeToClose(panel, close);
  return { close, body, panel };
}

function addSwipeToClose(panel, close) {
  const grip = panel.querySelector(".sheet-grip");
  const head = panel.querySelector(".sheet-head");
  let startY = null;
  let dy = 0;
  const start = (e) => {
    startY = e.touches[0].clientY;
    dy = 0;
    panel.style.transition = "none";
  };
  const move = (e) => {
    if (startY == null) return;
    dy = Math.max(0, e.touches[0].clientY - startY);
    panel.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (startY == null) return;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dy > 90) close();
    startY = null;
  };
  for (const el of [grip, head]) {
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end);
  }
}

// Searchable option list. Resolves with the chosen value or undefined.
export function pickOption({ title, options, value, describe, thumb }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      sheet.close();
      resolve(v);
    };
    const list = h("div", { class: "pick-list" });
    const search = h("input", {
      type: "search",
      class: "pick-search",
      placeholder: "Suchen…",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
    });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      const hits = options.filter((o) => !q || String(o).toLowerCase().includes(q));
      clear(
        list,
        hits.length ? null : h("p", { class: "muted pad" }, "Nichts gefunden."),
        hits.slice(0, 400).map((o) => {
          const s = String(o);
          const slash = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
          return h(
            "button",
            { class: `pick-item${o === value ? " selected" : ""}`, onclick: () => finish(o) },
            thumb ? h("img", { class: "pick-thumb", src: thumb(o), loading: "lazy", alt: "" }) : null,
            h(
              "span",
              { class: "pick-text" },
              h("span", { class: "pick-name" }, slash >= 0 ? s.slice(slash + 1) : s),
              slash >= 0 ? h("span", { class: "pick-dir" }, s.slice(0, slash)) : null,
              describe ? h("span", { class: "pick-dir" }, describe(o)) : null
            ),
            o === value ? icon("check", "pick-check") : null
          );
        })
      );
    };
    search.addEventListener("input", render);
    const sheet = openSheet({
      title,
      tall: options.length > 8,
      content: [options.length > 10 ? search : null, list],
      onClose: () => finish(undefined),
    });
    render();
    const selected = list.querySelector(".selected");
    if (selected) selected.scrollIntoView({ block: "center" });
  });
}

export function confirmAction(message) {
  return window.confirm(message);
}

// --- media viewer --------------------------------------------------------------

// items: [{kind, url, fullUrl, title}], actions: (item, index) => [elements]
export function openViewer({ items, index = 0, info, actions }) {
  let current = index;
  let zoomed = false;
  const stage = h("div", { class: "viewer-stage" });
  const counter = h("span", { class: "viewer-count" });
  const infoBox = h("div", { class: "viewer-info" });
  const actionBar = h("div", { class: "viewer-actions" });

  const close = () => {
    wrap.classList.remove("open");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => wrap.remove(), 200);
  };
  const onKey = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowRight") go(1);
    if (e.key === "ArrowLeft") go(-1);
  };

  const show = () => {
    const item = items[current];
    zoomed = false;
    stage.classList.remove("zoomed");
    let media;
    if (item.kind === "video") {
      media = h("video", { src: item.url, controls: true, playsinline: true, loop: true, autoplay: true, muted: true });
    } else if (item.kind === "audio") {
      media = h("div", { class: "viewer-audio" }, icon("play", "big"), h("audio", { src: item.url, controls: true }));
    } else {
      media = h("img", { src: item.url, alt: item.title ?? "" });
      media.addEventListener("dblclick", toggleZoom);
    }
    clear(stage, media);
    counter.textContent = items.length > 1 ? `${current + 1} / ${items.length}` : "";
    refresh();
  };
  const refresh = () => {
    clear(infoBox, info ? info(items[current], current) : null);
    clear(actionBar, actions ? actions(items[current], current, close) : null);
  };
  const go = (d) => {
    const next = current + d;
    if (next < 0 || next >= items.length) return;
    current = next;
    show();
  };
  const toggleZoom = () => {
    zoomed = !zoomed;
    stage.classList.toggle("zoomed", zoomed);
  };

  // Horizontal swipe to change item (only when not zoomed).
  let sx = null;
  let sy = null;
  let lastTap = 0;
  stage.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return (sx = null);
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    },
    { passive: true }
  );
  stage.addEventListener("touchend", (e) => {
    const now = Date.now();
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    if (!zoomed && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    else if (!zoomed && dy > 110 && Math.abs(dy) > Math.abs(dx) * 1.5) close();
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && items[current].kind === "image") {
      if (now - lastTap < 300) toggleZoom();
      lastTap = now;
    }
    sx = null;
  });

  const wrap = h(
    "div",
    { class: "viewer", role: "dialog", "aria-modal": "true" },
    h(
      "div",
      { class: "viewer-top" },
      h("button", { class: "icon-btn", "aria-label": "Schließen", onclick: close }, icon("close")),
      counter,
      h("span", { class: "spacer" })
    ),
    stage,
    h("div", { class: "viewer-bottom" }, infoBox, actionBar)
  );
  document.body.append(wrap);
  document.addEventListener("keydown", onKey);
  requestAnimationFrame(() => wrap.classList.add("open"));
  show();
  return { close, refresh };
}

// --- formatting ------------------------------------------------------------------

export function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return "gerade eben";
  if (s < 3600) return `vor ${Math.round(s / 60)} min`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} h`;
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}

export function duration(ms) {
  if (!ms || ms < 0) return "";
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

export function bytes(n) {
  if (!n && n !== 0) return "?";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i >= 3 ? 1 : 0)} ${u[i]}`;
}
