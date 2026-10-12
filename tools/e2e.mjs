// End-to-end test: load the extension, open a Turkish news page, check detection and extraction,
// then read the whole article and check every paragraph is played through to "ended".
//   node e2e.mjs [extra article URLs to check extraction on...]
import assert from "node:assert/strict";
import { launch, controller, serve, sleep } from "./lib.mjs";

const server = await serve();
const { browser, extId } = await launch();
const ctl = await controller(browser, extId);
let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); } catch (e) { failures++; console.log(`✗ ${name}\n  ${e.message}`); }
};

const page = await browser.newPage();
const url = `${server.url}/tools/fixtures/haber.html`;
await page.goto(url);
await sleep(2500);
const tabId = await ctl.tabOf(url);

await check("content script runs and shows the player", async () => {
  assert.ok(tabId, "no tab answered istima-detect");
  assert.ok(await page.evaluate(() => !!document.querySelector("istima-player")));
});

await check("detects a Turkish article", async () => {
  const d = await ctl.tabMessage(tabId, { type: "istima-detect" });
  assert.equal(d.isTurkish, true);
  assert.equal(d.isArticle, true);
  assert.equal(d.title, "İstanbul'da yeni metro hattı hizmete açıldı");
});

await check("extracts the paragraphs without boilerplate", async () => {
  const a = await ctl.tabMessage(tabId, { type: "istima-extract" });
  assert.equal(a.paragraphs.length, 7, a.paragraphs.join("\n"));
  assert.ok(!a.paragraphs.some((p) => /^(Reklam|İlginizi)/.test(p)));
  assert.ok(!a.paragraphs.some((p) => /Haber Merkezi/.test(p)), "byline was read");
});

await check("reads the whole article", async () => {
  const res = await ctl.send({ type: "start-tab", tabId });
  assert.equal(res.ok, true);
  const seen = new Set();
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < 150000) {
    await sleep(500);
    s = await ctl.state();
    if (s?.session?.state === "playing") seen.add(s.session.index);
    if (s?.session?.state === "ended" || s?.session?.state === "error") break;
  }
  assert.equal(s?.engine?.state, "ready");
  assert.equal(s?.session?.state, "ended", JSON.stringify(s?.session));
  assert.equal(seen.size, 7, `played paragraphs: ${[...seen]}`);
  console.log(`  model: ${s.engine.info.threads} threads, isolated: ${s.engine.info.crossOriginIsolated}, ready in ${Math.round(s.engine.info.initMs)} ms; article read in ${Math.round((Date.now() - t0) / 1000)} s`);
});

await check("pause, resume, seek and stop", async () => {
  await ctl.send({ type: "start-tab", tabId });
  for (let i = 0; i < 40 && (await ctl.state())?.session?.state !== "playing"; i++) await sleep(250);
  await ctl.send({ type: "control", action: "pause" });
  await sleep(400);
  assert.equal((await ctl.state()).session.state, "paused");
  await ctl.send({ type: "control", action: "seek", value: 4 });
  await ctl.send({ type: "control", action: "resume" });
  for (let i = 0; i < 40 && (await ctl.state())?.session?.state !== "playing"; i++) await sleep(250);
  assert.equal((await ctl.state()).session.index, 4);
  await ctl.send({ type: "control", action: "stop" });
  await sleep(300);
  assert.equal((await ctl.state()).session, null);
  assert.equal(await page.evaluate(() => document.querySelectorAll(".istima-reading").length), 0);
});

for (const extra of process.argv.slice(2)) {
  await check(`extracts ${extra}`, async () => {
    const p = await browser.newPage();
    await p.goto(extra, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(5000);
    const id = await ctl.tabOf(p.url());
    const a = await ctl.tabMessage(id, { type: "istima-extract" });
    assert.ok(a?.paragraphs?.length >= 3, "no article found");
    console.log(a.paragraphs.map((x, i) => `    ${i} ${x.slice(0, 90)}`).join("\n"));
    await p.close();
  });
}

await browser.close();
server.close();
if (!failures) await import("./ema-e2e.mjs");
if (!failures) await import("./context-e2e.mjs");
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
