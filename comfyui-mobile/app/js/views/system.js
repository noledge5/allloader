import { bytes, clear, h, icon, pickOption, toast } from "../ui.js";

const PREVIEW_METHODS = [
  ["auto", "Automatisch"],
  ["latent2rgb", "Schnell (latent2rgb)"],
  ["taesd", "Genau (TAESD)"],
  ["default", "Wie am PC eingestellt"],
  ["none", "Aus"],
];

const UPLOAD_SIZES = [
  [0, "Original"],
  [4096, "max. 4096 px"],
  [2048, "max. 2048 px"],
  [1536, "max. 1536 px"],
  [1024, "max. 1024 px"],
];

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// "cuda:0 NVIDIA GeForce RTX 4090 : cudaMallocAsync" -> "NVIDIA GeForce RTX 4090"
function gpuName(name) {
  return String(name || "GPU").replace(/^\w+:\d+\s*/, "").replace(/\s*:\s*\w+$/, "") || "GPU";
}

function meter(label, used, total) {
  const pct = total ? Math.round((used / total) * 100) : 0;
  return h(
    "div",
    { class: "meter" },
    h("div", { class: "row between" }, h("span", null, label), h("span", { class: "muted small" }, `${bytes(used)} / ${bytes(total)}`)),
    h("div", { class: `progress${pct > 90 ? " hot" : ""}` }, h("div", { class: "bar", style: { width: `${pct}%` } }))
  );
}

export class SystemView {
  constructor(app) {
    this.app = app;
    this.title = "System";
    this.root = document.getElementById("view-system");
    // Kept across refreshes so a half-typed API key survives reconnects.
    this.autoCard = h("section", { class: "card", id: "autoprompt-settings" }, h("h3", { class: "section-title" }, "Autoprompter"), h("div", { class: "spinner small" }));
  }

  show() {
    if (!this.autoCard.contains(document.activeElement)) this.fillAutoCard();
    this.refresh();
  }

  onReselect() {
    this.show();
  }

  async refresh() {
    const [stats, info] = await Promise.all([
      this.app.api.getSystemStats().catch((e) => ({ error: e.message })),
      this.app.api.mobileInfo().catch(() => null),
    ]);
    this.render(stats, info);
  }

