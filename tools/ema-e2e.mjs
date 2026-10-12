// Real ONNX/WASM parity and playback controls for EMA. No network or Python at test time.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { launch, controller, sleep } from "./lib.mjs";

const fixture = JSON.parse(gunzipSync(await readFile(new URL("fixtures/ema-parity.json.gz", import.meta.url))));
const { browser, extId } = await launch();
try {
  const ctl = await controller(browser, extId);
  ctl.page.on("pageerror", (err) => console.error("Options page:", err.message));
  const waitState = async (predicate, timeout = 60000) => {
    const start = Date.now();
    let state;
    while (Date.now() - start < timeout) {
      state = await ctl.send({ type: "get-state" });
      if (predicate(state)) return state;
      if (state.session?.state === "error" || state.engine?.state === "error") throw new Error(JSON.stringify(state));
      await sleep(100);
    }
    throw new Error(`Timed out: ${JSON.stringify(state)}`);
  };

  const parity = await ctl.page.evaluate(async (reference) => {
    const ort = await import("../vendor/ort/ort.wasm.min.mjs");
    const { EmaEngine, wordLayout, framePlan, emaText, emaPieces } = await import("../engine/ema.js");
    const { loadFrontend } = await import("../engine/frontend.js");
    ort.env.wasm.wasmPaths = chrome.runtime.getURL("vendor/ort/");
    ort.env.wasm.numThreads = 1;
    const base = chrome.runtime.getURL("models/ema/");
    const manifest = await (await fetch(base + "model-info.json")).json();
    const buffers = Object.fromEntries(await Promise.all(["text", "acoustic", "decoder"].map(async (name) => [name, await (await fetch(base + `ema-${name}.onnx`)).arrayBuffer()])));
    const engine = await EmaEngine.create(ort, buffers, manifest);
    const frontend = await loadFrontend(chrome.runtime.getURL("engine/frontend-data.json.gz"));
    const results = [];
    const compare = (name, actual, expected) => {
      const flat = expected.flat(Infinity);
      if (flat.length !== actual.length) throw new Error(`${name}: length mismatch`);
      let worst = 0;
      for (let i = 0; i < flat.length; i++) {
        const diff = Math.abs(Number(actual[i]) - Number(flat[i]));
        if (!Number.isFinite(diff) || diff > 2e-4 + 2e-3 * Math.abs(Number(flat[i]))) throw new Error(`${name}[${i}]: ${actual[i]} != ${flat[i]}`);
        worst = Math.max(worst, diff);
      }
      results.push({ name, maxAbs: worst });
    };
    const feed = (name, values) => {
      const type = ["mask", "fmask"].includes(name) ? "bool" : ["ids", "cw", "wstart", "fw", "lengths"].includes(name) ? "int64" : "float32";
      const dims = [];
      let row = values;
      while (Array.isArray(row)) { dims.push(row.length); row = row[0]; }
      const flat = values.flat(Infinity);
      const data = type === "int64" ? BigInt64Array.from(flat, BigInt) : type === "bool" ? Uint8Array.from(flat, Number) : Float32Array.from(flat);
      return new ort.Tensor(type, data, dims);
    };
    try {
      for (const [stage, input, outputs] of [["text", reference.text, ["h", "dur"]], ["acoustic", reference.sound, ["latents"]], ["decoder", reference.decode, ["audio"]]]) {
        const feeds = Object.fromEntries(Object.entries(input).map(([name, data]) => [name, feed(name, data)]));
        let actual;
        try {
          actual = await engine.sessions[stage].run(feeds);
          outputs.forEach((name, i) => compare(stage + "." + name, actual[name].data, reference.expected[stage][i]));
        } finally {
          for (const t of Object.values(feeds)) t.dispose();
          if (actual) for (const t of Object.values(actual)) t.dispose();
        }
      }
      const layout = wordLayout("merhaba dünya.", manifest.vocab);
      compare("ids", layout.ids, reference.text.ids);
      compare("cw", layout.cw, reference.sound.cw);
      compare("wstart", layout.wstart, reference.sound.wstart);
      const plan = framePlan(reference.sound.dur[0], layout.cw, 1);
      compare("fw", plan.fw, reference.sound.fw);
      compare("fp", plan.fp, reference.sound.fp);
      const ties = framePlan([2.5, 3.5], BigInt64Array.of(0n, 1n), 1);
      compare("ties-to-even", ties.fw, [0, 0, 1, 1, 1, 1]);
      const normalized = emaText("İSTANBUL’da 25 TL ve 5 kg. Café â î û", frontend, manifest.vocab);
      if (/\d/.test(normalized) || !normalized.includes("yirmi beş") || !normalized.includes("istanbul")) throw new Error(`Bad normalization: ${normalized}`);
      for (const c of normalized) if (!manifest.vocab.includes(c)) throw new Error(`Out-of-vocabulary: ${c}`);
      const long = emaText("İstanbul'da bugün hava güzel olacak. ".repeat(50), frontend, manifest.vocab);
      for (const speed of [.8, 1, 1.75]) {
        const pieces = emaPieces(long, speed);
        if (pieces.length < 2 || pieces.some((p) => p.text.length > 251 || !/[.!?]["')]*$/.test(p.text))) throw new Error("Invalid chunking");
        if (pieces.map((p) => p.text.match(/\p{L}/gu).join("")).join("") !== long.match(/\p{L}/gu).join("")) throw new Error("Chunking lost text");
      }
      // Compare context-window streaming with full decoding using exactly the same latents.
      const originalZ = reference.decode.z[0];
      const z = Array.from({ length: 260 }, (_, i) => originalZ[i % originalZ.length]);
      const hop = manifest.hop;
      const fullFeeds = { z: feed("z", [z]), lengths: feed("lengths", [z.length]) };
      let full;
      try { full = await engine.sessions.decoder.run(fullFeeds); }
      finally { for (const t of Object.values(fullFeeds)) t.dispose(); }
      const fullAudio = Array.from(full.audio.data);
      full.audio.dispose();
      for (let start = 0; start < z.length;) {
        const end = Math.min(z.length, start + (start === 0 ? 25 : 100));
        const left = Math.max(0, start - 16), right = Math.min(z.length, end + 16);
        const feeds = { z: feed("z", [z.slice(left, right)]), lengths: feed("lengths", [right - left]) };
        let output;
        try {
          output = await engine.sessions.decoder.run(feeds);
          compare(`window.${start}`, output.audio.data.subarray((start - left) * hop, (end - left) * hop), fullAudio.slice(start * hop, end * hop));
        } finally {
          for (const t of Object.values(feeds)) t.dispose();
          if (output) output.audio.dispose();
        }
        start = end;
      }
      // Exercise the full JS planner + seeded noise + streaming path, not just graph feeds.
      let samples = 0, peak = 0;
      for await (const { audio } of engine.speak("merhaba dünya.", { speed: 1.15, seed: 0 })) {
        samples += audio.length;
        for (const sample of audio) {
          if (!Number.isFinite(sample)) throw new Error("Non-finite PCM");
          peak = Math.max(peak, Math.abs(sample));
        }
      }
      if (samples < 4800 || peak < .001) throw new Error(`No speech: ${samples} samples, peak ${peak}`);
      return { results, normalized, samples, peak };
    } finally {
      await Promise.all(Object.values(engine.sessions).map((s) => s.release()));
    }
  }, fixture);
  console.log("✓ EMA text/acoustic/decoder WASM parity, frame planning, normalization, chunking and streaming", JSON.stringify(parity));

  await ctl.page.evaluate(() => document.querySelector('#model button[data-value="ema"]').click());
  await ctl.page.waitForFunction(() => document.querySelector('#model button[data-value="ema"]').getAttribute("aria-pressed") === "true");
  assert.equal(await ctl.page.evaluate(async () => (await chrome.storage.sync.get("model")).model), "ema");
  console.log("✓ EMA selected in settings");
  const paragraphs = ["Merhaba dünya. İstanbul'da bugün hava güzel olacak.", "Yeni metro hattı hizmete açıldı. Yolcular artık daha hızlı ulaşım sağlayacak."];
  const start = () => ctl.send({ type: "start", source: "test", paragraphs });
  assert.equal((await start()).ok, true);
  let state = await waitState((s) => s.session?.state === "playing");
  assert.equal(state.session.model, "ema");
  assert.equal(state.engine.info.modelId, "ema");
  await ctl.send({ type: "control", action: "pause" });
  await waitState((s) => s.session?.state === "paused");
  // Changing the saved preference does not change a paused session.
  await ctl.page.evaluate(() => document.querySelector('#model button[data-value="antalia"]').click());
  await ctl.page.waitForFunction(() => document.querySelector('#model button[data-value="antalia"]').getAttribute("aria-pressed") === "true");
  await ctl.send({ type: "control", action: "speed", value: 1.3 });
  await ctl.send({ type: "control", action: "seek", value: 1 });
  await waitState((s) => s.session?.index === 1 && s.session.state === "paused");
  await ctl.send({ type: "control", action: "resume" });
  state = await waitState((s) => s.session?.state === "playing");
  assert.equal(state.session.model, "ema");
  assert.equal(state.session.speed, 1.3);
  await waitState((s) => s.session?.state === "ended");
  console.log("✓ EMA preference, pause, speed, seek, resume and end");

  await start(); // next reading uses the newly saved Antalia preference
  state = await waitState((s) => s.session?.state === "playing" && s.engine.info?.modelId === "antalia");
  assert.equal(state.session.model, "antalia");
  await ctl.send({ type: "control", action: "stop" });
  await waitState((s) => s.session === null);
  console.log("✓ EMA → Antalia switch and stop");

  await ctl.page.evaluate(() => chrome.storage.sync.set({ model: "ema" }));
  await start();
  await ctl.send({ type: "control", action: "stop" });
  await waitState((s) => s.session === null && s.engine.state === "ready" && s.engine.info?.modelId === "ema");
  await sleep(500);
  assert.equal((await ctl.send({ type: "get-state" })).session, null);
  await start();
  await waitState((s) => s.session?.state === "playing" && s.session.model === "ema");
  await ctl.send({ type: "control", action: "stop" });
  console.log("✓ Stop during EMA load and subsequent restart");

  await ctl.page.evaluate(() => chrome.storage.sync.set({ model: "antalia" }));
  await start();
  await ctl.send({ type: "control", action: "pause" });
  await ctl.send({ type: "control", action: "seek", value: 1 });
  await waitState((s) => s.engine.state === "ready" && s.engine.info?.modelId === "antalia" && s.session?.state === "paused" && s.session.index === 1);
  await ctl.send({ type: "control", action: "resume" });
  await waitState((s) => s.session?.state === "playing" && s.session.index === 1);
  await ctl.send({ type: "control", action: "stop" });
  console.log("✓ Pause and seek while the replacement model loads");
} finally {
  await browser.close();
}
