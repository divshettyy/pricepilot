"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain } = require("./helpers");

const g = load(["lib/scoring.js", "lib/offers.js", "lib/reviews.js", "lib/unitprice.js"]).g;
const U = g.PricePilotUnit, R = g.PricePilotReviews, S = g.PricePilotScoring;
const unit = (t) => plain(U.parseUnit(t));

test("parseUnit: weights and volumes convert to g / ml", () => {
  assert.deepEqual(unit("Tata Salt 1 kg"), { qty: 1000, unit: "g" });
  assert.deepEqual(unit("Aashirvaad Atta, 5kg"), { qty: 5000, unit: "g" });
  assert.deepEqual(unit("Maggi Noodles 420 g"), { qty: 420, unit: "g" });
  assert.deepEqual(unit("Bru Coffee 200gm jar"), { qty: 200, unit: "g" });
  assert.deepEqual(unit("Coca-Cola 1.25 L bottle"), { qty: 1250, unit: "ml" });
  assert.deepEqual(unit("Dettol Handwash 750ml"), { qty: 750, unit: "ml" });
  assert.deepEqual(unit("Fortune Oil 1 Litre pouch"), { qty: 1000, unit: "ml" });
});

test("parseUnit: multipacks", () => {
  assert.deepEqual(unit("Amul Butter 4 x 100 g"), { qty: 400, unit: "g" });
  assert.deepEqual(unit("Red Bull 6×250ml"), { qty: 1500, unit: "ml" });
  assert.deepEqual(unit("Dove Soap 125 g (Pack of 3)"), { qty: 375, unit: "g" });
  assert.deepEqual(unit("Gillette Blades Pack of 8"), { qty: 8, unit: "pc" });
  assert.deepEqual(unit("Duracell AA 10 pcs"), { qty: 10, unit: "pc" });
});

test("parseUnit: storage takes the largest size and ignores pack count", () => {
  assert.deepEqual(unit("Redmi Note 13 (8 GB RAM, 128 GB ROM)"), { qty: 128, unit: "GB" });
  assert.deepEqual(unit("Samsung T7 1TB SSD"), { qty: 1024, unit: "GB" });
  assert.deepEqual(unit("SanDisk 64 GB Pendrive, Pack of 2"), { qty: 64, unit: "GB" });
});

test("parseUnit: nothing to parse", () => {
  assert.equal(U.parseUnit("Sony WH-1000XM5 Headphones"), null);
  assert.equal(U.parseUnit(""), null);
  assert.equal(U.parseUnit(null), null);
});

test("perUnit: price per 100 g / 100 ml / piece / GB", () => {
  assert.deepEqual(plain(U.perUnit(250, { qty: 500, unit: "g" })), { value: 50, label: "₹/100g" });
  assert.deepEqual(plain(U.perUnit(99, { qty: 750, unit: "ml" })), { value: 13.2, label: "₹/100ml" });
  assert.deepEqual(plain(U.perUnit(100, { qty: 8, unit: "pc" })), { value: 12.5, label: "₹/pc" });
  assert.deepEqual(plain(U.perUnit(6400, { qty: 128, unit: "GB" })), { value: 50, label: "₹/GB" });
  assert.equal(U.perUnit(null, { qty: 1, unit: "g" }), null);
  assert.equal(U.perUnit(10, null), null);
  assert.equal(U.perUnit(10, { qty: 0, unit: "g" }), null);
  assert.equal(U.perUnit(10, { qty: 1, unit: "m" }), null);
});

test("bayesian: few ratings pull towards the prior, many do not", () => {
  assert.equal(R.bayesian(5, 0), 3.9);
  assert.equal(R.bayesian(5, 50), 4.45);           // (50*5 + 50*3.9) / 100
  assert.equal(R.bayesian(4.5, 10000), 4.5);
  assert.equal(R.bayesian(4, 100, 3, 100), 3.5);   // custom prior and weight
  assert.equal(R.bayesian(null, 10), null);
  assert.equal(R.bayesian(4.2, null), 4.2);
  assert.ok(R.bayesian(4.8, 5) < R.bayesian(4.6, 5000)); // the whole point
});

test("assess: trust levels and flags", () => {
  assert.deepEqual(plain(R.assess({})), { adjustedRating: null, trust: "unknown", flags: [] });
  assert.equal(R.assess({ rating: 4.3 }).trust, "unknown");
  const few = plain(R.assess({ rating: 5, ratingCount: 5 }));
  assert.equal(few.trust, "low");
  assert.ok(few.flags.includes("Few ratings"));
  assert.ok(few.flags.includes("Rating inflated by low volume"));
  assert.equal(R.assess({ rating: 4.2, ratingCount: 150 }).trust, "medium");
  const solid = plain(R.assess({ rating: 4.2, ratingCount: 5000, ratingHistogram: { 5: 55, 4: 25, 3: 10, 2: 5, 1: 5 } }));
  assert.deepEqual(solid, { adjustedRating: 4.2, trust: "high", flags: [] });
  const polar = plain(R.assess({ rating: 4.2, ratingCount: 5000, ratingHistogram: { 5: 75, 4: 3, 3: 2, 2: 2, 1: 18 } }));
  assert.deepEqual(polar.flags, ["Polarized ratings, check 1-star reviews"]);
  assert.equal(polar.trust, "medium");
  const perfect = plain(R.assess({ rating: 4.9, ratingCount: 300, ratingHistogram: { 5: 95, 4: 3, 3: 1, 2: 0, 1: 1 } }));
  assert.ok(perfect.flags.includes("Unusually perfect ratings"));
});

