// Converts ComfyUI workflows from the UI format (what ComfyUI saves: nodes +
// links + subgraph definitions) into the API format that POST /prompt expects.
//
// It mirrors the frontend's graphToPrompt: muted/bypassed nodes, reroutes,
// legacy PrimitiveNodes, subgraphs (also nested) and dynamic combos are
// resolved the same way. Widget values are matched to input names with a
// type-aware alignment, because widgets_values also holds UI-only entries
// (seed "control after generate", upload buttons, ...).
//
// Besides the prompt it returns "bindings": for every API input that came from
// a widget, where that value lives in the UI workflow. Writing edited values
// back through them keeps an embedded workflow in sync with what was run.

export const MODE_NEVER = 2;
export const MODE_BYPASS = 4;

const SUBGRAPH_INPUT_ID = -10;
const SUBGRAPH_OUTPUT_ID = -20;

export const CONTROL_VALUES = new Set(["fixed", "increment", "decrement", "randomize", "increment-wrap"]);
const BUTTON_VALUES = new Set(["image", "video", "audio", "file", "upload3dmodel", "uploadExtraResources", "clear"]);
const WIDGET_TYPES = new Set(["INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COMFY_DYNAMICCOMBO_V3"]);

// Frontend-only nodes that never reach the server.
const PASSIVE_TYPES = new Set(["Note", "MarkdownNote", "PrimitiveNode", "Reroute", "Reroute (rgthree)", "SetNode", "GetNode"]);
const REROUTE_TYPES = new Set(["Reroute", "Reroute (rgthree)"]);

export class ConversionError extends Error {}

export function isApiPrompt(json) {
  if (!json || typeof json !== "object" || Array.isArray(json) || Array.isArray(json.nodes)) return false;
  const values = Object.values(json);
  return values.length > 0 && values.every((n) => n && typeof n === "object" && typeof n.class_type === "string");
}

export function isUiWorkflow(json) {
  return !!json && typeof json === "object" && Array.isArray(json.nodes);
}

// All node class names a workflow uses (including inside subgraphs), so their
// definitions can be fetched before converting.
export function collectClassTypes(workflow) {
  const subgraphIds = new Set((workflow.definitions?.subgraphs ?? []).map((s) => s.id));
  const types = new Set();
  const visit = (nodes) => {
    for (const n of nodes ?? []) {
      if (!subgraphIds.has(n.type) && !PASSIVE_TYPES.has(n.type)) types.add(n.type);
    }
  };
  visit(workflow.nodes);
  for (const s of workflow.definitions?.subgraphs ?? []) visit(s.nodes);
  return types;
}

// ---------------------------------------------------------------------------
// Input specs

export function orderedInputs(inputDef, inputOrder) {
  const out = [];
  for (const section of ["required", "optional"]) {
    const specs = inputDef?.[section];
    if (!specs) continue;
    const names = inputOrder?.[section] ?? Object.keys(specs);
    const seen = new Set();
    for (const name of names) {
      if (specs[name] && !seen.has(name)) {
        seen.add(name);
        out.push([name, specs[name]]);
      }
    }
    for (const name of Object.keys(specs)) if (!seen.has(name)) out.push([name, specs[name]]);
  }
  return out;
}

export function specType(spec) {
  const [type, opts] = spec;
  if (Array.isArray(type)) return "COMBO";
  return opts?.widgetType || type;
}

export function comboOptions(spec) {
  const [type, opts] = spec;
  if (Array.isArray(type)) return type;
  if (type === "COMFY_DYNAMICCOMBO_V3") return (opts?.options ?? []).map((o) => o.key);
  return opts?.options ?? [];
}

export function isWidgetSpec(spec) {
  const [type, opts = {}] = spec;
  if (opts.forceInput) return false;
  if (Array.isArray(type) || opts.widgetType || opts.socketless) return true;
  return WIDGET_TYPES.has(type);
}

