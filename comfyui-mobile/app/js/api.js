// Client for the ComfyUI HTTP API and websocket. The app is served by ComfyUI
// itself (under /mobile/), so everything is same-origin.

const CLIENT_ID_KEY = "comfy-mobile.client-id";

export function uuid() {
  // crypto.randomUUID only exists in secure contexts, and a LAN address over
  // plain http isn't one.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function loadClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const id = uuid().replace(/-/g, "");
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  } catch {
    return uuid().replace(/-/g, "");
  }
}

export class ComfyApi extends EventTarget {
  constructor() {
    super();
    // Supports ComfyUI behind a reverse proxy with a path prefix.
    this.base = location.pathname.replace(/\/mobile(\/.*)?$/, "");
    this.clientId = loadClientId();
    this.defs = new Map();
    this.socket = null;
    this.connected = false;
    this.reconnectDelay = 1000;
    this.hasJobsApi = null;
  }

  url(path) {
    return `${this.base}/api${path}`;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  request(path, options = {}) {
    return this.fetchParsed(this.url(path), options);
  }

  // Routes of the ComfyUI Mobile extension itself (under /mobile).
  mobileRequest(path, options = {}) {
    return this.fetchParsed(`${this.base}/mobile${path}`, options);
  }

  async fetchParsed(url, options = {}) {
    let res;
    try {
      res = await fetch(url, { cache: "no-store", ...options });
    } catch (e) {
      throw new ApiError("Keine Verbindung zu ComfyUI.", 0, null);
    }
    const type = res.headers.get("Content-Type") || "";
    const body = type.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
    if (!res.ok) {
      const msg = (body && body.error && (body.error.message || body.error)) || (typeof body === "string" && body) || res.statusText;
      throw new ApiError(String(msg || `HTTP ${res.status}`), res.status, body);
    }
    return body;
  }

  postJson(path, data) {
    return this.request(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data ?? {}),
    });
  }

  // --- websocket -----------------------------------------------------------

  connect() {
    if (this.socket) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}${this.base}/ws?clientId=${this.clientId}`);
    ws.binaryType = "arraybuffer";
    this.socket = ws;

    ws.addEventListener("open", () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      ws.send(JSON.stringify({ type: "feature_flags", data: { supports_preview_metadata: true } }));
      this.emit("connection", { connected: true });
    });
    ws.addEventListener("close", () => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      if (wasConnected) this.emit("connection", { connected: false });
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000);
    });
    ws.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.type === "executing") this.executingPrompt = msg.data?.prompt_id ?? this.executingPrompt;
        this.emit(msg.type, msg.data);
      } else {
        this.handleBinary(event.data);
      }
    });
  }

  // iOS drops sockets when the app goes to the background.
  reconnectNow() {
    if (this.socket && this.socket.readyState <= 1) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 1000;
    this.socket = null;
    this.connect();
  }

  handleBinary(buf) {
    if (buf.byteLength < 8) return;
    const view = new DataView(buf);
    const type = view.getUint32(0);
    if (type === 1) {
      const format = view.getUint32(4);
      const blob = new Blob([buf.slice(8)], { type: format === 2 ? "image/png" : "image/jpeg" });
      this.emit("preview", { blob, promptId: this.executingPrompt });
    } else if (type === 4) {
      const len = view.getUint32(4);
      let meta = {};
      try {
        meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len)));
      } catch {}
      const blob = new Blob([buf.slice(8 + len)], { type: meta.image_type || "image/jpeg" });
      this.emit("preview", { blob, promptId: meta.prompt_id ?? this.executingPrompt, nodeId: meta.node_id });
    }
  }

  // --- node definitions ----------------------------------------------------

  // Fetches definitions for the given node classes (cached). Unknown classes
  // (custom node not installed) map to null.
  async ensureDefs(classTypes) {
    const todo = [...classTypes].filter((c) => !this.defs.has(c));
    const queue = [...todo];
    const worker = async () => {
      while (queue.length) {
        const cls = queue.shift();
        try {
          const res = await this.request(`/object_info/${encodeURIComponent(cls)}`);
          this.defs.set(cls, res?.[cls] ?? null);
        } catch (e) {
          if (e.status === 0) throw e;
          this.defs.set(cls, null);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    const out = {};
    for (const c of classTypes) out[c] = this.defs.get(c);
    return out;
  }

  // Model lists live inside the definitions; drop the cache to re-read them.
  clearDefs() {
    this.defs.clear();
  }

  // --- queue & execution ---------------------------------------------------

  queuePrompt(prompt, extraData = {}) {
    return this.postJson("/prompt", { prompt, client_id: this.clientId, extra_data: extraData });
  }

  getQueue() {
    return this.request("/queue");
  }

  interrupt(promptId) {
    return this.postJson("/interrupt", promptId ? { prompt_id: promptId } : {});
  }

  deleteFromQueue(ids) {
    return this.postJson("/queue", { delete: ids });
  }

  clearQueue() {
    return this.postJson("/queue", { clear: true });
  }

  // --- history / jobs ------------------------------------------------------

  // Finished jobs, newest first: [{id, status, create_time, preview_output,
  // outputs_count, ...}]. Uses /api/jobs (lightweight) when the server has
  // it, otherwise builds the same shape from /history.
  async listJobs(limit, offset = 0) {
    if (this.hasJobsApi !== false) {
      try {
        const res = await this.request(
          `/jobs?status=completed,failed,cancelled&sort_order=desc&limit=${limit}&offset=${offset}`
        );
        this.hasJobsApi = true;
        return { jobs: res.jobs, hasMore: res.pagination?.has_more ?? false };
      } catch (e) {
        if (e.status !== 404 && e.status !== 405) throw e;
        this.hasJobsApi = false;
      }
    }
    const hist = await this.request(`/history?max_items=${offset + limit}`);
    const jobs = Object.entries(hist)
      .map(([id, item]) => historyToJob(id, item))
      .sort((a, b) => (b.create_time ?? b.priority) - (a.create_time ?? a.priority));
    return { jobs: jobs.slice(offset, offset + limit), hasMore: jobs.length >= offset + limit };
  }

  // Full job: adds `outputs` and `workflow: {prompt, extra_data}`.
  async getJob(id) {
    if (this.hasJobsApi !== false) {
      try {
        const job = await this.request(`/jobs/${encodeURIComponent(id)}`);
        this.hasJobsApi = true;
        return job;
      } catch (e) {
        if (e.status === 404 && this.hasJobsApi) return null;
        if (e.status !== 404 && e.status !== 405) throw e;
        this.hasJobsApi = false;
      }
    }
    const hist = await this.request(`/history/${encodeURIComponent(id)}`);
    return hist[id] ? historyToJob(id, hist[id], true) : null;
  }

  deleteHistory(ids) {
    return this.postJson("/history", { delete: ids });
  }

  // --- files ---------------------------------------------------------------

  viewUrl(file, { preview } = {}) {
    const q = new URLSearchParams({
      filename: file.filename,
      subfolder: file.subfolder ?? "",
      type: file.type ?? "output",
    });
    if (preview) q.set("preview", preview);
    return `${this.url("/view")}?${q}`;
  }

  async uploadImage(blob, filename, { subfolder = "", overwrite = false } = {}) {
    const form = new FormData();
    form.append("image", blob, filename);
    form.append("type", "input");
    form.append("subfolder", subfolder);
    form.append("overwrite", overwrite ? "true" : "false");
    return this.request("/upload/image", { method: "POST", body: form });
  }

  // --- saved workflows (ComfyUI user data) ---------------------------------

  async listWorkflows() {
    try {
      const files = await this.request("/userdata?dir=workflows&recurse=true&split=false&full_info=true");
      return files
        .filter((f) => f.path.toLowerCase().endsWith(".json") && !f.path.split("/").some((p) => p.startsWith(".")))
        .sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  getWorkflow(path) {
    return this.request(`/userdata/${encodeURIComponent("workflows/" + path)}`);
  }

  saveWorkflow(path, workflow, { overwrite = false } = {}) {
    return this.request(`/userdata/${encodeURIComponent("workflows/" + path)}?overwrite=${overwrite}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(workflow),
    });
  }

  // --- system --------------------------------------------------------------

  getSystemStats() {
    return this.request("/system_stats");
  }

  freeMemory() {
    return this.postJson("/free", { unload_models: true, free_memory: true });
  }

  async mobileInfo() {
    const res = await fetch(`${this.base}/mobile/info`, { cache: "no-store" });
    return res.ok ? res.json() : null;
  }

  // --- autoprompter ----------------------------------------------------------

  autopromptSettings() {
    return this.mobileRequest("/api/autoprompt/settings");
  }

  saveAutopromptSettings(patch) {
    return this.mobileRequest("/api/autoprompt/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  autopromptModels() {
    return this.mobileRequest("/api/autoprompt/models");
  }

  autoprompt(body) {
    return this.mobileRequest("/api/autoprompt/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }
}

function historyToJob(id, item, full = false) {
  const [priority, , prompt, extraData] = item.prompt ?? [];
  const messages = item.status?.messages ?? [];
  let start;
  let end;
  let error;
  let interrupted = false;
  for (const [name, data] of messages) {
    if (name === "execution_start") start = data?.timestamp;
    if (name === "execution_success" || name === "execution_error" || name === "execution_interrupted") end = data?.timestamp;
    if (name === "execution_error") error = data;
    if (name === "execution_interrupted") interrupted = true;
  }
  const statusStr = item.status?.status_str;
  const status = statusStr === "error" ? (interrupted ? "cancelled" : "failed") : "completed";
  const files = flattenOutputs(item.outputs ?? {});
  const job = {
    id,
    status,
    priority,
    create_time: extraData?.create_time,
    execution_start_time: start,
    execution_end_time: end,
    execution_error: error,
    outputs_count: files.length,
    preview_output: files.find((f) => f.type === "output") ?? files[0],
  };
  if (full) {
    job.outputs = item.outputs ?? {};
    job.workflow = { prompt, extra_data: extraData };
  }
  return job;
}

const MEDIA_KEYS = ["images", "gifs", "video", "videos", "audio", "3d"];

// Output files of a job as a flat list: [{filename, subfolder, type, nodeId, mediaType}].
export function flattenOutputs(outputs) {
  const files = [];
  for (const [nodeId, nodeOut] of Object.entries(outputs ?? {})) {
    if (!nodeOut || typeof nodeOut !== "object") continue;
    for (const [mediaType, items] of Object.entries(nodeOut)) {
      if (!MEDIA_KEYS.includes(mediaType) || !Array.isArray(items)) continue;
      for (const item of items) {
        if (item && typeof item === "object" && item.filename) files.push({ ...item, nodeId, mediaType });
      }
    }
  }
  return files;
}

export function fileKind(file) {
  const name = (file.filename || "").toLowerCase();
  const fmt = (file.format || "").toLowerCase();
  if (/\.(mp4|webm|mov|mkv|m4v)$/.test(name) || fmt.startsWith("video/")) return "video";
  if (/\.(mp3|wav|flac|ogg|opus|m4a|aac)$/.test(name) || file.mediaType === "audio" || fmt.startsWith("audio/")) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/.test(name)) return "image";
  return "other";
}
