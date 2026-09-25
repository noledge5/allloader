import { summarizePrompt } from "../workflow.js";
import { clear, h, icon, timeAgo, toast } from "../ui.js";

export class QueueView {
  constructor(app) {
    this.app = app;
    this.title = "Warteschlange";
    this.root = document.getElementById("view-queue");
    this.running = [];
    this.pending = [];
  }

  show() {
    this.refresh();
  }

  onReselect() {
    this.refresh();
  }

  async refresh() {
    clearTimeout(this.refreshTimer);
    // Coalesce bursts of status events.
    this.refreshTimer = setTimeout(async () => {
      try {
        const q = await this.app.api.getQueue();
        this.running = q.queue_running ?? [];
        this.pending = (q.queue_pending ?? []).slice().sort((a, b) => a[0] - b[0]);
        this.render();
      } catch (e) {
        clear(this.root, h("div", { class: "notice error" }, e.message));
      }
    }, 150);
  }

  itemName(item) {
    const [, id, prompt, extra] = item;
    const job = this.app.jobs.get(id);
    return extra?.comfy_mobile_name || job?.name || summarizePrompt(prompt).slice(0, 60) || "Workflow";
  }

  updateRunning(job) {
    const el = this.root.querySelector(`[data-running="${CSS.escape(job.id)}"]`);
    if (!el) return this.refresh();
    const node = job.node && job.prompt?.[job.node];
    const pct = job.max ? Math.round((job.value / job.max) * 100) : null;
    el.querySelector(".run-node").textContent = node ? node._meta?.title || node.class_type : job.status === "running" ? "Läuft…" : "";
    el.querySelector(".run-step").textContent = job.max ? `${job.value}/${job.max}` : "";
    el.querySelector(".progress").classList.toggle("indeterminate", pct == null);
    el.querySelector(".bar").style.width = `${pct ?? 0}%`;
    const img = el.querySelector(".queue-preview");
    if (job.previewUrl && img) {
      img.src = job.previewUrl;
      img.hidden = false;
    }
    if (job.status !== "running") this.refresh();
  }

  render() {
    const api = this.app.api;
    const running = this.running.map((item) => {
      const id = item[1];
      const job = this.app.jobs.get(id);
      const node = job?.node && job.prompt?.[job.node];
      const pct = job?.max ? Math.round((job.value / job.max) * 100) : null;
      return h(
        "div",
        { class: "card queue-running", dataset: { running: id } },
        h(
          "div",
          { class: "row between" },
          h("div", null, h("div", { class: "eyebrow" }, "Läuft gerade"), h("div", { class: "queue-name" }, this.itemName(item))),
          h(
            "button",
            {
              class: "btn danger small",
              onclick: async () => {
                try {
                  await api.interrupt(id);
                  toast("Wird abgebrochen…");
                } catch (e) {
                  toast(e.message, { error: true });
                }
              },
            },
            icon("stop"),
            "Abbrechen"
          )
        ),
        h("img", { class: "queue-preview", src: job?.previewUrl ?? "", hidden: !job?.previewUrl, alt: "Live-Vorschau" }),
        h(
          "div",
          { class: "run-line" },
          h("span", { class: "run-node" }, node ? node._meta?.title || node.class_type : ""),
          h("span", { class: "run-step" }, job?.max ? `${job.value}/${job.max}` : "")
        ),
        h("div", { class: `progress${pct == null ? " indeterminate" : ""}` }, h("div", { class: "bar", style: { width: `${pct ?? 0}%` } })),
        job ? null : h("p", { class: "muted small" }, "Am PC gestartet – Fortschritt wird nur dort angezeigt.")
      );
    });

    const pending = this.pending.map((item, i) => {
      const [, id, , extra] = item;
      return h(
        "div",
        { class: "queue-item" },
        h("span", { class: "queue-pos" }, String(i + 1)),
        h(
          "div",
          { class: "queue-text" },
          h("div", { class: "queue-name" }, this.itemName(item)),
          h("div", { class: "muted small" }, extra?.create_time ? timeAgo(extra.create_time) : "")
        ),
        h(
          "button",
          {
            class: "icon-btn",
            "aria-label": "Aus der Warteschlange entfernen",
            onclick: async () => {
              try {
                await api.deleteFromQueue([id]);
                const job = this.app.jobs.get(id);
                if (job) this.app.finishJob(id, "cancelled");
                this.refresh();
              } catch (e) {
                toast(e.message, { error: true });
              }
            },
          },
          icon("trash")
        )
      );
    });

    clear(
      this.root,
      running.length ? running : h("div", { class: "card muted center-text" }, "Gerade läuft nichts."),
      h(
        "section",
        { class: "card" },
        h(
          "div",
          { class: "row between" },
          h("h3", { class: "section-title" }, `Wartend (${pending.length})`),
          pending.length
            ? h(
                "button",
                {
                  class: "btn ghost small",
                  onclick: async () => {
                    if (!window.confirm("Alle wartenden Läufe entfernen?")) return;
                    await api.clearQueue();
                    this.refresh();
                  },
                },
                "Alle entfernen"
              )
            : null
        ),
        pending.length ? h("div", { class: "queue-list" }, pending) : h("p", { class: "muted" }, "Keine wartenden Läufe.")
      )
    );
  }
}