export function hasControl(name, spec) {
  const opts = spec[1] ?? {};
  if (opts.control_after_generate) return true;
  return specType(spec) === "INT" && (name === "seed" || name === "noise_seed");
}

export function defaultValue(spec) {
  const opts = spec[1] ?? {};
  if (opts.default !== undefined) return opts.default;
  switch (specType(spec)) {
    case "COMBO":
    case "COMFY_DYNAMICCOMBO_V3":
      return comboOptions(spec)[0];
    case "INT":
    case "FLOAT":
      return opts.min > 0 ? opts.min : 0;
    case "BOOLEAN":
      return false;
    case "STRING":
      return "";
    default:
      return undefined;
  }
}

// Sub-inputs a dynamic combo adds for the selected option, as [name, spec].
export function dynamicComboInputs(spec, value) {
  const option = (spec[1]?.options ?? []).find((o) => o.key === value);
  return option ? orderedInputs(option.inputs, option.input_order) : [];
}

// Flat widget list of a node given the current dynamic-combo selections.
// `pick(fullName)` returns the selected key for a dynamic combo.
function widgetList(def, pick) {
  const out = [];
  const walk = (inputs, prefix) => {
    for (const [name, spec] of inputs) {
      if (!isWidgetSpec(spec)) continue;
      const full = prefix + name;
      out.push({ name: full, spec });
      if (spec[0] === "COMFY_DYNAMICCOMBO_V3") walk(dynamicComboInputs(spec, pick(full, spec)), full + ".");
    }
  };
  walk(orderedInputs(def.input, def.input_order), "");
  return out;
}

// ---------------------------------------------------------------------------
// Widget value alignment

function assignCost(spec, v) {
  if (v === undefined) return 3;
  const type = specType(spec);
  if (type === "COMBO" || type === "COMFY_DYNAMICCOMBO_V3") {
    const options = comboOptions(spec);
    if (options.includes(v)) return 0;
    if (typeof v === "string") return CONTROL_VALUES.has(v) || BUTTON_VALUES.has(v) ? 2 : 0.5;
    if (typeof v === "number" && options.some((o) => typeof o === "number")) return 0.5;
    return 4;
  }
  switch (type) {
    case "INT":
    case "FLOAT":
      if (typeof v === "number") return 0;
      return typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? 1 : 4;
    case "BOOLEAN":
      return typeof v === "boolean" ? 0 : 4;
    case "STRING":
      if (typeof v !== "string") return 3;
      return CONTROL_VALUES.has(v) || BUTTON_VALUES.has(v) ? 0.8 : 0;
    default:
      return v === null ? 1 : 0.2;
  }
}

function skipCost(v) {
  return v === null || CONTROL_VALUES.has(v) || BUTTON_VALUES.has(v) ? 0.3 : 2.5;
}

// A widget without a value is normal at the end (the node gained inputs
// since the workflow was saved) but suspicious in the middle.
const MISSING_COST = 3;
const MISSING_AT_END_COST = 0.1;

// Returns, for each widget, the index into `values` it takes (or -1).
function align(widgets, values) {
  const m = widgets.length;
  const n = values.length;
  const dp = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const move = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1)); // 1 assign, 2 skip value, 3 missing
  for (let j = 1; j <= n; j++) {
    dp[0][j] = dp[0][j - 1] + skipCost(values[j - 1]);
    move[0][j] = 2;
  }
  for (let i = 1; i <= m; i++) {
    dp[i][0] = dp[i - 1][0] + (n === 0 ? MISSING_AT_END_COST : MISSING_COST);
    move[i][0] = 3;
    for (let j = 1; j <= n; j++) {
      // On ties prefer skipping/leaving out the *later* item, so values stay
      // aligned to the front like the frontend's index-based assignment.
      let best = dp[i][j - 1] + skipCost(values[j - 1]);
      let mv = 2;
      const miss = dp[i - 1][j] + (j === n ? MISSING_AT_END_COST : MISSING_COST);
      if (miss < best - 1e-9) {
        best = miss;
        mv = 3;
      }
      const assign = dp[i - 1][j - 1] + assignCost(widgets[i - 1].spec, values[j - 1]);
      if (assign < best - 1e-9) {
        best = assign;
        mv = 1;
      }
      dp[i][j] = best;
      move[i][j] = mv;
    }
  }
  const result = new Array(m).fill(-1);
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (mv === 1) result[--i] = --j;
    else if (mv === 2) j--;
    else i--;
  }
  return result;
}

