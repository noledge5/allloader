// Run with: node --test comfyui-mobile/tests/
import assert from "node:assert/strict";
import test from "node:test";

import { convertWorkflow, isApiPrompt, isUiWorkflow, mapWidgetValues, writeBack } from "../app/js/converter.js";
import { applyDynamicCombo, inputSpec } from "../app/js/workflow.js";

// Minimal node definitions in /object_info format.
const defs = {
  CheckpointLoaderSimple: {
    display_name: "Load Checkpoint",
    input: { required: { ckpt_name: [["a.safetensors", "b.safetensors"], {}] } },
    input_order: { required: ["ckpt_name"] },
  },
  CLIPTextEncode: {
    display_name: "CLIP Text Encode (Prompt)",
    input: { required: { text: ["STRING", { multiline: true }], clip: ["CLIP", {}] } },
    input_order: { required: ["text", "clip"] },
  },
  KSampler: {
    display_name: "KSampler",
    input: {
      required: {
        model: ["MODEL", {}],
        seed: ["INT", { default: 0, min: 0, max: 2 ** 53, control_after_generate: true }],
        steps: ["INT", { default: 20, min: 1, max: 10000 }],
        cfg: ["FLOAT", { default: 8, min: 0, max: 100, step: 0.1 }],
        sampler_name: [["euler", "dpmpp_2m"], {}],
        scheduler: [["normal", "karras"], {}],
        positive: ["CONDITIONING", {}],
        negative: ["CONDITIONING", {}],
        latent_image: ["LATENT", {}],
        denoise: ["FLOAT", { default: 1, min: 0, max: 1, step: 0.01 }],
      },
    },
    input_order: {
      required: ["model", "seed", "steps", "cfg", "sampler_name", "scheduler", "positive", "negative", "latent_image", "denoise"],
    },
  },
  EmptyLatentImage: {
    display_name: "Empty Latent Image",
    input: { required: { width: ["INT", { default: 512 }], height: ["INT", { default: 512 }], batch_size: ["INT", { default: 1 }] } },
    input_order: { required: ["width", "height", "batch_size"] },
  },
  SaveImage: {
    display_name: "Save Image",
    input: { required: { images: ["IMAGE", {}], filename_prefix: ["STRING", { default: "ComfyUI" }] } },
    input_order: { required: ["images", "filename_prefix"] },
  },
  LoadImage: {
    display_name: "Load Image",
    input: { required: { image: [["example.png"], { image_upload: true }] } },
    input_order: { required: ["image"] },
  },
  ImageInvert: {
    display_name: "Invert Image",
    input: { required: { image: ["IMAGE", {}] } },
    input_order: { required: ["image"] },
  },
  PrimitiveInt: {
    display_name: "Int",
    input: { required: { value: ["INT", { min: -1, max: 100, control_after_generate: "fixed" }] } },
    input_order: { required: ["value"] },
  },
  SaveVideo: {
    display_name: "Save Video",
    input: {
      required: {
        video: ["VIDEO", {}],
        filename_prefix: ["STRING", { default: "video/ComfyUI" }],
        format: [
          "COMFY_DYNAMICCOMBO_V3",
          {
            options: [
              { key: "auto", inputs: { required: {} } },
              { key: "mp4", inputs: { required: { crf: ["INT", { default: 23 }], preset: ["COMBO", { options: ["fast", "slow"] }] } } },
            ],
          },
        ],
      },
    },
    input_order: { required: ["video", "filename_prefix", "format"] },
  },
};

function node(id, type, widgets_values, inputs = [], extra = {}) {
  return { id, type, mode: 0, inputs, outputs: [], widgets_values, ...extra };
}

function link(id, from, fromSlot, to, toSlot, type) {
  return [id, from, fromSlot, to, toSlot, type];
}

test("detects formats", () => {
  assert.equal(isApiPrompt({ 1: { class_type: "KSampler", inputs: {} } }), true);
  assert.equal(isApiPrompt({ nodes: [] }), false);
  assert.equal(isUiWorkflow({ nodes: [] }), true);
});

