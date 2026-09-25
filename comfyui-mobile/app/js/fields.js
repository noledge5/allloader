// Touch-friendly controls for workflow inputs.

import { h, icon, pickOption, toast } from "./ui.js";

const SEED_MODES = [
  ["randomize", "Zufall"],
  ["fixed", "Fest"],
  ["increment", "+1"],
  ["decrement", "−1"],
];

function decimals(f) {
  const ref = f.round || f.step || (f.type === "INT" ? 1 : 0.01);
  const s = String(ref);
  return s.includes("e-") ? Number(s.split("e-")[1]) : (s.split(".")[1] ?? "").length;
}

function clampNumber(f, v) {
  if (!Number.isFinite(v)) return null;
  if (f.min != null && v < f.min) v = f.min;
  if (f.max != null && v > f.max) v = f.max;
  if (f.type === "INT") return Math.round(v);
  const d = decimals(f);
  return Number(v.toFixed(Math.min(d, 10)));
}

function header(f, ctx) {
  const pinned = ctx.pins?.has(f.id);
  return h(
    "div",
    { class: "field-head" },
    h(
      "label",
      { class: "field-label", for: `f-${f.id}` },
      f.label,
      f.sublabel ? h("span", { class: "field-sub" }, f.sublabel) : null
    ),
    ctx.onTogglePin
      ? h(
          "button",
          {
            class: `pin-btn${pinned ? " on" : ""}`,
            "aria-label": pinned ? "Vom Hauptbildschirm entfernen" : "Auf den Hauptbildschirm",
            onclick: (e) => {
              ctx.onTogglePin(f);
              const on = !!ctx.pins?.has(f.id);
              e.currentTarget.classList.toggle("on", on);
              e.currentTarget.setAttribute("aria-label", on ? "Vom Hauptbildschirm entfernen" : "Auf den Hauptbildschirm");
            },
          },
          icon("star")
        )
      : null
  );
}

export function renderField(f, value, ctx) {
  const set = (v) => ctx.onChange(f, v);
  let control;
  if (f.upload) control = mediaControl(f, value, set, ctx);
  else if (f.seed) control = seedControl(f, value, set, ctx);
  else if (f.type === "INT" || f.type === "FLOAT") control = numberControl(f, value, set);
  else if (f.type === "BOOLEAN") control = toggleControl(f, value, set);
  else if (f.type === "COMBO") control = comboControl(f, value, set, ctx);
  else if (f.multiline) control = textArea(f, value, set, ctx);
  else control = h("input", { id: `f-${f.id}`, type: "text", class: "input", value: value ?? "", oninput: (e) => set(e.target.value) });

  const error = ctx.errors?.get(f.id);
  return h(
    "div",
    { class: `field${f.multiline ? " wide" : ""}${error ? " has-error" : ""}`, dataset: { field: f.id } },
    header(f, ctx),
    control,
    error ? h("p", { class: "field-error" }, error) : null
  );
}