// Core nodes whose widgets are created by frontend extensions and therefore
// don't show up in the node definition.
const SPECIAL_WIDGETS = {
  // [choice, index, option1, option2, ...]
  CustomCombo(node, def, list) {
    const values = {};
    const bindings = {};
    const names = ["choice", "index", ...list.slice(2).map((_, i) => `option${i + 1}`)];
    names.forEach((name, i) => {
      if (i < list.length) {
        values[name] = list[i];
        bindings[name] = [{ node, index: i }];
      }
    });
    return { values, bindings, controls: {}, uncertain: false };
  },
};

// Values the frontend always sends for display-only widgets.
const WIDGET_TYPE_DEFAULTS = {
  IMAGECOMPARE: () => ["", ""],
};

// Maps a UI node's widgets_values onto input names.
// Returns { values: {name: value}, bindings: {name: [{node, index|key}]},
//           controls: {name: mode}, uncertain: bool }
export function mapWidgetValues(node, def) {
  const raw = node.widgets_values;
  const values = {};
  const bindings = {};
  const controls = {};

  if (raw && !Array.isArray(raw) && typeof raw === "object") {
    for (const w of widgetList(def, (name, spec) => raw[name] ?? defaultValue(spec))) {
      if (w.name in raw) {
        values[w.name] = raw[w.name];
        bindings[w.name] = [{ node, key: w.name }];
      } else {
        values[w.name] = defaultValue(w.spec);
      }
    }
    return { values, bindings, controls, uncertain: false };
  }

  const list = Array.isArray(raw) ? raw : [];
  const special = SPECIAL_WIDGETS[node.type];
  if (special) return special(node, def, list);
  // Dynamic combos change the widget list depending on their own value, so
  // iterate until the selections are stable.
  let picks = new Map();
  let widgets;
  let assignment;
  for (let round = 0; round < 4; round++) {
    widgets = widgetList(def, (name, spec) => (picks.has(name) ? picks.get(name) : defaultValue(spec)));
    assignment = align(widgets, list);
    let changed = false;
    const next = new Map();
    widgets.forEach((w, i) => {
      if (w.spec[0] !== "COMFY_DYNAMICCOMBO_V3") return;
      const v = assignment[i] >= 0 ? list[assignment[i]] : defaultValue(w.spec);
      next.set(w.name, v);
      if (picks.get(w.name) !== v) changed = true;
    });
    picks = next;
    if (!changed) break;
  }

  let uncertain = false;
  widgets.forEach((w, i) => {
    const j = assignment[i];
    if (j >= 0) {
      values[w.name] = list[j];
      bindings[w.name] = [{ node, index: j }];
      if (assignCost(w.spec, list[j]) >= 1.5) uncertain = true;
      const next = list[j + 1];
      if (hasControl(w.name, w.spec) && CONTROL_VALUES.has(next) && !assignment.includes(j + 1)) {
        controls[w.name] = next;
      }
    } else {
      const fallback = WIDGET_TYPE_DEFAULTS[specType(w.spec)];
      values[w.name] = fallback ? fallback() : defaultValue(w.spec);
    }
  });
  return { values, bindings, controls, uncertain };
}

// ---------------------------------------------------------------------------
// Graph flattening

function normalizeLinks(links) {
  const map = new Map();
  for (const l of links ?? []) {
    if (Array.isArray(l)) {
      const [id, origin_id, origin_slot, target_id, target_slot, type] = l;
      map.set(String(id), { id, origin_id, origin_slot, target_id, target_slot, type });
    } else if (l && typeof l === "object") {
      map.set(String(l.id), l);
    }
  }
  return map;
}

