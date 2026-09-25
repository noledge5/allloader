import { fileKind } from "../api.js";
import { renderField, renderSizePair } from "../fields.js";
import {
  applyDynamicCombo,
  buildFields,
  readWorkflowFile,
  savePins,
  templateFromJob,
  templateFromJson,
  workflowForSaving,
} from "../workflow.js";
import { clear, duration, h, icon, openSheet, openViewer, timeAgo, toast } from "../ui.js";

const STATUS_TEXT = {
  pending: "Wartet in der Warteschlange…",
  running: "Läuft…",
  done: "Fertig",
  error: "Fehler",
  cancelled: "Abgebrochen",
};

export class CreateView {
  constructor(app) {
    this.app = app;
    this.title = "Erstellen";
    this.root = document.getElementById("view-create");
    this.content = h("div", { class: "create-content" });
    this.runCard = h("div", { class: "run-card", hidden: true });
    this.count = 1;
    this.errors = new Map();
    this.errorList = [];
    this.showAll = false;
    this.countBtn = h("button", { class: "count-btn", "aria-label": "Anzahl Läufe", onclick: () => this.cycleCount() }, "×1");
    this.goBtn = h(
      "button",
      { class: "btn primary go-btn", onclick: () => this.app.generate(this.count) },
      icon("play"),
      "Generieren"
    );
    this.dock = h("div", { class: "dock" }, this.runCard, h("div", { class: "gen-bar" }, this.countBtn, this.goBtn));
    this.root.append(this.content, this.dock);
  }

  cycleCount() {
    const steps = [1, 2, 4, 8];
    this.count = steps[(steps.indexOf(this.count) + 1) % steps.length];
    this.countBtn.textContent = `×${this.count}`;
  }

  get ctx() {
    const app = this.app;
    const t = app.template;
    return {
      api: app.api,
      settings: app.settings,
      errors: this.errors,
      pins: this.model?.pins,
      onChange: (f, v) => {
        t.prompt[f.nodeId].inputs[f.input] = v;
        if (this.errors.delete(f.id)) this.root.querySelector(`[data-field="${CSS.escape(f.id)}"]`)?.classList.remove("has-error");
        app.persistTemplate();
      },
      onStructureChange: (f) => {
        applyDynamicCombo(t.prompt[f.nodeId], f.input, f.spec);
        t.uiStale = true;
        app.persistTemplate();
        this.render();
      },
      rerender: () => this.render(),
      getControl: (f) => t.controls[f.nodeId]?.[f.input],
      setControl: (f, mode) => {
        (t.controls[f.nodeId] ??= {})[f.input] = mode;
        app.persistTemplate();
      },
      onTogglePin: (f) => this.togglePin(f),
    };
  }

  togglePin(f) {
    const pins = new Set(this.model.pins);
    if (pins.has(f.id)) pins.delete(f.id);
    else pins.add(f.id);
    savePins(this.app.template, pins);
    this.render();
  }

  render() {
    const t = this.app.template;
    this.goBtn.disabled = !t;
    if (!t) {
      this.model = null;
      clear(
        this.content,
        h(
          "div",
          { class: "empty" },
          icon("layers", "big"),
          h("h2", null, "Kein Workflow geladen"),
          h("p", { class: "muted" }, "Öffne einen gespeicherten Workflow aus ComfyUI oder übernimm einen Lauf aus dem Verlauf."),
          h("button", { class: "btn primary", onclick: () => this.openPicker("saved") }, icon("folder"), "Workflow öffnen"),
          h("button", { class: "btn", onclick: () => this.openPicker("history") }, icon("history"), "Aus dem Verlauf")
        )
      );
      this.updateRun();
      return;
    }
    const scroll = window.scrollY;
    this.model = buildFields(t, this.app.defs);
    const ctx = this.ctx;
    clear(
      this.content,
      this.workflowBar(t),
      this.notices(t),
      this.errorPanel(),
      h("section", { class: "card quick" }, this.quickFields(ctx)),
      this.allParams(ctx)
    );
    window.scrollTo(0, scroll);
    this.updateRun();
  }