test("maps widget values around the seed control value", () => {
  const n = node(3, "KSampler", [42, "randomize", 25, 6.5, "dpmpp_2m", "karras", 0.8]);
  const { values, controls } = mapWidgetValues(n, defs.KSampler);
  assert.deepEqual(values, { seed: 42, steps: 25, cfg: 6.5, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 0.8 });
  assert.deepEqual(controls, { seed: "randomize" });
});

test("skips the upload button value of LoadImage", () => {
  const { values } = mapWidgetValues(node(1, "LoadImage", ["cat.png", "image"]), defs.LoadImage);
  assert.deepEqual(values, { image: "cat.png" });
});

test("fills trailing widgets missing from older workflows with defaults", () => {
  const { values } = mapWidgetValues(node(3, "KSampler", [1, "fixed", 20, 7, "euler", "normal"]), defs.KSampler);
  assert.equal(values.denoise, 1);
});

test("converts a basic text-to-image workflow", () => {
  const wf = {
    nodes: [
      node(4, "CheckpointLoaderSimple", ["b.safetensors"]),
      node(6, "CLIPTextEncode", ["a cat"], [{ name: "clip", type: "CLIP", link: 1 }]),
      node(7, "CLIPTextEncode", ["blurry"], [{ name: "clip", type: "CLIP", link: 2 }]),
      node(5, "EmptyLatentImage", [768, 512, 2]),
      node(3, "KSampler", [7, "fixed", 20, 8, "euler", "normal", 1], [
        { name: "model", type: "MODEL", link: 3 },
        { name: "positive", type: "CONDITIONING", link: 4 },
        { name: "negative", type: "CONDITIONING", link: 5 },
        { name: "latent_image", type: "LATENT", link: 6 },
      ]),
      node(10, "Note", ["just a note"]),
    ],
    links: [
      link(1, 4, 1, 6, 0, "CLIP"),
      link(2, 4, 1, 7, 0, "CLIP"),
      link(3, 4, 0, 3, 0, "MODEL"),
      link(4, 6, 0, 3, 1, "CONDITIONING"),
      link(5, 7, 0, 3, 2, "CONDITIONING"),
      link(6, 5, 0, 3, 3, "LATENT"),
    ],
  };
  const { prompt, controls, missing } = convertWorkflow(wf, defs);
  assert.deepEqual(Object.keys(prompt).sort(), ["3", "4", "5", "6", "7"]);
  assert.deepEqual(prompt["3"].inputs, {
    seed: 7,
    steps: 20,
    cfg: 8,
    sampler_name: "euler",
    scheduler: "normal",
    denoise: 1,
    model: ["4", 0],
    positive: ["6", 0],
    negative: ["7", 0],
    latent_image: ["5", 0],
  });
  assert.equal(prompt["6"].inputs.text, "a cat");
  assert.deepEqual(prompt["6"].inputs.clip, ["4", 1]);
  assert.equal(prompt["4"]._meta.title, "Load Checkpoint");
  assert.deepEqual(controls, { 3: { seed: "fixed" } });
  assert.deepEqual(missing, []);
});

test("resolves reroutes, primitive nodes, bypassed and muted nodes", () => {
  const wf = {
    nodes: [
      node(1, "LoadImage", ["x.png", "image"]),
      node(2, "Reroute", null, [{ name: "", type: "*", link: 1 }]),
      node(3, "ImageInvert", null, [{ name: "image", type: "IMAGE", link: 2 }], { mode: 4 }),
      node(4, "SaveImage", ["old"], [
        { name: "images", type: "IMAGE", link: 3 },
        { name: "filename_prefix", type: "STRING", link: 4, widget: { name: "filename_prefix" } },
      ]),
      node(5, "PrimitiveNode", ["from-primitive"]),
      node(6, "SaveImage", ["muted"], [{ name: "images", type: "IMAGE", link: 5 }], { mode: 2 }),
    ],
    links: [
      link(1, 1, 0, 2, 0, "IMAGE"),
      link(2, 2, 0, 3, 0, "IMAGE"),
      link(3, 3, 0, 4, 0, "IMAGE"),
      link(4, 5, 0, 4, 1, "STRING"),
      link(5, 1, 0, 6, 0, "IMAGE"),
    ],
  };
  const { prompt, bindings } = convertWorkflow(wf, defs);
  assert.deepEqual(Object.keys(prompt).sort(), ["1", "4"]);
  assert.deepEqual(prompt["4"].inputs, { filename_prefix: "from-primitive", images: ["1", 0] });

  // Editing the value writes it into both the target widget and the primitive.
  prompt["4"].inputs.filename_prefix = "edited";
  writeBack(prompt, bindings);
  assert.equal(wf.nodes[3].widgets_values[0], "edited");
  assert.equal(wf.nodes[4].widgets_values[0], "edited");
});