function typesMatch(a, b) {
  if (!a || !b || a === "*" || b === "*") return true;
  const as = String(a).toLowerCase().split(",");
  const bs = String(b).toLowerCase().split(",");
  return as.some((x) => bs.includes(x));
}

function wrapValue(v) {
  return Array.isArray(v) ? { __value__: v } : v;
}

class Converter {
  constructor(workflow, defs) {
    this.defs = defs;
    this.subgraphDefs = new Map((workflow.definitions?.subgraphs ?? []).map((s) => [s.id, s]));
    this.graphs = new Map();
    this.dtos = new Map();
    this.warnings = [];
    this.missing = new Set();
    this.uncertainNodes = [];
    this.mappedCache = new Map();
    this.expand(this.makeGraph(workflow, null), [], null, 0);
  }

  makeGraph(g, def) {
    return {
      def,
      nodes: new Map((g.nodes ?? []).map((n) => [String(n.id), n])),
      links: normalizeLinks(g.links),
    };
  }

  graphFor(subgraphId) {
    if (!this.graphs.has(subgraphId)) {
      const def = this.subgraphDefs.get(subgraphId);
      this.graphs.set(subgraphId, this.makeGraph(def, def));
    }
    return this.graphs.get(subgraphId);
  }

  isSubgraphNode(node) {
    return this.subgraphDefs.has(node.type);
  }

  expand(graph, path, instance, depth) {
    if (depth > 32) throw new ConversionError("Subgraphs sind zu tief verschachtelt.");
    for (const node of graph.nodes.values()) {
      const execId = [...path, node.id].join(":");
      const dto = { execId, node, graph, path, instance };
      this.dtos.set(execId, dto);
      // Like the frontend, only a top-level instance's mode decides whether
      // its contents are included; nested instances are always expanded.
      const active = depth > 0 || (node.mode !== MODE_NEVER && node.mode !== MODE_BYPASS);
      if (this.isSubgraphNode(node) && active) {
        this.expand(this.graphFor(node.type), [...path, node.id], dto, depth + 1);
      }
    }
  }

  dtoFor(path, nodeId) {
    return this.dtos.get([...path, nodeId].join(":"));
  }

  resolveInput(dto, index, visited) {
    const input = dto.node.inputs?.[index];
    if (!input || input.link == null) return null;
    return this.resolveLink(dto, input.link, input.type, visited);
  }

  mapped(node) {
    if (!this.mappedCache.has(node)) {
      const def = this.defs[node.type];
      this.mappedCache.set(node, def ? mapWidgetValues(node, def) : null);
    }
    return this.mappedCache.get(node);
  }

  // A link inside a subgraph that starts at the subgraph's input node leads
  // to the matching input of the instance node one level up. If that input
  // isn't connected, the value comes from the instance's own widget (older
  // subgraphs) or from the inner widget it promotes (newer ones).
  resolveSubgraphInput(instance, def, slot, visited) {
    const sgInput = def.inputs?.[slot];
    if (!instance || !sgInput) return null;
    const idx = (instance.node.inputs ?? []).findIndex((i) => i.name === sgInput.name);
    if (idx >= 0 && instance.node.inputs[idx].link != null) return this.resolveInput(instance, idx, visited);
    return this.subgraphInputValue(instance.node, def, slot);
  }

