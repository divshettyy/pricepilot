// PricePilot — Flipkart product page extractor.
// Needs content/common.js plus lib/offers.js, lib/unitprice.js (all loaded earlier, see manifest).
// Flipkart class names are minified and rotate; every selector has a text-regex fallback.
(function () {
  "use strict";

  if (!/\/p\//.test(location.href)) return;

  const C = window.PricePilotCommon;
  const toNum = (s) => {
    if (s == null) return null;
    const n = Number(String(s).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  // Read pid before cleanUrl strips the query string.
  const initialPid = (() => {
    try { return new URL(location.href).searchParams.get("pid"); } catch (e) { return null; }
  })();
  let lastSignature = null;

  function text(sel) {
    const el = document.querySelector(sel);
    return el && el.textContent ? el.textContent.trim() : "";
  }

  function firstText(selectors) {
    for (const sel of selectors) {
      const t = text(sel);
      if (t) return t;
    }
    return "";
  }

  function extractTitle() {
    return firstText(["span.B_NuCI", "span.VU-ZEz", "h1 span", "h1"]);
  }

  function extractPrice() {
    const t = firstText(["div._30jeq3._16Jk6d", "div._30jeq3", "div.Nx9bqj.CxhGGd", "div.Nx9bqj"]);
    const p = t ? C.extractPriceFromText(t) : null;
    return p !== null ? p : C.extractPriceFromText(document.body.innerText);
  }

  function extractMrp(price) {
    const selectors = ["div._3I9_wc._2p6lqe", "div._3I9_wc", "div.yRaY8j"];
    for (const sel of selectors) {
      const v = toNum(text(sel));
      if (v !== null && (price == null || v > price)) return v;
    }
    // Strike-through elements near the price.
    const struck = document.querySelectorAll("s, del, [style*='line-through']");
    for (const el of struck) {
      const v = C.extractPriceFromText(el.textContent || "");
      if (v !== null && (price == null || v > price)) return v;
    }
    return null;
  }

  function extractRating() {
    const t = firstText(["div._3LWZlK", "div.XQDdHH"]);
    const value = parseFloat(t);
    if (Number.isFinite(value)) return Math.min(5, Math.max(0, value));
    return C.extractRatingFromText(document.body.innerText);
  }

  function extractRatingCount() {
    const m = /([\d,]+)\s*Ratings/i.exec(firstText(["span._2_R_DZ", "span.Wphh3N"]) || document.body.innerText);
    return m ? toNum(m[1]) : null;
  }

  function extractHistogram() {
    // Flipkart shows per-star counts in rows ordered 5..1.
    const counts = [];
    document.querySelectorAll("div._1uJVNT, div.BArk-j").forEach((el) => {
      const n = toNum(el.textContent);
      if (n !== null) counts.push(n);
    });
    if (counts.length !== 5) return null;
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return null;
    const hist = {};
    counts.forEach((c, i) => { hist[5 - i] = Math.round((c / total) * 100); });
    return hist;
  }

  function extractDiscount() {
    const t = firstText(["div._3Ay6Sb span", "div.UkUFwK span"]);
    const m = /(\d+)%/.exec(t);
    return m ? Number(m[1]) : null;
  }

  function collectOfferTexts() {
    const texts = [];
    document.querySelectorAll("li, div, span").forEach((el) => {
      if (el.children.length > 4) return;
      const t = (el.innerText || "").trim();
      if (t.length < 15 || t.length > 400) return;
      if (/bank offer|cashback|partner offer|instant discount/i.test(t)) texts.push(t);
    });
    return texts;
  }

  function extractOffers() {
    if (!window.PricePilotOffers) return [];
    try {
      return window.PricePilotOffers.parseOffers(collectOfferTexts());
    } catch (e) {
      return [];
    }
  }

  function buildItem() {
    const title = extractTitle();
    const price = extractPrice();
    const partial = {
      url: C.cleanUrl(location.href),
      title,
      price,
      currency: "INR",
      rating: extractRating(),
      discountPct: extractDiscount(),
      deliveryFee: null,
      site: "flipkart",
      capturedAt: new Date().toISOString(),
      mrp: extractMrp(price),
      ratingCount: extractRatingCount(),
      ratingHistogram: extractHistogram(),
      offers: extractOffers(),
      unit: window.PricePilotUnit ? window.PricePilotUnit.parseUnit(title) : null,
      modelId: initialPid,
      restaurantKey: null,
      locality: null,
      cart: null,
    };
    if (partial.discountPct == null && partial.mrp && price) {
      partial.discountPct = Math.round((1 - price / partial.mrp) * 100);
    }
    return (C.normalizeItem || ((x) => x))(partial);
  }

  function run() {
    try {
      const item = buildItem();
      if (item.price === null) return;
      const signature = item.price + "|" + (item.offers ? item.offers.length : 0);
      if (signature !== lastSignature) {
        lastSignature = signature;
        C.upsertItem(item);
      }
    } catch (err) {
      console.warn("[PricePilot] flipkart extraction failed:", err);
    }
  }

  run();

  try {
    const observer = new MutationObserver(C.debounce(run, 500));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (err) {
    console.warn("[PricePilot] flipkart observer setup failed:", err);
  }
})();
