"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain, daysAgo } = require("./helpers");

const H = () => load(["lib/history.js"]);
const pts = (pairs) => pairs.map(([d, p]) => ({ t: daysAgo(d), p }));

test("analyze: lowest, highest, median, lowestAt, days covered", () => {
  const { g } = H();
  const a = g.PricePilotHistory.analyze(pts([[30, 1000], [20, 800], [10, 1200], [0, 900]]), 900, null);
  assert.equal(a.lowest, 800);
  assert.equal(a.highest, 1200);
  assert.equal(a.median, 950); // even count: mean of the two middle values
  assert.equal(a.lowestAt, daysAgo(20));
  assert.equal(a.pointCount, 4);
  assert.equal(a.daysCovered, 30);
});

test("analyze: trueDiscountPct is measured against the median, not the MRP", () => {
  const { g } = H();
  const a = g.PricePilotHistory.analyze(pts([[20, 1000], [10, 1000], [5, 1000], [0, 800]]), 800, 5000 / 4);
  assert.equal(a.median, 1000);
  assert.equal(a.trueDiscountPct, 20);
});

test("analyze: points are sorted by time before use", () => {
  const { g } = H();
  const a = g.PricePilotHistory.analyze(pts([[0, 900], [30, 1000], [10, 1200]]), null, null);
  assert.equal(a.daysCovered, 30);
  assert.equal(a.verdict, "great"); // current price defaults to the newest point (900 = lowest)
});

test("analyze: fewer than 3 points or under 3 days is insufficient-data", () => {
  const { g } = H();
  const an = g.PricePilotHistory.analyze;
  assert.equal(an(pts([[10, 100], [0, 90]]), 90, null).verdict, "insufficient-data");
  assert.equal(an(pts([[2, 100], [1, 95], [0, 90]]), 90, null).verdict, "insufficient-data");
  assert.equal(an([], 90, null).verdict, "insufficient-data");
  assert.equal(an(null, 90, null).pointCount, 0);
});

test("analyze: verdict thresholds great / good / fair / wait", () => {
  const { g } = H();
  const an = g.PricePilotHistory.analyze;
  const base = [[40, 1000], [30, 1000], [20, 1000], [10, 700]]; // lowest 700, median 1000
  assert.equal(an(pts(base), 714, null).verdict, "great");   // <= lowest x 1.02
  assert.equal(an(pts(base), 715, null).verdict, "good");    // above 714, <= median x 0.95
  assert.equal(an(pts(base), 950, null).verdict, "good");
  assert.equal(an(pts(base), 951, null).verdict, "fair");
  assert.equal(an(pts(base), 1079, null).verdict, "fair");
  assert.equal(an(pts(base), 1080, null).verdict, "wait");   // >= median x 1.08
});

test("analyze: inflated MRP is a fake discount, even with little history", () => {
  const { g } = H();
  const an = g.PricePilotHistory.analyze;
  const few = an(pts([[1, 1000], [0, 1000]]), 1000, 1601);
  assert.equal(few.verdict, "fake-discount");
  assert.match(few.reasons[0], /MRP/);
  assert.equal(an(pts([[1, 1000], [0, 1000]]), 1000, 1600).verdict, "insufficient-data"); // exactly 1.6x is allowed
});

test("analyze: price hiked before the sale is a fake discount", () => {
  const { g } = H();
  const an = g.PricePilotHistory.analyze;
  // 1000 for weeks, hiked to 1300 a week ago, "sale" back to 1000 today.
  const hike = pts([[40, 1000], [30, 1000], [12, 1000], [7, 1300], [0, 1000]]);
  const a = an(hike, 1000, null);
  assert.equal(a.verdict, "fake-discount");
  assert.match(a.reasons.join(" "), /hiked before sale/i);
  // Same hike, but the sale goes clearly below the earlier typical price: a real drop.
  const real = pts([[40, 1000], [30, 1000], [12, 1000], [7, 1300], [0, 800]]);
  assert.notEqual(an(real, 800, null).verdict, "fake-discount");
  // A rise under 15% is not a hike.
  const small = pts([[40, 1000], [30, 1000], [12, 1000], [7, 1100], [0, 1000]]);
  assert.notEqual(an(small, 1000, null).verdict, "fake-discount");
});

test("analyze: bad points are ignored", () => {
  const { g } = H();
  const a = g.PricePilotHistory.analyze(
    [{ t: daysAgo(9), p: 100 }, { t: daysAgo(5), p: "abc" }, null, { p: 5 }, { t: daysAgo(0), p: 90 }], 90, null);
  assert.equal(a.pointCount, 2);
  assert.equal(a.lowest, 90);
});

test("addPoint: skips an unchanged price inside 12 hours, records a change", async () => {
  const { g, local } = H();
  const Hx = g.PricePilotHistory;
  await Hx.addPoint("u", 500);
  await Hx.addPoint("u", 500);
  assert.equal(local.priceHistory.u.length, 1);
  await Hx.addPoint("u", "480");
  assert.deepEqual(local.priceHistory.u.map((x) => x.p), [500, 480]); // stored as numbers
});

test("addPoint: unchanged price is recorded again after 12 hours", async () => {
  const { g, local } = H();
  local.priceHistory = { u: [{ t: new Date(Date.now() - 13 * 3600 * 1000).toISOString(), p: 500 }] };
  await g.PricePilotHistory.addPoint("u", 500);
  assert.equal(local.priceHistory.u.length, 2);
});

test("addPoint: rejects empty url and non-numeric prices, caps at 365 points", async () => {
  const { g, local } = H();
  const Hx = g.PricePilotHistory;
  await Hx.addPoint("", 5);
  await Hx.addPoint("u", null);
  await Hx.addPoint("u", "abc");
  await Hx.addPoint("u", NaN);
  assert.equal(local.priceHistory, undefined);
  local.priceHistory = { u: Array.from({ length: 365 }, (_, i) => ({ t: daysAgo(400 - i), p: i })) };
  await Hx.addPoint("u", 9999);
  assert.equal(local.priceHistory.u.length, 365);
  assert.equal(local.priceHistory.u[0].p, 1);        // oldest dropped
  assert.equal(local.priceHistory.u[364].p, 9999);
});

test("getHistory: unknown url gives [], storage failure does not throw", async () => {
  const { g, warnings } = H();
  assert.deepEqual(plain(await g.PricePilotHistory.getHistory("nope")), []);
  g.chrome.storage.local.get = async () => { throw new Error("context invalidated"); };
  assert.deepEqual(plain(await g.PricePilotHistory.getHistory("u")), []);
  await g.PricePilotHistory.addPoint("u", 5); // must not reject
  assert.equal(warnings.length, 2);
});
