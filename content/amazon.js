// PricePilot — Amazon product page extractor.
// Needs content/common.js plus lib/offers.js, lib/unitprice.js (all loaded earlier, see manifest).
(function () {
  "use strict";

  if (!/\/dp\/|\/gp\/product\//.test(location.href)) return;

  const C = window.PricePilotCommon;
  const toNum = (s) => {
    if (s == null) return null;
    const n = Number(String(s).replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  let lastSignature = null;

  function text(sel) {
    const el = document.querySelector(sel);
    return el && el.textContent ? el.textContent.trim() : "";
  }

  function extractTitle() {
    return text("#productTitle");
  }

  function extractPrice() {
    const selectors = [
      "#corePrice_feature_div .a-price .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
    ];
    for (const sel of selectors) {
      const t = text(sel);
      if (t) {
        const price = C.extractPriceFromText(t);
        if (price !== null) return price;
      }
    }
    return C.extractPriceFromText(document.body.innerText);
  }

  function extractMrp(price) {
    const selectors = [
      "#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen",
      "#corePrice_feature_div .a-text-price .a-offscreen",
      ".basisPrice .a-offscreen",
      ".a-text-price .a-offscreen",
    ];
    for (const sel of selectors) {
      const v = C.extractPriceFromText(text(sel));
      if (v !== null && (price == null || v > price)) return v;
    }
    const m = /M\.?R\.?P\.?\s*:?\s*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i.exec(document.body.innerText);
    const v = m ? toNum(m[1]) : null;
    return v !== null && (price == null || v > price) ? v : null;
  }

  function extractRating() {
    const el = document.querySelector("#acrPopover");
    if (el) {
      const rating = C.extractRatingFromText(el.getAttribute("title") || el.textContent || "");
      if (rating !== null) return rating;
    }
    return C.extractRatingFromText(document.body.innerText);
  }

  function extractRatingCount() {
    const t = text("#acrCustomerReviewText");
    const m = /([\d,]+)/.exec(t);
    if (m) return toNum(m[1]);
    const b = /([\d,]+)\s+(?:global\s+)?ratings/i.exec(document.body.innerText);
    return b ? toNum(b[1]) : null;
  }

  function extractHistogram() {
    const hist = {};
    const nodes = document.querySelectorAll("#histogramTable [aria-label], #cm_cr_dp_d_rating_histogram [aria-label]");
    nodes.forEach((n) => {
      const m = /(\d+)\s*percent of reviews have\s*(\d)\s*stars?/i.exec(n.getAttribute("aria-label") || "");
      if (m) hist[m[2]] = Number(m[1]);
    });
    if (Object.keys(hist).length < 3) {
      const table = document.querySelector("#histogramTable");
      const src = table ? table.innerText : "";
      const re = /(\d)\s*star[\s\S]{0,40}?(\d{1,3})\s*%/gi;
      let m;
      while ((m = re.exec(src))) hist[m[1]] = Number(m[2]);
    }
    return Object.keys(hist).length >= 3 ? hist : null;
  }

  function extractDiscount() {
    const m = /(\d+)\s*%/.exec(text(".savingsPercentage"));
    return m ? Number(m[1]) : null;
  }

  function collectOfferTexts() {
    const texts = [];
    const boxSelectors = [
      "#itembox-InstantBankDiscount",
      "#itembox-Cashback",
      "#itembox-Partner",
      "#itembox-NoCostEmi",
      "#sopp_feature_div",
      "#vsxoffers_feature_div",
      "#poToggleButton",
    ];
    boxSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.innerText) texts.push(el.innerText);
      });
    });
    // Fallback: small text nodes in the buy-box area that mention an offer.
    const scope = document.querySelector("#ppd") || document.querySelector("#dp-container") || document.body;
    scope.querySelectorAll("span, li, div").forEach((el) => {
      if (el.children.length > 3) return;
      const t = (el.innerText || "").trim();
      if (t.length < 15 || t.length > 400) return;
      if (/bank offer|instant discount|cashback|partner offer/i.test(t)) texts.push(t);
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

  function extractModelId() {
    const m = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i.exec(location.pathname);
    return m ? m[1].toUpperCase() : null;
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
      site: "amazon",
      capturedAt: new Date().toISOString(),
      mrp: extractMrp(price),
      ratingCount: extractRatingCount(),
      ratingHistogram: extractHistogram(),
      offers: extractOffers(),
      unit: window.PricePilotUnit ? window.PricePilotUnit.parseUnit(title) : null,
      modelId: extractModelId(),
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
      console.warn("[PricePilot] amazon extraction failed:", err);
    }
  }

  run();

  try {
    const observer = new MutationObserver(C.debounce(run, 500));
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (err) {
    console.warn("[PricePilot] amazon observer setup failed:", err);
  }
})();
