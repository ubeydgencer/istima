# EMA parity fixture

`ema-parity.json.gz` is the deterministic `artifacts/php-fixture.json` from the
local EMA TTS project, compressed without changes. It contains PyTorch text,
acoustic and decoder inputs/outputs for `merhaba dünya.` with seed 42.

Source: EMA Lightning, Canberk Aslan, Apache-2.0 (see repository LICENSE).
Code revision: `129e39c7d9feb56de9c6830e94a630f04fc8aa03`.
Weights revision: `7a6ba1ad216bb2f1da9863f80ac8770a6a807632`.
Generated with that project's `scripts/php_fixture.py`.

`tools/ema-e2e.mjs` compares all graph outputs at `atol=2e-4, rtol=2e-3`,
checks word/frame alignment, and compares overlapping streamed decoder windows
against full WASM decoding of a longer latent sequence. It also exercises the JS synthesis path
and extension playback/model switching. This fixture proves this example;
it does not establish parity on every possible input or on text normalization.
