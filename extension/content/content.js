// İstima content script: finds a Turkish article on the page, offers to read it, highlights the paragraph
// being read and shows the in-page player. The audio itself plays in the extension's offscreen document.
(() => {
  if (globalThis.__istimaLoaded) return;
  globalThis.__istimaLoaded = true;

  // a copy of shared/settings.js (content scripts cannot import modules)
  const DEFAULTS = { model: "antalia", speed: 1, readTitle: true, highlight: true, autoScroll: true, showButton: true, autoPlay: false, position: "right", disabledSites: [] };
  const SPEEDS = [0.8, 1, 1.15, 1.3, 1.5, 1.75];
  const CHARS_PER_SECOND = 14; // Turkish speech at the voice's own pace
  const HL_CLASS = "istima-reading";

  let settings = { ...DEFAULTS };
  let article = null; // {url, title, site, paragraphs, els, isTurkish, isArticle, chars}
  let session = null, engine = null, isThisTab = false;
  let ui = null, pillDismissed = false, highlighted = null;
  let disposed = false, navigationTimer = null, idleHandle = null, highlightStyle = null;
  const playerUI = globalThis.IstimaUI;
  const domEvents = new AbortController();
  const timeouts = new Set();

  // Reloading/updating an extension invalidates its API, but the old page's JS timers survive.
  function dispose() {
    if (disposed) return;
    disposed = true;
    clearInterval(navigationTimer);
    for (const timer of timeouts) clearTimeout(timer);
    timeouts.clear();
    if (idleHandle != null) window.cancelIdleCallback(idleHandle);
    domEvents.abort();
    ui?.host.remove();
    clearHighlight();
    highlightStyle?.remove();
    if (globalThis.IstimaUI === playerUI) {
      delete globalThis.IstimaUI;
      delete globalThis.__istimaLoaded;
    }
  }

  function isActive() {
    if (!disposed && playerUI.isActive()) return true;
    dispose();
    return false;
  }

  function later(fn, delay) {
    const timer = setTimeout(() => {
      timeouts.delete(timer);
      if (isActive()) fn();
    }, delay);
    timeouts.add(timer);
  }

  async function send(msg) {
    if (!isActive()) return null;
    try { return await chrome.runtime.sendMessage(msg); }
    catch { isActive(); return null; }
  }
  const host = location.hostname.replace(/^www\./, "");
  const siteDisabled = () => settings.disabledSites.some((d) => host === d || host.endsWith(`.${d}`));

  // ------------------------------------------------------------------ language
  const TR_STOPWORDS = new Set("ve bir bu için ile da de olarak daha çok gibi olan ama en ki ne şu sonra kadar göre değil ise mi her var yok ancak ayrıca tarafından ilgili yılında üzerinde arasında olduğu olduğunu dedi açıkladı şöyle".split(" "));

  function looksTurkish(text) {
    const words = text.toLocaleLowerCase("tr").match(/\p{L}+/gu) || [];
    if (words.length < 40) return false;
    const sample = words.slice(0, 1500);
    const stop = sample.filter((w) => TR_STOPWORDS.has(w)).length / sample.length;
    const special = (text.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length / Math.max(1, text.length);
    return stop > 0.06 && special > 0.008;
  }

  function declaredLang() {
    const meta = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
    return (document.documentElement.lang || meta('meta[property="og:locale"]') || meta('meta[http-equiv="content-language" i]')).toLowerCase();
  }

  // ------------------------------------------------------------------ article extraction
  const JUNK = /^(reklam|advertisement|sponsorlu|haberin devamı|devamını oku|ilginizi çekebilir|ilgili haberler|abone ol|bizi takip edin|google news|takip et|paylaş|yorum yap|yorumlar|etiketler|okumaya devam|tıklayın|(kaynak|muhabir|editör|foto(ğraf)?|görsel)\s*:)/i;
  const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre";
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  // boilerplate that news sites put between paragraphs: follow-us prompts, copyright notes, tag lists
  const NOISE = /(takip edin|haberdar olun|abone olun|kaynak olarak ekle|bildirimleri aç|uygulamamızı indir|(whatsapp|telegram) kanal|her türlü telif hakk|tüm hakları saklıdır|izin alınmadan|ilgili konular\s*:)/i;
  const useful = (s) => (s.match(/\p{L}/gu) || []).length >= 3 && !(s.split(" ").length < 12 && JUNK.test(s)) && !/^https?:\/\/\S+$/.test(s)
    && !(s.split(" ").length < 40 && NOISE.test(s)) && (s.match(/#[\p{L}\d_]+/gu) || []).length < 2;

  function extract() {
    if (typeof Readability === "undefined") return null;
    let parsed;
    try {
      parsed = new Readability(document.cloneNode(true), { charThreshold: 300 }).parse();
    } catch {
      return null;
    }
    if (!parsed?.content) return null;
    const doc = new DOMParser().parseFromString(parsed.content, "text/html");
    const blocks = [...doc.body.querySelectorAll(BLOCKS)].filter((b) => !b.querySelector(BLOCKS));
    const byline = clean(parsed.byline);
    let paragraphs = blocks
      .filter((b) => {
        const text = clean(b.textContent);
        if (!useful(text) || text === byline) return false;
        if (/^H\d$/.test(b.tagName)) return true;
        const words = text.split(" ").length;
        const ended = /[.!?…:;"”’'»)]$/.test(text);
        if (words < 4 && !ended) return false; // category labels, captions, "Turizm"
        if (words < 14 && !ended && /\b(19|20)\d{2}\b|\b\d{1,2}:\d{2}\b/.test(text)) return false; // "Haber Merkezi · 10 Ekim 2026, 09:45"
        return true;
      })
      .map((b) => clean(b.textContent));
    const total = clean(parsed.textContent).length;
    if (paragraphs.join(" ").length < total * 0.5) {
      // sites that put text in <div>s with <br>s: fall back to the plain text
      paragraphs = String(parsed.textContent).split(/\n\s*\n/).map(clean).filter(useful);
    }
    paragraphs = paragraphs.filter((p, i) => p !== paragraphs[i - 1]);
    // the page's own headline beats <title>, which usually carries the site name ("… - Gazete")
    const h1 = [...document.querySelectorAll("article h1, main h1, h1")].map((h) => clean(h.textContent)).find((x) => x.length > 10);
    const title = h1 || clean(parsed.title) || clean(document.title);
    if (paragraphs[0] === title) paragraphs.shift();
    return { title, site: clean(parsed.siteName) || host, paragraphs, textContent: parsed.textContent, lang: parsed.lang };
  }

  /** Map each paragraph to the live element that shows it, for highlighting (best effort). */
  function locate(paragraphs, title) {
    const candidates = [...document.body.querySelectorAll(BLOCKS)].slice(0, 4000);
    const byText = new Map();
    for (const c of candidates) {
      if (c.closest("istima-player")) continue;
      const key = clean(c.textContent);
      if (key && !byText.has(key)) byText.set(key, c);
    }
    const used = new Set();
    const find = (text) => {
      let hit = byText.get(text);
      if (!hit) {
        const head = text.slice(0, 80);
        hit = candidates.find((c) => !used.has(c) && clean(c.textContent).startsWith(head));
      }
      if (hit) used.add(hit);
      return hit || null;
    };
    const titleEl = [...document.querySelectorAll("h1")].find((h) => clean(h.textContent) === title) || null;
    return { titleEl, els: paragraphs.map(find) };
  }

  /** Short news items fail Readability's quick check; trust pages that say they are articles. */
  function markedAsArticle() {
    if (/article/i.test(document.querySelector('meta[property="og:type"]')?.content || "")) return true;
    return [...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => /"@type"\s*:\s*"(News|Reportage|Analysis|Opinion)?Article"/.test(s.textContent));
  }

  function analyse() {
    const lang = declaredLang();
    const sample = (document.body?.textContent || "").slice(0, 20000);
    const declaredTr = lang.startsWith("tr");
    const probablyTr = declaredTr || looksTurkish(sample);
    const readerable = typeof isProbablyReaderable !== "function" || isProbablyReaderable(document, { minContentLength: 140, minScore: 20 }) || markedAsArticle();
    if (!probablyTr || !readerable) return { url: location.href, isTurkish: probablyTr, isArticle: false, paragraphs: [], els: [] };
    return build(declaredTr);
  }

  function build(declaredTr) {
    const parsed = extract();
    if (!parsed || !parsed.paragraphs.length) return { url: location.href, isTurkish: !!declaredTr, isArticle: false, paragraphs: [], els: [] };
    const isTurkish = declaredTr || (parsed.lang || "").toLowerCase().startsWith("tr") || looksTurkish(parsed.textContent);
    const chars = parsed.paragraphs.reduce((a, p) => a + p.length, 0) + parsed.title.length;
    const { titleEl, els } = locate(parsed.paragraphs, parsed.title);
    return {
      url: location.href, title: parsed.title, site: parsed.site, isTurkish, isArticle: chars >= 400,
      paragraphs: parsed.paragraphs, els, titleEl, chars,
    };
  }

  /** The texts to read and their elements, the title first when the setting asks for it. */
  function readingList(a) {
    if (settings.readTitle && a.title) return { texts: [a.title, ...a.paragraphs], els: [a.titleEl, ...a.els] };
    return { texts: a.paragraphs, els: a.els };
  }

  const minutes = (a) => Math.max(1, Math.round(a.chars / CHARS_PER_SECOND / 60 / (settings.speed || 1)));

  // ------------------------------------------------------------------ actions
  function startReading(index = 0) {
    if (!article?.paragraphs.length) return;
    const { texts } = readingList(article);
    send({ type: "start", url: article.url, title: article.title, site: article.site, paragraphs: texts, index });
  }

  function control(action, value) {
    return send({ type: "control", action, value });
  }

  function ensureUI() {
    if (ui) return ui;
    ui = IstimaUI.create({
      onPlay: () => startReading(0),
      onToggle: () => control("toggle"),
      onStop: () => control("stop"),
      onPrev: () => control("prev"),
      onNext: () => control("next"),
      onSpeed: () => {
        const cur = session?.speed ?? settings.speed;
        const next = SPEEDS[(SPEEDS.indexOf(cur) + 1) % SPEEDS.length] ?? 1;
        control("speed", next);
      },
      onSeekFraction: (f) => session?.total && control("seek", Math.min(session.total - 1, Math.floor(f * session.total))),
      onHidePill: () => { pillDismissed = true; render(); },
    });
    ui.setPosition(settings.position);
    return ui;
  }

  // ------------------------------------------------------------------ rendering
  function clearHighlight() {
    highlighted?.classList.remove(HL_CLASS);
    highlighted = null;
  }

  function highlight() {
    clearHighlight();
    if (!settings.highlight || !isThisTab || !session || session.source !== "page" || !article || session.url !== article.url) return;
    if (!["playing", "paused", "buffering"].includes(session.state)) return;
    const target = readingList(article).els[session.index];
    if (!target?.isConnected) return;
    if (!document.getElementById("istima-highlight-style")) {
      const style = document.createElement("style");
      style.id = "istima-highlight-style";
      highlightStyle = style;
      style.textContent = `.${HL_CLASS}{background-color:rgba(200,30,58,.09)!important;box-shadow:0 0 0 6px rgba(200,30,58,.09)!important;border-radius:4px!important;transition:background-color .3s,box-shadow .3s!important;scroll-margin:30vh!important}@media (prefers-color-scheme:dark){.${HL_CLASS}{background-color:rgba(240,86,110,.16)!important;box-shadow:0 0 0 6px rgba(240,86,110,.16)!important}}`;
      document.head.append(style);
    }
    target.classList.add(HL_CLASS);
    highlighted = target;
    if (settings.autoScroll && session.state === "playing") {
      const r = target.getBoundingClientRect();
      if (r.top < 60 || r.bottom > innerHeight - 140) target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  let lastIndex = -1;
  function render() {
    if (!isActive()) return;
    const active = isThisTab && session && session.state !== "stopped";
    const offer = !active && article?.isTurkish && article.isArticle && settings.showButton && !siteDisabled() && !pillDismissed;
    if (!active && !offer) {
      if (ui) ui.setMode("none");
      clearHighlight();
      return;
    }
    ensureUI();
    ui.setPosition(settings.position);
    if (active) {
      if (ui.mode !== "player" && ui.mode !== "mini") ui.setMode("player");
      ui.render(session, engine);
      if (session.index !== lastIndex || !highlighted || session.state !== "playing") highlight();
      lastIndex = session.index;
    } else {
      clearHighlight();
      ui.setPill({ minutes: minutes(article) });
      ui.setMode("pill");
    }
  }

  // ------------------------------------------------------------------ messages
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isActive()) return;
    if (msg?.type === "istima-state") {
      session = msg.session;
      engine = msg.engine;
      isThisTab = !!msg.session;
      render();
    } else if (msg?.type === "istima-detect") {
      if (!article || article.url !== location.href || !article.isArticle) article = analyse();
      sendResponse({
        url: location.href, isTurkish: !!article.isTurkish, isArticle: !!article.isArticle, title: article.title || document.title,
        site: article.site || host, paragraphs: article.paragraphs.length, minutes: article.chars ? minutes(article) : 0,
      });
    } else if (msg?.type === "istima-extract") {
      if (!article || article.url !== location.href || !article.isArticle) {
        article = analyse();
        if (msg.force && !article.paragraphs.length) article = build(false);
      }
      if (!article.paragraphs.length) { sendResponse(null); return; }
      const { texts } = readingList(article);
      sendResponse({ url: article.url, title: article.title, site: article.site, paragraphs: texts, index: 0 });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (!isActive()) return;
    if (area !== "sync") return;
    for (const [k, { newValue }] of Object.entries(changes)) settings[k] = newValue ?? DEFAULTS[k];
    render();
  });

  // Alt+click on a paragraph: read from there
  document.addEventListener("click", (e) => {
    if (!isActive()) return;
    if (!e.altKey || !article?.paragraphs.length) return;
    const { els } = readingList(article);
    const i = els.findIndex((el) => el && el.contains(e.target));
    if (i < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (isThisTab && session && session.url === article.url) control("seek", i);
    else startReading(i);
  }, { capture: true, signal: domEvents.signal });

  // ------------------------------------------------------------------ start-up and SPA navigation
  async function init() {
    if (!isActive()) return;
    try { settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(null)) }; }
    catch (error) { if (!isActive()) return; throw error; }
    if (!isActive()) return;
    const state = await send({ type: "get-state" });
    if (!isActive()) return;
    if (state?.isThisTab) { session = state.session; engine = state.engine; isThisTab = true; }
    // pages that render their article late get two more looks
    let tries = 0;
    const run = () => {
      if (!isActive()) return;
      article = analyse();
      render();
      if (!article.isArticle && ++tries < 3) { later(run, tries * 2500); return; }
      if (settings.autoPlay && article.isTurkish && article.isArticle && !siteDisabled() && !(isThisTab && session)) startReading(0);
    };
    const idle = () => {
      if (!isActive()) return;
      if (window.requestIdleCallback) idleHandle = requestIdleCallback(() => { idleHandle = null; run(); }, { timeout: 1500 });
      else later(run, 300);
    };
    if (document.readyState === "complete") idle();
    else addEventListener("load", idle, { once: true, signal: domEvents.signal });
  }

  let lastUrl = location.href;
  navigationTimer = setInterval(() => {
    if (!isActive()) return;
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    pillDismissed = false;
    later(() => { article = analyse(); render(); }, 1200);
  }, 1000);

  init();
})();
