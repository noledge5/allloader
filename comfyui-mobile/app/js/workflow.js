// The "template" the phone edits: an API-format prompt plus (when known) the
// UI workflow it came from, per-seed "control" modes and the field model the
// Create screen renders.

import {
  CONTROL_VALUES,
  collectClassTypes,
  comboOptions,
  convertWorkflow,
  dynamicComboInputs,
  defaultValue,
  hasControl,
  isApiPrompt,
  isUiWorkflow,
  orderedInputs,
  specType,
  writeBack,
} from "./converter.js";

const STORAGE_KEY = "comfy-mobile.current";
const PINS_PREFIX = "comfy-mobile.pins.";

// --- loading -----------------------------------------------------------------

export async function templateFromJson(api, json, { name, source }) {
  if (isApiPrompt(json)) return templateFromPrompt(api, json, null, { name, source });
  if (isUiWorkflow(json)) {
    const defs = await api.ensureDefs(collectClassTypes(json));
    const conv = convertWorkflow(json, defs);
    return finishTemplate(api, {
      name,
      source,
      ui: json,
      prompt: conv.prompt,
      conv,
    });
  }
  throw new Error("Diese Datei enthält keinen ComfyUI-Workflow.");
}

// From a finished job: its exact API prompt, plus the embedded UI workflow
// (if it was queued from ComfyUI's own frontend) for seed modes and saving.
export async function templateFromJob(api, job) {
  const prompt = job.workflow?.prompt;
  if (!isApiPrompt(prompt)) throw new Error("Dieser Eintrag enthält keinen verwendbaren Prompt.");
  const ui = job.workflow?.extra_data?.extra_pnginfo?.workflow;
  const name = (job.workflow?.extra_data?.comfy_mobile_name || summarizePrompt(prompt) || "Aus dem Verlauf").slice(0, 60);
  return templateFromPrompt(api, prompt, isUiWorkflow(ui) ? ui : null, { name, source: { kind: "job", id: job.id } });
}

async function templateFromPrompt(api, prompt, ui, { name, source }) {
  prompt = structuredClone(prompt);
  let conv = null;
  if (ui) {
    try {
      const defs = await api.ensureDefs(collectClassTypes(ui));
      conv = convertWorkflow(ui, defs);
      // Only keep bindings for nodes that really are the same node.
      for (const id of Object.keys(conv.bindings)) {
        if (prompt[id]?.class_type !== conv.prompt[id]?.class_type) delete conv.bindings[id];
      }
    } catch {
      conv = null;
      ui = null;
    }
  }
  return finishTemplate(api, { name, source, ui, prompt, conv });
}

async function finishTemplate(api, { name, source, ui, prompt, conv }) {
  const classTypes = new Set(Object.values(prompt).map((n) => n.class_type));
  const defs = await api.ensureDefs(classTypes);
  const missing = new Set(conv?.missing ?? []);
  for (const c of classTypes) if (!defs[c]) missing.add(c);
  const template = {
    key: signature(prompt),
    name: name || "Workflow",
    source,
    ui: ui ?? null,
    prompt,
    bindings: conv?.bindings ?? {},
    controls: {},
    exposed: conv?.exposed ?? [],
    missing: [...missing],
    uncertain: conv?.uncertainNodes ?? [],
    uiStale: false,
  };
  // Seed modes: what the workflow had, else "randomize" for seeds.
  for (const [id, node] of Object.entries(prompt)) {
    const def = defs[node.class_type];
    for (const name of Object.keys(node.inputs)) {
      const spec = def && inputSpec(def, name, node.inputs);
      if (!spec || !hasControl(name, spec) || Array.isArray(node.inputs[name])) continue;
      const fromWorkflow = conv?.controls?.[id]?.[name];
      const fallback = typeof spec[1]?.control_after_generate === "string" ? spec[1].control_after_generate : null;
      const mode = fromWorkflow ?? (fallback && CONTROL_VALUES.has(fallback) ? fallback : null) ?? (isSeedName(name) ? "randomize" : "fixed");
      (template.controls[id] ??= {})[name] = mode;
    }
  }
  return template;
}