function subgraphWorkflow({ instanceValues, proxyWidgets }) {
  // Subgraph: [input "steps"] -> PrimitiveInt(10) -> ... ; [input "prefix"] -> SaveImage(20).filename_prefix
  // and an IMAGE input feeding SaveImage.images.
  const sg = {
    id: "sub-1",
    name: "Sub",
    inputs: [
      { name: "images", type: "IMAGE", linkIds: [101] },
      { name: "prefix", type: "STRING", linkIds: [102], label: "Dateiname" },
    ],
    outputs: [],
    nodes: [
      node(20, "SaveImage", ["inner"], [
        { name: "images", type: "IMAGE", link: 101 },
        { name: "filename_prefix", type: "STRING", link: 102, widget: { name: "filename_prefix" } },
      ]),
      node(21, "PrimitiveInt", [5, "fixed"]),
    ],
    links: [
      { id: 101, origin_id: -10, origin_slot: 0, target_id: 20, target_slot: 0, type: "IMAGE" },
      { id: 102, origin_id: -10, origin_slot: 1, target_id: 20, target_slot: 1, type: "STRING" },
    ],
  };
  return {
    nodes: [
      node(1, "LoadImage", ["x.png", "image"]),
      node(9, "sub-1", instanceValues, [{ name: "images", type: "IMAGE", link: 1 }], { properties: { proxyWidgets } }),
    ],
    links: [link(1, 1, 0, 9, 0, "IMAGE")],
    definitions: { subgraphs: [sg] },
  };
}

test("flattens subgraphs, taking values from the instance node (older format)", () => {
  const wf = subgraphWorkflow({ instanceValues: ["outer"] });
  const { prompt, exposed, bindings } = convertWorkflow(wf, defs);
  assert.deepEqual(Object.keys(prompt).sort(), ["1", "9:20", "9:21"]);
  assert.deepEqual(prompt["9:20"].inputs, { filename_prefix: "outer", images: ["1", 0] });
  assert.deepEqual(exposed, [{ nodeId: "9:20", input: "filename_prefix", label: "Dateiname" }]);
  prompt["9:20"].inputs.filename_prefix = "changed";
  writeBack(prompt, bindings);
  assert.equal(wf.nodes[1].widgets_values[0], "changed");
});

test("flattens subgraphs with promoted inner widgets (newer format)", () => {
  const wf = subgraphWorkflow({ instanceValues: [], proxyWidgets: [["-1", "prefix"], ["21", "value"]] });
  const { prompt, exposed } = convertWorkflow(wf, defs);
  assert.equal(prompt["9:20"].inputs.filename_prefix, "inner");
  assert.ok(exposed.some((e) => e.nodeId === "9:21" && e.input === "value"));
});

test("reports node types that aren't installed", () => {
  const wf = { nodes: [node(1, "SomeCustomNode", [1, 2])], links: [] };
  assert.deepEqual(convertWorkflow(wf, defs).missing, ["SomeCustomNode"]);
});

test("expands dynamic combo sub-inputs", () => {
  const { values } = mapWidgetValues(node(1, "SaveVideo", ["clip", "mp4", 18, "slow"]), defs.SaveVideo);
  assert.deepEqual(values, { filename_prefix: "clip", format: "mp4", "format.crf": 18, "format.preset": "slow" });

  const apiNode = { class_type: "SaveVideo", inputs: { ...values } };
  assert.deepEqual(inputSpec(defs.SaveVideo, "format.crf", apiNode.inputs)[0], "INT");
  apiNode.inputs.format = "auto";
  applyDynamicCombo(apiNode, "format", defs.SaveVideo.input.required.format);
  assert.deepEqual(apiNode.inputs, { filename_prefix: "clip", format: "auto" });
});
