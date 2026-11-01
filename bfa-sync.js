/*
 * Clearance finder: BuyFromAuction sync engine
 *
 * This one file works in two places:
 *  1. On the Clearance finder page (GitHub Pages). It defines window.BFASync,
 *     which the page's Sync button uses to read the shop directly.
 *  2. On buyfromauction.in, loaded by the "BFA Sync" bookmark. Browsers often
 *     block one website from reading another website's data, so the bookmark
 *     runs this script on the shop's own tab, reads the products there, and
 *     sends them back to the Clearance finder tab that opened it.
 *
 * It only reads public product data (the same WooCommerce Store API and
 * WordPress REST endpoints your console scraper uses). It never logs in,
 * adds to cart or changes anything on the shop.
 */
(function () {
  "use strict";

  const SELF_SRC = (typeof document !== "undefined" && document.currentScript && document.currentScript.src) || "";
  const DEFAULTS = Object.freeze({
    origin: "https://buyfromauction.in",
    minPrice: 50,
    maxPrice: 159300,
    perPage: 100,
    concurrency: 3,
    retries: 2,
    timeoutMs: 20000
  });
  const STORE = "/wp-json/wc/store/v1/products";
  const WP = "/wp-json/wp/v2/product";

  function cancelledError() {
    const e = new Error("Sync cancelled");
    e.name = "AbortError";
    e.cancelled = true;
    return e;
  }

  async function getJSON(url, o) {
    let last;
    for (let attempt = 0; attempt <= o.retries; attempt++) {
      if (o.signal && o.signal.aborted) throw cancelledError();
      const ctl = new AbortController();
      const relay = () => ctl.abort();
      if (o.signal) o.signal.addEventListener("abort", relay, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, o.timeoutMs);
      try {
        const res = await fetch(url, {
          credentials: "omit",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: ctl.signal
        });
        if (!res.ok) {
          const e = new Error(`The shop answered HTTP ${res.status} for ${new URL(url).pathname}`);
          e.status = res.status;
          e.retryable = res.status === 408 || res.status === 429 || res.status >= 500;
          throw e;
        }
        return { data: await res.json(), headers: res.headers };
      } catch (e) {
        if (o.signal && o.signal.aborted) throw cancelledError();
        last = timedOut ? Object.assign(new Error("The shop took too long to answer"), { retryable: true }) : e;
        // A TypeError from fetch means the request never got a readable answer:
        // usually the browser's cross-site (CORS) block, or no internet.
        if (e instanceof TypeError) last.network = true;
        if (e.status && !e.retryable) break;
        if (attempt === o.retries) break;
        await new Promise((r) => setTimeout(r, 700 * 2 ** attempt + Math.random() * 250));
      } finally {
        clearTimeout(timer);
        if (o.signal) o.signal.removeEventListener("abort", relay);
      }
    }
    throw last;
  }

  async function pool(items, n, worker) {
    const out = new Array(items.length);
    let next = 0;
    let failed = null;
    async function lane() {
      while (!failed && next < items.length) {
        const i = next++;
        try { out[i] = await worker(items[i], i); } catch (e) { failed = failed || e; }
      }
    }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, lane));
    if (failed) throw failed;
    return out;
  }

  const decoder = typeof DOMParser !== "undefined" ? new DOMParser() : null;
  function decode(s) {
    const text = String(s == null ? "" : s);
    if (!/[&<]/.test(text)) return text.replace(/\s+/g, " ").trim();
    if (decoder) return (decoder.parseFromString(text, "text/html").body.textContent || "").replace(/\s+/g, " ").trim();
    return text.replace(/<[^>]*>/g, "").replace(/&#0?38;|&amp;/g, "&").replace(/&#8211;/g, "–").replace(/&#8217;/g, "’").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
  }

  /**
   * Reads in-stock products in the price range.
   * since (optional ISO date): only products published after that moment.
   * Returns { rows, total, syncedAt, warnings }.
   */
  async function run(options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    const base = String(o.origin).replace(/\/+$/, "");
    const progress = typeof o.onProgress === "function" ? o.onProgress : () => {};
    const url = (path, params) => {
      const u = new URL(path, base);
      Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v)); });
      return u.href;
    };
    const syncedAt = new Date().toISOString();
    const warnings = [];

    progress({ phase: "Connecting to the shop", done: 0, total: 1 });
    const cur = await getJSON(url(STORE, { per_page: 1, _fields: "prices" }), o);
    const minor = Number(cur.data && cur.data[0] && cur.data[0].prices && cur.data[0].prices.currency_minor_unit);
    const mu = Number.isInteger(minor) && minor >= 0 && minor <= 8 ? minor : 2;
    const toMinor = (v) => String(Math.round(Number(v) * 10 ** mu));
    const fromMinor = (v) => { const n = Number(v); return Number.isFinite(n) ? n / 10 ** mu : NaN; };

    const params = {
      stock_status: "instock",
      min_price: toMinor(o.minPrice),
      max_price: toMinor(o.maxPrice),
      per_page: o.perPage,
      orderby: "id",
      order: "asc",
      before: syncedAt,
      date_column: "date",
      _fields: "id,name,permalink,prices,images"
    };
    if (o.since) params.after = new Date(o.since).toISOString();

    const label = o.since ? "Reading new products" : "Reading every in-stock product";
    const first = await getJSON(url(STORE, Object.assign({}, params, { page: 1 })), o);
    if (!Array.isArray(first.data)) throw new Error("The shop sent an unexpected product list");
    const totalHeader = Number(first.headers.get("x-wp-total"));
    const pagesHeader = Number(first.headers.get("x-wp-totalpages"));
    let pages = [first.data];
    if (Number.isFinite(pagesHeader) && pagesHeader > 0) {
      progress({ phase: label, done: 1, total: pagesHeader });
      let done = 1;
      const rest = Array.from({ length: Math.max(0, pagesHeader - 1) }, (_, i) => i + 2);
      const more = await pool(rest, o.concurrency, async (page) => {
        let r;
        try { r = await getJSON(url(STORE, Object.assign({}, params, { page })), o); }
        catch (e) { if (e.status === 400) return []; throw e; }
        done++;
        progress({ phase: label, done, total: pagesHeader });
        return Array.isArray(r.data) ? r.data : [];
      });
      pages = pages.concat(more);
    } else {
      // No paging headers exposed: keep reading until a short page.
      let page = 1;
      while (pages[pages.length - 1].length === o.perPage && page < 1000) {
        page++;
        progress({ phase: label, done: page, total: page + 1 });
        let r;
        try { r = await getJSON(url(STORE, Object.assign({}, params, { page })), o); }
        catch (e) { if (e.status === 400) break; throw e; }
        pages.push(Array.isArray(r.data) ? r.data : []);
      }
    }

    const byId = new Map();
    pages.flat().forEach((p) => { const id = Number(p && p.id); if (Number.isSafeInteger(id) && id > 0) byId.set(id, p); });
    if (Number.isFinite(totalHeader) && totalHeader > 0 && byId.size < totalHeader) {
      warnings.push(`${totalHeader - byId.size} product(s) changed while syncing and may be missing; a later sync will pick them up.`);
    }

    const ids = [...byId.keys()];
    const batches = [];
    for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
    const published = new Map();
    let tDone = 0;
    let tFailed = 0;
    progress({ phase: "Reading publish dates", done: 0, total: Math.max(1, batches.length) });
    await pool(batches, 2, async (batch) => {
      try {
        const r = await getJSON(url(WP, { include: batch.join(","), per_page: batch.length, orderby: "include", _fields: "id,date_gmt" }), o);
        (Array.isArray(r.data) ? r.data : []).forEach((x) => {
          if (x && x.date_gmt) published.set(Number(x.id), /z$/i.test(x.date_gmt) ? x.date_gmt : x.date_gmt + "Z");
        });
      } catch (e) {
        if (e.cancelled) throw e;
        tFailed++;
      }
      tDone++;
      progress({ phase: "Reading publish dates", done: tDone, total: batches.length });
    });
    if (tFailed) warnings.push(`Publish dates could not be read for ${tFailed} batch(es) of up to 100 products.`);

    const rows = [];
    for (const [id, p] of byId) {
      const pr = p.prices || {};
      const sale = fromMinor(pr.sale_price || pr.price);
      const reg = fromMinor(pr.regular_price || pr.price);
      const title = decode(p.name);
      const link = String(p.permalink || "");
      if (!title || !link || !(sale > 0) || !(reg > 0)) continue;
      const img = p.images && p.images[0] && (p.images[0].src || p.images[0].thumbnail) || "";
      rows.push({ id, t: title, s: Math.round(sale), r: Math.round(Math.max(reg, sale)), u: link, img: /^https?:\/\//.test(img) ? img : "", pub: published.get(id) || "" });
    }
    progress({ phase: "Done", done: 1, total: 1 });
    return { rows, total: rows.length, syncedAt, warnings, mode: o.since ? "new" : "full" };
  }

  function toCSV(rows) {
    const head = ["Product ID", "Product Title", "Sale Price", "Regular Price / MRP", "Direct Product URL", "Image URL", "Published GMT", "In Stock at Last Observation"];
    const cell = (v) => {
      let t = String(v == null ? "" : v).replace(/\r?\n/g, " ");
      if (/^[=+\-@\t]/.test(t)) t = "'" + t;
      return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
    };
    return "\uFEFF" + [head].concat(rows.map((r) => [r.id, r.t, r.s, r.r, r.u, r.img, r.pub, true])).map((l) => l.map(cell).join(",")).join("\r\n");
  }

  const api = { run, toCSV, defaults: DEFAULTS, version: "1.0" };
  if (typeof window !== "undefined") window.BFASync = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  /* ---------- Bookmark mode: running on the shop's own tab ---------- */
  if (typeof location !== "undefined" && /(^|\.)buyfromauction\.in$/i.test(location.hostname)) bridge();

  function bridge() {
    // The bookmark loads this file from your Clearance finder site, so its own
    // address tells us where to send the results. The console version sets
    // window.__BFA_PAGE_ORIGIN instead.
    const given = typeof window.__BFA_PAGE_ORIGIN === "string" && /^https?:\/\/[^/]+$/.test(window.__BFA_PAGE_ORIGIN) ? window.__BFA_PAGE_ORIGIN : "";
    const pageOrigin = given || (SELF_SRC ? new URL(SELF_SRC).origin : "");
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    const mode = h.get("bfa-mode") === "full" ? "full" : "new";
    const since = h.get("bfa-since") || "";
    const minPrice = Number(h.get("bfa-min")) || DEFAULTS.minPrice;
    const maxPrice = Number(h.get("bfa-max")) || DEFAULTS.maxPrice;
    const opener = window.opener && !window.opener.closed ? window.opener : null;

    const old = document.getElementById("bfa-sync-host");
    if (old) old.remove();
    const host = document.createElement("div");
    host.id = "bfa-sync-host";
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647";
    document.documentElement.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .p{font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#141B24;border:1px solid #D6DCE3;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);padding:16px;width:min(360px,calc(100vw - 32px))}
      b.t{display:block;font-size:16px;margin-bottom:4px}.s{margin:6px 0 10px;color:#3C4654}.bar{height:6px;background:#E4E9EE;border-radius:9px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#0F5C6E;transition:width .2s}
      .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;font-weight:700;border-radius:999px;padding:8px 14px;border:1px solid #D6DCE3;background:#fff;cursor:pointer}button.pri{background:#0F5C6E;color:#fff;border-color:#0F5C6E}.err{color:#A3222B}.ok{color:#1E7A46}
    </style><div class="p" role="status"><b class="t">Clearance finder sync</b><div class="s">Starting…</div><div class="bar"><i></i></div><div class="row"></div></div>`;
    const $s = root.querySelector(".s");
    const $bar = root.querySelector(".bar i");
    const $row = root.querySelector(".row");
    const ctl = new AbortController();
    const button = (text, cls, fn) => { const b = document.createElement("button"); b.textContent = text; if (cls) b.className = cls; b.onclick = fn; $row.appendChild(b); return b; };
    const send = (msg) => { if (opener && pageOrigin) { try { opener.postMessage(Object.assign({ source: "bfa-sync" }, msg), pageOrigin); } catch (_) {} } };
    const cancelBtn = button("Cancel", "", () => ctl.abort());
    $s.textContent = mode === "full" ? "Reading every in-stock product…" : "Reading products published since your last sync…";

    run({ origin: location.origin, since: mode === "new" ? since : "", minPrice, maxPrice, signal: ctl.signal, onProgress: (p) => {
      $bar.style.width = `${Math.round(100 * (p.total ? p.done / p.total : 0))}%`;
      $s.textContent = `${p.phase}… ${p.total > 1 ? `${p.done} of ${p.total}` : ""}`;
      send({ type: "progress", phase: p.phase, done: p.done, total: p.total });
    } }).then((res) => {
      cancelBtn.remove();
      $bar.style.width = "100%";
      const download = () => {
        const href = URL.createObjectURL(new Blob([toCSV(res.rows)], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = href; a.download = `bfa-${mode === "full" ? "full" : "new"}-${res.syncedAt.slice(0, 10)}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
      };
      if (opener && pageOrigin) {
        send({ type: "result", mode, rows: res.rows, syncedAt: res.syncedAt, warnings: res.warnings });
        $s.innerHTML = `<span class="ok">Sent ${res.rows.length.toLocaleString("en-IN")} product${res.rows.length === 1 ? "" : "s"} to Clearance finder.</span> You can close this tab.`;
        button("Close this tab", "pri", () => window.close());
        button("Download CSV too", "", download);
      } else {
        $s.textContent = `Read ${res.rows.length.toLocaleString("en-IN")} products, but this tab wasn’t opened from Clearance finder, so download the CSV and upload it there.`;
        button("Download CSV", "pri", download);
      }
    }).catch((e) => {
      cancelBtn.remove();
      $s.innerHTML = `<span class="err">${e.cancelled ? "Sync cancelled." : "Sync failed: " + String(e.message || e).replace(/[<>&]/g, "")}</span>`;
      send({ type: "error", message: e.cancelled ? "Sync cancelled on the shop tab." : String(e.message || e) });
      button("Close", "", () => host.remove());
    });
  }
})();