function isSeedName(name) {
  return name === "seed" || name === "noise_seed";
}

function signature(prompt) {
  const s = Object.entries(prompt)
    .map(([id, n]) => `${id}:${n.class_type}`)
    .sort()
    .join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function summarizePrompt(prompt) {
  for (const node of Object.values(prompt ?? {})) {
    for (const [k, v] of Object.entries(node.inputs ?? {})) {
      if (typeof v === "string" && v.trim().length > 8 && /text|prompt|value/i.test(k)) {
        return v.trim().replace(/\s+/g, " ");
      }
    }
  }
  return "";
}

// --- persistence ----------------------------------------------------------------

export function saveCurrent(template) {
  try {
    if (!template) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const { key, name, source, ui, prompt, controls, uiStale } = template;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key, name, source, ui, prompt, controls, uiStale }));
  } catch {
    // Storage full or unavailable: the template just won't survive a reload.
  }
}

export async function restoreCurrent(api) {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
  if (!saved?.prompt) return null;
  const t = await templateFromPrompt(api, saved.prompt, saved.ui, { name: saved.name, source: saved.source });
  t.controls = { ...t.controls, ...(saved.controls ?? {}) };
  t.uiStale = !!saved.uiStale;
  return t;
}

export function loadPins(template) {
  try {
    const raw = localStorage.getItem(PINS_PREFIX + template.key);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function savePins(template, pins) {
  try {
    localStorage.setItem(PINS_PREFIX + template.key, JSON.stringify([...pins]));
  } catch {}
}

// --- input specs -----------------------------------------------------------------

// Spec for an API input name, following dynamic combos ("format.codec").
export function inputSpec(def, name, inputs) {
  const parts = name.split(".");
  let list = orderedInputs(def.input, def.input_order);
  let prefix = "";
  for (let i = 0; i < parts.length; i++) {
    const entry = list.find(([n]) => n === parts[i]);
    if (!entry) return null;
    if (i === parts.length - 1) return entry[1];
    prefix += (prefix ? "." : "") + parts[i];
    if (entry[1][0] !== "COMFY_DYNAMICCOMBO_V3") return null;
    list = dynamicComboInputs(entry[1], inputs[prefix]);
  }
  return null;
}

// After a dynamic combo changes, swap its sub-inputs for the new option's.
export function applyDynamicCombo(node, name, spec) {
  for (const key of Object.keys(node.inputs)) if (key.startsWith(name + ".")) delete node.inputs[key];
  const add = (inputs, prefix) => {
    for (const [sub, subSpec] of inputs) {
      const full = `${prefix}.${sub}`;
      const v = defaultValue(subSpec);
      if (v !== undefined) node.inputs[full] = v;
      if (subSpec[0] === "COMFY_DYNAMICCOMBO_V3") add(dynamicComboInputs(subSpec, v), full);
    }
  };
  add(dynamicComboInputs(spec, node.inputs[name]), name);
}

// --- field model ------------------------------------------------------------------

const LABELS = {
  text: "Prompt",
  prompt: "Prompt",
  negative_prompt: "Negativ-Prompt",
  seed: "Seed",
  noise_seed: "Seed",
  steps: "Schritte",
  cfg: "CFG",
  sampler_name: "Sampler",
  scheduler: "Scheduler",
  denoise: "Denoise",
  guidance: "Guidance",
  width: "Breite",
  height: "Höhe",
  batch_size: "Bilder pro Lauf",
  length: "Länge (Frames)",
  ckpt_name: "Checkpoint",
  unet_name: "Diffusion-Modell",
  lora_name: "LoRA",
  strength_model: "LoRA-Stärke",
  strength_clip: "LoRA-Stärke (CLIP)",
  vae_name: "VAE",
  clip_name: "Text-Encoder",
  clip_name1: "Text-Encoder 1",
  clip_name2: "Text-Encoder 2",
  image: "Eingabebild",
  video: "Eingabevideo",
  file: "Datei",
  audio: "Audio",
  filename_prefix: "Dateiname",
  megapixels: "Megapixel",
  aspect_ratio: "Seitenverhältnis",
  fps: "FPS",
  frame_rate: "Framerate",
  shift: "Shift",
  upscale_method: "Skalierung",
  scale_by: "Faktor",
  control_net_name: "ControlNet",
  strength: "Stärke",
};

const QUICK_NAMES = new Set([
  "seed",
  "noise_seed",
  "steps",
  "cfg",
  "denoise",
  "guidance",
  "sampler_name",
  "scheduler",
  "width",
  "height",
  "batch_size",
  "length",
  "ckpt_name",
  "unet_name",
  "lora_name",
  "strength_model",
]);

const PRIMITIVE_CLASSES = /^Primitive(Int|Float|String|StringMultiline|Boolean|Node)?$/;

// Sort order for quick fields.
function quickRank(f) {
  if (f.multiline) return f.role === "negative" ? 1 : 0;
  if (f.upload) return 2;
  if (["ckpt_name", "unet_name"].includes(f.input)) return 3;
  if (["lora_name", "strength_model", "strength_clip"].includes(f.input)) return 4;
  if (["width", "height", "batch_size", "length", "megapixels", "aspect_ratio"].includes(f.input)) return 5;
  if (/^(breite|höhe|width|height)$/i.test(f.label)) return 5;
  if (f.seed) return 6;
  if (["steps", "cfg", "guidance", "sampler_name", "scheduler", "denoise"].includes(f.input)) return 7;
  return 8;
}

function uploadKind(spec) {
  const o = spec?.[1] ?? {};
  if (o.image_upload) return "image";
  if (o.video_upload) return "video";
  if (o.audio_upload) return "audio";
  return null;
}

function topoOrder(prompt) {
  const order = [];
  const seen = new Set();
  const visit = (id, depth) => {
    if (seen.has(id) || !prompt[id] || depth > 500) return;
    seen.add(id);
    for (const v of Object.values(prompt[id].inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") visit(v[0], depth + 1);
    }
    order.push(id);
  };
  for (const id of Object.keys(prompt)) visit(id, 0);
  return order;
}

// Which sampler input a text node's conditioning ends up in.
function promptRole(prompt, nodeId) {
  const consumers = {};
  for (const [id, node] of Object.entries(prompt)) {
    for (const [name, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2) (consumers[v[0]] ??= []).push({ id, name });
    }
  }
  const queue = [[nodeId, 0]];
  const seen = new Set();
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (seen.has(id) || depth > 6) continue;
    seen.add(id);
    for (const c of consumers[id] ?? []) {
      if (/negative/i.test(c.name)) return "negative";
      if (/positive/i.test(c.name)) return "positive";
      queue.push([c.id, depth + 1]);
    }
  }
  return null;
}

export function buildFields(template, defs) {
  const { prompt } = template;
  const exposed = new Map(template.exposed.map((e) => [`${e.nodeId}|${e.input}`, e]));
  const groups = [];
  const all = [];

  for (const nodeId of topoOrder(prompt)) {
    const node = prompt[nodeId];
    const def = defs[node.class_type];
    const title = node._meta?.title || def?.display_name || node.class_type;
    const customTitle = def && title !== def.display_name && title !== node.class_type;
    const fields = [];
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue;
      const spec = def ? inputSpec(def, input, node.inputs) : null;
      if (spec?.[1]?.hidden) continue;
      const type = spec ? specType(spec) : guessType(value);
      if (!["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COMFY_DYNAMICCOMBO_V3"].includes(type)) continue;
      const opts = spec?.[1] ?? {};
      const id = `${nodeId}|${input}`;
      const f = {
        id,
        nodeId,
        input,
        classType: node.class_type,
        spec,
        type: type === "COMFY_DYNAMICCOMBO_V3" ? "COMBO" : type,
        dynamic: type === "COMFY_DYNAMICCOMBO_V3",
        options: type === "COMBO" || type === "COMFY_DYNAMICCOMBO_V3" ? comboOptions(spec ?? [[]]) : null,
        multiline: type === "STRING" && !!opts.multiline,
        min: opts.min,
        max: opts.max,
        step: opts.step,
        round: opts.round,
        labelOn: opts.label_on,
        labelOff: opts.label_off,
        // Int primitives carry a "control" too; only treat seeds (or values
        // the workflow actually randomizes) as seeds.
        seed:
          !!spec &&
          hasControl(input, spec) &&
          (/seed/i.test(input) || /seed/i.test(title) || (template.controls[nodeId]?.[input] ?? "fixed") !== "fixed"),
        upload: uploadKind(spec),
        advanced: !!opts.advanced,
        tooltip: opts.tooltip,
        nodeTitle: title,
        exposed: exposed.get(id),
        inSubgraph: nodeId.includes(":"),
      };
      f.role = f.multiline ? promptRole(prompt, nodeId) : null;
      f.label = fieldLabel(f, customTitle ? title : null);
      fields.push(f);
      all.push(f);
    }
    if (fields.length) groups.push({ nodeId, title, classType: node.class_type, fields });
  }

  // Disambiguate identical labels ("Seed" twice) with the node title.
  const counts = {};
  for (const f of all) counts[f.label] = (counts[f.label] ?? 0) + 1;
  for (const f of all) if (counts[f.label] > 1 && f.label !== f.nodeTitle) f.sublabel = f.nodeTitle;

  let pins = loadPins(template);
  const defaults = new Set(all.filter(isDefaultQuick).map((f) => f.id));
  if (!pins) pins = defaults;
  const quick = all.filter((f) => pins.has(f.id)).sort((a, b) => quickRank(a) - quickRank(b));
  return { groups, quick, pins, all };
}

function isDefaultQuick(f) {
  if (f.exposed) return true;
  if (f.inSubgraph) return false;
  if (f.multiline) return true;
  if (f.upload) return true;
  if (PRIMITIVE_CLASSES.test(f.classType)) return true;
  if (f.advanced) return false;
  return QUICK_NAMES.has(f.input);
}

function fieldLabel(f, customTitle) {
  if (f.exposed?.label && !/^(value|text|string_[ab])(_\d+)?$/.test(f.exposed.label)) return LABELS[f.exposed.label] ?? prettify(f.exposed.label);
  if (f.multiline) {
    if (customTitle) return customTitle;
    if (f.role === "negative") return "Negativ-Prompt";
    if (f.role === "positive") return "Prompt";
    return LABELS[f.input] ?? prettify(f.input);
  }
  if (PRIMITIVE_CLASSES.test(f.classType) && f.input === "value") return customTitle || f.nodeTitle;
  if (customTitle && f.input === "value") return customTitle;
  return LABELS[f.input] ?? prettify(f.input);
}

function prettify(name) {
  const s = String(name).replace(/[._]+/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function guessType(v) {
  if (typeof v === "number") return Number.isInteger(v) ? "INT" : "FLOAT";
  if (typeof v === "boolean") return "BOOLEAN";
  if (typeof v === "string") return "STRING";
  return "UNKNOWN";
}

// --- running ---------------------------------------------------------------------

function randomSeed(spec) {
  const min = Math.max(spec?.[1]?.min ?? 0, 0);
  const max = Math.min(spec?.[1]?.max ?? 2 ** 50, 2 ** 50);
  return min + Math.floor(Math.random() * (max - min + 1));
}

// Applies seed modes (in place, so the screen shows the seed that ran) and
// returns the prompt + extra data for POST /prompt.
export function prepareRun(template, defs) {
  for (const [id, modes] of Object.entries(template.controls)) {
    const node = template.prompt[id];
    if (!node) continue;
    for (const [name, mode] of Object.entries(modes)) {
      const v = node.inputs[name];
      if (typeof v !== "number") continue;
      const spec = defs[node.class_type] && inputSpec(defs[node.class_type], name, node.inputs);
      const min = spec?.[1]?.min ?? 0;
      const max = spec?.[1]?.max ?? Number.MAX_SAFE_INTEGER;
      if (mode === "randomize") node.inputs[name] = randomSeed(spec);
      else if (mode === "increment") node.inputs[name] = v + 1 > max ? min : v + 1;
      else if (mode === "decrement") node.inputs[name] = v - 1 < min ? max : v - 1;
    }
  }
  const extra = { comfy_mobile_name: template.name };
  if (template.ui && !template.uiStale) {
    try {
      writeBack(template.prompt, template.bindings);
      extra.extra_pnginfo = { workflow: structuredClone(template.ui) };
    } catch {}
  }
  return { prompt: structuredClone(template.prompt), extraData: extra };
}

// UI workflow with the phone's edits, for saving back to ComfyUI.
export function workflowForSaving(template) {
  if (!template.ui || template.uiStale) return null;
  writeBack(template.prompt, template.bindings);
  return structuredClone(template.ui);
}

// --- files -------------------------------------------------------------------------

// ComfyUI embeds "workflow" and "prompt" as PNG text chunks.
export async function readPngMetadata(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!sig.every((b, i) => buf[i] === b)) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const latin1 = new TextDecoder("latin1");
  const utf8 = new TextDecoder("utf-8");
  const out = {};
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = view.getUint32(pos);
    const type = latin1.decode(buf.subarray(pos + 4, pos + 8));
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "tEXt") {
      const nul = data.indexOf(0);
      if (nul > 0) out[latin1.decode(data.subarray(0, nul))] = utf8.decode(data.subarray(nul + 1));
    } else if (type === "iTXt") {
      const nul = data.indexOf(0);
      const compressed = data[nul + 1];
      let p = nul + 3;
      p = data.indexOf(0, p) + 1; // language tag
      p = data.indexOf(0, p) + 1; // translated keyword
      if (nul > 0 && !compressed) out[latin1.decode(data.subarray(0, nul))] = utf8.decode(data.subarray(p));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  return out;
}

export async function readWorkflowFile(file) {
  if (file.type === "image/png" || /\.png$/i.test(file.name)) {
    const meta = await readPngMetadata(file);
    const raw = meta?.workflow || meta?.prompt;
    if (!raw) throw new Error("Dieses Bild enthält keinen ComfyUI-Workflow.");
    return JSON.parse(raw);
  }
  return JSON.parse(await file.text());
}

// --- run summary (gallery info) ---------------------------------------------------

const DESCRIBE = {
  seed: "Seed",
  noise_seed: "Seed",
  steps: "Schritte",
  cfg: "CFG",
  guidance: "Guidance",
  sampler_name: "Sampler",
  scheduler: "Scheduler",
  denoise: "Denoise",
  ckpt_name: "Checkpoint",
  unet_name: "Modell",
  lora_name: "LoRA",
  width: "Breite",
  height: "Höhe",
};

// Key settings of an API prompt as [label, value] rows.
export function describePrompt(prompt) {
  const rows = [];
  const seen = new Set();
  let prompts = 0;
  const add = (label, value) => {
    const key = `${label}\u0000${value}`;
    if (value === undefined || value === "" || seen.has(key)) return;
    seen.add(key);
    rows.push([label, String(value)]);
  };
  for (const id of topoOrder(prompt ?? {})) {
    const node = prompt[id];
    for (const [k, v] of Object.entries(node.inputs ?? {})) {
      if (v == null || typeof v === "object") continue;
      if (typeof v === "string" && v.trim().length > 12 && /text|prompt|string|value/i.test(k) && prompts < 3) {
        prompts++;
        add(promptRole(prompt, id) === "negative" ? "Negativ-Prompt" : "Prompt", v.trim());
      } else if (DESCRIBE[k] && typeof v !== "boolean") {
        add(DESCRIBE[k], v);
      }
    }
  }
  return rows;
}
