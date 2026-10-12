// İstima background service worker: keeps the reading session, routes controls between the page,
// the popup and the offscreen audio document, and owns the context menu, shortcuts and badge.
import { DEFAULTS, getSettings, modelId } from "./shared/settings.js";

const OFFSCREEN_URL = "offscreen/offscreen.html";
const CONTENT_FILES = ["vendor/readability/Readability-readerable.js", "vendor/readability/Readability.js", "content/player-ui.js", "content/content.js"];
// Host access is optional: without it İstima reads a page when the user asks (activeTab); with it ("find
// articles automatically") the content script runs on every page and offers the "Listen" button by itself.
const AUTO_ORIGINS = ["http://*/*", "https://*/*"];
const AUTO_SCRIPT_ID = "istima-auto";
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

// ------------------------------------------------------------------ session (survives worker restarts)
// {tabId, url, title, site, paragraphs, index, total, state, speed, source: "page" | "selection" | "test"}
let session = null;
// the offscreen document (and the loaded model) may be gone after a restart; it reloads on demand
let engine = { state: "idle" };
const ready = chrome.storage.session.get("session").then((s) => {
  session = s.session || null;
});

const saveSession = () => chrome.storage.session.set({ session });

function publicState() {
  if (!session) return { session: null, engine };
  const { paragraphs, ...rest } = session;
  return { session: { ...rest, current: paragraphs[session.index] || "" }, engine };
}

function broadcast() {
  const state = publicState();
  chrome.runtime.sendMessage({ target: "ui", type: "state", ...state }).catch(() => {});
  if (session?.tabId != null) chrome.tabs.sendMessage(session.tabId, { type: "istima-state", ...state }).catch(() => {});
  updateBadge();
}

function updateBadge() {
  const s = session?.state;
  const text = s === "playing" || s === "buffering" || s === "loading" ? "▶" : s === "paused" ? "II" : "";
  chrome.action.setBadgeBackgroundColor({ color: "#C81E3A" });
  chrome.action.setBadgeTextColor?.({ color: "#FFFFFF" });
  chrome.action.setBadgeText({ text });
}

// ------------------------------------------------------------------ offscreen document
let creating = null;
async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["AUDIO_PLAYBACK", "WORKERS"],
      justification: "Türkçe metni cihaz üzerinde yapay zekâ ile sese dönüştürüp çalmak için.",
    }).finally(() => { creating = null; });
  }
  await creating;
}

async function toOffscreen(msg, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      return await chrome.runtime.sendMessage({ target: "offscreen", ...msg });
    } catch (err) {
      if (i === tries - 1) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

// ------------------------------------------------------------------ reading
async function start({ tabId = null, url = "", title = "", site = "", paragraphs, index = 0, source = "page", model }) {
  await ready;
  paragraphs = (paragraphs || []).map((p) => String(p).trim()).filter(Boolean);
  if (!paragraphs.length) return { ok: false, error: "empty" };
  const settings = await getSettings();
  const previousTab = session?.tabId;
  session = { tabId, url, title, site, paragraphs, index, total: paragraphs.length, state: "loading", speed: session?.speed ?? settings.speed, source, model: modelId(model ?? settings.model) };
  const reading = session;
  await saveSession();
  if (session !== reading) return { ok: true };
  if (previousTab != null && previousTab !== tabId) {
    chrome.tabs.sendMessage(previousTab, { type: "istima-state", session: null, engine }).catch(() => {});
  }
  broadcast();
  await ensureOffscreen();
  if (session !== reading) return { ok: true };
  await toOffscreen({ type: "play", session: { paragraphs, index, speed: reading.speed, model: reading.model } });
  return { ok: true };
}

async function control(action, value) {
  await ready;
  if (!session) {
    if (action === "toggle") return startFromActiveTab();
    return { ok: false };
  }
  if (action === "stop") {
    const previousTab = session.tabId;
    session = null;
    await saveSession();
    if (await hasOffscreen()) await toOffscreen({ type: "stop" }).catch(() => {});
    broadcast();
    if (previousTab != null) chrome.tabs.sendMessage(previousTab, { type: "istima-state", session: null, engine }).catch(() => {});
    return { ok: true };
  }
  if (action === "speed") {
    session.speed = value;
    await saveSession();
    chrome.storage.sync.set({ speed: value });
  }
  // the offscreen document closes itself after ~30 s without audio (e.g. a long pause): rebuild it and
  // continue from the paragraph we were on
  const alive = (await hasOffscreen()) && (await toOffscreen({ type: "ping" }).catch(() => null))?.hasSession;
  if (!alive) {
    if (action === "pause") return { ok: true };
    let index = session.index;
    if (action === "next") index = Math.min(index + 1, session.total - 1);
    if (action === "prev") index = Math.max(index - 1, 0);
    if (action === "seek") index = value;
    if (session.state === "ended" && action === "toggle") index = 0;
    return start({ ...session, index });
  }
  await toOffscreen({ type: action, index: value, speed: value });
  return { ok: true };
}

/** Ask the page for its article (injecting the content script if the tab predates the install). */
async function extractFromTab(tabId, opts = {}) {
  const ask = () => chrome.tabs.sendMessage(tabId, { type: "istima-extract", ...opts });
  try {
    return await ask();
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
    return ask();
  }
}

async function startFromTab(tabId, opts = {}) {
  let article;
  try {
    article = await extractFromTab(tabId, opts);
  } catch {
    return { ok: false, error: "restricted" };
  }
  if (!article?.paragraphs?.length) return { ok: false, error: "no-article" };
  return start({ tabId, ...article, source: "page" });
}

async function startFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false };
  return startFromTab(tab.id, { force: true });
}

