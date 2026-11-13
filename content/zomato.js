// PricePilot — Zomato content script
// Heuristic text extraction: Zomato is a React SPA with hashed class names that
// change every deploy, so we read rendered innerText and the page title instead
// of CSS selectors. Shared heuristics live in lib/food.js (PricePilotFood).
//
// Cart handling: Zomato shows the cart/bill on the restaurant's own /order page,
// so the bill attaches to that page's item. On a standalone checkout/cart URL
// (no restaurant in the path) the bill is attached to the most recently tracked
// Zomato item instead, since that is the restaurant the user just came from.

(function () {
  try {
    var host = location.hostname || "";
    var path = location.pathname || "";
    if (host.indexOf("zomato.com") === -1) return;
    if (path === "/") return;

    var F = window.PricePilotFood;
    var C = window.PricePilotCommon;
    if (!F || !C) return;
    var normalize = C.normalizeItem || function (x) { return x; };

    var SITE = "zomato";
    var lastSignature = null;

    // /<city>/<restaurant-slug>/order  -> city, slug
    function urlParts() {
      var segs = path.split("/").filter(Boolean);
      return { city: segs[0] || null, slug: segs[1] || null };
    }

    function isStandaloneCheckout() {
      return /\/(checkout|cart)(\/|$)/i.test(path);
    }

    function hasBill(text) {
      return /To Pay|Bill Details|Bill Summary|Grand Total/i.test(text);
    }

    function getIdentity() {
      var u = urlParts();
      var parsed = F.parseTitle(document.title, "Zomato", u.city);
      var name = parsed.name;
      if (!name || /^zomato$/i.test(name)) {
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
      await C.upsertItem(normalize(updated));
    }

    function extractAndMaybeSave() {
      try {
        var text = (document.body && document.body.innerText) || "";
        var cart = hasBill(text) ? F.parseCart(text) : null;

        if (isStandaloneCheckout()) {
          if (cart) attachCartToRecent(cart).catch(function (e) {
            console.warn("[PricePilot/zomato] cart attach error", e);
          });
          return;
        }

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
        console.warn("[PricePilot/zomato] extraction error", e);
      }
    }

    var debounced = C.debounce(extractAndMaybeSave, 800);
    new MutationObserver(debounced).observe(document.body, { childList: true, subtree: true, characterData: true });

    extractAndMaybeSave();
    setTimeout(extractAndMaybeSave, 2000);
  } catch (e) {
    console.warn("[PricePilot/zomato] init error", e);
  }
})();
