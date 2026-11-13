// PricePilot — Flipkart product page extractor.
// Requires content/common.js (window.PricePilotCommon) loaded earlier.
(function () {
  "use strict";

  function isProductPage() {
    return /\/p\//.test(location.href);
  }

  if (!isProductPage()) return;

  let lastPrice = null;

  function extractTitle() {
    const selectors = ["span.B_NuCI", "span.VU-ZEz", "h1 span"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    return "";
  }

  function extractPrice() {
    const selectors = ["div._30jeq3._16Jk6d", "div._30jeq3"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const price = PricePilotCommon.extractPriceFromText(el.textContent);
        if (price !== null) return price;
      }
    }
    return PricePilotCommon.extractPriceFromText(document.body.innerText);
  }

  function extractRating() {
    const el = document.querySelector("div._3LWZlK");
    if (el && el.textContent) {
      const value = parseFloat(el.textContent.trim());
      if (Number.isFinite(value)) {
        return Math.min(5, Math.max(0, value));
      }
    }
    return PricePilotCommon.extractRatingFromText(document.body.innerText);
  }

  function extractDiscount() {
    const selectors = ["div._3Ay6Sb span", "div.UkUFwK span"];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent) {
        const match = /(\d+)%/.exec(el.textContent);
        if (match) return Number(match[1]);
      }
    }
    return null;
  }

  function buildItem() {
    return {
      url: PricePilotCommon.cleanUrl(location.href),
      title: extractTitle(),
      price: extractPrice(),
      currency: "INR",
      rating: extractRating(),
      discountPct: extractDiscount(),
      deliveryFee: null,
      site: "flipkart",
      capturedAt: new Date().toISOString(),
    };
  }

  function run() {
    try {
      const item = buildItem();
      if (item.price !== null && item.price !== lastPrice) {
        lastPrice = item.price;
        PricePilotCommon.upsertItem(item);
      }
    } catch (err) {
      console.warn("[PricePilot] flipkart extraction failed:", err);
    }
  }

  run();

  try {
    const debouncedRun = PricePilotCommon.debounce(run, 500);
    const observer = new MutationObserver(debouncedRun);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (err) {
    console.warn("[PricePilot] flipkart observer setup failed:", err);
  }
})();