  subgraphInputValue(instanceNode, def, slot) {
    const graph = this.graphFor(def.id);
    const widgetTargets = (input) => {
      const out = [];
      for (const linkId of input.linkIds ?? []) {
        const l = graph.links.get(String(linkId));
        const target = l && graph.nodes.get(String(l.target_id));
        const name = target?.inputs?.[l.target_slot]?.widget?.name;
        if (name) out.push({ node: target, name });
      }
      return out;
    };
    const wv = instanceNode.widgets_values;
    if (Array.isArray(wv) && wv.length) {
      let wi = 0;
      for (let k = 0; k < slot; k++) if (widgetTargets(def.inputs[k]).length) wi++;
      if (widgetTargets(def.inputs[slot]).length && wi < wv.length) {
        return { value: wv[wi], binding: { node: instanceNode, index: wi }, label: def.inputs[slot].label ?? def.inputs[slot].name };
      }
    }
    for (const t of widgetTargets(def.inputs[slot])) {
      const mapped = this.mapped(t.node);
      if (mapped && t.name in mapped.values) {
        return {
          value: mapped.values[t.name],
          binding: mapped.bindings[t.name]?.[0] ?? null,
          control: mapped.controls[t.name],
          label: def.inputs[slot].label ?? def.inputs[slot].name,
        };
      }
    }
    return null;
  }

  resolveLink(dto, linkId, type, visited) {
    const link = dto.graph.links.get(String(linkId));
    if (!link) return null;
    if (Number(link.origin_id) === SUBGRAPH_INPUT_ID) {
      return this.resolveSubgraphInput(dto.instance, dto.graph.def, link.origin_slot, visited);
    }
    const origin = this.dtoFor(dto.path, link.origin_id);
    if (!origin) return null;
    return this.resolveOutput(origin, link.origin_slot, type ?? link.type, visited);
  }

  resolveOutput(dto, slot, type, visited) {
    const key = `${dto.execId}[O]${slot}`;
    if (visited.has(key)) throw new ConversionError(`Zirkelbezug bei Node ${dto.execId}.`);
    visited.add(key);
    const { node } = dto;
    if (node.mode === MODE_NEVER) return null;
    if (node.mode === MODE_BYPASS) {
      const idx = this.bypassSlot(node, slot, type);
      return idx < 0 ? null : this.resolveInput(dto, idx, visited);
    }
    if (this.isSubgraphNode(node)) {
      const graph = this.graphFor(node.type);
      let link = null;
      for (const l of graph.links.values()) {
        if (Number(l.target_id) === SUBGRAPH_OUTPUT_ID && Number(l.target_slot) === Number(slot)) link = l;
      }
      if (!link) return null;
      if (Number(link.origin_id) === SUBGRAPH_INPUT_ID) {
        return this.resolveSubgraphInput(dto, graph.def, link.origin_slot, visited);
      }
      const inner = this.dtoFor([...dto.path, node.id], link.origin_id);
      return inner ? this.resolveOutput(inner, link.origin_slot, type, visited) : null;
    }
    if (node.type === "PrimitiveNode") {
      return { value: node.widgets_values?.[0], binding: { node, index: 0 }, control: node.widgets_values?.[1] };
    }
    if (REROUTE_TYPES.has(node.type) || node.type === "SetNode") {
      return this.resolveInput(dto, 0, visited);
    }
    if (node.type === "GetNode") {
      const name = node.widgets_values?.[0];
      for (const other of dto.graph.nodes.values()) {
        if (other.type === "SetNode" && other.widgets_values?.[0] === name) {
          return this.resolveInput(this.dtoFor(dto.path, other.id), 0, visited);
        }
      }
      return null;
    }
    return { dto, slot: Number(slot) };
  }

  bypassSlot(node, slot, type) {
    const inputs = node.inputs ?? [];
    if (!inputs.length) return -1;
    if (type === "*" || type === "" || type == null) return inputs.length > slot ? slot : 0;
    const outType = node.outputs?.[slot]?.type;
    const same = inputs[slot];
    if (same && typesMatch(same.type, outType) && typesMatch(same.type, type)) return slot;
    const exact = inputs.findIndex((i) => i.type === type);
    if (exact >= 0) return exact;
    return inputs.findIndex((i) => typesMatch(i.type, outType) && typesMatch(i.type, type));
  }