function splitSelection(text) {
  return String(text || "").split(/\n\s*\n|\r\n\s*\r\n/).map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// ------------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === "background") {
    // from the offscreen document
    (async () => {
      await ready;
      if (msg.type === "engine") {
        engine = { state: msg.state, loaded: msg.loaded, total: msg.total, error: msg.error, info: msg.info };
        broadcast();
      } else if (msg.type === "status" && session) {
        if (msg.state === "stopped") return;
        session.state = msg.state;
        session.index = msg.index;
        if (msg.error) session.error = msg.error;
        await saveSession();
        broadcast();
      }
    })();
    return;
  }
  if (msg?.target === "offscreen" || msg?.target === "ui") return;

  const tabId = sender.tab?.id ?? msg.tabId ?? null;
  const reply = (p) => { Promise.resolve(p).then(sendResponse, (e) => sendResponse({ ok: false, error: String(e?.message || e) })); return true; };
  switch (msg?.type) {
    case "get-state":
      return reply(ready.then(() => ({ ...publicState(), isThisTab: tabId != null && session?.tabId === tabId })));
    case "start":
      return reply(start({ ...msg, tabId: msg.source === "test" ? null : tabId }));
    case "start-tab":
      return reply(startFromTab(msg.tabId, { force: true }));
    case "control":
      return reply(control(msg.action, msg.value));
    case "preload":
      return reply(getSettings().then(async ({ model }) => {
        await ensureOffscreen();
        return toOffscreen({ type: "preload", model });
      }));
  }
});

// ------------------------------------------------------------------ automatic article detection
/** Register the content script for every page when the optional host permission is granted, and remove it
 * when it is revoked. Returns whether automatic detection is on. */
async function syncAutoDetect({ injectOpenTabs = false } = {}) {
  const granted = await chrome.permissions.contains({ origins: AUTO_ORIGINS });
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] })).length > 0;
  if (granted && !registered) {
    await chrome.scripting.registerContentScripts([{ id: AUTO_SCRIPT_ID, matches: AUTO_ORIGINS, js: CONTENT_FILES, runAt: "document_idle", persistAcrossSessions: true }]);
  } else if (!granted && registered) {
    await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
  }
  if (granted && injectOpenTabs) {
    // pages that are already open get the button too (the content script ignores a second injection)
    for (const tab of await chrome.tabs.query({ url: AUTO_ORIGINS })) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
    }
  }
  return granted;
}

chrome.permissions.onAdded.addListener(() => syncAutoDetect({ injectOpenTabs: true }));
chrome.permissions.onRemoved.addListener(() => syncAutoDetect());

// ------------------------------------------------------------------ shortcuts, context menu, lifecycle
chrome.commands.onCommand.addListener((command) => {
  const map = { "toggle-reading": "toggle", "stop-reading": "stop", "next-paragraph": "next", "prev-paragraph": "prev" };
  if (map[command]) control(map[command]);
});

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "istima-selection", title: t("menuReadSelection"), contexts: ["selection"] });
    chrome.contextMenus.create({ id: "istima-page", title: t("menuReadPage"), contexts: ["page"] });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "istima-selection") {
    start({ tabId: tab?.id ?? null, url: tab?.url || "", title: t("selectionTitle"), site: tab?.url ? new URL(tab.url).hostname : "", paragraphs: splitSelection(info.selectionText), source: "selection" });
  } else if (info.menuItemId === "istima-page" && tab?.id) {
    startFromTab(tab.id, { force: true });
  }
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  createMenus();
  syncAutoDetect({ injectOpenTabs: true });
  const current = await chrome.storage.sync.get(null);
  await chrome.storage.sync.set({ ...DEFAULTS, ...current });
  if (reason === "install") chrome.tabs.create({ url: "welcome/welcome.html" });
});

chrome.runtime.onStartup.addListener(() => {
  createMenus();
  syncAutoDetect();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ready;
  if (session?.tabId === tabId) control("stop");
});

updateBadge();
