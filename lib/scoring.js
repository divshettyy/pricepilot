// PricePilot scoring — weighted best-pick ranking. Classic script, no hard deps.
// Uses PricePilotOffers (card net price) and PricePilotReviews (volume-aware rating) when loaded.
// Backward compatible with v0.1: computeScores(items, weights).
(function (g) {
  "use strict";
  var DEFAULT_WEIGHTS = { price: 0.45, rating: 0.25, discount: 0.2, delivery: 0.1 };

  function normalizeWeights(weights) {
    var w = weights || {};
    var sum = (w.price || 0) + (w.rating || 0) + (w.discount || 0) + (w.delivery || 0);
    if (!(sum > 0)) return DEFAULT_WEIGHTS;
    return { price: w.price || 0, rating: w.rating || 0, discount: w.discount || 0, delivery: w.delivery || 0 };
  }

  function minMaxScore(values, value, higherIsBetter) {
    var nums = values.filter(function (v) { return v != null; });
    if (value == null || nums.length === 0) return 50;
    var min = Math.min.apply(null, nums);
    var max = Math.max.apply(null, nums);
    if (max === min) return 100;
    var ratio = (value - min) / (max - min);
    return higherIsBetter ? ratio * 100 : (1 - ratio) * 100;
  }

  function effectivePriceOf(item, cards) {
    if (item.price == null) return null;
    var Offers = g.PricePilotOffers;
    if (Offers && item.offers && item.offers.length) {
      var best = Offers.bestNetPrice(item.price, item.offers, cards || []);
      if (best) return best.netPrice;
    }
    return item.price;
  }

  function adjustedRatingOf(item) {
    if (item.rating == null) return null;
    var Reviews = g.PricePilotReviews;
    if (Reviews && item.ratingCount != null) return Reviews.bayesian(item.rating, item.ratingCount);
    return item.rating;
  }

  function computeScores(items, weights, opts) {
    if (!items || items.length === 0) return [];
    opts = opts || {};
    var w = normalizeWeights(weights);
    var wSum = w.price + w.rating + w.discount + w.delivery;

    var eff = items.map(function (i) { return effectivePriceOf(i, opts.cards); });
    var adj = items.map(adjustedRatingOf);
    var fees = items.map(function (i) { return i.deliveryFee; });

    var scored = items.map(function (item, idx) {
      var priceScore = minMaxScore(eff, eff[idx], false);
      var ratingScore = adj[idx] != null ? (adj[idx] / 5) * 100 : 50;
      var discountScore = item.discountPct != null ? Math.min(100, Math.max(0, item.discountPct)) : 0;
      var deliveryScore = minMaxScore(fees, item.deliveryFee, false);
      var total = (priceScore * w.price + ratingScore * w.rating +
                   discountScore * w.discount + deliveryScore * w.delivery) / wSum;

      var out = {};
      for (var k in item) out[k] = item[k];
      out.effectivePrice = eff[idx];
      out.adjustedRating = adj[idx];
      out.score = total;
      out.scoreBreakdown = {
        priceScore: priceScore,
        ratingScore: ratingScore,
        discountScore: discountScore,
        deliveryScore: deliveryScore
      };
      return out;
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    scored.forEach(function (item, idx) { item.isBestPick = idx === 0; });
    return scored;
  }

  g.PricePilotScoring = {
    computeScores: computeScores,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS
  };
})(typeof self !== "undefined" ? self : window);