  focusAutoprompt() {
    this.autoCard?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // --- autoprompter settings -------------------------------------------------

  async fillAutoCard() {
    const card = this.autoCard;
    let s;
    try {
      s = await this.app.api.autopromptSettings();
    } catch (e) {
      clear(card, h("h3", { class: "section-title" }, "Autoprompter"), h("p", { class: "muted" }, e.message));
      return;
    }
    const api = this.app.api;
    const save = async (patch, rerender = false) => {
      try {
        s = await api.saveAutopromptSettings(patch);
        if (rerender) this.fillAutoCard();
      } catch (e) {
        toast(e.message, { error: true });
      }
    };

    const provider = h(
      "select",
      { class: "input select", onchange: (e) => save({ provider: e.target.value }, true) },
      [
        ["openrouter", "OpenRouter"],
        ["openai", "OpenAI"],
        ["custom", "Eigene Adresse (LM Studio, Ollama …)"],
      ].map(([v, label]) => h("option", { value: v, selected: v === s.provider }, label))
    );

    const baseUrl =
      s.provider === "custom"
        ? h("input", {
            class: "input",
            type: "url",
            value: s.base_url,
            placeholder: "http://127.0.0.1:1234/v1",
            autocapitalize: "off",
            spellcheck: "false",
            onchange: (e) => save({ base_url: e.target.value }),
          })
        : null;

    const keyInput = h("input", {
      class: "input",
      type: "password",
      autocomplete: "off",
      placeholder: s.has_key ? `gespeichert (…${s.key_hint || "••••"})` : s.provider === "custom" ? "meist nicht nötig" : "API-Key einfügen",
    });
    const keyRow = h(
      "div",
      { class: "row" },
      keyInput,
      h(
        "button",
        {
          class: "btn",
          onclick: async () => {
            if (!keyInput.value.trim()) return;
            await save({ api_key: keyInput.value.trim() }, true);
            toast("API-Key gespeichert");
          },
        },
        "Speichern"
      )
    );

    const modelBtn = h(
      "button",
      {
        class: `input picker-btn${s.model ? "" : " warn"}`,
        onclick: async () => {
          let models;
          try {
            models = await api.autopromptModels();
          } catch (e) {
            toast(`Modelle konnten nicht geladen werden: ${e.message}`, { error: true, duration: 5000 });
            return;
          }
          if (!models.length) return toast("Der Anbieter hat keine Modelle gemeldet.", { error: true });
          const names = new Map(models.map((m) => [m.id, m.name]));
          const v = await pickOption({
            title: "Modell für den Autoprompter",
            options: models.map((m) => m.id),
            value: s.model,
            describe: (id) => (names.get(id) !== id ? names.get(id) : ""),
          });
          if (v !== undefined) save({ model: v }, true);
        },
      },
      h("span", { class: "picker-text" }, h("span", { class: "picker-name" }, s.model || "Modell wählen…")),
      icon("down")
    );

    const styleSeg = h(
      "div",
      { class: "segmented" },
      [
        ["natural", "Natürliche Sprache"],
        ["tags", "Tags (SD 1.5, Pony …)"],
      ].map(([v, label]) =>
        h(
          "button",
          {
            class: v === s.prompt_style ? "on" : "",
            onclick: (e) => {
              for (const b of styleSeg.children) b.classList.toggle("on", b === e.currentTarget);
              save({ prompt_style: v });
            },
          },
          label
        )
      )
    );

    const instructions = h("textarea", {
      class: "input textarea",
      rows: 2,
      value: s.instructions,
      placeholder: "Optional, z.B. „Immer im Stil analoger Fotografie“",
      onchange: (e) => save({ instructions: e.target.value }),
    });

    const testOut = h("div");
    const testBtn = h(
      "button",
      {
        class: "btn",
        onclick: async () => {
          testBtn.disabled = true;
          clear(testOut, h("div", { class: "spinner small" }));
          try {
            const res = await api.autoprompt({ text: "ein Fuchs im Schnee", mode: "expand" });
            clear(testOut, h("p", { class: "ap-test" }, res.text));
          } catch (e) {
            clear(testOut, h("p", { class: "notice error" }, e.message));
          } finally {
            testBtn.disabled = false;
          }
        },
      },
      icon("create"),
      "Testen"
    );

    clear(
      card,
      h("h3", { class: "section-title" }, "Autoprompter"),
      h("p", { class: "muted small" }, "Erweitert und verbessert Prompts mit einem Sprachmodell. Der API-Key bleibt auf dem PC."),
      h("label", { class: "setting" }, h("span", null, "Anbieter"), provider),
      baseUrl ? h("label", { class: "setting" }, h("span", null, "Adresse (OpenAI-kompatibel)"), baseUrl) : null,
      h(
        "div",
        { class: "setting" },
        h("span", null, "API-Key"),
        keyRow,
        s.key_from_env ? h("span", { class: "small" }, "Kommt aus einer Umgebungsvariable am PC.") : null,
        s.has_key && !s.key_from_env
          ? h("button", { class: "link-btn", onclick: () => window.confirm("API-Key löschen?") && save({ clear_key: true }, true) }, "Key löschen")
          : null
      ),
      h("div", { class: "setting" }, h("span", null, "Modell"), modelBtn),
      h("div", { class: "setting" }, h("span", null, "Prompt-Stil"), styleSeg),
      h("label", { class: "setting" }, h("span", null, "Eigene Anweisung"), instructions),
      h("div", { class: "btn-row" }, testBtn),
      testOut
    );
  }

  render(stats, info) {
    const app = this.app;
    const sys = stats?.system ?? {};
    const connected = app.api.connected && !stats?.error;
    const select = (options, value, onChange) =>
      h(
        "select",
        { class: "input select", onchange: (e) => onChange(e.target.value) },
        options.map(([v, label]) => h("option", { value: String(v), selected: String(v) === String(value) }, label))
      );

    clear(
      this.root,
      h(
        "section",
        { class: "card" },
        h("div", { class: "row" }, h("span", { class: `dot${connected ? " ok" : ""}` }), h("strong", null, connected ? "Mit ComfyUI verbunden" : "Keine Verbindung")),
        stats?.error ? h("p", { class: "muted small" }, stats.error) : null,
        sys.comfyui_version
          ? h(
              "dl",
              { class: "kv" },
              h("dt", null, "ComfyUI"),
              h("dd", null, sys.comfyui_version),
              h("dt", null, "Adresse"),
              h("dd", null, location.host),
              sys.pytorch_version ? [h("dt", null, "PyTorch"), h("dd", null, sys.pytorch_version)] : null,
              sys.os ? [h("dt", null, "System"), h("dd", null, sys.os)] : null
            )
          : null
      ),
      stats?.devices?.length || sys.ram_total
        ? h(
            "section",
            { class: "card" },
            h("h3", { class: "section-title" }, "Auslastung"),
            (stats.devices ?? []).map((d) =>
              d.vram_total && d.type !== "cpu"
                ? meter(`${gpuName(d.name)} (VRAM)`, d.vram_total - d.vram_free, d.vram_total)
                : null
            ),
            sys.ram_total ? meter("Arbeitsspeicher", sys.ram_total - sys.ram_free, sys.ram_total) : null,
            h(
              "div",
              { class: "btn-row" },
              h(
                "button",
                {
                  class: "btn",
                  onclick: async () => {
                    try {
                      await app.api.freeMemory();
                      toast("Modelle werden entladen");
                      setTimeout(() => this.refresh(), 1500);
                    } catch (e) {
                      toast(e.message, { error: true });
                    }
                  },
                },
                icon("bolt"),
                "VRAM freigeben"
              ),
              h(
                "button",
                {
                  class: "btn",
                  onclick: async () => {
                    await app.reloadDefs();
                    toast("Modelllisten neu geladen");
                  },
                },
                icon("refresh"),
                "Modelllisten neu laden"
              )
            )
          )
        : null,
      this.autoCard,
      h(
        "section",
        { class: "card" },
        h("h3", { class: "section-title" }, "Einstellungen"),
        h("label", { class: "setting" }, h("span", null, "Live-Vorschau beim Generieren"), select(PREVIEW_METHODS, app.settings.previewMethod, (v) => app.saveSettings({ previewMethod: v }))),
        h("label", { class: "setting" }, h("span", null, "Fotos vor dem Hochladen verkleinern"), select(UPLOAD_SIZES, app.settings.uploadMaxEdge, (v) => app.saveSettings({ uploadMaxEdge: Number(v) })))
      ),
      this.installCard(info)
    );
  }

  installCard(info) {
    if (isIos() && !isStandalone()) {
      return h(
        "section",
        { class: "card tip" },
        h("h3", { class: "section-title" }, "Als App installieren"),
        h("p", null, "In Safari unten auf ", h("strong", null, "Teilen"), " tippen und dann ", h("strong", null, "„Zum Home-Bildschirm“"), " wählen. Danach startet ComfyUI Mobile im Vollbild wie eine App.")
      );
    }
    if (info && !isIos()) {
      return h(
        "section",
        { class: "card tip" },
        h("h3", { class: "section-title" }, "Auf dem Handy öffnen"),
        info.loopback_only
          ? h("p", null, "ComfyUI ist nur auf diesem PC erreichbar. In ComfyUI Desktop unter Einstellungen → Server-Config den Host auf ", h("code", null, "0.0.0.0"), " stellen und neu starten.")
          : [h("p", null, "Diese Adresse in Safari auf dem iPhone öffnen (gleiches WLAN):"), info.phone_urls.map((u) => h("p", null, h("code", { class: "url" }, u)))]
      );
    }
    return null;
  }
}
