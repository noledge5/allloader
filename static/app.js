const list = document.getElementById("tasks");
const form = document.getElementById("add-form");
const urlInput = document.getElementById("url");
const submitBtn = document.getElementById("submit-btn");
let mode = "file";

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    mode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll("[data-mode]").forEach((el) => {
      if (el.classList.contains("tab")) return;
      el.hidden = el.dataset.mode !== mode;
    });
    urlInput.placeholder =
      mode === "video"
        ? "Video-Link einfügen (YouTube, Vimeo, TikTok, ...)"
        : "Download-Link einfügen (https://...)";
    submitBtn.textContent = mode === "video" ? "Video herunterladen" : "Download starten";
  });
});

function human(n) {
  if (n == null) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function fmtEta(s) {
  if (s == null || !isFinite(s)) return "--";
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const LABELS = {
  queued: "Wartet",
  downloading: "Lädt",
  paused: "Pausiert",
  completed: "Fertig",
  error: "Fehler",
  canceled: "Abgebrochen",
};

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

async function refresh() {
  const res = await fetch("/api/tasks");
  const tasks = await res.json();
  list.innerHTML = "";
  for (const t of tasks) {
    const li = document.createElement("li");
    li.className = `task ${t.status}`;
    const pct = t.pct != null ? t.pct.toFixed(1) : null;

    const parts = [];
    parts.push(pct != null ? `${pct}%` : human(t.downloaded));
    if (t.total) parts.push(`/ ${human(t.total)}`);
    if (t.status === "downloading") parts.push(`· ${human(t.speed)}/s · ETA ${fmtEta(t.eta)}`);
    if (t.error) parts.push(`· Fehler: ${t.error}`);

    const icon = t.kind === "video" ? "🎬" : "📄";
    li.innerHTML = `
      <div class="task-head">
        <span class="name" title="${escapeHtml(t.url)}">${icon} ${escapeHtml(t.filename || t.url)}</span>
        <span class="status">${LABELS[t.status] || t.status}</span>
      </div>
      <div class="bar"><div class="bar-fill" style="width:${pct ?? (t.status === "completed" ? 100 : 0)}%"></div></div>
      <div class="meta">${parts.join(" ")}</div>
      <div class="actions">
        ${t.status === "downloading" ? `<button data-a="pause">Pause</button>` : ""}
        ${["paused", "error"].includes(t.status) ? `<button data-a="resume">Fortsetzen</button>` : ""}
        ${!["completed", "canceled"].includes(t.status) ? `<button data-a="cancel">Abbrechen</button>` : ""}
        ${["completed", "canceled", "error"].includes(t.status) ? `<button data-a="remove">Entfernen</button>` : ""}
        <button data-a="open-folder">📂 Ordner</button>
        <button class="copy-link">🔗 Link</button>
      </div>
    `;
    li.querySelectorAll("button[data-a]").forEach((btn) => {
      btn.addEventListener("click", () => act(t.id, btn.dataset.a));
    });
    li.querySelector(".copy-link").addEventListener("click", (e) => copyLink(t.url, e.target));
    list.appendChild(li);
  }
}

async function act(id, action) {
  const res =
    action === "remove"
      ? await fetch(`/api/tasks/${id}`, { method: "DELETE" })
      : await fetch(`/api/tasks/${id}/${action}`, { method: "POST" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "Aktion fehlgeschlagen.");
  }
  refresh();
}

async function copyLink(url, btn) {
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "Kopiert!";
  } catch (e) {
    window.prompt("Link kopieren:", url);
  }
  setTimeout(() => {
    btn.textContent = original;
  }, 1500);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const body =
    mode === "video"
      ? {
          kind: "video",
          url: urlInput.value,
          output_dir: document.getElementById("output_dir").value,
          audio_only: document.getElementById("audio_only").checked,
          quality: document.getElementById("quality").value,
        }
      : {
          kind: "file",
          url: urlInput.value,
          output_dir: document.getElementById("output_dir").value,
          filename: document.getElementById("filename").value,
          header: document.getElementById("header").value,
        };
  await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  urlInput.value = "";
  document.getElementById("filename").value = "";
  refresh();
});

refresh();
setInterval(refresh, 1000);
