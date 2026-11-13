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
   * never accidentally match a bare number (e.g. a rating).
   * Returns a Number, or null if nothing found.
   */
  function extractPriceFromText(text) {
    if (!text) return null;
    const re = /(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/i;
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
  async function upsertItem(item) {
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
    } catch (err) {
      console.warn("[PricePilot] upsertItem failed:", err);
    }
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
    debounce,
  };
})();
