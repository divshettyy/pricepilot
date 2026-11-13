// PricePilot — Zomato content script
// Heuristic text-pattern extraction: Zomato is a React SPA with hashed/minified
// class names that change on every deploy, so we scan rendered innerText instead
// of relying on brittle CSS selectors. All heuristics below are best-effort and
// may need tuning if Zomato's page layout/copy changes.

(function () {
  try {
    var host = location.hostname || "";
    var path = location.pathname || "";
    if (host.indexOf("zomato.com") === -1) return;
    if (path === "/") return; // bare homepage, nothing to extract

    var lastSignature = null;

    function getTitle() {
      try {
        var t = (document.title || "").trim();
        // Strip common " - Zomato" / " | Zomato" suffixes
        t = t.replace(/\s*[-|]\s*Zomato\s*$/i, "").trim();
        if (t && t.toLowerCase() !== "zomato") return t;
        var h1 = document.querySelector("h1");
        if (h1 && h1.textContent) return h1.textContent.trim();
        return t || "";
      } catch (e) {
        return "";
      }
    }

    // Heuristic: find a rating 1.0-5.0, preferring one near the word "rating(s)".
    function findRatingInText(text) {
      try {
        var nearRatings = /([0-5]\.\d)\s*\n?\s*\d*\s*(?:ratings?|Ratings?)/;
        var m = nearRatings.exec(text);
        if (m) {
          var v = parseFloat(m[1]);
          if (v >= 1 && v <= 5) return v;
        }
        // Fallback: first bare X.Y in range 1.0-5.0 within the first 2000 chars.
        var head = text.slice(0, 2000);
        var bare = /\b([1-5]\.\d)\b/g;
        var bm;
        while ((bm = bare.exec(head)) !== null) {
          var bv = parseFloat(bm[1]);
          if (bv >= 1 && bv <= 5) return bv;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    // Collect all ₹ amounts, filter obvious fee/tax noise (<30), take median.
    function findAllPricesInText(text) {
      try {
        var re = /₹\s?([\d,]+(?:\.\d+)?)/g;
        var vals = [];
        var m;
        while ((m = re.exec(text)) !== null) {
          var n = parseFloat(m[1].replace(/,/g, ""));
          if (!isNaN(n) && n >= 30) vals.push(n);
        }
        return vals;
      } catch (e) {
        return [];
      }
    }

    function median(nums) {
      if (!nums.length) return null;
      var sorted = nums.slice().sort(function (a, b) {
        return a - b;
      });
      var mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
      return sorted[mid];
    }

    function findDeliveryFeeInText(text) {
      try {
        var re = /Delivery\s*(?:Fee|Partner Fee)?\s*₹\s?([\d,]+(?:\.\d+)?)/i;
        var m = re.exec(text);
        if (m) {
          var n = parseFloat(m[1].replace(/,/g, ""));
          if (!isNaN(n)) return n;
        }
        return null;
      } catch (e) {
        return null;
      }
    }

    function findMaxDiscountInText(text) {
      try {
        var re = /(\d+)%\s*OFF/gi;
        var max = null;
        var m;
        while ((m = re.exec(text)) !== null) {
          var n = parseInt(m[1], 10);
          if (!isNaN(n) && (max === null || n > max)) max = n;
        }
        return max;
      } catch (e) {
        return null;
      }
    }

    function extractAndMaybeSave() {
      try {
        var text = (document.body && document.body.innerText) || "";
        var title = getTitle();
        var prices = findAllPricesInText(text);
        var price = prices.length >= 1 ? median(prices) : null;
        var rating = findRatingInText(text);
        var discountPct = findMaxDiscountInText(text);
        var deliveryFee = findDeliveryFeeInText(text);

        var signature = price + "|" + rating + "|" + discountPct;
        if (signature === lastSignature) return;
        if (price === null || !title) return;

        lastSignature = signature;

        var item = {
          url: window.PricePilotCommon.cleanUrl(location.href),
          title: title,
          price: price,
          currency: "INR",
          rating: rating,
          discountPct: discountPct,
          deliveryFee: deliveryFee,
          site: "zomato",
          capturedAt: new Date().toISOString()
        };

        window.PricePilotCommon.upsertItem(item);
      } catch (e) {
        console.warn("[PricePilot/zomato] extraction error", e);
      }
    }

    var debouncedExtract = window.PricePilotCommon.debounce(extractAndMaybeSave, 800);

    var observer = new MutationObserver(debouncedExtract);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    extractAndMaybeSave();
    setTimeout(extractAndMaybeSave, 2000);
  } catch (e) {
    console.warn("[PricePilot/zomato] init error", e);
  }
})();