  // Re-render but keep the keyboard out of the way (after seeds changed).
  refreshValues() {
    if (document.activeElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.render();
  }

  workflowBar(t) {
    return h(
      "div",
      { class: "wf-bar" },
      h(
        "button",
        { class: "wf-name", onclick: () => this.openPicker() },
        icon("layers"),
        h("span", { class: "wf-text" }, h("span", { class: "wf-title" }, t.name), h("span", { class: "wf-source" }, sourceLabel(t))),
        icon("down")
      ),
      h("button", { class: "icon-btn outline", "aria-label": "Workflow-Menü", onclick: () => this.openMenu() }, icon("more"))
    );
  }

  notices(t) {
    const items = [];
    if (t.missing.length) {
      items.push(
        h(
          "div",
          { class: "notice warn" },
          h("strong", null, "Fehlende Nodes: "),
          t.missing.join(", "),
          h("div", { class: "small" }, "Diese Node-Typen sind in ComfyUI auf dem PC nicht installiert.")
        )
      );
    }
    if (t.uncertain.length) {
      items.push(
        h(
          "div",
          { class: "notice" },
          "Einige Werte konnten nicht sicher zugeordnet werden. Wenn etwas komisch aussieht: Workflow einmal am PC ausführen und hier „Aus dem Verlauf“ übernehmen."
        )
      );
    }
    return items;
  }

  errorPanel() {
    if (!this.errorList.length) return null;
    return h(
      "div",
      { class: "notice error" },
      h("div", { class: "notice-head" }, h("strong", null, "Workflow wurde nicht gestartet"), h("button", { class: "icon-btn", "aria-label": "Ausblenden", onclick: () => this.clearErrors(true) }, icon("close"))),
      h("ul", null, this.errorList.map((e) => h("li", null, e)))
    );
  }

  quickFields(ctx) {
    const { quick } = this.model;
    const prompt = this.app.template.prompt;
    const out = [h("h3", { class: "section-title" }, "Schnellzugriff")];
    if (!quick.length) {
      out.push(h("p", { class: "muted" }, "Tippe unten bei „Alle Parameter“ auf den Stern, um Felder hierher zu holen."));
      return out;
    }
    const used = new Set();
    for (const f of quick) {
      if (used.has(f.id)) continue;
      const partner = sizePartner(f, quick, used);
      if (partner) {
        const [wf, hf] = f.input === "width" || /breite|width/i.test(f.label) ? [f, partner] : [partner, f];
        const w = prompt[wf.nodeId].inputs[wf.input];
        const hv = prompt[hf.nodeId].inputs[hf.input];
        if (typeof w === "number" && typeof hv === "number") {
          used.add(wf.id).add(hf.id);
          out.push(renderSizePair(wf, hf, w, hv, ctx));
          continue;
        }
      }
      used.add(f.id);
      out.push(renderField(f, prompt[f.nodeId].inputs[f.input], { ...ctx, onTogglePin: null }));
    }
    return out;
  }

  allParams(ctx) {
    const { groups } = this.model;
    const prompt = this.app.template.prompt;
    const body = h(
      "div",
      { class: "groups" },
      groups.map((g) =>
        h(
          "details",
          { class: "group", open: groups.length <= 2 || g.fields.some((f) => this.errors.has(f.id)) },
          h(
            "summary",
            null,
            h("span", { class: "group-title" }, g.title),
            g.title !== g.classType ? h("span", { class: "group-class" }, g.classType) : null,
            h("span", { class: "group-count" }, String(g.fields.length))
          ),
          h(
            "div",
            { class: "group-body" },
            // Pinned fields are edited up in the quick section; a second live
            // copy here would go stale.
            g.fields.map((f) =>
              this.model.pins.has(f.id)
                ? h(
                    "div",
                    { class: "field pinned-ref" },
                    h(
                      "div",
                      { class: "field-head" },
                      h("span", { class: "field-label" }, f.label, h("span", { class: "field-sub" }, "im Schnellzugriff")),
                      h("button", { class: "pin-btn on", "aria-label": "Aus Schnellzugriff entfernen", onclick: () => this.togglePin(f) }, icon("star"))
                    )
                  )
                : renderField(f, prompt[f.nodeId].inputs[f.input], ctx)
            )
          )
        )
      )
    );
    const toggle = h(
      "button",
      {
        class: "section-toggle",
        "aria-expanded": this.showAll ? "true" : "false",
        onclick: () => {
          this.showAll = !this.showAll;
          toggle.setAttribute("aria-expanded", this.showAll ? "true" : "false");
          body.hidden = !this.showAll;
        },
      },
      h("span", null, "Alle Parameter"),
      h("span", { class: "muted small" }, `${groups.length} Nodes`),
      icon("down")
    );
    body.hidden = !this.showAll;
    return h("section", { class: "card" }, toggle, body);
  }

  // --- errors from POST /prompt ------------------------------------------------

  clearErrors(rerender = false) {
    const had = this.errorList.length || this.errors.size;
    this.errors.clear();
    this.errorList = [];
    if (rerender && had) this.render();
  }

  showQueueError(e) {
    const body = e.body;
    const prompt = this.app.template?.prompt ?? {};
    this.errors.clear();
    this.errorList = [];
    if (body?.node_errors && Object.keys(body.node_errors).length) {
      for (const [nodeId, ne] of Object.entries(body.node_errors)) {
        const title = prompt[nodeId]?._meta?.title || ne.class_type || nodeId;
        for (const err of ne.errors ?? []) {
          const input = err.extra_info?.input_name;
          const text = `${err.message}${err.details ? ` – ${err.details}` : ""}`;
          if (input) this.errors.set(`${nodeId}|${input}`, text);
          this.errorList.push(`${title}${input ? ` › ${input}` : ""}: ${text}`);
        }
      }
    } else {
      this.errorList.push(e.message || "Unbekannter Fehler");
    }
    this.showAll = this.showAll || [...this.errors.keys()].some((id) => !this.model?.quick.some((f) => f.id === id));
    this.render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // --- run card ------------------------------------------------------------------

  updateRun() {
    const job = this.app.displayJob();
    this.runCard.hidden = !job;
    if (!job) return;
    const results = job.outputs.filter((o) => fileKind(o) !== "other");
    const image = results.find((o) => o.type === "output") ?? results[0];
    let thumb;
    if (job.status === "done" && image) {
      thumb = fileKind(image) === "image" ? h("img", { src: this.app.api.viewUrl(image, { preview: "webp;70" }), alt: "" }) : h("div", { class: "thumb-icon" }, icon("play"));
    } else if (job.previewUrl) {
      thumb = h("img", { src: job.previewUrl, alt: "" });
    } else {
      thumb = h("div", { class: `thumb-icon${job.status === "running" ? " spin" : ""}` }, icon(job.status === "error" ? "info" : "bolt"));
    }
    const node = job.node && job.prompt?.[job.node];
    let text = STATUS_TEXT[job.status] ?? job.status;
    if (job.status === "running" && node) text = node._meta?.title || node.class_type;
    if (job.status === "done") text = `Fertig${job.startedAt && job.endedAt ? ` in ${duration(job.endedAt - job.startedAt)}` : ""}${results.length > 1 ? ` · ${results.length} Dateien` : ""}`;
    if (job.status === "error") text = `Fehler: ${job.error?.exception_message?.split("\n")[0] ?? "siehe PC"}`;
    const pct = job.max ? Math.round((job.value / job.max) * 100) : null;
    const step = job.status === "running" && job.max ? `${job.value}/${job.max}` : "";

    clear(
      this.runCard,
      h("button", { class: "run-thumb", "aria-label": "Ergebnis ansehen", onclick: () => this.openRun(job) }, thumb),
      h(
        "div",
        { class: "run-info", onclick: () => this.openRun(job) },
        h("div", { class: "run-line" }, h("span", { class: `run-status ${job.status}` }, text), h("span", { class: "run-step" }, step)),
        h(
          "div",
          { class: `progress${job.status === "running" && pct == null ? " indeterminate" : ""}${job.status === "pending" ? " idle" : ""}` },
          h("div", { class: "bar", style: { width: `${job.status === "done" ? 100 : pct ?? 0}%` } })
        )
      ),
      job.status === "running" || job.status === "pending"
        ? h(
            "button",
            {
              class: "icon-btn",
              "aria-label": "Abbrechen",
              onclick: async () => {
                try {
                  if (job.status === "running") await this.app.api.interrupt(job.id);
                  else await this.app.api.deleteFromQueue([job.id]);
                  if (job.status === "pending") this.app.finishJob(job.id, "cancelled");
                } catch (e) {
                  toast(e.message, { error: true });
                }
              },
            },
            icon("stop")
          )
        : h("button", { class: "icon-btn", "aria-label": "Ausblenden", onclick: () => ((this.app.lastJobId = null), this.updateRun()) }, icon("close"))
    );
  }

  openRun(job) {
    const files = job.outputs.filter((o) => fileKind(o) !== "other");
    if (job.status === "done" && files.length) {
      this.app.views.gallery.openFiles(files, 0, { jobId: job.id });
    } else if (job.previewUrl) {
      openViewer({ items: [{ kind: "image", url: job.previewUrl, title: "Vorschau" }], info: () => h("p", { class: "muted" }, "Live-Vorschau") });
    } else if (job.status === "error" && job.error) {
      openSheet({
        title: "Fehler beim Ausführen",
        content: [
          h("p", null, h("strong", null, job.error.node_type ?? ""), " ", job.error.exception_message ?? ""),
          job.error.traceback ? h("pre", { class: "trace" }, [].concat(job.error.traceback).join("")) : null,
        ],
      });
    }
  }

  // --- workflow picker ---------------------------------------------------------------

  openPicker(tab = "saved") {
    const body = h("div", { class: "picker" });
    const tabs = h(
      "div",
      { class: "segmented" },
      [
        ["saved", "Gespeichert"],
        ["history", "Verlauf"],
        ["file", "Datei"],
      ].map(([key, label]) => h("button", { class: key === tab ? "on" : "", onclick: () => show(key) }, label))
    );
    const sheet = openSheet({ title: "Workflow öffnen", tall: true, content: [tabs, body] });
    const show = (key) => {
      tab = key;
      [...tabs.children].forEach((b, i) => b.classList.toggle("on", ["saved", "history", "file"][i] === key));
      if (key === "saved") this.renderSaved(body, sheet);
      else if (key === "history") this.renderHistory(body, sheet);
      else this.renderFile(body, sheet);
    };
    show(tab);
  }

  async load(promise, sheet) {
    const overlay = h("div", { class: "loading-overlay" }, h("div", { class: "spinner" }), "Workflow wird geladen…");
    document.body.append(overlay);
    try {
      const t = await promise;
      this.clearErrors();
      await this.app.setTemplate(t);
      sheet?.close();
      window.scrollTo(0, 0);
      this.app.navigate("create");
    } catch (e) {
      toast(e.message || String(e), { error: true, duration: 5000 });
    } finally {
      overlay.remove();
    }
  }

  async renderSaved(body, sheet) {
    clear(body, h("div", { class: "spinner center" }));
    let files;
    try {
      files = await this.app.api.listWorkflows();
    } catch (e) {
      clear(body, h("p", { class: "notice error" }, e.message));
      return;
    }
    if (!files.length) {
      clear(body, h("p", { class: "muted pad" }, "In ComfyUI sind noch keine Workflows gespeichert."));
      return;
    }
    const search = h("input", { type: "search", class: "pick-search", placeholder: "Suchen…", autocapitalize: "off" });
    const list = h("div", { class: "pick-list" });
    const render = () => {
      const q = search.value.trim().toLowerCase();
      clear(
        list,
        files
          .filter((f) => !q || f.path.toLowerCase().includes(q))
          .map((f) => {
            const name = f.path.replace(/\.json$/i, "");
            const slash = name.lastIndexOf("/");
            return h(
              "button",
              {
                class: "pick-item",
                onclick: () =>
                  this.load(
                    this.app.api.getWorkflow(f.path).then((json) =>
                      templateFromJson(this.app.api, json, { name: name.slice(slash + 1), source: { kind: "workflow", path: f.path } })
                    ),
                    sheet
                  ),
              },
              icon("file", "pick-icon"),
              h(
                "span",
                { class: "pick-text" },
                h("span", { class: "pick-name" }, name.slice(slash + 1)),
                h("span", { class: "pick-dir" }, [slash >= 0 ? name.slice(0, slash) : null, f.modified ? timeAgo(f.modified * (f.modified < 1e12 ? 1000 : 1)) : null].filter(Boolean).join(" · "))
              )
            );
          })
      );
    };
    search.addEventListener("input", render);
    clear(body, files.length > 8 ? search : null, list);
    render();
  }

  async renderHistory(body, sheet) {
    clear(body, h("div", { class: "spinner center" }));
    let jobs;
    try {
      ({ jobs } = await this.app.api.listJobs(40));
    } catch (e) {
      clear(body, h("p", { class: "notice error" }, e.message));
      return;
    }
    jobs = jobs.filter((j) => j.status === "completed");
    if (!jobs.length) {
      clear(body, h("p", { class: "muted pad" }, "Noch keine abgeschlossenen Läufe."));
      return;
    }
    clear(
      body,
      h("p", { class: "muted small pad-x" }, "Übernimmt exakt die Einstellungen eines Laufs – funktioniert mit jedem Workflow, auch mit Custom Nodes."),
      h(
        "div",
        { class: "pick-list" },
        jobs.map((j) => {
          const p = j.preview_output;
          const thumb = p && fileKind(p) === "image" ? h("img", { class: "pick-thumb", src: this.app.api.viewUrl(p, { preview: "webp;50" }), loading: "lazy", alt: "" }) : icon("history", "pick-icon");
          return h(
            "button",
            {
              class: "pick-item",
              onclick: () =>
                this.load(
                  this.app.api.getJob(j.id).then((full) => {
                    if (!full) throw new Error("Eintrag nicht mehr im Verlauf.");
                    return templateFromJob(this.app.api, full);
                  }),
                  sheet
                ),
            },
            thumb,
            h(
              "span",
              { class: "pick-text" },
              h("span", { class: "pick-name" }, timeAgo(j.create_time ?? j.execution_start_time) || "Lauf"),
              h("span", { class: "pick-dir" }, `${j.outputs_count ?? 0} Ergebnis${j.outputs_count === 1 ? "" : "se"}`)
            )
          );
        })
      )
    );
  }

  renderFile(body, sheet) {
    const input = h("input", { type: "file", accept: ".json,application/json,image/png", hidden: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      this.load(
        readWorkflowFile(file).then((json) =>
          templateFromJson(this.app.api, json, { name: file.name.replace(/\.(json|png)$/i, ""), source: { kind: "file", name: file.name } })
        ),
        sheet
      );
    });
    clear(
      body,
      h(
        "div",
        { class: "pad" },
        h("p", { class: "muted" }, "Eine Workflow-Datei (.json, auch „API“-Export) oder ein mit ComfyUI erzeugtes PNG aus „Dateien“ öffnen."),
        h("button", { class: "btn primary block", onclick: () => input.click() }, icon("upload"), "Datei auswählen"),
        input
      )
    );
  }

  // --- menu ------------------------------------------------------------------------

  openMenu() {
    const t = this.app.template;
    const canSave = !!t.ui && !t.uiStale;
    const sheet = openSheet({
      title: t.name,
      content: h(
        "div",
        { class: "menu" },
        h("button", { class: "menu-item", disabled: !canSave, onclick: () => (sheet.close(), this.saveAs()) }, icon("save"), h("span", null, "In ComfyUI speichern…", !canSave ? h("small", null, t.ui ? "Struktur geändert – nicht möglich" : "Nur für Workflows mit Workflow-Daten") : null)),
        h("button", { class: "menu-item", disabled: t.source?.kind !== "workflow", onclick: () => (sheet.close(), this.reloadFromSource()) }, icon("reuse"), h("span", null, "Auf gespeicherten Stand zurücksetzen")),
        h("button", { class: "menu-item", onclick: () => (sheet.close(), this.resetPins()) }, icon("star"), h("span", null, "Schnellzugriff zurücksetzen")),
        h("button", { class: "menu-item", onclick: async () => (sheet.close(), await this.app.reloadDefs(), toast("Modelllisten neu geladen")) }, icon("refresh"), h("span", null, "Modelllisten neu laden")),
        h("button", { class: "menu-item", onclick: () => (sheet.close(), this.openPicker()) }, icon("folder"), h("span", null, "Anderen Workflow öffnen"))
      ),
    });
  }

  resetPins() {
    try {
      localStorage.removeItem("comfy-mobile.pins." + this.app.template.key);
    } catch {}
    this.render();
  }

  async reloadFromSource() {
    const t = this.app.template;
    if (t.source?.kind !== "workflow") return;
    const name = t.name;
    await this.load(this.app.api.getWorkflow(t.source.path).then((json) => templateFromJson(this.app.api, json, { name, source: t.source })));
  }

  async saveAs() {
    const t = this.app.template;
    const wf = workflowForSaving(t);
    if (!wf) return;
    const suggested = t.source?.kind === "workflow" ? t.source.path.replace(/\.json$/i, "") : `mobil/${t.name}`;
    let name = window.prompt("Name des Workflows in ComfyUI:", suggested);
    if (!name) return;
    name = name.trim().replace(/\.json$/i, "");
    const path = `${name}.json`;
    try {
      await this.app.api.saveWorkflow(path, wf, { overwrite: false });
    } catch (e) {
      if (e.status !== 409) return toast(e.message, { error: true });
      if (!window.confirm(`„${name}“ existiert schon. Überschreiben?`)) return;
      try {
        await this.app.api.saveWorkflow(path, wf, { overwrite: true });
      } catch (e2) {
        return toast(e2.message, { error: true });
      }
    }
    t.source = { kind: "workflow", path };
    t.name = name.split("/").pop();
    this.app.persistTemplate();
    this.render();
    toast("In ComfyUI gespeichert");
  }

  // Called from the gallery: put an output image into an image input.
  useAsInput(file) {
    const t = this.app.template;
    const fields = this.model?.all.filter((f) => f.upload === "image") ?? [];
    if (!t || !fields.length) {
      toast("Der aktuelle Workflow hat kein Eingabebild.", { error: true });
      return false;
    }
    const value = `${file.subfolder ? file.subfolder + "/" : ""}${file.filename} [${file.type || "output"}]`;
    const f = fields.find((x) => this.model.quick.includes(x)) ?? fields[0];
    t.prompt[f.nodeId].inputs[f.input] = value;
    this.app.persistTemplate();
    this.render();
    toast(`Als „${f.label}“ gesetzt`);
    return true;
  }
}

function sourceLabel(t) {
  switch (t.source?.kind) {
    case "workflow":
      return "Gespeicherter Workflow";
    case "job":
      return "Aus dem Verlauf";
    case "file":
      return "Aus Datei";
    default:
      return "";
  }
}

function sizePartner(f, quick, used) {
  const isW = (x) => x.input === "width" || /^(breite|width)$/i.test(x.label);
  const isH = (x) => x.input === "height" || /^(höhe|height)$/i.test(x.label);
  if (!(isW(f) || isH(f)) || f.type !== "INT") return null;
  const want = isW(f) ? isH : isW;
  return (
    quick.find((x) => !used.has(x.id) && x !== f && x.type === "INT" && want(x) && x.nodeId === f.nodeId) ??
    quick.find((x) => !used.has(x.id) && x !== f && x.type === "INT" && want(x) && x.nodeId !== f.nodeId && (x.exposed || f.exposed || x.classType === f.classType))
  );
}