const item = (o) => Object.assign({ url: "u", title: "t", price: 100, rating: null, discountPct: null, deliveryFee: null, offers: [] }, o);

test("computeScores: cheapest wins on price weight alone, best pick is first", () => {
  const out = plain(S.computeScores([item({ url: "a", price: 300 }), item({ url: "b", price: 100 }), item({ url: "c", price: 200 })],
    { price: 1, rating: 0, discount: 0, delivery: 0 }));
  assert.deepEqual(out.map((x) => x.url), ["b", "c", "a"]);
  assert.deepEqual(out.map((x) => x.score), [100, 50, 0]);
  assert.deepEqual(out.map((x) => x.isBestPick), [true, false, false]);
});

test("computeScores: rating weight alone ranks by rating; breakdown is reported", () => {
  const out = plain(S.computeScores([item({ url: "a", rating: 3 }), item({ url: "b", rating: 4.5 })],
    { price: 0, rating: 1, discount: 0, delivery: 0 }));
  assert.equal(out[0].url, "b");
  assert.equal(out[0].scoreBreakdown.ratingScore, 90);
  assert.equal(out[1].scoreBreakdown.ratingScore, 60);
});

test("computeScores: volume-aware rating beats a perfect score from 3 ratings", () => {
  const out = plain(S.computeScores([item({ url: "tiny", rating: 5, ratingCount: 3 }), item({ url: "proven", rating: 4.5, ratingCount: 8000 })],
    { price: 0, rating: 1, discount: 0, delivery: 0 }));
  assert.equal(out[0].url, "proven");
  assert.equal(out[1].adjustedRating, 3.96);
});

test("computeScores: card net price changes the ranking only for a matching card", () => {
  const offers = plain(g.PricePilotOffers.parseOffers(["10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card"]));
  const items = [item({ url: "a", price: 10500, offers }), item({ url: "b", price: 10000 })];
  const w = { price: 1, rating: 0, discount: 0, delivery: 0 };
  const without = plain(S.computeScores(items, w));
  assert.equal(without[0].url, "b");
  assert.equal(without[1].effectivePrice, 10500);
  const withCard = plain(S.computeScores(items, w, { cards: [{ bank: "HDFC", cardType: "credit" }] }));
  assert.equal(withCard[0].url, "a");
  assert.equal(withCard[0].effectivePrice, 9450);
  assert.equal(withCard[0].price, 10500); // the listed price is not overwritten
});

test("computeScores: weights, missing values and edge cases", () => {
  assert.deepEqual(plain(S.computeScores([], {})), []);
  assert.deepEqual(plain(S.computeScores(null, {})), []);
  // all-zero weights fall back to the defaults instead of dividing by zero
  const d = plain(S.computeScores([item({ url: "a", price: 100 }), item({ url: "b", price: 200 })], { price: 0, rating: 0, discount: 0, delivery: 0 }));
  assert.equal(d[0].url, "a");
  assert.ok(Number.isFinite(d[0].score) && Number.isFinite(d[1].score));
  assert.equal(Math.round((S.DEFAULT_WEIGHTS.price + S.DEFAULT_WEIGHTS.rating + S.DEFAULT_WEIGHTS.discount + S.DEFAULT_WEIGHTS.delivery) * 100), 100);
  // an item without a price gets the neutral 50, not the top score
  const np = plain(S.computeScores([item({ url: "none", price: null }), item({ url: "cheap", price: 100 }), item({ url: "dear", price: 200 })],
    { price: 1, rating: 0, discount: 0, delivery: 0 }));
  assert.deepEqual(np.map((x) => x.url), ["cheap", "none", "dear"]);
  // discount is clamped to 0-100, lower delivery fee scores higher
  const c = plain(S.computeScores([item({ url: "a", discountPct: 250, deliveryFee: 0 }), item({ url: "b", discountPct: -5, deliveryFee: 80 })],
    { price: 0, rating: 0, discount: 1, delivery: 1 }));
  assert.equal(c[0].scoreBreakdown.discountScore, 100);
  assert.equal(c[1].scoreBreakdown.discountScore, 0);
  assert.equal(c[0].scoreBreakdown.deliveryScore, 100);
  assert.equal(c[1].scoreBreakdown.deliveryScore, 0);
});

test("computeScores: input items are not mutated", () => {
  const a = item({ url: "a" });
  const before = JSON.stringify(a);
  S.computeScores([a, item({ url: "b", price: 50 })], {});
  assert.equal(JSON.stringify(a), before);
});