  run() {
    const prompt = {};
    const bindings = {};
    const controls = {};
    // Inputs the workflow author exposed on a subgraph node: good candidates
    // for the phone's quick controls.
    const exposed = [];
    for (const dto of this.dtos.values()) {
      const { node } = dto;
      if (node.mode === MODE_NEVER || node.mode === MODE_BYPASS) continue;
      if (this.isSubgraphNode(node) || PASSIVE_TYPES.has(node.type)) continue;
      const def = this.defs[node.type];
      if (!def) {
        this.missing.add(node.type);
        continue;
      }
      const mapped = this.mapped(node);
      if (mapped.uncertain) this.uncertainNodes.push(dto.execId);
      const inputs = {};
      for (const [name, v] of Object.entries(mapped.values)) {
        if (v !== undefined) inputs[name] = wrapValue(v);
      }
      const nodeBindings = { ...mapped.bindings };
      const nodeControls = { ...mapped.controls };
      (node.inputs ?? []).forEach((input, i) => {
        if (input.link == null) return;
        const r = this.resolveInput(dto, i, new Set());
        if (!r) return;
        if ("value" in r) {
          inputs[input.name] = wrapValue(r.value);
          if (r.binding) nodeBindings[input.name] = [...(nodeBindings[input.name] ?? []), r.binding];
          if (r.label) exposed.push({ nodeId: dto.execId, input: input.name, label: r.label });
          if (CONTROL_VALUES.has(r.control)) nodeControls[input.name] = r.control;
        } else {
          inputs[input.name] = [r.dto.execId, r.slot];
          delete nodeBindings[input.name];
        }
      });
      prompt[dto.execId] = {
        inputs,
        class_type: node.type,
        _meta: { title: node.title ?? def.display_name ?? node.type },
      };
      bindings[dto.execId] = nodeBindings;
      if (Object.keys(nodeControls).length) controls[dto.execId] = nodeControls;
    }
    for (const dto of this.dtos.values()) {
      if (!this.isSubgraphNode(dto.node)) continue;
      for (const entry of dto.node.properties?.proxyWidgets ?? []) {
        const [innerId, widget] = entry ?? [];
        const target = `${dto.execId}:${innerId}`;
        if (String(innerId) !== "-1" && prompt[target] && widget in prompt[target].inputs) {
          if (!exposed.some((e) => e.nodeId === target && e.input === widget)) exposed.push({ nodeId: target, input: widget });
        }
      }
    }
    // Links into nodes that were dropped (missing types) can't be sent.
    for (const { inputs } of Object.values(prompt)) {
      for (const [name, v] of Object.entries(inputs)) {
        if (Array.isArray(v) && v.length === 2 && !prompt[v[0]]) delete inputs[name];
      }
    }
    return {
      prompt,
      bindings,
      controls,
      exposed,
      missing: [...this.missing],
      uncertainNodes: this.uncertainNodes,
    };
  }
}

export function convertWorkflow(workflow, defs) {
  if (!isUiWorkflow(workflow)) throw new ConversionError("Kein ComfyUI-Workflow (es fehlt die Node-Liste).");
  return new Converter(workflow, defs).run();
}

// Writes API input values back into the UI workflow the bindings point into
// (the bindings reference node objects of that workflow).
export function writeBack(prompt, bindings) {
  for (const [id, nodeBindings] of Object.entries(bindings)) {
    const inputs = prompt[id]?.inputs;
    if (!inputs) continue;
    for (const [name, targets] of Object.entries(nodeBindings)) {
      if (!(name in inputs)) continue;
      let v = inputs[name];
      if (Array.isArray(v)) continue; // became a link
      if (v && typeof v === "object" && "__value__" in v) v = v.__value__;
      for (const t of targets) {
        if (t.key !== undefined) {
          if (t.node.widgets_values && typeof t.node.widgets_values === "object") t.node.widgets_values[t.key] = v;
        } else if (Array.isArray(t.node.widgets_values)) {
          t.node.widgets_values[t.index] = v;
        }
      }
    }
  }
}