function textArea(f, value, set, ctx) {
  const ta = h("textarea", {
    id: `f-${f.id}`,
    class: "input textarea",
    rows: 3,
    value: value ?? "",
    autocapitalize: "sentences",
    spellcheck: "true",
  });
  const fit = () => {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 360)}px`;
  };
  ta.addEventListener("input", () => {
    set(ta.value);
    fit();
  });
  requestAnimationFrame(fit);
  if (!ctx.onAutoprompt) return ta;

  // Autoprompter button with a one-step undo.
  let previous = null;
  const undo = h(
    "button",
    {
      class: "tool-btn",
      hidden: true,
      onclick: () => {
        if (previous == null) return;
        ta.value = previous;
        set(previous);
        fit();
        previous = null;
        undo.hidden = true;
      },
    },
    icon("reuse"),
    "Rückgängig"
  );
  const magic = h(
    "button",
    {
      class: "tool-btn accent",
      onclick: () =>
        ctx.onAutoprompt(f, ta.value, (next) => {
          previous = ta.value;
          ta.value = next;
          set(next);
          fit();
          undo.hidden = false;
        }),
    },
    icon("create"),
    f.role === "negative" ? "Negativ erzeugen" : "Autoprompt"
  );
  return h("div", { class: "ta-wrap" }, ta, h("div", { class: "ta-tools" }, magic, undo));
}

function numberControl(f, value, set) {
  const input = h("input", {
    id: `f-${f.id}`,
    class: "input num",
    type: "text",
    inputmode: f.type === "INT" && (f.min ?? 0) >= 0 ? "numeric" : "decimal",
    value: value ?? "",
    enterkeyhint: "done",
  });
  const step = f.step || (f.type === "INT" ? 1 : 0.1);
  const commit = (v) => {
    const c = clampNumber(f, v);
    if (c == null) {
      input.value = value ?? "";
      return;
    }
    value = c;
    input.value = String(c);
    if (slider) slider.value = String(c);
    set(c);
  };
  input.addEventListener("change", () => commit(Number(input.value.replace(",", "."))));
  input.addEventListener("keydown", (e) => e.key === "Enter" && input.blur());

  const range = f.max != null && f.min != null ? f.max - f.min : Infinity;
  const slider =
    range > 0 && range <= (f.type === "INT" ? 200 : 100) && range / step <= 2000
      ? h("input", {
          type: "range",
          class: "slider",
          min: f.min,
          max: f.max,
          step,
          value: value ?? f.min,
          "aria-label": f.label,
          oninput: (e) => {
            const c = clampNumber(f, Number(e.target.value));
            input.value = String(c);
            value = c;
            set(c);
          },
        })
      : null;

  return h(
    "div",
    { class: "num-wrap" },
    h(
      "div",
      { class: "stepper" },
      h("button", { class: "step-btn", "aria-label": "Weniger", onclick: () => commit(Number(value) - step) }, "−"),
      input,
      h("button", { class: "step-btn", "aria-label": "Mehr", onclick: () => commit(Number(value) + step) }, "+")
    ),
    slider
  );
}

function seedControl(f, value, set, ctx) {
  const mode = ctx.getControl(f) ?? "fixed";
  const input = h("input", {
    id: `f-${f.id}`,
    class: "input num seed",
    type: "text",
    inputmode: "numeric",
    value: value ?? 0,
  });
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (Number.isFinite(n)) set(clampNumber(f, Math.floor(n)));
    else input.value = value;
  });
  const dice = h(
    "button",
    {
      class: "icon-btn outline",
      "aria-label": "Zufälliger Seed",
      onclick: () => {
        const max = Math.min(f.max ?? 2 ** 50, 2 ** 50);
        const v = Math.floor(Math.random() * max);
        input.value = String(v);
        set(v);
      },
    },
    icon("dice")
  );
  const seg = h(
    "div",
    { class: "segmented small", role: "radiogroup", "aria-label": "Seed-Modus" },
    SEED_MODES.map(([m, label]) =>
      h(
        "button",
        {
          class: m === mode ? "on" : "",
          role: "radio",
          "aria-checked": m === mode ? "true" : "false",
          onclick: (e) => {
            ctx.setControl(f, m);
            for (const b of seg.children) b.classList.toggle("on", b === e.currentTarget);
          },
        },
        label
      )
    )
  );
  return h("div", { class: "seed-wrap" }, h("div", { class: "row" }, input, dice), seg);
}

function toggleControl(f, value, set) {
  const label = h("span", { class: "toggle-text" }, value ? f.labelOn ?? "An" : f.labelOff ?? "Aus");
  const input = h("input", {
    id: `f-${f.id}`,
    type: "checkbox",
    class: "switch",
    checked: !!value,
    onchange: (e) => {
      label.textContent = e.target.checked ? f.labelOn ?? "An" : f.labelOff ?? "Aus";
      set(e.target.checked);
    },
  });
  return h("label", { class: "toggle" }, input, label);
}

function comboControl(f, value, set, ctx) {
  const options = f.options ?? [];
  const missing = value != null && value !== "" && !options.includes(value);
  if (options.length <= 12 && options.every((o) => String(o).length <= 28)) {
    const select = h(
      "select",
      { id: `f-${f.id}`, class: `input select${missing ? " warn" : ""}` },
      missing ? h("option", { value: String(value), selected: true }, `${value} (fehlt)`) : null,
      options.map((o) => h("option", { value: String(o), selected: o === value }, String(o)))
    );
    select.addEventListener("change", () => {
      const v = options.find((o) => String(o) === select.value) ?? select.value;
      set(v);
      if (f.dynamic) ctx.onStructureChange?.(f);
    });
    return select;
  }
  const shown = String(value ?? "");
  const slash = Math.max(shown.lastIndexOf("/"), shown.lastIndexOf("\\"));
  const btn = h(
    "button",
    { id: `f-${f.id}`, class: `input picker-btn${missing ? " warn" : ""}` },
    h(
      "span",
      { class: "picker-text" },
      h("span", { class: "picker-name" }, slash >= 0 ? shown.slice(slash + 1) : shown || "—"),
      slash >= 0 ? h("span", { class: "picker-dir" }, shown.slice(0, slash)) : null,
      missing ? h("span", { class: "picker-dir warn-text" }, "Nicht auf dem PC vorhanden") : null
    ),
    icon("down")
  );
  btn.addEventListener("click", async () => {
    const v = await pickOption({ title: f.label, options, value });
    if (v === undefined) return;
    set(v);
    if (f.dynamic) ctx.onStructureChange?.(f);
    else ctx.rerender?.();
  });
  return btn;
}

// --- media inputs (LoadImage & co.) ---------------------------------------------

// "sub/name.png [output]" -> {filename, subfolder, type}
export function parseMediaValue(value) {
  let v = String(value ?? "");
  let type = "input";
  const m = v.match(/^(.*) \[(input|output|temp)\]$/);
  if (m) {
    v = m[1];
    type = m[2];
  }
  const slash = v.lastIndexOf("/");
  return { filename: slash >= 0 ? v.slice(slash + 1) : v, subfolder: slash >= 0 ? v.slice(0, slash) : "", type };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht gelesen werden."));
    };
    img.src = url;
  });
}

// Scales big photos down before upload. Drawing an <img> (rather than an
// ImageBitmap) keeps Safari's EXIF rotation.
async function shrinkImage(file, maxEdge) {
  if (!maxEdge || !file.type.startsWith("image/") || file.type === "image/gif") return file;
  let img;
  try {
    img = await loadImage(file);
  } catch {
    return file;
  }
  const w = img.naturalWidth;
  const hgt = img.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(w, hgt));
  const isHeic = /heic|heif/i.test(file.type);
  if (scale === 1 && !isHeic) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  const type = /jpe?g/i.test(file.type) || isHeic ? "image/jpeg" : "image/png";
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.92));
}

function mediaControl(f, value, set, ctx) {
  const { api } = ctx;
  const accept = { image: "image/*", video: "video/*", audio: "audio/*" }[f.upload];
  const preview = () => {
    if (!value) return h("div", { class: "media-empty" }, icon(f.upload === "image" ? "image" : "file"), "Keine Datei");
    const url = api.viewUrl(parseMediaValue(value), f.upload === "image" ? { preview: "webp;80" } : {});
    if (f.upload === "image") return h("img", { class: "media-thumb", src: url, alt: "" });
    if (f.upload === "video") return h("video", { class: "media-thumb", src: url, muted: true, playsinline: true, preload: "metadata" });
    return h("audio", { src: url, controls: true });
  };
  const box = h("div", { class: "media-preview" }, preview());
  const name = h("div", { class: "media-name" }, String(value ?? ""));
  const fileInput = h("input", { type: "file", accept, hidden: true });
  const status = h("span", { class: "muted small" });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    status.textContent = "Lädt hoch…";
    try {
      const blob = f.upload === "image" ? await shrinkImage(file, ctx.settings.uploadMaxEdge) : file;
      const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : (file.name.split(".").pop() || "bin").toLowerCase();
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const res = await api.uploadImage(blob, `mobile_${stamp}.${ext}`);
      value = res.subfolder ? `${res.subfolder}/${res.name}` : res.name;
      set(value);
      if (f.options && !f.options.includes(value)) f.options.unshift(value);
      box.replaceChildren(preview());
      name.textContent = value;
      status.textContent = "";
    } catch (e) {
      status.textContent = "";
      toast(`Upload fehlgeschlagen: ${e.message}`, { error: true });
    }
  });

  const pickExisting = async () => {
    const opts = f.options ?? [];
    if (!opts.length) return toast("Im Eingabe-Ordner liegen keine Dateien.");
    const v = await pickOption({
      title: "Aus dem Eingabe-Ordner",
      options: opts,
      value,
      thumb: f.upload === "image" ? (o) => api.viewUrl(parseMediaValue(o), { preview: "webp;50" }) : null,
    });
    if (v === undefined) return;
    value = v;
    set(v);
    box.replaceChildren(preview());
    name.textContent = v;
  };

  const label = { image: "Foto wählen", video: "Video wählen", audio: "Audio wählen" }[f.upload];
  return h(
    "div",
    { class: "media" },
    box,
    h(
      "div",
      { class: "media-side" },
      name,
      h("button", { class: "btn", onclick: () => fileInput.click() }, icon("upload"), label),
      h("button", { class: "btn ghost", onclick: pickExisting }, icon("folder"), "Vorhandene"),
      status,
      fileInput
    )
  );
}

// --- width × height pair ----------------------------------------------------------

const RATIOS = [
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
  ["5:4", 5 / 4],
  ["4:3", 4 / 3],
  ["3:2", 3 / 2],
  ["16:9", 16 / 9],
];

export function renderSizePair(wf, hf, w, hv, ctx) {
  const grid = (w * hv) >= 400 * 400 ? 64 : 8;
  const round = (v, f) => clampNumber(f, Math.max(grid, Math.round(v / grid) * grid));
  const wIn = h("input", { class: "input num", type: "text", inputmode: "numeric", value: w, "aria-label": wf.label });
  const hIn = h("input", { class: "input num", type: "text", inputmode: "numeric", value: hv, "aria-label": hf.label });
  const apply = (nw, nh) => {
    w = nw;
    hv = nh;
    wIn.value = String(nw);
    hIn.value = String(nh);
    ctx.onChange(wf, nw);
    ctx.onChange(hf, nh);
    markChips();
  };
  wIn.addEventListener("change", () => {
    const v = clampNumber(wf, Number(wIn.value));
    if (v == null) wIn.value = w;
    else apply(v, hv);
  });
  hIn.addEventListener("change", () => {
    const v = clampNumber(hf, Number(hIn.value));
    if (v == null) hIn.value = hv;
    else apply(w, v);
  });
  const chips = h(
    "div",
    { class: "chips" },
    RATIOS.map(([label, r]) =>
      h(
        "button",
        {
          class: "chip",
          dataset: { ratio: r },
          onclick: () => {
            const area = w * hv;
            apply(round(Math.sqrt(area * r), wf), round(Math.sqrt(area / r), hf));
          },
        },
        label
      )
    )
  );
  const markChips = () => {
    for (const c of chips.children) c.classList.toggle("on", Math.abs(w / hv - Number(c.dataset.ratio)) < 0.02);
  };
  markChips();
  const errors = [ctx.errors?.get(wf.id), ctx.errors?.get(hf.id)].filter(Boolean);
  return h(
    "div",
    { class: `field wide${errors.length ? " has-error" : ""}` },
    h("div", { class: "field-head" }, h("span", { class: "field-label" }, "Größe", wf.sublabel ? h("span", { class: "field-sub" }, wf.sublabel) : null)),
    h(
      "div",
      { class: "size-row" },
      wIn,
      h("span", { class: "times" }, "×"),
      hIn,
      h("button", { class: "icon-btn outline", "aria-label": "Tauschen", onclick: () => apply(hv, w) }, icon("swap"))
    ),
    chips,
    errors.map((e) => h("p", { class: "field-error" }, e))
  );
}
