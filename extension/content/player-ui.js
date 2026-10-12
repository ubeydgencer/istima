// İstima's in-page player, rendered in a shadow root so the page's CSS cannot reach it.
// Exposes globalThis.IstimaUI.create(handlers) -> controller. Loaded before content.js.
(() => {
  if (globalThis.IstimaUI) return;
  const isActive = () => {
    try { return !!chrome.runtime?.id; } catch { return false; }
  };
  const t = (key, subs) => {
    if (!isActive()) return "";
    try { return chrome.i18n.getMessage(key, subs) || key; }
    catch (error) {
      if (!isActive() || error.message?.includes("Extension context invalidated")) return "";
      throw error;
    }
  };

  // each logo gets its own gradient id: a gradient inside a hidden (display: none) copy would not paint
  let gradients = 0;
  const ICON = {
    logo: () => { const id = `ig${++gradients}`; return '<svg viewBox="0 0 128 128" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E23A55"/><stop offset="1" stop-color="#A3142D"/></linearGradient></defs><rect width="128" height="128" rx="30" fill="url(#' + id + ')"/><circle cx="44" cy="33" r="11" fill="#FFF6EC"/><rect x="34" y="53" width="20" height="50" rx="10" fill="#FFF6EC"/><path d="M68 62a22 22 0 0 1 0 32" fill="none" stroke="#FFF6EC" stroke-width="10" stroke-linecap="round"/><path d="M82 49a40 40 0 0 1 0 58" fill="none" stroke="#FFF6EC" stroke-width="10" stroke-linecap="round" opacity=".72"/></svg>'; },
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.5 6.2v11.6a.9.9 0 0 1-1.4.75L8.4 13.2V17a1 1 0 0 1-2 0V7a1 1 0 0 1 2 0v3.8l7.7-5.35a.9.9 0 0 1 1.4.75z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.2v11.6a.9.9 0 0 0 1.4.75l7.7-5.35V17a1 1 0 0 0 2 0V7a1 1 0 0 0-2 0v3.8L7.9 5.45a.9.9 0 0 0-1.4.75z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    minimize: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/></svg>',
  };

  const CSS = `
:host { all: initial; }
.istima {
  --brand: #C81E3A; --brand-hover: #A3142D; --brand-soft: rgba(200, 30, 58, .1);
  --bg: #FFFFFF; --surface: #F6F2EE; --text: #1C1A1F; --muted: #6B6570; --line: rgba(28, 26, 31, .1);
  --shadow: 0 1px 2px rgba(20, 10, 15, .08), 0 12px 32px -8px rgba(20, 10, 15, .28);
  position: fixed; bottom: 20px; right: 20px; z-index: 2147483646;
  font: 400 14px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text); -webkit-font-smoothing: antialiased; letter-spacing: normal; text-align: left;
}
.istima[data-pos="left"] { right: auto; left: 20px; }
@media (prefers-color-scheme: dark) {
  .istima { --bg: #1E1B21; --surface: #2A262E; --text: #F3EEE9; --muted: #A79FAB; --line: rgba(255, 255, 255, .1);
    --brand: #F0566E; --brand-hover: #FF7088; --brand-soft: rgba(240, 86, 110, .14);
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 12px 32px -8px rgba(0, 0, 0, .7); }
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
svg { display: block; width: 100%; height: 100%; }
[hidden] { display: none !important; }

/* pill: an article was found, nothing playing */
.pill-wrap { display: flex; align-items: center; gap: 4px; animation: rise .35s cubic-bezier(.2, .8, .2, 1); }
.pill { display: flex; align-items: center; gap: 10px; padding: 8px 16px 8px 8px; border-radius: 999px;
  background: var(--bg); box-shadow: var(--shadow); border: 1px solid var(--line); transition: transform .15s, box-shadow .15s; }
.pill:hover { transform: translateY(-1px); }
.pill:active { transform: translateY(0); }
.pill .logo { width: 32px; height: 32px; flex: none; }
.pill-text { display: flex; flex-direction: column; line-height: 1.2; }
.pill-text b { font-weight: 650; font-size: 14px; }
.pill-text small { color: var(--muted); font-size: 12px; }
.pill-close { width: 26px; height: 26px; padding: 6px; border-radius: 50%; color: var(--muted); background: var(--bg);
  box-shadow: var(--shadow); opacity: 0; transition: opacity .15s; }
.pill-wrap:hover .pill-close, .pill-close:focus-visible { opacity: 1; }

/* card: the full player */
.card { width: 340px; max-width: calc(100vw - 40px); background: var(--bg); border: 1px solid var(--line); border-radius: 18px;
  box-shadow: var(--shadow); padding: 14px 14px 12px; animation: rise .3s cubic-bezier(.2, .8, .2, 1); }
.head { display: flex; align-items: center; gap: 10px; }
.head .logo { width: 30px; height: 30px; flex: none; }
.meta { flex: 1; min-width: 0; }
.brand { font-weight: 700; font-size: 12px; letter-spacing: .02em; color: var(--brand); display: block; }
.title { display: block; font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.icon-btn { width: 28px; height: 28px; padding: 5px; border-radius: 8px; color: var(--muted); flex: none; }
.icon-btn:hover { background: var(--surface); color: var(--text); }
.status { display: flex; align-items: center; gap: 8px; margin: 12px 2px 8px; font-size: 12.5px; color: var(--muted); min-height: 18px; }
.status-text { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.count { font-variant-numeric: tabular-nums; }
.progress { height: 4px; background: var(--surface); border-radius: 99px; overflow: hidden; cursor: pointer; }
.bar { height: 100%; width: 0; background: var(--brand); border-radius: 99px; transition: width .4s ease; }
.controls { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 12px; position: relative; }
.ctl { width: 38px; height: 38px; padding: 8px; border-radius: 50%; color: var(--text); }
.ctl:hover { background: var(--surface); }
.ctl:disabled { opacity: .35; cursor: default; background: none; }
.main { width: 52px; height: 52px; padding: 13px; border-radius: 50%; background: var(--brand); color: #fff; box-shadow: 0 6px 16px -6px var(--brand); transition: background .15s, transform .1s; }
.main:hover { background: var(--brand-hover); }
.main:active { transform: scale(.96); }
.speed { position: absolute; right: 0; min-width: 48px; height: 30px; padding: 0 10px; border-radius: 99px; background: var(--surface);
  font-weight: 650; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.speed:hover { background: var(--brand-soft); color: var(--brand); }
.hint { position: absolute; left: 0; font-size: 11px; color: var(--muted); }

/* spinner and equaliser */
.spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--brand); animation: spin .8s linear infinite; flex: none; }
.eq { display: flex; align-items: flex-end; gap: 2px; width: 14px; height: 12px; flex: none; }
.eq i { flex: 1; background: var(--brand); border-radius: 1px; animation: eq 1s ease-in-out infinite; }
.eq i:nth-child(2) { animation-delay: -.3s; } .eq i:nth-child(3) { animation-delay: -.6s; }
.paused .eq i { animation-play-state: paused; }

/* mini: minimised while reading */
.mini { width: 52px; height: 52px; border-radius: 50%; background: var(--bg); box-shadow: var(--shadow); border: 1px solid var(--line);
  display: grid; place-items: center; animation: rise .3s cubic-bezier(.2, .8, .2, 1); position: relative; }
.mini .logo { width: 36px; height: 36px; }
.mini .ring { position: absolute; inset: -3px; border-radius: 50%; border: 3px solid transparent; border-top-color: var(--brand); animation: spin 1.4s linear infinite; }
.mini.idle .ring { display: none; }

@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes eq { 0%, 100% { height: 30%; } 50% { height: 100%; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
`;

  function el(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  function create(h) {
    const host = document.createElement("istima-player");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483646;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    root.append(style);

    const wrap = el(`<div class="istima" data-pos="right" role="region"></div>`);
    wrap.setAttribute("aria-label", t("playerRegion"));
    root.append(wrap);

    // pill
    const pill = el(`<div class="pill-wrap" hidden>
      <button class="pill" type="button"><span class="logo">${ICON.logo()}</span><span class="pill-text"><b></b><small></small></span></button>
      <button class="pill-close" type="button">${ICON.close}</button></div>`);
    pill.querySelector("b").textContent = t("pillListen");
    pill.querySelector(".pill-close").setAttribute("aria-label", t("pillHide"));
    pill.querySelector(".pill-close").title = t("pillHide");
    pill.querySelector(".pill").addEventListener("click", () => h.onPlay());
    pill.querySelector(".pill-close").addEventListener("click", () => h.onHidePill());

    // card
    const card = el(`<section class="card" hidden>
      <div class="head"><span class="logo">${ICON.logo()}</span>
        <div class="meta"><span class="brand">İstima</span><span class="title"></span></div>
        <button class="icon-btn min" type="button">${ICON.minimize}</button>
        <button class="icon-btn x" type="button">${ICON.close}</button></div>
      <div class="status"><span class="ind"></span><span class="status-text"></span><span class="count"></span></div>
      <div class="progress" role="progressbar" aria-valuemin="0"><div class="bar"></div></div>
      <div class="controls">
        <button class="ctl prev" type="button">${ICON.prev}</button>
        <button class="main" type="button">${ICON.pause}</button>
        <button class="ctl next" type="button">${ICON.next}</button>
        <button class="speed" type="button">1×</button>
      </div></section>`);
    const $ = (s) => card.querySelector(s);
    const label = (node, key) => { node.setAttribute("aria-label", t(key)); node.title = t(key); };
    label($(".min"), "playerMinimize");
    label($(".x"), "playerStop");
    label($(".prev"), "playerPrev");
    label($(".next"), "playerNext");
    label($(".speed"), "playerSpeed");
    $(".min").addEventListener("click", () => setMode("mini"));
    $(".x").addEventListener("click", () => h.onStop());
    $(".prev").addEventListener("click", () => h.onPrev());
    $(".next").addEventListener("click", () => h.onNext());
    $(".main").addEventListener("click", () => h.onToggle());
    $(".speed").addEventListener("click", () => h.onSpeed());
    $(".progress").addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      h.onSeekFraction(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    });

    // mini
    const mini = el(`<button class="mini" type="button" hidden><span class="ring"></span><span class="logo">${ICON.logo()}</span></button>`);
    label(mini, "playerExpand");
    mini.addEventListener("click", () => setMode("player"));

    wrap.append(pill, card, mini);
    (document.body || document.documentElement).append(host);

    let mode = "none";
    function setMode(m) {
      mode = m;
      pill.hidden = m !== "pill";
      card.hidden = m !== "player";
      mini.hidden = m !== "mini";
    }

    return {
      host,
      get mode() { return mode; },
      setMode,
      setPosition(pos) { wrap.dataset.pos = pos === "left" ? "left" : "right"; },
      setPill({ minutes }) {
        pill.querySelector("small").textContent = minutes ? t("pillMinutes", [String(minutes)]) : t("pillOnDevice");
      },
      /** state: the session as the background reports it; engine: {state, loaded, total} */
      render(state, engine) {
        const s = state || {};
        $(".title").textContent = s.title || "";
        $(".title").title = s.title || "";
        const total = s.total || 0, index = s.index || 0;
        $(".count").textContent = total ? `${Math.min(index + 1, total)}/${total}` : "";
        const frac = total ? (index + (s.state === "ended" ? 1 : 0.5)) / total : 0;
        $(".bar").style.width = `${Math.round(frac * 100)}%`;
        $(".progress").setAttribute("aria-valuemax", String(total));
        $(".progress").setAttribute("aria-valuenow", String(index + 1));
        const playing = s.state === "playing" || s.state === "buffering" || s.state === "loading";
        const main = $(".main");
        main.innerHTML = playing ? ICON.pause : ICON.play;
        label(main, playing ? "playerPause" : "playerPlay");
        $(".prev").disabled = index <= 0;
        $(".next").disabled = index >= total - 1;
        $(".speed").textContent = `${String(s.speed ?? 1).replace(".", ",")}×`;

        let text, ind;
        if (s.state === "loading" || engine?.state === "loading") {
          const pct = engine?.total ? Math.round((engine.loaded / engine.total) * 100) : 0;
          text = pct && pct < 100 ? t("statusLoadingPct", [String(pct)]) : t("statusLoading");
          ind = "spin";
        } else if (s.state === "buffering") { text = t("statusBuffering"); ind = "spin"; }
        else if (s.state === "playing") { text = t("statusPlaying"); ind = "eq"; }
        else if (s.state === "paused") { text = t("statusPaused"); ind = "eq"; }
        else if (s.state === "ended") { text = t("statusEnded"); ind = ""; }
        else if (s.state === "error") { text = t("statusError"); ind = ""; }
        else { text = ""; ind = ""; }
        $(".status-text").textContent = text;
        const indEl = $(".ind");
        indEl.className = "ind";
        indEl.innerHTML = ind === "eq" ? '<span class="eq"><i></i><i></i><i></i></span>' : ind === "spin" ? '<span class="spin"></span>' : "";
        card.classList.toggle("paused", s.state === "paused");
        mini.classList.toggle("idle", !playing);
      },
    };
  }

  globalThis.IstimaUI = { create, isActive };
})();
