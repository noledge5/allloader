import { ComfyApi, flattenOutputs } from "./api.js";
import { prepareRun, restoreCurrent, saveCurrent } from "./workflow.js";
import { toast } from "./ui.js";
import { CreateView } from "./views/create.js";
import { QueueView } from "./views/queue.js";
import { GalleryView } from "./views/gallery.js";
import { SystemView } from "./views/system.js";

const SETTINGS_KEY = "comfy-mobile.settings";
const DEFAULT_SETTINGS = { previewMethod: "auto", uploadMaxEdge: 2048 };

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

class App {
  constructor() {
    this.api = new ComfyApi();
    this.settings = loadSettings();
    this.template = null;
    this.defs = {};
    // Runs seen over the websocket or queued from here, by prompt id.
    this.jobs = new Map();
    this.lastJobId = null;
    this.queueRemaining = 0;
    this.current = null;
    this.views = {
      create: new CreateView(this),
      queue: new QueueView(this),
      gallery: new GalleryView(this),
      system: new SystemView(this),
    };
  }

  async start() {
    for (const btn of document.querySelectorAll(".tabbar button")) {
      btn.addEventListener("click", () => this.navigate(btn.dataset.view));
    }
    this.bindSocket();
    this.api.connect();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.resync();
    });
    window.addEventListener("pageshow", (e) => e.persisted && this.resync());

    this.navigate("create");
    try {
      const t = await restoreCurrent(this.api);
      if (t) await this.setTemplate(t, { save: false });
    } catch {
      // Stale or broken saved state: start empty.
    }
    this.views.create.render();
  }

  navigate(name) {
    if (this.current === name) {
      this.views[name].onReselect?.();
      return;
    }
    this.current = name;
    for (const btn of document.querySelectorAll(".tabbar button")) {
      const on = btn.dataset.view === name;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-current", on ? "page" : "false");
    }
    for (const [key, view] of Object.entries(this.views)) {
      view.root.classList.toggle("active", key === name);
    }
    document.getElementById("view-title").textContent = this.views[name].title;
    window.scrollTo(0, 0);
    this.views[name].show?.();
  }

  saveSettings(patch) {
    Object.assign(this.settings, patch);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {}
  }

  async setTemplate(template, { save = true } = {}) {
    const classes = new Set(Object.values(template.prompt).map((n) => n.class_type));
    this.defs = await this.api.ensureDefs(classes);
    this.template = template;
    if (save) saveCurrent(template);
    this.views.create.render();
  }

  persistTemplate() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => saveCurrent(this.template), 400);
  }

  async reloadDefs() {
    this.api.clearDefs();
    if (this.template) await this.setTemplate(this.template, { save: false });
  }

  // --- running ----------------------------------------------------------------

  async generate(count = 1) {
    const t = this.template;
    if (!t) return;
    this.views.create.clearErrors();
    let queued = 0;
    for (let i = 0; i < count; i++) {
      const { prompt, extraData } = prepareRun(t, this.defs);
      if (this.settings.previewMethod && this.settings.previewMethod !== "default") {
        extraData.preview_method = this.settings.previewMethod;
      }
      try {
        const res = await this.api.queuePrompt(prompt, extraData);
        // Websocket events for a fast run can beat this response, so don't
        // touch the status here (new jobs start as "pending").
        const job = this.job(res.prompt_id);
        Object.assign(job, { name: t.name, prompt, mine: true, queuedAt: Date.now(), templateKey: t.key });
        if (Object.keys(res.node_errors ?? {}).length) {
          toast("Einige Ausgabe-Nodes haben Fehler und werden übersprungen.", { error: true, duration: 5000 });
        }
        this.lastJobId = res.prompt_id;
        queued++;
        this.views.create.updateRun();
      } catch (e) {
        this.views.create.showQueueError(e);
        break;
      }
    }
    this.views.create.refreshValues();
    saveCurrent(t);
    if (queued) toast(queued > 1 ? `${queued} Läufe in der Warteschlange` : "In der Warteschlange");
  }

  job(id) {
    if (!this.jobs.has(id)) {
      this.jobs.set(id, { id, status: "pending", outputs: [], value: 0, max: 0 });
      // Keep memory bounded on long sessions.
      if (this.jobs.size > 60) {
        const oldest = this.jobs.keys().next().value;
        const old = this.jobs.get(oldest);
        if (old?.previewUrl) URL.revokeObjectURL(old.previewUrl);
        this.jobs.delete(oldest);
      }
    }
    return this.jobs.get(id);
  }

  // The run card shows the phone's job that is running right now, else the
  // most recently queued one.
  displayJob() {
    for (const job of this.jobs.values()) if (job.mine && job.status === "running") return job;
    return this.lastJobId ? this.jobs.get(this.lastJobId) : null;
  }

  jobChanged(job) {
    if (job.mine || job.id === this.lastJobId) this.views.create.updateRun();
    if (this.current === "queue") this.views.queue.updateRunning(job);
  }

  bindSocket() {
    const on = (type, fn) => this.api.addEventListener(type, (e) => fn(e.detail ?? {}));
    on("connection", ({ connected }) => {
      document.body.classList.toggle("offline", !connected);
      if (connected) this.resync();
    });
    on("status", (d) => {
      this.queueRemaining = d.status?.exec_info?.queue_remaining ?? 0;
      const badge = document.getElementById("queue-badge");
      badge.textContent = this.queueRemaining > 0 ? String(this.queueRemaining) : "";
      badge.hidden = this.queueRemaining === 0;
      if (this.current === "queue") this.views.queue.refresh();
    });
    on("execution_start", (d) => {
      const job = this.job(d.prompt_id);
      job.status = "running";
      job.startedAt = d.timestamp ?? Date.now();
      job.outputs = [];
      this.runningId = d.prompt_id;
      this.jobChanged(job);
    });
    on("executing", (d) => {
      if (!d.prompt_id) return;
      const job = this.job(d.prompt_id);
      if (d.node == null) return;
      job.node = d.node;
      job.status = "running";
      job.value = 0;
      job.max = 0;
      this.jobChanged(job);
    });
    on("progress", (d) => {
      const job = this.job(d.prompt_id);
      job.value = d.value;
      job.max = d.max;
      job.node = d.node ?? job.node;
      job.status = "running";
      this.jobChanged(job);
    });
    on("executed", (d) => {
      const job = this.job(d.prompt_id);
      job.outputs.push(...flattenOutputs({ [d.node]: d.output }));
      this.jobChanged(job);
    });
    on("execution_success", (d) => this.finishJob(d.prompt_id, "done", d.timestamp));
    on("execution_error", (d) => {
      const job = this.job(d.prompt_id);
      job.error = d;
      this.finishJob(d.prompt_id, "error", d.timestamp);
    });
    on("execution_interrupted", (d) => this.finishJob(d.prompt_id, "cancelled", d.timestamp));
    on("preview", (d) => {
      const job = this.job(d.promptId ?? this.runningId);
      if (job.previewUrl) URL.revokeObjectURL(job.previewUrl);
      job.previewUrl = URL.createObjectURL(d.blob);
      this.jobChanged(job);
    });
  }

  finishJob(id, status, timestamp) {
    const job = this.job(id);
    job.status = status;
    job.endedAt = timestamp ?? Date.now();
    job.node = null;
    if (this.runningId === id) this.runningId = null;
    this.jobChanged(job);
    if (this.current === "gallery") this.views.gallery.refresh();
  }

  // After the phone was asleep: reconnect and fetch what we missed.
  async resync() {
    this.api.reconnectNow();
    for (const job of this.jobs.values()) {
      if (!job.mine || (job.status !== "pending" && job.status !== "running")) continue;
      try {
        const full = await this.api.getJob(job.id);
        if (!full || full.status === "pending" || full.status === "in_progress") continue;
        job.outputs = flattenOutputs(full.outputs ?? {});
        job.status = full.status === "completed" ? "done" : full.status === "cancelled" ? "cancelled" : "error";
        if (full.execution_error) job.error = full.execution_error;
        job.startedAt = full.execution_start_time ?? job.startedAt;
        job.endedAt = full.execution_end_time ?? job.endedAt;
        this.jobChanged(job);
      } catch {}
    }
    this.views[this.current]?.show?.();
  }
}

const app = new App();
window.comfyMobile = app;
app.start();
