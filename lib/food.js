// PricePilot — food helpers (Zomato vs Swiggy).
// Restaurant matching, page/title parsing and cart bill parsing.
// Works in content scripts, popup and service worker (attaches to self/window).
//
// Sample cart texts verified with node (see `node -e` run in the commit that
// added this file). Shapes seen on real checkout pages:
//
//  1) Swiggy:   "Bill Details\nItem Total\n₹438\nDelivery Fee | 3.2 kms\n₹45\nPlatform fee\n₹10\nGST and Restaurant Charges\n₹42.15\nTO PAY\n₹535"
//  2) Zomato:   "Bill Summary\nItem total ₹520 ₹468\nDelivery partner fee FREE\nPlatform fee ₹6\nGST & restaurant charges ₹31.40\nGrand Total ₹505.40"
//  3) Discount: "Item Total ₹300\nItem Discount -₹60\nPackaging charges ₹20\nTaxes ₹18\nTo Pay ₹278"
//  4) Rs form:  "Subtotal Rs. 1,250\nDelivery Fee Rs 0\nRestaurant Packaging Charges Rs 40\nYou saved Rs 125\nTotal Rs. 1,165"
//  5) Too thin: "Delivery Fee ₹30"  -> null (fewer than 2 fields)

(function (g) {
  "use strict";

  var DROP_TOKENS = { the: 1, restaurant: 1, restaurants: 1, and: 1, pvt: 1, ltd: 1 };

  function stripAccents(s) {
    try {
      return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    } catch (e) {
      return s;
    }
  }

  function normalizeName(name) {
    if (!name) return "";
    var s = stripAccents(String(name).toLowerCase()).replace(/&/g, " and ");
    s = s.replace(/[^a-z0-9\s]/g, " ");
    return s
      .split(/\s+/)
      .filter(function (t) { return t && !DROP_TOKENS[t]; })
      .join(" ");
  }

  function restaurantKey(name, locality) {
    return normalizeName(name) + "|" + normalizeName(locality || "");
  }

  function tokens(s) {
    return normalizeName(s).split(" ").filter(Boolean);
  }

  function jaccard(a, b) {
    var A = {}, B = {}, inter = 0, union = 0, k;
    a.forEach(function (t) { A[t] = 1; });
    b.forEach(function (t) { B[t] = 1; });
    for (k in A) { union++; if (B[k]) inter++; }
    for (k in B) { if (!A[k]) union++; }
    return union ? inter / union : 0;
  }

  // ---------- amounts ----------

  var AMOUNT_RE = /(-?)\s*(?:₹|Rs\.?)\s*([\d,]+(?:\.\d+)?)/gi;
  var BARE_AMOUNT_LINE = /^\s*(-?)\s*(?:₹|Rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*$/i;

  // Last currency amount on a line (strikethrough original price comes first).
  function lastAmount(line) {
    var m, last = null;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(line)) !== null) {
      var n = parseFloat(m[2].replace(/,/g, ""));
      if (!isNaN(n)) last = n;
    }
    return last;
  }

  // ---------- cart parsing ----------

  // Order matters: more specific labels first.
  var CART_FIELDS = [
    { key: "packaging", re: /packaging/i, freeable: true },
    { key: "platformFee", re: /platform\s*fee/i, freeable: true },
    { key: "deliveryFee", re: /delivery\s*(?:partner\s*)?fee/i, freeable: true },
    { key: "gst", re: /\bgst\b|\btaxes\b/i },
    { key: "discount", re: /discount|coupon|you saved|savings/i },
    { key: "itemTotal", re: /^\s*(?:item\s*total|sub\s*total)\b/i },
    { key: "grandTotal", re: /^\s*(?:to\s*pay|grand\s*total|total)\b/i }
  ];

  function parseCart(text) {
    if (!text) return null;
    var lines = String(text).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
    var cart = {
      itemTotal: null, packaging: null, platformFee: null, deliveryFee: null,
      gst: null, discount: null, grandTotal: null
    };
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var field = null;
      for (var f = 0; f < CART_FIELDS.length; f++) {
        if (CART_FIELDS[f].re.test(line)) { field = CART_FIELDS[f]; break; }
      }
      if (!field) continue;

      var value = null;
      if (field.freeable && /\bfree\b/i.test(line)) {
        value = 0;
      } else {
        value = lastAmount(line);
        // Label and amount often sit on separate lines in innerText.
        if (value === null) {
          for (var j = i + 1; j <= i + 2 && j < lines.length; j++) {
            if (field.freeable && /^\s*free\s*$/i.test(lines[j])) { value = 0; break; }
            var cur = lastAmount(lines[j]);
            if (cur !== null) { value = cur; break; }
            var bm = BARE_AMOUNT_LINE.exec(lines[j]);
            if (bm) { value = parseFloat(bm[2].replace(/,/g, "")); break; }
            // Stop if the next line is another label.
            if (CART_FIELDS.some(function (cf) { return cf.re.test(lines[j]); })) break;
          }
        }
      }
      if (value === null || isNaN(value)) continue;
      value = Math.abs(value);
      if (field.key === "grandTotal") {
        cart.grandTotal = value; // last occurrence wins
      } else if (cart[field.key] === null) {
        cart[field.key] = value;
      }
    }
    var found = 0;
    for (var k in cart) if (cart[k] !== null) found++;
    return found >= 2 ? cart : null;
  }

  // ---------- page scanning (shared by zomato.js / swiggy.js) ----------

  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  function parseCount(raw) {
    if (!raw) return null;
    var s = raw.replace(/,/g, "").replace(/\+/g, "").trim();
    var mult = /k$/i.test(s) ? 1000 : /l$|lakh/i.test(s) ? 100000 : 1;
    var n = parseFloat(s);
    return isNaN(n) ? null : Math.round(n * mult);
  }

  // Heuristic scan of rendered innerText. SPA class names are hashed, so text is
  // the most stable signal. Best-effort; tune regexes if layouts change.
  function scanPage(text) {
    var out = { price: null, rating: null, ratingCount: null, discountPct: null, deliveryFee: null, offerTexts: [] };
    if (!text) return out;
    try {
      var near = /([1-5]\.\d)\s*[\n·•|]*\s*\(?\s*([\d,.]+\s*[KkLl]?\+?)?\s*(?:ratings?|reviews?)/i.exec(text);
      if (near) {
        out.rating = parseFloat(near[1]);
        out.ratingCount = parseCount(near[2]);
      } else {
        var bm = /\b([1-5]\.\d)\b/.exec(text.slice(0, 2000));
        if (bm) out.rating = parseFloat(bm[1]);
      }

      // Drop the bill/cart block first so totals and fees don't skew the menu-price median.
      var menuText = text.replace(/(Bill Details|Bill Summary)[\s\S]*?(To Pay|Grand Total)[^\n]*(\n[^\n]*)?/gi, " ");
      var re = /₹\s?([\d,]+(?:\.\d+)?)/g, m, vals = [];
      while ((m = re.exec(menuText)) !== null) {
        // Skip offer caps/thresholds ("up to ₹100", "above ₹199", "flat ₹50 off").
        var before = menuText.slice(Math.max(0, m.index - 14), m.index);
        if (/(up\s*to|upto|above|over|min(imum)?\.?|flat|save|off on)\s*$/i.test(before)) continue;
        var n = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(n) && n >= 30) vals.push(n);
      }
      out.price = median(vals);

      var df = /Delivery\s*(?:Partner\s*)?Fee[^\n₹]{0,20}(?:₹\s?([\d,]+(?:\.\d+)?)|\b(FREE)\b)/i.exec(text);
      if (df) out.deliveryFee = df[2] ? 0 : parseFloat(df[1].replace(/,/g, ""));

      var dre = /(\d+)%\s*OFF/gi, dm;
      while ((dm = dre.exec(text)) !== null) {
        var p = parseInt(dm[1], 10);
        if (p > 0 && p <= 100 && (out.discountPct === null || p > out.discountPct)) out.discountPct = p;
      }

      out.offerTexts = text
        .split(/\n+/)
        .filter(function (l) { return /%\s*OFF|FLAT\s*₹|OFF\s*UP\s*TO|\bbank\b.*\boff\b/i.test(l) && l.length < 160; })
        .slice(0, 10);
    } catch (e) {
      console.warn("[PricePilot/food] scanPage error", e);
    }
    return out;
  }

  // "Order Food Online from Meghana Foods, Koramangala, Bangalore | Zomato"
  // "Meghana Foods - Residency Road, Ashok Nagar, Bangalore | Swiggy"
  function parseTitle(raw, brand, city) {
    var t = String(raw || "");
    t = t.replace(new RegExp("\\s*[-|]\\s*" + brand + "\\b.*$", "i"), "");
    t = t.replace(/^\s*order\s+(?:food\s+)?(?:online\s+)?(?:from\s+)?/i, "");
    t = t.replace(/\s+(?:order\s+online|online\s+order(?:ing)?|food\s+delivery|delivery|menu)\b.*$/i, "");
    var parts = t.split(/\s+-\s+|\s*,\s*/).map(function (p) { return p.trim(); }).filter(Boolean);
    var name = parts[0] || "";
    var cityN = normalizeName(city || "");
    var rest = parts.slice(1).filter(function (p) { return !cityN || normalizeName(p) !== cityN; });
    return { name: name, locality: rest.length ? rest[0] : null };
  }

  // Locality from slug: drop leading name tokens, trailing city and id tokens.
  function localityFromSlug(slug, name, city) {
    if (!slug) return null;
    var toks = slug.toLowerCase().replace(/-rest\d+$|-\d+$/, "").split("-").filter(Boolean);
    var nameToks = tokens(name);
    var i = 0;
    while (i < toks.length && i < nameToks.length && toks[i] === nameToks[i]) i++;
    if (i === 0) return null; // slug doesn't start with the name; can't split reliably
    var cityToks = tokens(city || "");
    var rest = toks.slice(i);
    while (rest.length && cityToks.indexOf(rest[rest.length - 1]) !== -1) rest.pop();
    return rest.length ? rest.join(" ") : null;
  }

  // ---------- cross-app matching ----------

  function comparableTotal(item, useCart) {
    if (useCart) return item.cart.grandTotal;
    if (item.price == null) return null;
    // Dish-level estimate: % OFF offers on food are almost always capped, so cap
    // the estimated discount at ₹150 to avoid over-crediting "60% OFF".
    var disc = item.discountPct ? Math.min(item.price * item.discountPct / 100, 150) : 0;
    return item.price + (item.deliveryFee || 0) - disc;
  }

  function isPair(z, s) {
    var zk = z.restaurantKey || restaurantKey(z.title, z.locality);
    var sk = s.restaurantKey || restaurantKey(s.title, s.locality);
    if (zk === sk && zk.split("|")[0]) return 1;
    var nameScore = jaccard(tokens(z.title), tokens(s.title));
    if (nameScore < 0.75) return 0;
    if (z.locality && s.locality) {
      var lz = tokens(z.locality), ls = tokens(s.locality);
      if (!lz.some(function (t) { return ls.indexOf(t) !== -1; })) return 0;
    }
    return nameScore;
  }

  function matchAcrossApps(items) {
    var zs = (items || []).filter(function (i) { return i && i.site === "zomato"; });
    var ss = (items || []).filter(function (i) { return i && i.site === "swiggy"; });
    var used = {}, pairs = [];
    zs.forEach(function (z) {
      var best = null, bestScore = 0;
      ss.forEach(function (s, idx) {
        if (used[idx]) return;
        var sc = isPair(z, s);
        if (sc > bestScore) { bestScore = sc; best = idx; }
      });
      if (best === null) return;
      used[best] = true;
      var s = ss[best];
      var useCart = !!(z.cart && s.cart && z.cart.grandTotal != null && s.cart.grandTotal != null);
      var zt = comparableTotal(z, useCart), st = comparableTotal(s, useCart);
      var cheaper = "same", diff = 0;
      if (zt != null && st != null) {
        diff = Math.round(Math.abs(zt - st) * 100) / 100;
        cheaper = diff < 1 ? "same" : zt < st ? "zomato" : "swiggy";
      }
      pairs.push({
        key: z.restaurantKey || restaurantKey(z.title, z.locality),
        zomato: z, swiggy: s, cheaper: cheaper, diff: diff,
        basis: useCart ? "cart" : "estimate", zomatoTotal: zt, swiggyTotal: st
      });
    });
    return pairs;
  }

  g.PricePilotFood = {
    normalizeName: normalizeName,
    restaurantKey: restaurantKey,
    parseCart: parseCart,
    matchAcrossApps: matchAcrossApps,
    // helpers shared by content/zomato.js and content/swiggy.js
    scanPage: scanPage,
    parseTitle: parseTitle,
    localityFromSlug: localityFromSlug
  };
})(typeof self !== "undefined" ? self : window);
