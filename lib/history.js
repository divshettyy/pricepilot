// PricePilot price history: local timeseries per URL + transparent deal verdict.
(function (g) {
  "use strict";

  const MAX_POINTS = 365;
  const MIN_GAP_MS = 12 * 3600 * 1000;
  const DAY = 24 * 3600 * 1000;

  async function readAll() {
    const r = await chrome.storage.local.get("priceHistory");
    return r.priceHistory && typeof r.priceHistory === "object" ? r.priceHistory : {};
  }

  // Append when price changed or 12h+ since last point. Cap 365 points per url.
  async function addPoint(url, price) {
    try {
      if (!url || price == null || !Number.isFinite(Number(price))) return;
      const all = await readAll();
      const pts = Array.isArray(all[url]) ? all[url] : [];
      const last = pts[pts.length - 1];
      const now = Date.now();
      if (last && last.p === Number(price) && now - Date.parse(last.t) < MIN_GAP_MS) return;
      pts.push({ t: new Date(now).toISOString(), p: Number(price) });
      all[url] = pts.length > MAX_POINTS ? pts.slice(pts.length - MAX_POINTS) : pts;
      await chrome.storage.local.set({ priceHistory: all });
    } catch (err) {
      console.warn("[PricePilot] addPoint failed:", err);
    }
  }

  async function getHistory(url) {
    try {
      const all = await readAll();
      return Array.isArray(all[url]) ? all[url] : [];
    } catch (err) {
      console.warn("[PricePilot] getHistory failed:", err);
      return [];
    }
  }

  function median(nums) {
    if (!nums.length) return null;
    const s = nums.slice().sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /*
   * Verdict rules (in priority order, all shown to the user as reasons):
   * 1. insufficient-data: fewer than 3 points or fewer than 3 days covered.
   * 2. fake-discount, either:
   *    a. "price hiked before sale": the price rose 15%+ within the 14 days
   *       before the latest drop, and the current price is not below the
   *       median of the 60 days before that hike.
   *    b. "MRP looks inflated": mrp > 1.6 x the highest price ever seen.
   * 3. great: current <= lowest seen x 1.02.
   * 4. good:  current <= median x 0.95.
   * 5. wait:  current >= median x 1.08.
   * 6. fair:  otherwise.
   * trueDiscountPct = (median - current) / median x 100, rounded.
   */
  function analyze(points, currentPrice, mrp) {
    const pts = (Array.isArray(points) ? points : [])
      .filter((x) => x && Number.isFinite(x.p) && x.t)
      .map((x) => ({ t: Date.parse(x.t), p: x.p }))
      .sort((a, b) => a.t - b.t);
    const cur = currentPrice != null ? Number(currentPrice) : pts.length ? pts[pts.length - 1].p : null;
    const prices = pts.map((x) => x.p);
    const out = {
      lowest: prices.length ? Math.min(...prices) : null,
      highest: prices.length ? Math.max(...prices) : null,
      median: median(prices),
      lowestAt: null,
      pointCount: pts.length,
      daysCovered: pts.length ? Math.round((pts[pts.length - 1].t - pts[0].t) / DAY) : 0,
      trueDiscountPct: null,
      verdict: "insufficient-data",
      reasons: [],
    };
    if (out.lowest != null) {
      const lp = pts.find((x) => x.p === out.lowest);
      out.lowestAt = lp ? new Date(lp.t).toISOString() : null;
    }
    if (out.median && cur != null) {
      out.trueDiscountPct = Math.round(((out.median - cur) / out.median) * 100);
    }

    // Rule 2b can fire even with little history.
    let fake = false;
    if (mrp && out.highest && mrp > 1.6 * out.highest) {
      fake = true;
      out.reasons.push(`MRP ₹${Math.round(mrp)} looks inflated: it is over 1.6× the highest price seen (₹${Math.round(out.highest)}).`);
    }

    if (pts.length < 3 || out.daysCovered < 3) {
      if (fake) { out.verdict = "fake-discount"; return out; }
      out.reasons.push(`Only ${pts.length} price point(s) over ${out.daysCovered} day(s). Need 3+ points across 3+ days for a verdict.`);
      return out;
    }

    // Rule 2a: find latest drop, look for a 15%+ rise in the 14 days before it.
    let dropIdx = -1;
    for (let i = pts.length - 1; i > 0; i--) {
      if (pts[i].p < pts[i - 1].p) { dropIdx = i; break; }
    }
    if (dropIdx > 0) {
      const dropT = pts[dropIdx].t;
      const win = pts.filter((x) => x.t >= dropT - 14 * DAY && x.t < dropT);
      for (let i = 0; i < win.length && !fake; i++) {
        for (let j = i + 1; j < win.length; j++) {
          if (win[j].p >= win[i].p * 1.15) {
            const hikeT = win[j].t;
            const prior = pts.filter((x) => x.t >= hikeT - 60 * DAY && x.t < win[i].t + 1).map((x) => x.p);
            const priorMed = median(prior);
            if (priorMed != null && cur >= priorMed) {
              fake = true;
              out.reasons.push(`Price hiked before sale: rose ${Math.round((win[j].p / win[i].p - 1) * 100)}% in the 14 days before the latest drop, and ₹${Math.round(cur)} is not below the earlier median of ₹${Math.round(priorMed)}.`);
            }
            break;
          }
        }
      }
    }
    if (fake) { out.verdict = "fake-discount"; return out; }

    if (cur <= out.lowest * 1.02) {
      out.verdict = "great";
      out.reasons.push(`At or near the lowest price seen (₹${Math.round(out.lowest)}).`);
    } else if (cur <= out.median * 0.95) {
      out.verdict = "good";
      out.reasons.push(`${out.trueDiscountPct}% below the typical price of ₹${Math.round(out.median)}.`);
    } else if (cur >= out.median * 1.08) {
      out.verdict = "wait";
      out.reasons.push(`${-out.trueDiscountPct}% above the typical price of ₹${Math.round(out.median)}. Prices have been lower; consider waiting.`);
    } else {
      out.verdict = "fair";
      out.reasons.push(`Close to the typical price of ₹${Math.round(out.median)}.`);
    }
    return out;
  }

  g.PricePilotHistory = { addPoint, getHistory, analyze };
})(typeof self !== "undefined" ? self : window);
