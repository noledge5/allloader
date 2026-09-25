import { fileKind, flattenOutputs } from "../api.js";
import { describePrompt, templateFromJob } from "../workflow.js";
import { clear, duration, h, icon, openViewer, timeAgo, toast } from "../ui.js";

const PAGE = 30;

export class GalleryView {
  constructor(app) {
    this.app = app;
    this.title = "Galerie";
    this.root = document.getElementById("view-gallery");
    this.jobs = [];
    this.hasMore = false;
    this.loaded = false;
    this.fullJobs = new Map();
  }

  show() {
    this.refresh();
  }

  onReselect() {
    window.scrollTo({ top: 0, behavior: "smooth" });
    this.refresh();
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    if (!this.loaded) clear(this.root, h("div", { class: "spinner center" }));
    try {
      const { jobs, hasMore } = await this.app.api.listJobs(Math.max(PAGE, this.jobs.length));
      this.jobs = jobs;
      this.hasMore = hasMore;
      this.loaded = true;
      this.render();
    } catch (e) {
      clear(this.root, h("div", { class: "notice error" }, e.message));
    } finally {
      this.loading = false;
    }
  }

  async loadMore(btn) {
    btn.disabled = true;
    try {
      const { jobs, hasMore } = await this.app.api.listJobs(PAGE, this.jobs.length);
      const known = new Set(this.jobs.map((j) => j.id));
      this.jobs.push(...jobs.filter((j) => !known.has(j.id)));
      this.hasMore = hasMore;
      this.render();
    } catch (e) {
      toast(e.message, { error: true });
      btn.disabled = false;
    }
  }

  render() {
    const api = this.app.api;
    if (!this.jobs.length) {
      clear(this.root, h("div", { class: "empty" }, icon("gallery", "big"), h("h2", null, "Noch keine Ergebnisse"), h("p", { class: "muted" }, "Fertige Bilder und Videos erscheinen hier.")));
      return;
    }
    const cards = this.jobs.map((job) => {
      const p = job.preview_output;
      let media;
      if (job.status === "failed") media = h("div", { class: "tile-icon error" }, icon("info"), "Fehler");
      else if (job.status === "cancelled" && !p) media = h("div", { class: "tile-icon" }, icon("stop"), "Abgebrochen");
      else if (!p) media = h("div", { class: "tile-icon" }, icon("file"), "Keine Bilder");
      else if (fileKind(p) === "video") media = h("video", { src: `${api.viewUrl(p)}#t=0.1`, muted: true, playsinline: true, preload: "metadata" });
      else if (fileKind(p) === "image") media = h("img", { src: api.viewUrl(p, { preview: "webp;60" }), loading: "lazy", alt: "" });
      else media = h("div", { class: "tile-icon" }, icon(fileKind(p) === "audio" ? "play" : "file"), p.filename);
      return h(
        "button",
        { class: "tile", onclick: () => this.openJob(job) },
        media,
        fileKind(p ?? {}) === "video" ? h("span", { class: "tile-badge left" }, icon("play")) : null,
        job.outputs_count > 1 ? h("span", { class: "tile-badge" }, String(job.outputs_count)) : null,
        h("span", { class: "tile-time" }, timeAgo(job.create_time ?? job.execution_start_time))
      );
    });
    clear(
      this.root,
      h("div", { class: "grid" }, cards),
      this.hasMore ? h("button", { class: "btn block", onclick: (e) => this.loadMore(e.currentTarget) }, "Mehr laden") : null
    );
  }

  async fullJob(id) {
    if (!this.fullJobs.has(id)) {
      const job = await this.app.api.getJob(id);
      if (!job) throw new Error("Eintrag nicht mehr im Verlauf.");
      this.fullJobs.set(id, job);
    }
    return this.fullJobs.get(id);
  }

  async openJob(summary) {
    let job;
    try {
      job = await this.fullJob(summary.id);
    } catch (e) {
      return toast(e.message, { error: true });
    }
    const files = flattenOutputs(job.outputs).filter((f) => fileKind(f) !== "other");
    if (!files.length) {
      const err = job.execution_error;
      return toast(err ? `Fehler: ${err.exception_message ?? ""}`.slice(0, 200) : "Dieser Lauf hat keine Bilder.", { error: !!err, duration: 5000 });
    }
    files.sort((a, b) => (a.type === "output" ? 0 : 1) - (b.type === "output" ? 0 : 1));
    this.openFiles(files, 0, { jobId: job.id });
  }

  // Viewer for a job's files, with info and actions.
  openFiles(files, index, { jobId }) {
    const api = this.app.api;
    const items = files.map((f) => ({ file: f, kind: fileKind(f), url: api.viewUrl(f), title: f.filename }));
    let job = this.fullJobs.get(jobId);
    let viewer;
    const info = () => {
      if (!job) return h("p", { class: "muted small" }, "Lädt Details…");
      const rows = describePrompt(job.workflow?.prompt);
      const took = job.execution_start_time && job.execution_end_time ? duration(job.execution_end_time - job.execution_start_time) : "";
      return h(
        "details",
        { class: "run-details" },
        h("summary", null, [timeAgo(job.create_time ?? job.execution_start_time), took && `Dauer ${took}`].filter(Boolean).join(" · ") || "Details"),
        h("dl", null, rows.map(([k, v]) => [h("dt", null, k), h("dd", { class: k.includes("Prompt") ? "prompt-text" : "" }, v)]))
      );
    };
    const actions = (item, i, close) => [
      h(
        "button",
        {
          class: "viewer-btn",
          disabled: !job,
          onclick: async () => {
            await this.reuse(job, false);
            close();
          },
        },
        icon("reuse"),
        "Übernehmen"
      ),
      h(
        "button",
        {
          class: "viewer-btn",
          disabled: !job,
          onclick: async () => {
            if (await this.reuse(job, true)) close();
          },
        },
        icon("refresh"),
        "Nochmal"
      ),
      item.kind === "image"
        ? h(
            "button",
            {
              class: "viewer-btn",
              onclick: () => {
                if (this.app.views.create.useAsInput(item.file)) {
                  close();
                  this.app.navigate("create");
                }
              },
            },
            icon("image"),
            "Als Eingabe"
          )
        : null,
      h("a", { class: "viewer-btn", href: item.url, target: "_blank", rel: "noopener" }, icon("open"), "Original"),
      h(
        "button",
        {
          class: "viewer-btn danger",
          onclick: async () => {
            if (!window.confirm("Diesen Lauf aus dem Verlauf entfernen? (Die Dateien auf dem PC bleiben erhalten.)")) return;
            try {
              await api.deleteHistory([jobId]);
              this.fullJobs.delete(jobId);
              this.jobs = this.jobs.filter((j) => j.id !== jobId);
              this.render();
              close();
            } catch (e) {
              toast(e.message, { error: true });
            }
          },
        },
        icon("trash"),
        "Entfernen"
      ),
    ];
    viewer = openViewer({ items, index, info, actions });
    if (!job && jobId) {
      this.fullJob(jobId)
        .then((j) => {
          job = j;
          viewer.refresh?.();
        })
        .catch(() => {});
    }
  }

  async reuse(job, run) {
    try {
      const t = await templateFromJob(this.app.api, job);
      await this.app.setTemplate(t);
      this.app.navigate("create");
      if (run) await this.app.generate(1);
      else toast("Einstellungen übernommen");
      return true;
    } catch (e) {
      toast(e.message, { error: true });
      return false;
    }
  }
}
