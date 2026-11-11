// ==UserScript==
// @name         BuyFromAuction Deal Watcher
// @namespace    bfa-deal-watcher
// @version      2.0.2
// @description  Polls the BuyFromAuction store API every 10 seconds from noon until 7 PM local time and alerts when a watched product is in stock.
// @match        https://buyfromauction.in/*
// @match        https://www.buyfromauction.in/*
// @match        http://buyfromauction.in/*
// @noframes
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Two ways to run it:
//   A) Tampermonkey/Violentmonkey: install this file; it starts whenever a buyfromauction.in tab is open.
//   B) Quick test: open buyfromauction.in, press F12 > Console, paste this whole file, press Enter.
// Keep one buyfromauction.in tab open (a background tab is fine). Only one tab polls at a time.

(function () {
  'use strict';
  if (typeof window !== 'undefined') console.log('[BFA watcher] script loaded on', location.href);

  // ===================================================================
  // 1. WATCHLIST — add a product by adding one object to this array.
  // ===================================================================
  //
  // type 'keyword' : match on product name + brand.
  //   search   : terms sent to the site's search (one request per term, every tick)
  //   any      : product matches if its text contains ANY of these
  //   all      : ...and ALL of these (optional, to narrow)
  //
  // type 'device'  : phones, tablets, laptops… matched by brand + minimum specs read from the title.
  //   minRam / minStorage (GB) / minScreen (inches) : rule-wide minimums
  //   brands     : watched brands; each can override the minimums and add `aliases`
  //   requireAny : title must contain one of these words (e.g. 'tab', 'ipad') to count as this device
  //   modelHints : fill in specs the title leaves out, e.g. { 'tab s12 ultra': { screen: 14.6 } }
  //   allowUnknownRam / allowUnknownScreen : accept a listing whose title doesn't state that spec
  //   query / queries / search : extra API requests made every tick for this rule
  //
  // Optional on any rule: exclude: ['refurbished'], minPrice: 8000, maxPrice: 40000, minDiscount: 30 (%),
  //   categorySlugs: ['tablets'] (only listings in these site categories)
  //
  // Words that mark accessories rather than the device itself. Built from the shop's own
  // titles (catalogue export of 19,290 listings): "Back Cover For Iphone 15", "Clear Case",
  // "Camera Lens Glass Protector For Moto Edge 60", "Usb C Adaptor", "Compatible With Ipad"…
  // Whole words only. Not listed on purpose: glass (Gorilla Glass), battery (5000mAh Battery),
  // pencil and pen (bundles), magsafe.
  const ACCESSORY_WORDS = [
    'case', 'cover', 'back cover', 'flip', 'bumper', 'skin', 'sticker', 'pouch', 'sleeve', 'wallet',
    'tempered glass', 'screen guard', 'screen protector', 'protector', 'lens protector', 'camera lens',
    'charger', 'charging', 'adapter', 'adaptor', 'connector', 'cable', 'converter', 'dock',
    'holder', 'stand', 'mount', 'bracket', 'tripod', 'grip', 'ring holder', 'lanyard', 'strap', 'charm',
    'keyboard', 'folio', 'mouse pad', 'stylus', 'nibs', 'pen tips', 'magnifier', 'cleaning kit',
    'compatible', 'compatible with', 'replacement', 'spare', 'housing', 'toy', 'dummy', 'empty box',
    'for iphone', 'for apple', 'for ipad', 'for samsung', 'for galaxy', 'for oneplus', 'for one plus',
    'for moto', 'for motorola', 'for tab',
    'remote', 'mug', 'lamp', 'projector', 'night light',
    'private label', 'private lable', 'praivet lable',   // the shop's unbranded goods, never a real device
  ];

  const WATCHLIST = [
    {
      id: 'rosier-ghee',
      label: 'Rosier ghee',
      type: 'keyword',
      search: ['rosier'],
      any: ['rosier', 'rozier'],
      all: ['ghee'],      // Rosier also sells tumblers etc.; only ghee listings count
    },
    {
      id: 'phones',
      label: 'Phones',
      type: 'device',
      query: { category: '56631' },          // Smartphones category on the site
      categorySlugs: ['smartphones'],          // ignore tablets etc.
      minRam: 8, minStorage: 256,
      minPrice: 8000,                          // no qualifying phone costs less; accessories cost ₹50–500
      brands: {
        apple:    { minStorage: 128, allowUnknownRam: true, aliases: ['iphone'] },
        oneplus:  { aliases: ['one plus'] },
        samsung:  { aliases: ['galaxy'] },
        motorola: { aliases: ['moto'] },
        // google: { aliases: ['pixel'] },
      },
      // Add 'refurbished' here to skip refurbished phones.
      exclude: [...ACCESSORY_WORDS],
    },
    {
      id: 'big-tablets',
      label: 'Tablets 13"+',
      type: 'device',
      // Tablets category plus searches, in case a tablet is filed under another category.
      query: { category: '56632' },
      search: ['galaxy tab', 'oneplus pad', 'ipad'],
      requireAny: ['tab', 'tablet', 'pad', 'ipad'],
      minRam: 12, minStorage: 256, minScreen: 13,
      minPrice: 10000,
      brands: {
        samsung: { aliases: ['galaxy'] },
        oneplus: { aliases: ['one plus'] },
        // iPad titles almost never state RAM; the 13" iPad Pro has 12 GB from the M5 onward.
        apple:   { allowUnknownRam: true, aliases: ['ipad'] },
      },
      // Screen sizes for models whose titles often skip "inch". Add new models here.
      modelHints: {
        'tab s9 ultra': { screen: 14.6 }, 'tab s10 ultra': { screen: 14.6 },
        'tab s11 ultra': { screen: 14.6 }, 'tab s12 ultra': { screen: 14.6 },
        'tab s10 fe+': { screen: 13.1 }, 'tab s10 fe plus': { screen: 13.1 },
        'tab s11 fe+': { screen: 13.1 }, 'tab s11 fe plus': { screen: 13.1 },
        'oneplus pad 3': { screen: 13.2 }, 'oneplus pad 4': { screen: 13.2 },
        'ipad pro 13': { screen: 13 }, 'ipad air 13': { screen: 13 },
      },
      exclude: [...ACCESSORY_WORDS, 'book cover', 'paper feel', 'writing tablet', 'lcd writing', 'drawing'],
    },
    // Example — add more like this:
    // { id: 'airfryer', label: 'Philips air fryer', type: 'keyword',
    //   search: ['air fryer'], any: ['philips'], all: ['fryer'], maxPrice: 6000 },
  ];

  const SETTINGS = {
    // When to watch, in your computer's local time (24-hour clock). Outside these windows the
    // watcher sleeps and sends no requests. everyMin = minutes between checks in that window.
    // Set activeHours: [] to watch all day every intervalSec instead.
    activeHours: [
      { from: '12:00', to: '19:00', everyMin: 10 / 60 },
    ],
    intervalSec: 10,        // how often to poll when activeHours is empty
    // Slow down while the shop is quiet: after `afterMin` with no listing added, sold or repriced,
    // the gap between checks moves to the next entry of `stepsMin` and stays on the last one.
    // Any change (or "Check now") drops straight back to the normal pace. Editable from the panel.
    idleBackoff: {
      enabled: true,
      afterMin: 5,
      stepsMin: [1, 2, 4, 8, 16, 30],
    },
    latestPages: 2,         // most pages of newest listings read per check (page 2 only if page 1 is all new)
    fullScanEveryMin: 10,   // category + search requests for every rule run this often (and on "Check now")
    perPage: 100,
    inStockOnly: true,      // only alert on items you can actually buy
    sound: true,
    desktopNotify: true,
    requestGapMs: 1500,     // pause between API calls so the site's firewall doesn't see a burst
    maxBackoffMin: 30,      // if the site refuses everything, wait up to this long between retries
    requestTimeoutSec: 20,  // give up on a request that hasn't answered in this long
    reloadEveryHours: 4,    // Tampermonkey only: reload the idle watcher tab this often to refresh login and the site's checks
    autoCart: {
      enabled: true,        // put new matches straight into your cart (you still check out yourself)
      maxPerCheck: 5,       // safety cap: at most this many items added in one check
      maxPrice: null,       // e.g. 60000 to never auto-add anything above ₹60,000
    },
    // A rule can opt out with autoCart: false (it will still alert you).
  };

  // ===================================================================
  // 2. Matching (pure functions — no DOM)
  // ===================================================================
  const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", times: '×' };
  const decode = (s) => String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
  const norm = (s) => decode(s).toLowerCase().replace(/\s+/g, ' ');

  const brandOf = (p) =>
    (p.attributes || []).find((a) => a.taxonomy === 'pa_brand')?.terms?.map((t) => t.name).join(' ') || '';
  const textOf = (p) => norm(`${p.name} ${brandOf(p)}`);
  const money = (p, key) => Number(p.prices?.[key] || 0) / 10 ** (p.prices?.currency_minor_unit ?? 2);
  const discountPct = (p) => {
    const mrp = money(p, 'regular_price'), price = money(p, 'price');
    return mrp > 0 ? Math.round((1 - price / mrp) * 100) : 0;
  };

  // Pull RAM/storage out of messy titles like
  // "Samsung Galaxy A37 5G 12Gb Ram 256 Gb Storage Imei No 3574...", "OnePlus Nord 5 (8+256)", "8/256GB".
  // Only real phone sizes count, so IMEIs, model numbers and "5G" are ignored. Skipped:
  // virtual/boosted RAM ("+6GB virtual", "12GB with RAM Plus") and card limits ("expandable up to 2TB").
  const RAM_SIZES = new Set([2, 3, 4, 6, 8, 10, 12, 16, 18, 24]);
  const STORAGE_SIZES = new Set([32, 64, 128, 256, 512, 1024, 2048]);
  function parseSpecs(name) {
    // The shop writes decimals as "Point": "14 Point6 Inch", "10Point1", "1 Point 5 Ton".
    const s = norm(name).replace(/(\d)\s*point\s*(\d)/g, '$1.$2');
    const ram = [], storage = [];
    // Combined forms: "8+256", "8gb/256gb", "12 | 512gb", "(8+256)"
    for (const m of s.matchAll(/(?<![\d.])(\d{1,2})\s*(?:gb)?\s*[+/|]\s*(\d{1,4})\s*(gb|tb)?(?![\d.])/g)) {
      const r = +m[1], st = m[3] === 'tb' ? +m[2] * 1024 : +m[2];
      if (RAM_SIZES.has(r) && STORAGE_SIZES.has(st)) { ram.push(r); storage.push(st); }
    }
    // Separate forms: "12GB RAM", "256 GB", "1TB"
    for (const m of s.matchAll(/(?<![\d.])(\d{1,4})\s*(gb|tb)\b/g)) {
      const gb = m[2] === 'tb' ? +m[1] * 1024 : +m[1];
      const before = s.slice(Math.max(0, m.index - 16), m.index);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
      if (STORAGE_SIZES.has(gb) && (m[2] === 'tb' || gb >= 32)) {
        if (/(up\s*to|upto|expand\w*|extend\w*)\s*$/.test(before)) continue;           // card limit
        if (/^\s*(micro\s*sd|sd\b|memory card|card)/.test(after)) continue;
        storage.push(gb);
      } else if (RAM_SIZES.has(gb) && m[2] === 'gb') {
        if (/((?<![a-z0-9.])\d{1,2}\s*(gb)?\s*(ram)?\s*\+|up\s*to|upto)\s*$/.test(before)) continue;      // "8GB + 8GB virtual", "up to 16GB"
        if (/^\s*(virtual|extended|expand|boost|ram\s*(plus|boost|ext))/.test(after)) continue;
        if (/^\s*with\s*ram\s*(plus|boost|ext)/.test(after)) continue;
        ram.push(gb);
      }
    }
    // Screen: "14.6 inch", "13-inch", '13.2"', "13 in", "36.99 cm (14.6 inch)"
    const screens = [];
    // Not screens: dimensions ("12X8 Inches") and ranges ("for 14 to 32 Inch TVs").
    const notScreen = (m) => /(x|to)\s*$/.test(s.slice(Math.max(0, m.index - 4), m.index));
    for (const m of s.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*-?\s*(?:inches|inch|in\b|"|''|\u201d|\u2033)/g)) if (!notScreen(m)) screens.push(+m[1]);
    for (const m of s.matchAll(/(?<![\d.])(\d{2}(?:\.\d{1,2})?)\s*cm\b/g)) if (!notScreen(m)) screens.push(Math.round((+m[1] / 2.54) * 10) / 10);
    const okScreens = screens.filter((v) => v >= 5 && v <= 20);
    return {
      ram: ram.length ? Math.max(...ram) : null,
      storage: storage.length ? Math.max(...storage) : null,
      screen: okScreens.length ? Math.max(...okScreens) : null,
    };
  }

  const escRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole-word match; plural=true also accepts "covers", "cases", "chargers"…
  const hasWord = (text, w, plural = false) =>
    new RegExp(`(^|[^a-z0-9])${escRe(norm(w).trim())}${plural ? '(?:e?s)?' : ''}($|[^a-z0-9])`).test(text);

  const MATCHERS = {
    keyword(p, rule) {
      const t = textOf(p);
      const any = (rule.any || []).map(norm);
      const all = (rule.all || []).map(norm);
      if (any.length && !any.some((k) => t.includes(k))) return null;
      if (!all.every((k) => t.includes(k))) return null;
      return brandOf(p) || 'match';
    },
    device(p, rule) {
      if (rule.categorySlugs && !(p.categories || []).some((c) => rule.categorySlugs.includes(c.slug))) return null;
      const t = textOf(p);
      if (rule.requireAny && !rule.requireAny.some((w) => hasWord(t, w))) return null;
      // Brand: trust the listing's brand field; if it doesn't name a watched brand, look only at
      // the first two words of the title ("Apple iPhone", "Samsung Galaxy", "iPhone 15"), so
      // "Redmi … Samsung display", "Lighthouse Lamp Galaxy Projector" or "Private Label iPhone" don't count.
      const words = (b) => [b, ...(rule.brands[b].aliases || [])];
      const keys = Object.keys(rule.brands);
      const attr = norm(brandOf(p));
      const head = norm(p.name).split(' ').slice(0, 2).join(' ');
      const brand = keys.find((b) => words(b).some((w) => hasWord(attr, w)))
        || keys.find((b) => words(b).some((w) => hasWord(head, w)));
      if (!brand) return null;
      const req = {
        minRam: rule.minRam ?? 0, minStorage: rule.minStorage ?? 0, minScreen: rule.minScreen ?? 0,
        allowUnknownRam: !!rule.allowUnknownRam, allowUnknownScreen: !!rule.allowUnknownScreen,
        ...rule.brands[brand],
      };
      const spec = parseSpecs(p.name);
      for (const [model, hint] of Object.entries(rule.modelHints || {})) {
        if (hasWord(t, model)) for (const k of Object.keys(hint)) spec[k] = spec[k] ?? hint[k];
      }
      if (req.minStorage && (spec.storage == null || spec.storage < req.minStorage)) return null;
      if (req.minRam && (spec.ram == null ? !req.allowUnknownRam : spec.ram < req.minRam)) return null;
      if (req.minScreen && (spec.screen == null ? !req.allowUnknownScreen : spec.screen < req.minScreen)) return null;
      const parts = [];
      if (req.minRam || spec.ram) parts.push(`${spec.ram ?? '?'} GB RAM`);
      if (spec.storage) parts.push(spec.storage >= 1024 ? `${spec.storage / 1024} TB` : `${spec.storage} GB`);
      if (spec.screen) parts.push(`${spec.screen}"`);
      return parts.join(', ') || 'match';
    },
  };
  MATCHERS.phone = MATCHERS.device;   // older rules written with type 'phone' keep working

  function evaluate(p, rule, settings) {
    const matcher = MATCHERS[rule.type];
    if (!matcher) return null;
    if (settings.inStockOnly && !(p.is_in_stock && p.is_purchasable)) return null;
    const t = textOf(p);
    if ((rule.exclude || []).some((k) => hasWord(t, k, true))) return null;
    if (rule.maxPrice != null && money(p, 'price') > rule.maxPrice) return null;
    if (rule.minPrice != null && money(p, 'price') < rule.minPrice) return null;
    if (rule.minDiscount != null && discountPct(p) < rule.minDiscount) return null;
    return matcher(p, rule);
  }

  // ---------- watch hours ----------
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const atMinute = (d, min) => { const t = new Date(d); t.setHours(0, 0, 0, 0); t.setMinutes(min); return t; };
  // The watch window covering time d, or null outside watch hours.
  function windowAt(d = new Date(), settings = SETTINGS) {
    const hrs = settings.activeHours || [];
    if (!hrs.length) return { everyMin: settings.intervalSec / 60, end: null };
    const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const w = hrs.find((x) => m >= toMin(x.from) && m < toMin(x.to));
    return w ? { ...w, end: atMinute(d, toMin(w.to)) } : null;
  }
  // Start of the next watch window after time d (later today, or tomorrow).
  function nextWindowStart(d = new Date(), settings = SETTINGS) {
    const starts = (settings.activeHours || []).map((x) => toMin(x.from)).sort((a, b) => a - b);
    if (!starts.length) return d;
    const m = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
    const next = starts.find((x) => x > m);
    if (next != null) return atMinute(d, next);
    const t = atMinute(d, starts[0]); t.setDate(t.getDate() + 1); return t;
  }
  const longestIntervalMs = (settings = SETTINGS) =>
    Math.max(settings.intervalSec / 60, ...(settings.activeHours || []).map((x) => x.everyMin)) * 60000;
  const hoursSummary = (settings = SETTINGS) => {
    const hrs = settings.activeHours || [];
    if (!hrs.length) return 'all day';
    const f = (min) => new Date(2000, 0, 1, 0, min).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return `${f(Math.min(...hrs.map((x) => toMin(x.from))))}–${f(Math.max(...hrs.map((x) => toMin(x.to))))}`;
  };

  // Node test hook: `node -e "const w=require('./bfa-deal-watcher.user.js')"`
  if (typeof window === 'undefined') {
    module.exports = { parseSpecs, evaluate, WATCHLIST, SETTINGS, MATCHERS, windowAt, nextWindowStart };
    return;
  }

  // ===================================================================
  // 3. Polling, state, alerts (browser only)
  // ===================================================================
  if (window.BFA) window.BFA.stop();            // pasted twice? replace the old copy

  const API = '/wp-json/wc/store/v1/products';
  const STORE = 'bfaWatcher.v1';
  const LOCK = 'bfaWatcher.lock';
  const TAB = Math.random().toString(36).slice(2);

  const state = (() => {
    try { return { alerted: {}, carted: {}, extraRules: [], ...JSON.parse(localStorage.getItem(STORE) || '{}') }; }
    catch { return { alerted: {}, carted: {}, extraRules: [] }; }
  })();
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch {} };
  const VERSION = '2.0.0';
  if (state.ver !== VERSION) { state.level = 0; delete state.botParams; state.ver = VERSION; save(); }

  // Pace settings the panel can change, kept per browser.
  const DEFAULT_TUNING = { intervalSec: SETTINGS.intervalSec, idleBackoff: { ...SETTINGS.idleBackoff, stepsMin: [...SETTINGS.idleBackoff.stepsMin] } };
  function applyTuning(t) {
    if (!t) return;
    if (t.intervalSec > 0) {
      SETTINGS.intervalSec = t.intervalSec;
      (SETTINGS.activeHours || []).forEach((w) => { w.everyMin = t.intervalSec / 60; });   // same pace in every watch window
    }
    if (t.idleBackoff) Object.assign(SETTINGS.idleBackoff, t.idleBackoff);
  }
  applyTuning(state.tuning);

  const rules = () => [...WATCHLIST, ...state.extraRules];
  let timer = null, running = false, blockedStreak = 0, nextAt = null;
  let tickStarted = 0, lastDone = Date.now(), pausedNote = '', pausedUntil = 0, lastInput = Date.now();
  const setNote = (text, minutes = 60) => { pausedNote = text; pausedUntil = Date.now() + minutes * 60000; };
  const pageStarted = Date.now();
  let current = [];                // matches from the latest tick
  let status = { last: null, scanned: 0, errors: 0, standby: false, blocked: false };
  const skipUntil = {};            // query key -> timestamp; queries the site keeps refusing
  let lastSeenIds = new Set();     // listings read from the newest-listings feed in the last check
  let lastFull = 0;                // time of the last full check
  let idleStep = 0, idleSig = '', stepAt = 0, quietSince = 0;   // adaptive pace while nothing changes

  const idleMs = () => {
    const steps = SETTINGS.idleBackoff?.stepsMin || [];
    return idleStep ? steps[Math.min(idleStep, steps.length) - 1] * 60000 : 0;
  };
  const fmtEvery = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} sec` : `${Math.round(ms / 6000) / 10} min`);

  // Any listing added, sold or repriced on the newest-listings pages counts as activity; while the
  // feed stands still the gap between checks climbs one rung of stepsMin per quiet afterMin.
  function updatePace(sig) {
    const cfg = SETTINGS.idleBackoff || {};
    const steps = cfg.stepsMin || [];
    const now = Date.now();
    if (!cfg.enabled || !steps.length || !sig) { idleStep = 0; return; }
    if (sig !== idleSig) {
      if (idleStep) console.info('[BFA watcher] listings changed; back to the normal pace');
      idleSig = sig; idleStep = 0; stepAt = now; quietSince = now;
      return;
    }
    if (now - stepAt >= (cfg.afterMin ?? 5) * 60000 && idleStep < steps.length) {
      idleStep++; stepAt = now;
      console.info(`[BFA watcher] nothing new for ${cfg.afterMin} min; checking every ${steps[idleStep - 1]} min now`);
    }
  }

  function haveLock() {
    const now = Date.now();
    let l = null;
    try { l = JSON.parse(localStorage.getItem(LOCK) || 'null'); } catch {}
    if (!l || l.tab === TAB || now - l.ts > Math.max(longestIntervalMs(), idleMs()) * 2.5) {
      localStorage.setItem(LOCK, JSON.stringify({ tab: TAB, ts: now }));
      return true;
    }
    return false;
  }
  addEventListener('beforeunload', () => {
    try { if (JSON.parse(localStorage.getItem(LOCK) || '{}').tab === TAB) localStorage.removeItem(LOCK); } catch {}
  });

  // The site's firewall answers 403 to some query shapes. Try progressively plainer
  // requests (the last one mirrors the URL that worked when opened directly) and
  // remember the first style that succeeds. In-stock filtering also happens locally.
  const VARIANTS = [
    { name: '100 per page, newest first, in-stock only', q: (p) => ({ per_page: 100, orderby: 'date', order: 'desc', ...p, stock_status: 'instock' }) },
    { name: '100 per page, newest first', q: (p) => ({ per_page: 100, orderby: 'date', order: 'desc', ...p }) },
    { name: '50 per page, newest first', q: (p) => ({ per_page: 50, orderby: 'date', order: 'desc', ...p }) },
    { name: '50 per page, site default order', q: (p) => ({ per_page: 50, ...p }) },
  ];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let lastReq = 0;

  // No cookies (same as bfa-sync.js): requests carrying the shop's cookies trip its bot
  // check and get 403, while anonymous API reads are served normally.
  // Every request gets a time limit, so one that never answers can't stall the watcher.
  async function fetchT(url, opts = {}, ms = SETTINGS.requestTimeoutSec * 1000) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  const FETCH_OPTS = { cache: 'no-store', credentials: 'omit', headers: { Accept: 'application/json' } };
  // Only the fields the watcher uses — smaller, faster responses.
  const FIELDS = 'id,name,permalink,prices,images,categories,attributes,is_in_stock,is_purchasable';

  async function get(params) {
    const wait = lastReq + SETTINGS.requestGapMs * (1 + Math.random() / 3) - Date.now();
    if (wait > 0) await sleep(wait);
    lastReq = Date.now();
    const url = new URL(API, location.origin);
    for (const [k, v] of Object.entries({ ...params, _fields: FIELDS })) if (v != null) url.searchParams.set(k, v);
    const res = await fetchT(url, FETCH_OPTS);
    return { res, url, via: res.ok ? 'ok' : 'refused' };
  }

  async function fetchProducts(params) {
    const key = JSON.stringify(params);
    if (skipUntil[key] > Date.now()) return { items: [], perPage: 0, skipped: true };
    let lastStatus;
    for (let i = Math.min(state.level || 0, VARIANTS.length - 1); i < VARIANTS.length; i++) {
      const q = VARIANTS[i].q(params);
      const { res } = await get(q);
      if (res.ok) {
        if ((state.level || 0) !== i) {
          state.level = i; save();
          console.info(`[BFA watcher] switched to request style: ${VARIANTS[i].name}`);
        }
        const data = await res.json();
        return { items: Array.isArray(data) ? data : [], perPage: q.per_page };
      }
      lastStatus = res.status;
      if (res.status !== 403 && res.status !== 400) break;
    }
    const err = new Error(`${lastStatus} for ${key}`);
    err.status = lastStatus;
    throw err;
  }

  function queriesFor(rule) {
    return [
      ...(rule.query ? [rule.query] : []),
      ...(rule.queries || []),
      ...(rule.search || []).map((term) => ({ search: term })),
    ];
  }

  // Quick check (every interval): newest listings only — every new listing appears there first.
  // Full check (every fullScanEveryMin, and on "Check now"): also each rule's category/search
  // requests, which find older in-stock items and refresh stock for everything in the panel.
  async function tick({ full = false } = {}) {
    if (running) return;
    full = full || !lastFull || Date.now() - lastFull >= SETTINGS.fullScanEveryMin * 60000;
    if (!haveLock()) { status.standby = true; render(); return; }
    status.standby = false;
    running = true;
    tickStarted = Date.now();
    const pool = new Map();
    let errors = 0, ok = 0, requests = 0, netErrors = 0;
    const grab = async (params, { skipOnFail = false } = {}) => {
      try {
        const r = await fetchProducts(params);
        if (!r.skipped) { ok++; requests++; }
        r.items.forEach((p) => pool.set(p.id, p));
        return r;
      } catch (e) {
        errors++; requests++;
        if (!e.status) netErrors++;            // no answer at all (offline, timeout) rather than a refusal
        console.warn('[BFA watcher]', e.message);
        // A search/category query the site refuses: stop asking for 30 min. The latest-listings
        // feed is still checked against every rule, so nothing is missed, just found via the feed.
        if (skipOnFail && ok > 0) skipUntil[JSON.stringify(params)] = Date.now() + 30 * 60000;
        return null;
      }
    };
    try {
      const pages = Math.max(SETTINGS.latestPages, 1);
      // Read the next page only if every listing on this one is new since the last check
      // (compared by listing, not by ID number — the shop's IDs don't always follow publish order).
      const prevSeen = lastSeenIds, seenNow = new Set();
      let newCount = 0;
      const feed = [];
      for (let page = 1; page <= pages * 2; page++) {    // ×2 covers the 50-per-page fallback
        const r = await grab({ page });
        if (!r || !r.items.length) break;
        feed.push(...r.items);
        const fresh = r.items.filter((p) => !prevSeen.has(p.id)).length;
        if (prevSeen.size) newCount += fresh;
        r.items.forEach((p) => seenNow.add(p.id));
        if (r.items.length < r.perPage || pool.size >= pages * SETTINGS.perPage) break;
        if (prevSeen.size && fresh < r.items.length) break;  // reached listings already checked
        if (prevSeen.size) console.info(`[BFA watcher] all ${fresh} listings on page ${page} are new since the last check; reading page ${page + 1}`);
      }
      if (seenNow.size) lastSeenIds = seenNow;
      if (ok === 0) {
        // No answers at all = connection problem: keep retrying every ~2 minutes (and immediately
        // when the browser reports it's back online). Refusals (403) back off further each time.
        const offline = errors > 0 && netErrors === errors;
        blockedStreak = offline ? 1 : blockedStreak + 1;
        status = { ...status, last: new Date(), errors, blocked: !offline, offline, standby: false };
        render();
        return;
      }
      blockedStreak = 0;
      updatePace(feed.map((p) => `${p.id}:${p.prices?.price}:${p.is_in_stock ? 1 : 0}`).join(','));
      if (full) {
        for (const rule of rules()) for (const q of queriesFor(rule)) await grab(q, { skipOnFail: true });
        lastFull = Date.now();
      }

      const matches = [];
      for (const p of pool.values()) {
        for (const rule of rules()) {
          const note = evaluate(p, rule, SETTINGS);
          if (note) { matches.push({ p, rule, note }); break; }
        }
      }
      matches.sort((a, b) => b.p.id - a.p.id);
      const fresh = matches.filter((m) => !state.alerted[m.p.id]);
      fresh.forEach((m) => { state.alerted[m.p.id] = Date.now(); m.fresh = true; });
      save();
      if (fresh.length) { idleStep = 0; stepAt = quietSince = Date.now(); }   // a match found by a search counts as activity too
      if (full) {
        current = matches;
      } else {
        // Keep earlier matches (found by a full check) unless we just re-read them; sold items
        // drop out at the next full check at the latest.
        const byId = new Map(current.map((m) => [m.p.id, { ...m, fresh: false }]));
        for (const id of pool.keys()) byId.delete(id);
        for (const m of matches) byId.set(m.p.id, m);
        current = [...byId.values()].sort((a, b) => b.p.id - a.p.id);
      }
      status = { last: new Date(), scanned: pool.size, errors, requests, full, newCount: prevSeen.size ? newCount : null, standby: false, blocked: false, offline: false };
      state.lastCheck = Date.now(); save();
      if (fresh.length) { render(); await autoCart(fresh); alertUser(fresh); }
      render();
    } finally {
      running = false;
      lastDone = Date.now();
    }
  }

  // ---------- add to cart ----------
  // A cart needs your login cookies, which the site's bot check sometimes blocks, so three methods
  // are tried in order and the first that works is remembered:
  //  1. WooCommerce's own AJAX add-to-cart (what the shop's buttons call)
  //  2. The Store API cart endpoint
  //  3. Loading /cart/?add-to-cart=ID in a hidden frame, like opening the link yourself
  // Adding to a cart does not hold stock: whoever checks out first gets the item.
  const CART_METHODS = {
    async ajax(id) {
      const tpl = window.wc_add_to_cart_params?.wc_ajax_url || '/?wc-ajax=%%endpoint%%';
      const res = await fetchT(tpl.replace('%%endpoint%%', 'add_to_cart'), {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams({ product_id: id, quantity: 1 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.error) return { ok: false, why: data?.error ? 'shop said it could not be added (likely sold)' : `HTTP ${res.status}` };
      // Refresh the shop's mini-cart / cart count if the theme listens for it
      try { window.jQuery?.(document.body).trigger('added_to_cart', [data.fragments, data.cart_hash]); } catch {}
      return { ok: true };
    },
    async store(id) {
      const base = '/wp-json/wc/store/v1/cart';
      let nonce = window.wcSettings?.storeApiNonce || window.wcBlocksMiddlewareConfig?.storeApiNonce;
      if (!nonce) {
        const r = await fetchT(base, { credentials: 'include', cache: 'no-store' });
        if (!r.ok) return { ok: false, why: `HTTP ${r.status} reading cart` };
        nonce = r.headers.get('Nonce') || r.headers.get('X-WC-Store-API-Nonce');
      }
      const res = await fetchT(base + '/add-item', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Nonce: nonce || '', 'X-WC-Store-API-Nonce': nonce || '' },
        body: JSON.stringify({ id: Number(id), quantity: 1 }),
      });
      if (res.ok) return { ok: true };
      const err = await res.json().catch(() => null);
      return { ok: false, why: err?.message ? decode(err.message) : `HTTP ${res.status}` };
    },
    frame(id) {
      return new Promise((resolve) => {
        const f = document.createElement('iframe');
        f.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px;border:0';
        f.setAttribute('aria-hidden', 'true');
        const done = (r) => { clearTimeout(t); f.remove(); resolve(r); };
        const t = setTimeout(() => done({ ok: false, why: 'cart page did not load in 25 s' }), 25000);
        f.onload = () => {
          try {
            const d = f.contentDocument;
            if (!d || !d.querySelector('.woocommerce, .wc-block-cart, body.woocommerce-cart')) return; // check page; wait for redirect
            const err = d.querySelector('.woocommerce-error, .wc-block-components-notice-banner.is-error');
            if (err) return done({ ok: false, why: err.textContent.trim().slice(0, 120) });
            done({ ok: true });
          } catch { /* not readable yet */ }
        };
        f.src = `/cart/?add-to-cart=${encodeURIComponent(id)}`;
        document.body.appendChild(f);
      });
    },
  };

  async function addToCart(p) {
    const order = Object.keys(CART_METHODS);
    if (state.cartMethod && order.includes(state.cartMethod)) order.unshift(...order.splice(order.indexOf(state.cartMethod), 1));
    let last = 'no method worked';
    for (const m of order) {
      try {
        const r = await CART_METHODS[m](p.id);
        if (r.ok) {
          if (state.cartMethod !== m) { state.cartMethod = m; console.info(`[BFA watcher] add-to-cart works via: ${m}`); }
          state.carted[p.id] = Date.now(); save();
          return { ok: true, method: m };
        }
        last = `${m}: ${r.why}`;
        if (/sold|out of stock|not enough|cannot be purchased|could not be added/i.test(r.why)) break; // item is gone; other methods won't help
      } catch (e) { last = `${m}: ${e.message}`; }
    }
    console.warn(`[BFA watcher] could not add ${p.id} to cart (${last})`);
    return { ok: false, why: last };
  }

  async function autoCart(fresh) {
    const cfg = SETTINGS.autoCart || {};
    if (!cfg.enabled) return;
    let added = 0;
    for (const m of fresh) {
      if (added >= (cfg.maxPerCheck ?? 5)) { m.cart = 'skipped: per-check limit reached'; continue; }
      if (m.rule.autoCart === false) continue;
      if (cfg.maxPrice != null && money(m.p, 'price') > cfg.maxPrice) { m.cart = 'skipped: above auto-cart price limit'; continue; }
      if (state.carted[m.p.id]) { m.cart = 'in cart'; continue; }
      const r = await addToCart(m.p);
      m.cart = r.ok ? 'in cart' : `not added: ${r.why}`;
      if (r.ok) added++;
      await sleep(800);
    }
  }

  // ---------- alerts ----------
  let audio;
  function beep() {
    if (!SETTINGS.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.25, 0.5].forEach((t) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; g.gain.value = 0.15;
        o.connect(g).connect(audio.destination);
        o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.15);
      });
    } catch {}
  }

  let flash;
  function flashTitle(n) {
    clearInterval(flash);
    const orig = document.title.replace(/^\(\d+ new\) /, '');
    let on = false;
    flash = setInterval(() => { document.title = (on = !on) ? `(${n} new) ${orig}` : orig; }, 1000);
    const stopFlash = () => { clearInterval(flash); document.title = orig; removeEventListener('focus', stopFlash); };
    addEventListener('focus', stopFlash);
  }

  function alertUser(fresh) {
    beep();
    flashTitle(fresh.length);
    console.log(`%c[BFA watcher] ${fresh.length} new match(es)`, 'font-weight:bold;color:#C8372D');
    console.table(fresh.map(({ p, rule, note, cart }) => ({
      watch: rule.label, name: decode(p.name), price: money(p, 'price'),
      mrp: money(p, 'regular_price'), off: discountPct(p) + '%', detail: note, cart: cart || '', link: p.permalink,
    })));
    if (SETTINGS.desktopNotify && 'Notification' in window && Notification.permission === 'granted') {
      const show = fresh.slice(0, 4);
      show.forEach(({ p, rule, note }) => {
        const n = new Notification(`${rule.label}: ₹${money(p, 'price').toLocaleString('en-IN')} (${discountPct(p)}% off)`, {
          body: `${decode(p.name).slice(0, 110)}\n${note}${state.carted[p.id] ? '\nAdded to your cart: open checkout to buy.' : ''}`,
          icon: p.images?.[0]?.thumbnail, tag: 'bfa-' + p.id, requireInteraction: true,
        });
        n.onclick = () => { window.open(state.carted[p.id] ? '/checkout/' : p.permalink, '_blank'); n.close(); };
      });
      if (fresh.length > show.length) new Notification(`BuyFromAuction: ${fresh.length - show.length} more match(es)`, { body: 'Open the watcher panel to see all.' });
    }
  }

  // ===================================================================
  // 4. On-page panel
  // ===================================================================
  const css = `
  #bfa-w{--ink:#1E2A44;--paper:#FFFFFF;--line:#D9DEE8;--muted:#5B6477;--stamp:#C8372D;--gold:#B7851A;
    position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(400px,calc(100vw - 32px));
    font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--paper);
    border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 28px rgba(30,42,68,.22);overflow:hidden}
  @media (prefers-color-scheme:dark){#bfa-w{--ink:#E8ECF4;--paper:#18202F;--line:#2E3A50;--muted:#9AA4B8;--gold:#E2B33C}}
  #bfa-w *{box-sizing:border-box}
  #bfa-w header{display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--ink);color:var(--paper)}
  @media (prefers-color-scheme:dark){#bfa-w header{background:#0F1522;color:#E8ECF4}}
  #bfa-w header strong{font-size:14px;flex:1}
  #bfa-w button{font:inherit;font-size:12px;border:1px solid currentColor;background:transparent;color:inherit;
    border-radius:6px;padding:3px 8px;cursor:pointer}
  #bfa-w button:focus-visible,#bfa-w a:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
  #bfa-w .st{padding:6px 12px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--line)}
  #bfa-w .list{max-height:55vh;overflow:auto}
  #bfa-w .it{display:grid;grid-template-columns:52px 1fr;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line)}
  #bfa-w .it.new{box-shadow:inset 4px 0 0 var(--stamp)}
  #bfa-w img{width:52px;height:52px;object-fit:cover;border-radius:6px;background:var(--line)}
  #bfa-w .nm{font-size:13px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  #bfa-w .pr{margin-top:2px;font-size:15px;font-weight:700}
  #bfa-w .pr s{font-weight:400;font-size:12px;color:var(--muted);margin-left:6px}
  #bfa-w .pr em{font-style:normal;color:var(--gold);font-size:12px;margin-left:6px}
  #bfa-w .meta{font-size:12px;color:var(--muted)}
  #bfa-w .act{display:flex;gap:12px;margin-top:4px;font-size:12px}
  #bfa-w .act a{color:var(--stamp);font-weight:600;text-decoration:none}
  #bfa-w .act .ab{border-color:var(--stamp);color:var(--stamp);font-weight:600;padding:1px 8px}
  #bfa-w .act .ok{color:#1E7A46;font-weight:600}
  @media (prefers-color-scheme:dark){#bfa-w .act .ok{color:#5CC48A}}
  #bfa-w header .co{color:inherit;font-size:12px;font-weight:600;text-decoration:underline;margin-right:2px}
  #bfa-w .empty{padding:14px 12px;color:var(--muted);font-size:13px}
  #bfa-w .note{padding:8px 12px;font-size:12px;color:var(--stamp);border-bottom:1px solid var(--line)}
  #bfa-w .cfg{padding:10px 12px;border-bottom:1px solid var(--line);font-size:12px;display:grid;gap:7px}
  #bfa-w .cfg label{display:flex;align-items:center;gap:6px}
  #bfa-w .cfg input[type=number]{width:62px}
  #bfa-w .cfg input[type=text]{flex:1;min-width:0}
  #bfa-w .cfg input{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:5px;padding:2px 5px}
  #bfa-w .cfg .row{display:flex;align-items:center;gap:8px}
  #bfa-w .cfg .hint{color:var(--muted)}
  #bfa-w.min .st,#bfa-w.min .list,#bfa-w.min .cfg{display:none}`;

  let root;
  function mount() {
    if (document.getElementById('bfa-w')) document.getElementById('bfa-w').remove();
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    root = document.createElement('div'); root.id = 'bfa-w';
    root.innerHTML = `<header><strong>Deal watcher</strong>
      <a class="co" href="/checkout/" target="_blank" rel="noopener">Checkout</a><button data-a="alerts">Enable alerts</button><button data-a="scan">Check now</button><button data-a="cfg">Pace</button><button data-a="min">Hide</button></header>
      <div class="note" hidden></div>
      <div class="cfg" hidden>
        <label>Check every <input name="intervalSec" type="number" min="5" max="3600" step="1"> sec</label>
        <label><input name="idleEnabled" type="checkbox"> Slow down while the shop is quiet</label>
        <label>after <input name="afterMin" type="number" min="1" max="240" step="1"> min with nothing new</label>
        <label>steps <input name="stepsMin" type="text" inputmode="numeric" placeholder="1, 2, 4, 8, 16, 30"> min</label>
        <div class="row"><button data-a="save">Save</button><button data-a="defaults">Defaults</button><span class="hint"></span></div>
      </div>
      <div class="st"></div><div class="list"></div>`;
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      const a = btn?.dataset.a;
      if (a === 'scan') { idleStep = 0; stepAt = Date.now(); tick({ full: true }); }
      if (a === 'cfg') { const c = root.querySelector('.cfg'); c.hidden = !c.hidden; if (!c.hidden) fillCfg(); }
      if (a === 'save') saveCfg(readCfg());
      if (a === 'defaults') saveCfg(DEFAULT_TUNING);
      if (a === 'cart') {
        const m = current.find((x) => String(x.p.id) === btn.dataset.id);
        if (m) { btn.disabled = true; btn.textContent = 'Adding…'; addToCart(m.p).then((r) => { m.cart = r.ok ? 'in cart' : `not added: ${r.why}`; render(); }); }
      }
      if (a === 'min') { root.classList.toggle('min'); e.target.textContent = root.classList.contains('min') ? 'Show' : 'Hide'; }
      if (a === 'alerts') {
        beep();                                   // unlocks sound for this tab
        if ('Notification' in window) Notification.requestPermission().then(render);
      }
    });
    document.body.appendChild(root);
  }

  const cfgEl = (name) => root.querySelector(`.cfg [name="${name}"]`);
  function fillCfg() {
    cfgEl('intervalSec').value = SETTINGS.intervalSec;
    cfgEl('idleEnabled').checked = !!SETTINGS.idleBackoff.enabled;
    cfgEl('afterMin').value = SETTINGS.idleBackoff.afterMin;
    cfgEl('stepsMin').value = (SETTINGS.idleBackoff.stepsMin || []).join(', ');
  }
  const clamp = (v, lo, hi, fallback) => (Number.isFinite(+v) && +v ? Math.min(hi, Math.max(lo, +v)) : fallback);
  function readCfg() {
    const steps = cfgEl('stepsMin').value.split(/[,\s]+/).map(Number).filter((n) => n > 0 && n <= 720);
    return {
      intervalSec: clamp(cfgEl('intervalSec').value, 5, 3600, SETTINGS.intervalSec),
      idleBackoff: {
        enabled: cfgEl('idleEnabled').checked,
        afterMin: clamp(cfgEl('afterMin').value, 1, 240, SETTINGS.idleBackoff.afterMin),
        stepsMin: steps.length ? [...new Set(steps)].sort((a, b) => a - b) : DEFAULT_TUNING.idleBackoff.stepsMin,
      },
    };
  }
  function saveCfg(tuning) {
    state.tuning = JSON.parse(JSON.stringify(tuning)); save();
    applyTuning(state.tuning);
    idleStep = 0; stepAt = Date.now();
    schedule(Math.max(1000, nextDelay() - (Date.now() - lastDone)));
    if (root) {
      fillCfg();
      const hint = root.querySelector('.cfg .hint');
      if (hint) hint.textContent = `Saved at ${new Date().toLocaleTimeString()}`;
    }
    render();
  }

  const esc = (s) => decode(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function render() {
    if (!root) return;
    const st = root.querySelector('.st');
    const perm = 'Notification' in window ? Notification.permission : 'unsupported';
    root.querySelector('[data-a="alerts"]').style.display = perm === 'granted' ? 'none' : '';
    const nextTxt = nextAt ? new Date(nextAt).toLocaleTimeString() : 'soon';
    const notes = [];
    if (pausedNote && Date.now() < pausedUntil) notes.push(pausedNote);
    if (SETTINGS.autoCart?.enabled && document.body && !document.body.classList.contains('logged-in'))
      notes.push('You are not logged in, so matches would go into a guest cart. Log in to buyfromauction.in in this tab.');
    const noteEl = root.querySelector('.note');
    noteEl.hidden = !notes.length;
    noteEl.textContent = notes.join(' ');
    const win = windowAt();
    const pace = win && fmtEvery(Math.max(win.everyMin * 60000, idleMs()));
    const paceTxt = win?.end ? ` Checking every ${pace} until ${win.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.` : '';
    const quietTxt = idleStep && quietSince ? ` Quiet since ${new Date(quietSince).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}, so checks are slower; they speed up on the first change.` : '';
    st.textContent = !win && !running
      ? `Outside watch hours (${hoursSummary()}). Sleeping until ${new Date(nextAt || nextWindowStart()).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}. "Check now" still works.`
      : status.standby
      ? 'Standing by: another buyfromauction.in tab is already checking.'
      : status.offline
        ? `No connection to the shop (offline or not answering). Retrying at ${nextTxt}, or as soon as the connection is back.`
      : status.blocked
        ? `The site refused every request (HTTP 403). Retrying at ${nextTxt}. Run BFA.probe() in the console to see which requests it allows.`
      : status.last
        ? `${status.full ? 'Full check' : 'Quick check'} at ${status.last.toLocaleTimeString()} (${status.requests} request${status.requests === 1 ? '' : 's'}${status.newCount != null ? `, ${status.newCount} new listing${status.newCount === 1 ? '' : 's'} since last check` : ''}): ${current.length} match${current.length === 1 ? '' : 'es'}` +
          (status.errors ? `, ${status.errors} request(s) refused (see console)` : '') + `. Next check at ${nextTxt}.` + paceTxt + quietTxt
        : 'First check running…';
    const list = root.querySelector('.list');
    if (!current.length) {
      list.innerHTML = `<div class="empty">Nothing in stock matches yet. Watching: ${rules().map((r) => esc(r.label)).join(', ')}.</div>`;
      return;
    }
    list.innerHTML = current.map(({ p, rule, note, fresh, cart }) => `
      <div class="it${fresh ? ' new' : ''}">
        <img src="${esc(p.images?.[0]?.thumbnail || '')}" alt="" loading="lazy">
        <div>
          <div class="nm">${esc(p.name)}</div>
          <div class="pr">₹${money(p, 'price').toLocaleString('en-IN')}<s>₹${money(p, 'regular_price').toLocaleString('en-IN')}</s><em>${discountPct(p)}% off</em></div>
          <div class="meta">${esc(rule.label)}: ${esc(note)}</div>
          <div class="act"><a href="${esc(p.permalink)}" target="_blank" rel="noopener">Open listing</a>
            ${state.carted[p.id]
              ? '<span class="ok">In your cart</span>'
              : `<button class="ab" data-a="cart" data-id="${p.id}">Add to cart</button>`}</div>
          ${cart && !state.carted[p.id] ? `<div class="meta">${esc(cart)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  // ===================================================================
  // 5. Console controls — window.BFA
  // ===================================================================
  window.BFA = {
    /** Add a rule at runtime (saved in this browser). Same shape as WATCHLIST entries. */
    watch(rule) {
      if (!rule?.id || !MATCHERS[rule.type]) throw new Error('Rule needs an id and type: ' + Object.keys(MATCHERS).join(' | '));
      state.extraRules = state.extraRules.filter((r) => r.id !== rule.id).concat(rule);
      save(); tick({ full: true }); return rules().map((r) => r.id);
    },
    unwatch(id) { state.extraRules = state.extraRules.filter((r) => r.id !== id); save(); tick({ full: true }); return rules().map((r) => r.id); },
    rules,
    matches: () => current.map(({ p, rule, note }) => ({ watch: rule.label, name: decode(p.name), price: money(p, 'price'), detail: note, link: p.permalink })),
    scanNow: () => { idleStep = 0; stepAt = Date.now(); return tick({ full: true }); },
    /** Read or change the pace, e.g. BFA.pace({ intervalSec: 15, idleBackoff: { stepsMin: [1, 5, 30] } }). */
    pace(t) {
      if (t) saveCfg({ intervalSec: t.intervalSec || SETTINGS.intervalSec, idleBackoff: { ...SETTINGS.idleBackoff, ...(t.idleBackoff || {}) } });
      return {
        intervalSec: SETTINGS.intervalSec,
        idleBackoff: SETTINGS.idleBackoff,
        checkingEvery: fmtEvery(Math.max((windowAt()?.everyMin ?? SETTINGS.intervalSec / 60) * 60000, idleMs())),
        idleStep,
      };
    },
    // Test add-to-cart with any product id (it really adds it; remove it from the cart after).
    addToCart: (id) => addToCart({ id }),
    test: (name) => parseSpecs(name),
    // Re-alert on everything currently matching and retry the richest request style.
    reset() { state.alerted = {}; state.level = 0; save(); tick({ full: true }); },
    // Shows which request shapes the site accepts right now.
    async probe() {
      const tests = [
        ['same as opening the URL directly', { per_page: 50 }],
        ...VARIANTS.map((v) => [v.name, v.q({})]),
        ['search "rosier"', { per_page: 50, search: 'rosier' }],
        ['smartphones category', { per_page: 50, category: '56631' }],
      ];
      const rows = [];
      for (const [test, q] of tests) {
        const { res, url, via } = await get(q);
        rows.push({ test, status: res.status, via, url: url.pathname + url.search });
      }
      console.table(rows);
      return rows;
    },
    stop() { clearTimeout(timer); timer = null; document.getElementById('bfa-w')?.remove(); },
    start() { if (!timer) { mount(); schedule(0); } },
    settings: SETTINGS,
  };

  const nextDelay = () => {
    const every = Math.max((windowAt()?.everyMin ?? SETTINGS.intervalSec / 60) * 60000, idleMs());
    return blockedStreak ? Math.min(SETTINGS.maxBackoffMin * 60000, every * 2 ** blockedStreak) : every;
  };
  // Outside watch hours: no requests until the next window opens.
  function sleepUntilWindow() {
    status.sleeping = true;
    schedule(Math.max(1000, nextWindowStart() - Date.now() + 1000));
    render();
  }
  function schedule(ms, opts = {}) {
    clearTimeout(timer);
    nextAt = Date.now() + ms;
    timer = setTimeout(async () => {
      if (!windowAt()) { sleepUntilWindow(); return; }
      status.sleeping = false;
      const started = Date.now();
      try { await tick(opts); } finally {
        if (timer !== null) {
          let wait = Math.max(1000, nextDelay() - (blockedStreak ? 0 : Date.now() - started));
          const w = windowAt();
          // Don't run past the end of watch hours, and switch to the next window's pace on time.
          if (w?.end && Date.now() + wait > w.end.getTime()) {
            const after = new Date(w.end.getTime() + 1000);
            wait = windowAt(after) ? after - Date.now() : nextWindowStart(after) - Date.now() + 1000;
          }
          schedule(Math.max(1000, wait)); render();
        }
      }
    }, ms);
  }

  // ---------- staying alive over long sessions ----------
  // A frozen tab, a sleeping computer or a lost connection pauses the watcher silently. These
  // checks notice when a scheduled check is overdue and catch up straight away with a full check.
  const fmtDur = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  // A full check can legitimately run for minutes (one request per rule query, each retried
  // through every variant), so only call it stalled well past that worst case.
  const stallMs = () => Math.max(5 * 60000, SETTINGS.requestTimeoutSec * 1000 * VARIANTS.length * 3);
  const overdueMs = () => Math.max(60000, nextDelay() * 3);
  function catchUp(reason) {
    if (timer === null) return;                                       // stopped by BFA.stop()
    if (running && Date.now() - tickStarted > stallMs()) running = false;   // a check that never finished
    if (running || !nextAt || Date.now() - nextAt < overdueMs()) return;    // on schedule
    if (!windowAt()) { sleepUntilWindow(); return; }                  // woke up outside watch hours
    const gap = Date.now() - lastDone;
    setNote(`Watcher was paused for ${fmtDur(gap)} (${reason}); caught up at ${new Date().toLocaleTimeString()}.`);
    console.info('[BFA watcher]', pausedNote);
    if (status.offline) blockedStreak = 0;
    schedule(0, { full: true });
  }
  function maybeReload() {
    // Only as a userscript (Tampermonkey restarts it after the reload), never on cart/checkout,
    // and only if nobody has used this tab for 10 minutes.
    if (typeof GM_info === 'undefined' || !SETTINGS.reloadEveryHours) return;
    if (Date.now() - pageStarted < SETTINGS.reloadEveryHours * 3600000) return;
    if (running || /\/(cart|checkout)/.test(location.pathname) || Date.now() - lastInput < 10 * 60000) return;
    try { sessionStorage.setItem('bfaSelfReload', '1'); } catch {}
    location.reload();
  }
  setInterval(() => { catchUp('timer was delayed: tab frozen or computer asleep'); maybeReload(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) catchUp('tab was in the background'); });
  document.addEventListener('resume', () => catchUp('Chrome had frozen the tab'));
  addEventListener('pageshow', (e) => { if (e.persisted) catchUp('page was restored from the back/forward cache'); });
  addEventListener('online', () => { if (status.offline) { blockedStreak = 0; setNote('Connection is back; checking now.', 2); schedule(0, { full: true }); } });
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true }));

  // Explain gaps from before this page load (tab closed, unloaded by Chrome, computer off).
  (() => {
    let self = false;
    try { self = sessionStorage.getItem('bfaSelfReload') === '1'; sessionStorage.removeItem('bfaSelfReload'); } catch {}
    if (self) return;
    if (document.wasDiscarded) setNote('Chrome had unloaded this tab to save memory, so no checks ran until you came back. Add buyfromauction.in to "Always keep these sites active" in chrome://settings/performance.');
    else if (state.lastCheck && windowAt()) {
      // Only count time inside today's watch hours; nights and mornings are expected gaps.
      const dayStart = (SETTINGS.activeHours || []).length
        ? atMinute(new Date(), Math.min(...SETTINGS.activeHours.map((x) => toMin(x.from)))).getTime() : 0;
      const missed = Date.now() - Math.max(state.lastCheck, dayStart);
      if (missed > windowAt().everyMin * 60000 * 3)
        setNote(`No checks ran for ${fmtDur(missed)} of today's watch hours before this page opened (tab closed, unloaded, or computer asleep).`);
    }
  })();

  try { window.BFA.start(); } catch (e) { console.error('[BFA watcher] failed to start:', e); return; }
  console.log('%c[BFA watcher] running. Try BFA.matches(), BFA.watch({...}), BFA.stop()', 'color:#1E2A44;font-weight:bold');
})();