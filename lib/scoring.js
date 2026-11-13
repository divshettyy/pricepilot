// PricePilot scoring — pure, no deps. Loaded via <script> in popup and as a content script.
(function () {
  var DEFAULT_WEIGHTS = { price: 0.45, rating: 0.25, discount: 0.2, delivery: 0.1 };

  function normalizeWeights(weights) {
    var w = weights || {};
    var sum = (w.price || 0) + (w.rating || 0) + (w.discount || 0) + (w.delivery || 0);
    return sum > 0 ? w : DEFAULT_WEIGHTS;
  }

  function minMaxScore(values, value, higherIsBetter) {
    var nums = values.filter(function (v) { return v != null; });
    if (value == null) return 50;
    if (nums.length === 0) return 50;
    var min = Math.min.apply(null, nums);
    var max = Math.max.apply(null, nums);
    if (max === min) return 100;
    var ratio = (value - min) / (max - min);
    return higherIsBetter ? ratio * 100 : (1 - ratio) * 100;
  }

  function computeScores(items, weights) {
    if (!items || items.length === 0) return [];
    var w = normalizeWeights(weights);
    var wSum = w.price + w.rating + w.discount + w.delivery;
    var prices = items.map(function (i) { return i.price; });
    var fees = items.map(function (i) { return i.deliveryFee; });

    var scored = items.map(function (item) {
      var priceScore = minMaxScore(prices, item.price, false);
      var ratingScore = item.rating != null ? (item.rating / 5) * 100 : 50;
      var discountScore = item.discountPct != null
        ? Math.min(100, Math.max(0, item.discountPct))
        : 0;
      var deliveryScore = minMaxScore(fees, item.deliveryFee, false);

      var total = wSum > 0
        ? (priceScore * w.price + ratingScore * w.rating +
           discountScore * w.discount + deliveryScore * w.delivery) / wSum
        : 50;

      var out = {};
      for (var k in item) out[k] = item[k];
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

  window.PricePilotScoring = {
    computeScores: computeScores,
    DEFAULT_WEIGHTS: DEFAULT_WEIGHTS
  };
})();
