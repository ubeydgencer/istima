// Offscreen document: owns the TTS worker and plays the audio.
// The background service worker sends {target: "offscreen", type, ...}; this page answers with
// {target: "background", type: "engine" | "status", ...}.

import { modelId } from "../shared/settings.js";

const BASE_SPEED = { antalia: 0.95, ema: 1 }; // each model's natural pace is shown as 1×
const AHEAD_SECONDS = 25; // keep at least this much audio synthesised ahead of playback

let worker = null;
let selectedModel = null;
let engineState = "idle"; // idle | loading | ready | error
let engineReady = null;
let resolveReady, rejectReady;

function emit(msg) {
  chrome.runtime.sendMessage({ target: "background", ...msg }).catch(() => {});
}

function loadEngine(model = selectedModel || "antalia") {
  model = modelId(model);
  if (selectedModel !== model || engineState === "error") {
    worker?.terminate();
    rejectReady?.(new Error("Speech model changed"));
    selectedModel = model;
    engineReady = null;
    worker = new Worker(new URL("../engine/worker.js", import.meta.url), { type: "module" });
    const currentWorker = worker;
    worker.onmessage = (event) => { if (worker === currentWorker) onWorkerMessage(event); };
    worker.onerror = (event) => {
      if (worker !== currentWorker) return;
      engineState = "error";
      engineReady = null;
      const error = event.message || "Speech worker failed";
      rejectReady?.(new Error(error));
      resetQueue();
      emit({ type: "engine", state: "error", error });
      setState("error", { error });
    };
  }
  if (engineReady) return engineReady;
  engineState = "loading";
  emit({ type: "engine", state: "loading", loaded: 0, total: 0 });
  engineReady = new Promise((res, rej) => { resolveReady = res; rejectReady = rej; });
  worker.postMessage({ type: "init", model });
  return engineReady;
}

// ------------------------------------------------------------------ player
const player = {
  gen: 0,
  paragraphs: [],
  index: 0, // paragraph being played
  synthNext: 0, // next paragraph to synthesise
  synthBusy: null, // id of the synth in flight
  segments: [], // [{para, buffer}] waiting to be played
  queuedSeconds: 0,
  source: null,
  speed: 1,
  state: "stopped", // stopped | loading | buffering | playing | paused | ended | error
  ctx: null,
};

function status(extra = {}) {
  emit({ type: "status", state: player.state, index: player.index, total: player.paragraphs.length, speed: player.speed, ...extra });
}

function setState(state, extra) {
  player.state = state;
  status(extra);
}

function audioCtx() {
  if (!player.ctx) player.ctx = new AudioContext({ sampleRate: 48000, latencyHint: "playback" });
  return player.ctx;
}

function resetQueue() {
  player.gen++;
  if (player.synthBusy) worker.postMessage({ type: "cancel", id: player.synthBusy });
  player.synthBusy = null;
  player.segments = [];
  player.queuedSeconds = 0;
  if (player.source) {
    player.source.onended = null;
    try { player.source.stop(); } catch {}
    player.source = null;
  }
}

async function play({ paragraphs, index = 0, speed = 1, model = "antalia" }) {
  resetQueue();
  const gen = player.gen;
  player.paragraphs = paragraphs;
  player.index = player.synthNext = Math.max(0, Math.min(index, paragraphs.length - 1));
  player.speed = speed;
  const ctx = audioCtx();
  if (ctx.state === "suspended") await ctx.resume();
  if (gen !== player.gen) return;
  if (engineState !== "ready" || selectedModel !== modelId(model)) {
    setState("loading");
    try { await loadEngine(model); } catch { return; }
  }
  if (gen !== player.gen) return;
  if (player.state === "paused") { pump(); return; }
  setState("buffering");
  pump();
}

function seek(index) {
  if (!player.paragraphs.length) return;
  const wasPaused = player.state === "paused";
  resetQueue();
  player.index = player.synthNext = Math.max(0, Math.min(index, player.paragraphs.length - 1));
  if (wasPaused) { status(); pump(); return; }
  setState("buffering");
  pump();
}

