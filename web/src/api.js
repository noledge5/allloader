// REST + WebSocket client for the Cove backend.

async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  listDownloads: () => req("GET", "/api/downloads"),
  createDownload: (b) => req("POST", "/api/downloads", b),
  pause: (id) => req("POST", `/api/downloads/${id}/pause`),
  resume: (id) => req("POST", `/api/downloads/${id}/resume`),
  cancel: (id) => req("POST", `/api/downloads/${id}/cancel`),
  remove: (id) => req("DELETE", `/api/downloads/${id}`),
  catalog: () => req("GET", "/api/catalog"),
  pruneCatalog: () => req("POST", "/api/catalog/prune"),
  fileUrl: (id) => `/api/downloads/${id}/file`,

  library: () => req("GET", "/api/library"),
  libraryDelete: (rels) => req("POST", "/api/library/delete", { rels }),
  libraryFileUrl: (rel) => `/api/library/file?rel=${encodeURIComponent(rel)}`,

  listSources: () => req("GET", "/api/sources"),
  addSource: (b) => req("POST", "/api/sources", b),
  removeSource: (id) => req("DELETE", `/api/sources/${id}`),
  scanSource: (id) => req("POST", `/api/sources/${id}/scan`),
  analyze: (b) => req("POST", "/api/analyze", b),
  queueItems: (items) => req("POST", "/api/queue", { items }),

  listProposals: () => req("GET", "/api/proposals"),
  confirmProposals: (selections, ids) => req("POST", "/api/proposals/confirm", { selections, ids }),
  dismissProposals: (ids) => req("POST", "/api/proposals/dismiss", { ids }),

  aiStatus: () => req("GET", "/api/ai/status"),
  aiIntake: (text) => req("POST", "/api/ai/intake", { text }),
  aiChat: (message, history) => req("POST", "/api/ai/chat", { message, history }),
  aiTriage: (id) => req("POST", `/api/ai/triage/${id}`),

  listBatches: () => req("GET", "/api/batches"),
  addBatch: (b) => req("POST", "/api/batches", b),
  removeBatch: (id) => req("DELETE", `/api/batches/${id}`),

  getSchedule: () => req("GET", "/api/schedule"),
  putSchedule: (b) => req("PUT", "/api/schedule", b),

  nas: (rel = "") => req("GET", `/api/nas?rel=${encodeURIComponent(rel)}`),
};

// Subscribe to the live progress WebSocket. Returns an unsubscribe fn.
export function subscribe(onMessage) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  let ws, closed = false, retry;
  const connect = () => {
    ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data)); } catch {}
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(connect, 1500);
    };
  };
  connect();
  return () => { closed = true; clearTimeout(retry); ws && ws.close(); };
}

// -- formatting ------------------------------------------------------------

export function human(n) {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? n : n.toFixed(1)} ${u[i]}`;
}

export function pct(d, t) {
  return t ? Math.min(100, (d / t) * 100) : 0;
}
