import { t, localize, formatSpeed } from "../shared/i18n.js";
import { SPEEDS, getSettings } from "../shared/settings.js";
import { hasAutoDetect, requestAutoDetect, removeAutoDetect } from "../shared/auto-detect.js";

const $ = (id) => document.getElementById(id);
let settings;
let savedTimer;

async function save(patch) {
  Object.assign(settings, patch);
  await chrome.storage.sync.set(patch);
  const note = $("saved");
  note.textContent = t("optSaved");
  note.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => note.classList.remove("show"), 1400);
}

function renderSpeed() {
  const box = $("speed");
  if (!box.children.length) {
    for (const s of SPEEDS) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.value = String(s);
      b.textContent = formatSpeed(s);
      b.addEventListener("click", () => { save({ speed: s }); renderSpeed(); });
      box.append(b);
    }
  }
  for (const b of box.children) b.setAttribute("aria-pressed", String(Number(b.dataset.value) === settings.speed));
}

function renderPosition() {
  for (const b of $("position").children) b.setAttribute("aria-pressed", String(b.dataset.value === settings.position));
}

function renderModel() {
  for (const b of $("model").children) b.setAttribute("aria-pressed", String(b.dataset.value === settings.model));
}

function renderSites() {
  const list = $("sites");
  list.replaceChildren();
  for (const site of settings.disabledSites) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = site;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.setAttribute("aria-label", t("optSitesRemove", [site]));
    rm.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    rm.addEventListener("click", () => { save({ disabledSites: settings.disabledSites.filter((s) => s !== site) }); renderSites(); });
    li.append(name, rm);
    list.append(li);
  }
  $("sites-empty").hidden = settings.disabledSites.length > 0;
}

function normaliseSite(input) {
  let v = input.trim().toLowerCase();
  if (!v) return "";
  try { v = new URL(v.includes("://") ? v : `https://${v}`).hostname; } catch { return ""; }
  return v.replace(/^www\./, "");
}

async function renderShortcuts() {
  const list = $("shortcuts");
  const commands = await chrome.commands.getAll();
  list.replaceChildren();
  for (const c of commands) {
    if (!c.description) continue;
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = c.description;
    const keys = document.createElement("span");
    if (c.shortcut) {
      for (const k of c.shortcut.split(/\+/)) {
        const kbd = document.createElement("kbd");
        kbd.textContent = k;
        keys.append(kbd, " ");
      }
    } else {
      keys.className = "muted small";
      keys.textContent = t("optShortcutUnset");
    }
    li.append(label, keys);
    list.append(li);
  }
}

// ------------------------------------------------------------------ try the voice
function renderTry(session, engine) {
  const status = $("try-status");
  if (engine?.state === "loading") {
    const pct = engine.total ? Math.round((engine.loaded / engine.total) * 100) : 0;
    status.textContent = pct && pct < 100 ? t("statusLoadingPct", [String(pct)]) : t("statusLoading");
  } else if (session?.source === "test") {
    const key = { loading: "statusLoading", buffering: "statusBuffering", playing: "statusPlaying", paused: "statusPaused", ended: "statusEnded", error: "statusError" }[session.state];
    status.textContent = key ? t(key) : "";
  } else status.textContent = "";
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.target === "ui" && msg.type === "state") renderTry(msg.session, msg.engine);
});

(async () => {
  localize();
  settings = await getSettings();
  for (const input of document.querySelectorAll("input[data-key]")) {
    input.checked = !!settings[input.dataset.key];
    input.addEventListener("change", () => save({ [input.dataset.key]: input.checked }));
  }
  renderSpeed();
  renderModel();
  for (const b of $("model").children) b.addEventListener("click", async () => {
    await save({ model: b.dataset.value });
    renderModel();
  });
  renderPosition();
  const auto = $("auto-detect");
  const renderAuto = async () => {
    auto.checked = await hasAutoDetect();
    for (const row of document.querySelectorAll(".needs-auto")) row.classList.toggle("off", !auto.checked);
  };
  auto.addEventListener("change", async () => {
    if (auto.checked) await requestAutoDetect().catch(() => false);
    else await removeAutoDetect();
    renderAuto();
  });
  chrome.permissions.onAdded.addListener(renderAuto);
  chrome.permissions.onRemoved.addListener(renderAuto);
  renderAuto();
  for (const b of $("position").children) b.addEventListener("click", () => { save({ position: b.dataset.value }); renderPosition(); });
  renderSites();
  $("site-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const site = normaliseSite($("site-input").value);
    if (!site || settings.disabledSites.includes(site)) return;
    save({ disabledSites: [...settings.disabledSites, site] });
    $("site-input").value = "";
    renderSites();
  });
  renderShortcuts();
  $("edit-shortcuts").addEventListener("click", () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }));

  $("try-text").value = t("optTrySample");
  $("try-play").addEventListener("click", () => {
    const text = $("try-text").value.trim();
    if (text) chrome.runtime.sendMessage({ type: "start", source: "test", title: t("popupNowTest"), paragraphs: text.split(/\n\s*\n/) });
  });
  $("try-stop").addEventListener("click", () => chrome.runtime.sendMessage({ type: "control", action: "stop" }));
  const state = await chrome.runtime.sendMessage({ type: "get-state" });
  renderTry(state?.session, state?.engine);

  $("version").textContent = t("optVersion", [chrome.runtime.getManifest().version]);
})();
