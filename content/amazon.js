// PricePilot — Amazon product page extractor.
// Requires content/common.js (window.PricePilotCommon) loaded earlier.
(function () {
  "use strict";

  function isProductPage() {
    return /\/dp\/|\/gp\/product\//.test(location.href);
  }

  if (!isProductPage()) return;

  let lastPrice = null;

  function extractTitle() {
    const el = document.querySelector("#productTitle");
    return el ? el.textContent.trim() : "";
  }

  function extractPrice() {
    const selectors = [
      "#corePrice_feature_div .a-price .a-offscreen",
      ".a-price .a-offscreen",
      "#priceblock_ourprice",
      "#priceblock_dealprice",
    ];
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
    const el = document.querySelector("#acrPopover");
    if (el) {
      const source = el.getAttribute("title") || el.textContent || "";
      const rating = PricePilotCommon.extractRatingFromText(source);
      if (rating !== null) return rating;
    }
    return PricePilotCommon.extractRatingFromText(document.body.innerText);
  }

  function extractDiscount() {
    const el = document.querySelector(".savingsPercentage");
    if (!el || !el.textContent) return null;
    const match = /(\d+)\s*%/.exec(el.textContent);
    return match ? Number(match[1]) : null;
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
      site: "amazon",
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
      console.warn("[PricePilot] amazon extraction failed:", err);
    }
  }

  run();

  try {
    const debouncedRun = PricePilotCommon.debounce(run, 500);
    const observer = new MutationObserver(debouncedRun);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch (err) {
    console.warn("[PricePilot] amazon observer setup failed:", err);
  }
})();
