// Antalia-2 Mini in a Web Worker, adapted from the model's Hugging Face Space (js/worker.js, Apache-2.0).
// Runs the Turkish text frontend and Antalia (four graphs) or EMA (three graphs) off the main thread.
//   -> {type: "init", model?}                        <- {type: "progress", loaded, total} ... {type: "ready", info}
//   -> {type: "synth", id, text, speed?, seed?}      <- {type: "chunk", id, index, count, audio} ... {type: "done", id}
//   -> {type: "cancel", id}                          (handled at once; the running synth stops after its chunk)
//   <- {type: "error", id?, message}
import { Engine, SAMPLE_RATE, speak } from "./tts.js";
import { loadFrontend } from "./frontend.js";
import { EmaEngine, emaText } from "./ema.js";
import { modelId } from "../shared/settings.js";

const ROOT = new URL("../", import.meta.url);
// "mixed" precision, as the Space's default: fp32 acoustic graphs, fp16 vocoder weights (22.8 MB)
const PROFILES = {
  antalia: { dir: "models/", files: { text: "text.onnx", cond: "cond.onnx", flow: "flow.onnx", vocoder: "vocoder.fp16.onnx" } },
  ema: { dir: "models/ema/", files: { text: "ema-text.onnx", acoustic: "ema-acoustic.onnx", decoder: "ema-decoder.onnx" } },
};

let engine = null, frontend = null;
let selectedModel = "antalia", manifest;
const cancelled = new Set();

async function fetchAll(manifest, profile) {
  const names = Object.values(profile.files);
  const sizes = names.map((n) => manifest.files?.[n]?.bytes || 0);
  const loaded = names.map(() => 0);
  const total = sizes.reduce((a, b) => a + b, 0);
  const report = () => postMessage({ type: "progress", loaded: loaded.reduce((a, b) => a + b, 0), total });
  return Promise.all(names.map(async (name, i) => {
    const res = await fetch(new URL(`${profile.dir}${name}`, ROOT));
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const parts = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      loaded[i] += value.byteLength;
      report();
    }
    const out = new Uint8Array(loaded[i]);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.byteLength; }
    return out.buffer;
  }));
}

async function init(model) {
  const t0 = performance.now();
  selectedModel = modelId(model);
  const profile = PROFILES[selectedModel];
  manifest = await (await fetch(new URL(`${profile.dir}model-info.json`, ROOT))).json();
  const ort = await import("../vendor/ort/ort.wasm.min.mjs");
  ort.env.wasm.wasmPaths = new URL("vendor/ort/", ROOT).href;
  // Threads need SharedArrayBuffer (a cross-origin isolated context, set in manifest.json). Half the cores,
  // at most 4: the Space measured more threads as slower on laptops with mixed fast and slow cores.
  const cores = self.crossOriginIsolated ? navigator.hardwareConcurrency || 1 : 1;
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, Math.floor(cores / 2)));
  const [buffers, fe] = await Promise.all([fetchAll(manifest, profile), loadFrontend(new URL("engine/frontend-data.json.gz", ROOT))]);
  frontend = fe;
  const graphs = Object.fromEntries(Object.keys(profile.files).map((key, i) => [key, buffers[i]]));
  engine = selectedModel === "ema" ? await EmaEngine.create(ort, graphs, manifest) : await Engine.create(ort, graphs, manifest, ["wasm"]);
  // warm-up: the first run of each graph allocates and picks kernels
  for await (const _ of speech("Merhaba.", { steps: 1 }));
  postMessage({
    type: "ready",
    info: { threads: ort.env.wasm.numThreads, crossOriginIsolated: self.crossOriginIsolated, initMs: performance.now() - t0, model: manifest.model, modelId: selectedModel, version: manifest.version },
  });
}

function speech(text, options) {
  if (selectedModel === "ema") return engine.speak(emaText(text, frontend, manifest.vocab), options);
  return speak(engine, frontend.modelText(text), options);
}

async function synth({ id, text, speed, seed = 0 }) {
  if (cancelled.delete(id)) return;
  for await (const { audio, index, count } of speech(text, { seed, speed })) {
    if (cancelled.has(id)) break;
    postMessage({ type: "chunk", id, index, count, audio, sampleRate: SAMPLE_RATE }, [audio.buffer]);
  }
  cancelled.delete(id);
  postMessage({ type: "done", id });
}

let queue = Promise.resolve();
onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "cancel") { cancelled.add(msg.id); return; }
  queue = queue.then(async () => {
    try {
      if (msg.type === "init") await init(msg.model);
      else if (msg.type === "synth") await synth(msg);
    } catch (err) {
      postMessage({ type: "error", id: msg.id, message: String(err?.message || err) });
    }
  });
};
