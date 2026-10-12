// Regression: reloading the extension must retire old content scripts in open SPA tabs.
import assert from "node:assert/strict";
import { join } from "node:path";
import { ROOT, launch, controller, serve, sleep } from "./lib.mjs";

const server = await serve();
let browser;
try {
  const launched = await launch();
  browser = launched.browser;
  const { extId } = launched;
  const ctl = await controller(browser, extId);
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${server.url}/tools/fixtures/haber.html`);
  await page.waitForSelector("istima-player");
  const tabId = await ctl.tabOf(page.url());
  assert.ok(tabId);
  assert.equal((await ctl.tabMessage(tabId, { type: "istima-extract" })).paragraphs.length, 7);

  // Extension APIs can throw synchronously, before any Promise.catch() is attached.
  await ctl.page.evaluate(async (id) => {
    await chrome.scripting.executeScript({ target: { tabId: id }, func: () => {
      const getMessage = chrome.i18n.getMessage;
      const sendMessage = chrome.runtime.sendMessage;
      const fail = () => { throw new Error("Extension context invalidated."); };
      try {
        chrome.i18n.getMessage = fail;
        const preview = globalThis.IstimaUI.create({});
        preview.host.remove();
        chrome.i18n.getMessage = getMessage;
        chrome.runtime.sendMessage = fail;
        document.querySelector("article p").dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true, cancelable: true }));
      } finally {
        chrome.i18n.getMessage = getMessage;
        chrome.runtime.sendMessage = sendMessage;
      }
    } });
  }, tabId);
  await sleep(100);
  assert.deepEqual(errors, [], "synchronous extension API failure escaped");

  await ctl.tabMessage(tabId, {
    type: "istima-state", engine: { state: "ready" },
    session: { state: "playing", index: 0, total: 7, source: "page", url: page.url(), title: "Test", speed: 1 },
  });
  assert.equal(await page.evaluate(() => document.querySelectorAll(".istima-reading").length), 1);

  // Defer reload so this evaluate() returns before its own extension page is destroyed.
  await ctl.page.evaluate(() => { setTimeout(() => chrome.runtime.reload(), 50); });
  await sleep(1000);
  await page.evaluate(() => history.pushState({}, "", "?spa=after-reload"));
  await sleep(3500);
  assert.deepEqual(errors, [], "old content script threw after extension reload + SPA navigation");
  assert.equal(await page.evaluate(() => document.querySelectorAll("istima-player").length), 0, "stale player remains");
  assert.equal(await page.evaluate(() => document.querySelectorAll(".istima-reading").length), 0, "stale highlight remains");
  assert.equal(await page.evaluate(() => !!document.getElementById("istima-highlight-style")), false);
  assert.equal(await page.evaluate(() => {
    const event = new MouseEvent("click", { altKey: true, bubbles: true, cancelable: true });
    document.querySelector("article p").dispatchEvent(event);
    return event.defaultPrevented;
  }), false, "stale Alt+click handler intercepted the page");

  // The same tab can be injected again by the new extension without refreshing the page.
  // A CDP-installed extension stays disabled after runtime.reload() in Chrome for Testing.
  // Reinstall it to exercise fresh injection into the existing tab.
  await browser.uninstallExtension(extId);
  assert.equal(await browser.installExtension(join(ROOT, "tools", ".cache", "extension-test")), extId);
  const fresh = await controller(browser, extId);
  const result = await fresh.send({ type: "start-tab", tabId });
  assert.equal(result.ok, true);
  await page.waitForSelector("istima-player");
  assert.equal((await fresh.tabMessage(tabId, { type: "istima-extract" })).paragraphs.length, 7);
  await fresh.send({ type: "control", action: "stop" });
  assert.equal(await page.evaluate(() => document.querySelectorAll("istima-player").length), 1);
  assert.deepEqual(errors, [], "reinjection threw");
  console.log("✓ Extension reload + SPA navigation: no stale API calls, player removed, reinjection works");
} finally {
  if (browser) await browser.close();
  server.close();
}
