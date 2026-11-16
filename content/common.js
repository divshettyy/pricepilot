// PricePilot shared content-script helpers.
// Loaded before amazon.js / flipkart.js in the same classic-script `window` scope.
(function () {
  "use strict";

  /**
   * Canonicalize a page URL for dedupe: strip query string and hash,
   * keep only origin + pathname.
   */
  function cleanUrl(url) {
    const u = new URL(url);
    return u.origin + u.pathname;
  }

  /**
   * Scan text for a rupee price like "₹1,234", "Rs. 1234", "₹ 1,234.00".
   * Requires a ₹ symbol or "Rs." prefix immediately before the digits so we
   * never accidentally match a bare number (e.g. a rating). "Rs" must start a
   * word: "4.3 stars, 1,234 ratings" and "offers 500" are not prices.
   * Returns a Number, or null if nothing found.
   */
  function extractPriceFromText(text) {
    if (!text) return null;
    const re = /(?:₹|\bRs\.?)\s*(\d[\d,]*(?:\.\d+)?)/i;
    const match = re.exec(text);
    if (!match) return null;
    const numeric = match[1].replace(/,/g, "");
    const value = Number(numeric);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Scan text for a rating like "4.3 out of 5" or "4.3 out of 5 stars".
   * Returns a Number between 0-5, or null if nothing found.
   */
  function extractRatingFromText(text) {
    if (!text) return null;
    const re = /([0-5](?:\.\d+)?)\s*out of\s*5(?:\s*stars?)?/i;
    const match = re.exec(text);
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  /**
   * Upsert an item into chrome.storage.local under 'trackedItems', keyed by
   * item.url. Replaces an existing entry in place (preserving array order)
   * or pushes a new one. Trims the array to the most recent 200 entries.
   * Never throws — the extension context can be invalidated on navigation.
   */
  /**
   * Fill every contract field with a default so downstream code can rely on shape.
   */
  function normalizeItem(partial) {
    const p = partial || {};
    return {
      url: p.url || cleanUrl(location.href),
      title: p.title || "",
      site: p.site || null,
      price: p.price ?? null,
      currency: p.currency || "INR",
      capturedAt: p.capturedAt || new Date().toISOString(),
      rating: p.rating ?? null,
      discountPct: p.discountPct ?? null,
      deliveryFee: p.deliveryFee ?? null,
      mrp: p.mrp ?? null,
      ratingCount: p.ratingCount ?? null,
      ratingHistogram: p.ratingHistogram ?? null,
      offers: Array.isArray(p.offers) ? p.offers : [],
      unit: p.unit ?? null,
      modelId: p.modelId ?? null,
      restaurantKey: p.restaurantKey ?? null,
      locality: p.locality ?? null,
      cart: p.cart ?? null,
    };
  }

  async function upsertItem(rawItem) {
    const item = normalizeItem(rawItem);
    try {
      const result = await chrome.storage.local.get("trackedItems");
      let items = Array.isArray(result.trackedItems) ? result.trackedItems : [];

      const existingIndex = items.findIndex((it) => it && it.url === item.url);
      if (existingIndex !== -1) {
        items[existingIndex] = item;
      } else {
        items.push(item);
      }

      if (items.length > 200) {
        items = items.slice(items.length - 200);
      }

      await chrome.storage.local.set({ trackedItems: items });
      if (item.price != null && window.PricePilotHistory) {
        await window.PricePilotHistory.addPoint(item.url, item.price);
      }
    } catch (err) {
      console.warn("[PricePilot] upsertItem failed:", err);
    }
    try {
      window.dispatchEvent(new CustomEvent("pricepilot:item", { detail: item }));
    } catch (err) {
      console.warn("[PricePilot] item event failed:", err);
    }
    return item;
  }

  /**
   * Standard debounce helper: delays invoking `fn` until `ms` have passed
   * since the last call.
   */
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, ms);
    };
  }

  window.PricePilotCommon = {
    cleanUrl,
    extractPriceFromText,
    extractRatingFromText,
    upsertItem,
    normalizeItem,
    debounce,
  };
})();
