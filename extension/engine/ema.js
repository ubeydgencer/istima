// EMA Lightning browser adaptation by İstima. Planning/chunking adapted from
// canberk7/ema-lightning (Apache-2.0); ONNX exports come from the local ema-tts project.
import { TorchRandn } from "./tts.js";

const f32 = Math.fround;
const roundEven = (x) => {
  const n = Math.floor(x), d = x - n;
  return d > 0.5 ? n + 1 : d < 0.5 ? n : n % 2 ? n + 1 : n;
};

/** EMA has its own alphabet and no BOS/EOS tokens. Reuse İstima's spoken-text
 * normalizer; this is deliberately not a port of upstream normalizer-tr. */
export function emaText(raw, frontend, vocab) {
  let spoken;
  const safe = String(raw).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").normalize("NFC");
  try { spoken = frontend.normalizeForModel(safe); } catch { spoken = safe; }
  const allowed = new Set(vocab);
  const text = spoken.replace(/[’‘ʼ´`]/g, "'").replace(/[“”„«»]/g, '"')
    .replace(/[–—−]/g, "-").replace(/…/g, "...").replaceAll("İ", "i").replaceAll("I", "ı").toLowerCase();
  return Array.from(text, (c) => {
    const folded = /[çğıöşü]/.test(c) ? c : c.normalize("NFKD").replace(/\p{M}/gu, "");
    return folded && Array.from(folded).every((ch) => allowed.has(ch)) ? folded : " ";
  }).join("").replace(/\s+/g, " ").trim();
}

export function emaPieces(text, speed) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("Invalid EMA speed");
  const limit = Math.max(1, Math.floor(Math.min(250, 180 * speed)));
  const pieces = [];
  let rest = Array.from(text.trim());
  while (rest.length) {
    let cut = rest.length, pause = 0;
    if (rest.length > limit) {
      cut = limit;
      const window = rest.slice(0, limit + 1).join("");
      for (const [pattern, gap] of [[/[.!?]+["')]*(?= )/gu, .25], [/[,;:](?= )/gu, .12], [/\S(?= )/gu, .12]]) {
        const matches = [...window.matchAll(pattern)];
        if (matches.length) {
          const m = matches.at(-1);
          cut = Array.from(window.slice(0, m.index + m[0].length)).length;
          pause = gap;
          break;
        }
      }
    }
    let piece = rest.slice(0, cut).join("").trim();
    rest = Array.from(rest.slice(cut).join("").trim());
    if (!/\p{L}/u.test(piece)) continue;
    if (!/[.!?]$/.test(piece.replace(/["')]+$/, ""))) piece = piece.replace(/[,;:\- ]+$/, "") + ".";
    pieces.push({ text: piece, pause });
  }
  if (pieces.length) pieces.at(-1).pause = .15;
  return pieces;
}

export function wordLayout(text, vocab) {
  const table = new Map(vocab.map((c, i) => [c, i]));
  const chars = Array.from(text);
  const ids = new BigInt64Array(chars.length), cw = new BigInt64Array(chars.length), wstart = new BigInt64Array(chars.length);
  let word = 0, start = 0;
  chars.forEach((c, i) => {
    if (i && c !== " " && chars[i - 1] === " ") { word++; start = i; }
    ids[i] = BigInt(table.get(c) ?? 1);
    cw[i] = BigInt(word);
    wstart[i] = BigInt(start);
  });
  return { ids, cw, wstart };
}

export function framePlan(rawDur, cw, speed) {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error("Invalid EMA speed");
  const dur = Float32Array.from(rawDur, (d) => f32(d / speed));
  const counts = new Float32Array(Number(cw.at(-1)) + 1);
  dur.forEach((d, i) => { const w = Number(cw[i]); counts[w] = f32(counts[w] + d); });
  const lengths = Array.from(counts, (n) => Math.max(1, Math.min(250, roundEven(n))));
  const frames = lengths.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(frames) || frames > 3000) throw new Error("EMA piece exceeds frame budget");
  const fw = new BigInt64Array(frames), fp = new Float32Array(frames);
  let offset = 0;
  lengths.forEach((n, word) => {
    for (let i = 0; i < n; i++) { fw[offset] = BigInt(word); fp[offset++] = i / n; }
  });
  return { dur, fw, fp, frames };
}

export class EmaEngine {
  static async create(ort, buffers, manifest) {
    const engine = new EmaEngine();
    Object.assign(engine, { ort, manifest, sessions: {} });
    try {
      for (const name of ["text", "acoustic", "decoder"]) {
        engine.sessions[name] = await ort.InferenceSession.create(new Uint8Array(buffers[name]), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      }
    } catch (err) {
      await Promise.all(Object.values(engine.sessions).map((s) => s.release()));
      throw err;
    }
    return engine;
  }

  /** Decode overlapped 1 s / 4 s windows, emitting only their centre samples. */
  async *speak(text, { speed = 1, seed = 0 } = {}) {
    const { ort, manifest: m, sessions } = this;
    let index = 0;
    for (const piece of emaPieces(text, speed)) {
      const tensors = [];
      const tensor = (type, data, dims) => { const t = new ort.Tensor(type, data, dims); tensors.push(t); return t; };
      const remember = (outputs) => { tensors.push(...Object.values(outputs)); return outputs; };
      try {
        const { ids, cw, wstart } = wordLayout(piece.text, m.vocab);
        const L = ids.length;
        const mask = tensor("bool", new Uint8Array(L).fill(1), [1, L]);
        const tx = remember(await sessions.text.run({ ids: tensor("int64", ids, [1, L]), mask }));
        const { dur, fw, fp, frames: T } = framePlan(tx.dur.data, cw, speed);
        const noise = new TorchRandn(seed).randn(m.times.length * T * m.latent_dim, 1);
        const sx = remember(await sessions.acoustic.run({
          h: tx.h, dur: tensor("float32", dur, [1, L]), mask,
          cw: tensor("int64", cw, [1, L]), wstart: tensor("int64", wstart, [1, L]),
          fw: tensor("int64", fw, [1, T]), fp: tensor("float32", fp, [1, T]),
          fmask: tensor("bool", new Uint8Array(T).fill(1), [1, T]),
          noise: tensor("float32", noise, [1, m.times.length, T, m.latent_dim]),
        }));
        for (let start = 0; start < T;) {
          const end = Math.min(T, start + (start === 0 ? 25 : 100));
          // 16 context frames matches the verified local PHP streaming implementation.
          const left = Math.max(0, start - 16), right = Math.min(T, end + 16);
          const z = new ort.Tensor("float32", sx.latents.data.slice(left * m.latent_dim, right * m.latent_dim), [1, right - left, m.latent_dim]);
          const lengths = new ort.Tensor("int64", BigInt64Array.of(BigInt(right - left)), [1]);
          let decoded;
          try {
            decoded = await sessions.decoder.run({ z, lengths });
            const samples = (end - start) * m.hop;
            const pause = end === T ? Math.floor(piece.pause * m.sample_rate) : 0;
            const audio = new Float32Array(samples + pause);
            audio.set(decoded.audio.data.subarray((start - left) * m.hop, (end - left) * m.hop));
            yield { audio, index: index++ };
          } finally {
            z.dispose(); lengths.dispose();
            if (decoded) for (const t of Object.values(decoded)) t.dispose();
          }
          start = end;
        }
      } finally {
        for (const t of tensors) t.dispose();
      }
    }
  }
}
