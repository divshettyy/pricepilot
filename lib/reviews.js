// PricePilot reviews — volume-aware rating and simple, labeled authenticity heuristics.
// These are heuristics, not fraud detection. Flags tell the user where to look.
(function (g) {
  "use strict";

  function bayesian(rating, count, prior, m) {
    if (rating == null) return null;
    if (prior == null) prior = 3.9;
    if (m == null) m = 50;
    if (count == null || count < 0) return rating;
    var v = (count * rating + m * prior) / (count + m);
    return Math.round(v * 100) / 100;
  }

  function assess(item) {
    item = item || {};
    var rating = item.rating, count = item.ratingCount, hist = item.ratingHistogram;
    if (rating == null) return { adjustedRating: null, trust: "unknown", flags: [] };

    var adjusted = bayesian(rating, count);
    var flags = [];

    if (count != null && count < 30) flags.push("Few ratings");
    if (hist && hist[5] != null && hist[1] != null && hist[5] >= 70 && hist[1] >= 15) {
      flags.push("Polarized ratings, check 1-star reviews");
    }
    if (hist && hist[5] != null && hist[5] >= 90 && count != null && count < 500) {
      flags.push("Unusually perfect ratings");
    }
    if (count != null && rating - adjusted >= 0.4) flags.push("Rating inflated by low volume");

    var trust;
    if (count == null) trust = "unknown";
    else if (flags.length >= 2 || count < 10) trust = "low";
    else if (flags.length === 1 || count < 200) trust = "medium";
    else trust = "high";

    return { adjustedRating: adjusted, trust: trust, flags: flags };
  }

  g.PricePilotReviews = { bayesian: bayesian, assess: assess };
})(typeof self !== "undefined" ? self : window);
