// PricePilot — Swiggy content script
// Heuristic text extraction: Swiggy is a React SPA with hashed class names that
// change every deploy, so we read rendered innerText and the page title instead
// of CSS selectors. Shared heuristics live in lib/food.js (PricePilotFood).
//
// Cart handling: Swiggy's bill lives on /checkout, whose URL carries no
// restaurant. The bill is therefore attached to the most recently tracked
// Swiggy item, since that is the restaurant the user just added dishes from.

(function () {
  try {
    var host = location.hostname || "";
    var path = location.pathname || "";
    if (host.indexOf("swiggy.com") === -1) return;
    if (path === "/" || /^\/search\/?$/.test(path)) return;

    var F = window.PricePilotFood;
    var C = window.PricePilotCommon;
    if (!F || !C) return;
    var normalize = C.normalizeItem || function (x) { return x; };

    var SITE = "swiggy";
    var lastSignature = null;

    // /restaurants/<name>-<locality>-<city>-<id>
    // /city/<city>/<name>-<locality>-rest<id>
    function urlParts() {
      var segs = path.split("/").filter(Boolean);
      var city = null, slug = null;
      if (segs[0] === "city") {
        city = segs[1] || null;
        slug = segs[2] || null;
      } else if (segs[0] === "restaurants") {
        slug = segs[1] || null;
        if (slug && /-\d+$/.test(slug)) {
          var toks = slug.replace(/-\d+$/, "").split("-");
          city = toks.length > 1 ? toks[toks.length - 1] : null;
        }
      }
      return { city: city, slug: slug };
    }

    function isCheckout() {
      return /\/(checkout|cart)(\/|$)/i.test(path);
    }

    function hasBill(text) {
      return /To Pay|Bill Details|Bill Summary|Grand Total/i.test(text);
    }

    function getIdentity() {
      var u = urlParts();
      var parsed = F.parseTitle(document.title, "Swiggy", u.city);
      var name = parsed.name;
      if (!name || /^swiggy$/i.test(name)) {
        var h1 = document.querySelector("h1");
        name = h1 && h1.textContent ? h1.textContent.trim() : "";
      }
      var locality = parsed.locality || F.localityFromSlug(u.slug, name, u.city);
      return { name: name, locality: locality };
    }

    async function attachCartToRecent(cart) {
      var data = await chrome.storage.local.get("trackedItems");
      var items = (data && data.trackedItems) || [];
      var recent = null;
      items.forEach(function (it) {
        if (it.site === SITE && (!recent || it.capturedAt > recent.capturedAt)) recent = it;
      });
      if (!recent) return;
      var sig = "cart|" + recent.url + "|" + cart.grandTotal;
      if (sig === lastSignature) return;
      lastSignature = sig;
      var updated = Object.assign({}, recent, { cart: cart, capturedAt: new Date().toISOString() });
      if (cart.deliveryFee != null) updated.deliveryFee = cart.deliveryFee;
      await C.upsertItem(normalize(updated));
    }

    function extractAndMaybeSave() {
      try {
        var text = (document.body && document.body.innerText) || "";

        if (isCheckout()) {
          var bill = hasBill(text) ? F.parseCart(text) : null;
          if (bill) attachCartToRecent(bill).catch(function (e) {
            console.warn("[PricePilot/swiggy] cart attach error", e);
          });
          return;
        }

        var cart = hasBill(text) ? F.parseCart(text) : null;
        var id = getIdentity();
        var scan = F.scanPage(text);
        if (scan.price === null || !id.name) return;

        var signature = [scan.price, scan.rating, scan.discountPct, cart ? cart.grandTotal : ""].join("|");
        if (signature === lastSignature) return;
        lastSignature = signature;

        var offers = [];
        if (window.PricePilotOffers && scan.offerTexts.length) {
          try { offers = window.PricePilotOffers.parseOffers(scan.offerTexts) || []; } catch (e) { offers = []; }
        }

        var item = {
          url: C.cleanUrl(location.href),
          title: id.name,
          site: SITE,
          price: scan.price,
          currency: "INR",
          capturedAt: new Date().toISOString(),
          rating: scan.rating,
          discountPct: scan.discountPct,
          deliveryFee: cart && cart.deliveryFee != null ? cart.deliveryFee : scan.deliveryFee,
          mrp: null,
          ratingCount: scan.ratingCount,
          ratingHistogram: null,
          offers: offers,
          unit: null,
          modelId: null,
          restaurantKey: F.restaurantKey(id.name, id.locality),
          locality: id.locality,
          cart: cart
        };

        C.upsertItem(normalize(item));
      } catch (e) {
        console.warn("[PricePilot/swiggy] extraction error", e);
      }
    }

    var debounced = C.debounce(extractAndMaybeSave, 800);
    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true, characterData: true });

    extractAndMaybeSave();
    setTimeout(extractAndMaybeSave, 2000);
  } catch (e) {
    console.warn("[PricePilot/swiggy] init error", e);
  }
})();