/** Synthesise ahead: the current paragraph, the next one, then until AHEAD_SECONDS are queued. */
function pump() {
  if (engineState !== "ready" || player.synthBusy || player.synthNext >= player.paragraphs.length) return;
  const ahead = player.synthNext <= player.index + 1 || player.queuedSeconds < AHEAD_SECONDS;
  if (!ahead) return;
  const para = player.synthNext++;
  const id = `${player.gen}:${para}`;
  player.synthBusy = id;
  worker.postMessage({ type: "synth", id, text: player.paragraphs[para], speed: BASE_SPEED[selectedModel] * player.speed, seed: 0 });
}

function playNext() {
  if (player.source || player.state === "paused" || player.state === "stopped") return;
  const seg = player.segments.shift();
  if (!seg) {
    if (player.synthNext >= player.paragraphs.length && !player.synthBusy) {
      setState("ended");
    } else if (player.state !== "buffering" && player.state !== "loading") {
      setState("buffering");
    }
    return;
  }
  player.queuedSeconds -= seg.buffer.duration;
  const ctx = audioCtx();
  const src = ctx.createBufferSource();
  src.buffer = seg.buffer;
  src.connect(ctx.destination);
  const gen = player.gen;
  src.onended = () => {
    if (gen !== player.gen) return;
    player.source = null;
    playNext();
    pump();
  };
  player.source = src;
  src.start();
  const changed = seg.para !== player.index || player.state !== "playing";
  player.index = seg.para;
  player.state = "playing";
  if (changed) status();
  pump();
}

function pause() {
  if (player.state === "stopped" || player.state === "ended") return;
  player.state = "paused";
  player.ctx?.suspend();
  status();
}

async function resume() {
  if (player.state !== "paused") return;
  await audioCtx().resume();
  player.state = player.source ? "playing" : "buffering";
  status();
  playNext();
  pump();
}

function stop() {
  resetQueue();
  player.paragraphs = [];
  player.index = 0;
  setState("stopped");
}

// ------------------------------------------------------------------ worker events
function onWorkerMessage({ data: msg }) {
  if (msg.type === "progress") {
    emit({ type: "engine", state: "loading", loaded: msg.loaded, total: msg.total });
  } else if (msg.type === "ready") {
    engineState = "ready";
    emit({ type: "engine", state: "ready", info: msg.info });
    resolveReady(msg.info);
    // A seek/speed command may have replaced the pending play() while the model loaded.
    if (player.paragraphs.length) pump();
  } else if (msg.type === "chunk") {
    const [gen, para] = msg.id.split(":").map(Number);
    if (gen !== player.gen) return;
    const ctx = audioCtx();
    const buffer = ctx.createBuffer(1, msg.audio.length, msg.sampleRate);
    buffer.copyToChannel(msg.audio, 0);
    player.segments.push({ para, buffer });
    player.queuedSeconds += buffer.duration;
    playNext();
  } else if (msg.type === "done") {
    if (msg.id !== player.synthBusy) return;
    player.synthBusy = null;
    pump();
    playNext();
  } else if (msg.type === "error") {
    if (engineState === "loading") {
      engineState = "error";
      engineReady = null;
      emit({ type: "engine", state: "error", error: msg.message });
      rejectReady(new Error(msg.message));
      setState("error", { error: msg.message });
      return;
    }
    if (msg.id && msg.id !== player.synthBusy) return;
    // one paragraph failed (e.g. text the normaliser rejects): skip it rather than stop reading
    console.warn("İstima: paragraph skipped", msg.message);
    player.synthBusy = null;
    pump();
    playNext();
  }
}

// ------------------------------------------------------------------ messages from the background
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;
  switch (msg.type) {
    case "ping":
      sendResponse({ ok: true, hasSession: player.paragraphs.length > 0, state: player.state, engine: engineState });
      return;
    case "preload":
      // An options/welcome preview must not replace the engine of an active reading.
      if (!player.paragraphs.length) loadEngine(msg.model).catch(() => {});
      break;
    case "play": play(msg.session); break;
    case "pause": pause(); break;
    case "resume": resume(); break;
    case "toggle":
      if (player.state === "paused") resume();
      else if (player.state === "ended") seek(0);
      else pause();
      break;
    case "stop": stop(); break;
    case "seek": seek(msg.index); break;
    case "next": if (player.index + 1 < player.paragraphs.length) seek(player.index + 1); break;
    case "prev": seek(player.index - 1); break;
    case "speed":
      player.speed = msg.speed;
      if (player.paragraphs.length && player.state !== "ended") seek(player.index);
      else status();
      break;
  }
  sendResponse({ ok: true });
});
