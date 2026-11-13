// PricePilot cross-store lookup. Service worker only (uses fetch with host_permissions).
// Regex-only HTML parsing: no DOMParser in service workers.
(function (g) {
  "use strict";

  const STOP = new Set(["the", "and", "for", "with", "from", "pack", "new", "buy", "online", "india", "best", "price", "combo", "set", "of"]);

  function tokens(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w));
  }

  function matchScore(a, b) {
    const ta = new Set(tokens(a));
    const tb = new Set(tokens(b));
    if (!ta.size || !tb.size) return 0;
    let inter = 0;
    ta.forEach((t) => { if (tb.has(t)) inter++; });
    let score = inter / (ta.size + tb.size - inter);
    const model = (t) => /[a-z]/.test(t) && /\d/.test(t);
    const ma = [...ta].filter(model);
    const mb = [...tb].filter(model);
    // Hard rejects: a near-variant is a different product, never a cheaper copy.
    if (ma.length && mb.length && !ma.some((t) => tb.has(t))) return 0; // WH-1000XM4 vs XM5
    const caps = (s) => new Set((String(s).toLowerCase().match(/\d+(?:\.\d+)?\s?(?:gb|tb|mah|w|inch|")/g) || []).map((x) => x.replace(/\s/g, "")));
    const ca = caps(a), cb = caps(b);
    if (ca.size && cb.size && ![...ca].some((x) => cb.has(x))) return 0;   // 128GB vs 256GB
    const variants = ["pro", "max", "plus", "ultra", "mini", "lite", "air", "fe", "neo", "prime", "se"];
    const va = new Set(String(a).toLowerCase().split(/[^a-z0-9+]+/).filter((w) => variants.includes(w)));
    const vb = new Set(String(b).toLowerCase().split(/[^a-z0-9+]+/).filter((w) => variants.includes(w)));
    if (va.size !== vb.size || [...va].some((v) => !vb.has(v))) return 0;  // iPhone 15 vs 15 Pro
    if (ma.length && ma.some((t) => tb.has(t))) score += 0.2;
    return Math.min(1, Math.round(score * 100) / 100);
  }

  function decode(s) {
    return (s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ").trim();
  }

  function num(s) {
    if (s == null) return null;
    const v = Number(String(s).replace(/[^\d.]/g, ""));
    return Number.isFinite(v) && v > 0 ? v : null;
  }

  function isBlocked(html) {
    return /captcha|robot check|Type the characters you see|api-services-support@amazon|are you a human|Access Denied/i.test(html.slice(0, 20000));
  }

  async function fetchText(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const res = await fetch(url, { credentials: "omit", signal: ctrl.signal, headers: { Accept: "text/html" } });
      if (!res.ok) return null;
      return await res.text();
    } catch (err) {
      console.warn("[PricePilot] fetch failed:", url, err && err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  function parseAmazon(html) {
    const out = [];
    const parts = html.split(/(?=<div[^>]*data-asin="[A-Z0-9]{10}"[^>]*data-component-type="s-search-result")/);
    for (const block of parts.slice(1)) {
      if (out.length >= 8) break;
      const asin = (block.match(/data-asin="([A-Z0-9]{10})"/) || [])[1];
      if (!asin) continue;
      let title = (block.match(/<h2[^>]*aria-label="([^"]+)"/) || [])[1];
      if (!title) title = decode((block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1]);
      else title = decode(title);
      const price = num((block.match(/a-price-whole">([\d,]+)/) || [])[1]);
      const rating = num((block.match(/([0-5](?:\.\d)?) out of 5 stars/) || [])[1]);
      if (!title || price == null) continue;
      out.push({ site: "amazon", title, price, url: `https://www.amazon.in/dp/${asin}`, rating });
    }
    return out;
  }

  function parseFlipkart(html) {
    const out = [];
    const seen = new Set();
    const re = /href="(\/[^"]*?\/p\/itm[a-z0-9]+)[^"]*"/gi;
    let m;
    while ((m = re.exec(html)) && out.length < 8) {
      const path = m[1];
      if (seen.has(path)) continue;
      seen.add(path);
      const chunk = html.slice(m.index, m.index + 4000);
      let title = (chunk.match(/title="([^"]{8,})"/) || [])[1];
      if (!title) {
        const slug = path.split("/")[1] || "";
        title = slug.replace(/-/g, " ");
      }
      const price = num((chunk.match(/₹\s?([\d,]+)/) || [])[1]);
      const rating = num((chunk.match(/>([0-5]\.\d)<(?:img|svg)/) || [])[1]);
      if (price == null) continue;
      out.push({ site: "flipkart", title: decode(title), price, url: "https://www.flipkart.com" + path, rating });
    }
    return out;
  }

  async function searchAll(query, excludeSite) {
    const q = encodeURIComponent((query || "").slice(0, 120));
    if (!q) return [];
    const jobs = [];
    if (excludeSite !== "amazon") {
      jobs.push(fetchText(`https://www.amazon.in/s?k=${q}`).then((h) => (h && !isBlocked(h) ? parseAmazon(h) : [])));
    }
    if (excludeSite !== "flipkart") {
      jobs.push(fetchText(`https://www.flipkart.com/search?q=${q}`).then((h) => (h && !isBlocked(h) ? parseFlipkart(h) : [])));
    }
    const settled = await Promise.allSettled(jobs);
    const all = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
    return all
      .map((r) => Object.assign(r, { matchScore: matchScore(query, r.title) }))
      .filter((r) => r.matchScore >= 0.5)
      .sort((a, b) => a.price - b.price);
  }

  function extractPriceFromHtml(site, html) {
    if (!html || isBlocked(html)) return null;
    if (site === "amazon") {
      const core = html.match(/id="corePrice[\s\S]{0,3000}?a-price-whole">([\d,]+)/);
      if (core) return num(core[1]);
      const any = html.match(/a-price-whole">([\d,]+)/);
      return any ? num(any[1]) : null;
    }
    if (site === "flipkart") {
      const block = html.match(/class="(?:Nx9bqj|_30jeq3)[^"]*"[^>]*>₹\s?([\d,]+)/);
      if (block) return num(block[1]);
      const json = html.match(/"(?:finalPrice|sellingPrice)"\s*:\s*\{?[^}]*?"(?:value|decimalValue)"\s*:\s*"?([\d.]+)/) ||
                   html.match(/"price"\s*:\s*"?([\d.]+)/);
      return json ? num(json[1]) : null;
    }
    return null;
  }

  g.PricePilotCross = { searchAll, extractPriceFromHtml, matchScore };
})(typeof self !== "undefined" ? self : window);
