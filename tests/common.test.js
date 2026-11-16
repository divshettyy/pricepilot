"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain } = require("./helpers");

const L = () => load(["lib/history.js", "content/common.js"]);

test("extractPriceFromText: rupee formats", () => {
  const C = L().g.PricePilotCommon;
  assert.equal(C.extractPriceFromText("₹1,234"), 1234);
  assert.equal(C.extractPriceFromText("Deal price: ₹ 1,09,999.00 incl. taxes"), 109999);
  assert.equal(C.extractPriceFromText("Rs. 499"), 499);
  assert.equal(C.extractPriceFromText("rs 2,050.50"), 2050.5);
  assert.equal(C.extractPriceFromText("M.R.P.: ₹2,999 ₹1,999"), 2999); // first amount
});

test("extractPriceFromText: a bare number is never a price", () => {
  const C = L().g.PricePilotCommon;
  assert.equal(C.extractPriceFromText("4.3 out of 5 stars, 1,234 ratings"), null);
  assert.equal(C.extractPriceFromText("$19.99"), null);
  assert.equal(C.extractPriceFromText("3 offers 500 more results"), null); // "rs" inside a word is not "Rs"
  assert.equal(C.extractPriceFromText("Rs. , see price in cart"), null);
  assert.equal(C.extractPriceFromText(""), null);
  assert.equal(C.extractPriceFromText(null), null);
});

test("extractRatingFromText", () => {
  const C = L().g.PricePilotCommon;
  assert.equal(C.extractRatingFromText("4.3 out of 5 stars"), 4.3);
  assert.equal(C.extractRatingFromText("Rated 5 out of 5"), 5);
  assert.equal(C.extractRatingFromText("1,234 ratings"), null);
  assert.equal(C.extractRatingFromText(null), null);
});

test("cleanUrl drops query string and fragment", () => {
  const C = L().g.PricePilotCommon;
  assert.equal(C.cleanUrl("https://www.amazon.in/dp/B0TEST1234?tag=aff-21&ref=x#reviews"), "https://www.amazon.in/dp/B0TEST1234");
});

test("normalizeItem fills every field of the contract Item", () => {
  const C = L().g.PricePilotCommon;
  const it = plain(C.normalizeItem({ title: "X", site: "amazon", price: 0, rating: 0 }));
  assert.deepEqual(Object.keys(it).sort(), [
    "capturedAt", "cart", "currency", "deliveryFee", "discountPct", "locality", "modelId", "mrp", "offers", "price",
    "rating", "ratingCount", "ratingHistogram", "restaurantKey", "site", "title", "unit", "url",
  ]);
  assert.equal(it.url, "https://www.amazon.in/dp/B0TEST1234"); // from location, cleaned
  assert.equal(it.currency, "INR");
  assert.equal(it.price, 0);   // 0 is a value, not "missing"
  assert.equal(it.rating, 0);
  assert.deepEqual(it.offers, []);
  assert.equal(it.mrp, null);
  assert.ok(!Number.isNaN(Date.parse(it.capturedAt)));
  assert.deepEqual(plain(C.normalizeItem({ offers: "nope" })).offers, []);
});

test("upsertItem: stores, replaces by url, records history, fires the event", async () => {
  const { g, local, events } = L();
  const C = g.PricePilotCommon;
  await C.upsertItem({ url: "https://a/1", title: "one", site: "amazon", price: 100 });
  await C.upsertItem({ url: "https://a/2", title: "two", site: "amazon", price: 200 });
  await C.upsertItem({ url: "https://a/1", title: "one again", site: "amazon", price: 90 });
  assert.deepEqual(local.trackedItems.map((i) => [i.url, i.title, i.price]),
    [["https://a/1", "one again", 90], ["https://a/2", "two", 200]]); // replaced in place
  assert.deepEqual(local.priceHistory["https://a/1"].map((p) => p.p), [100, 90]);
  assert.equal(events.length, 3);
  assert.equal(events[2].type, "pricepilot:item");
  assert.equal(events[2].detail.price, 90);
});

test("upsertItem: no price means no history point", async () => {
  const { g, local } = L();
  await g.PricePilotCommon.upsertItem({ url: "https://a/1", title: "t", site: "zomato", price: null });
  assert.equal(local.trackedItems.length, 1);
  assert.equal(local.priceHistory, undefined);
});

test("upsertItem: keeps the newest 200 items", async () => {
  const { g, local } = L();
  local.trackedItems = Array.from({ length: 200 }, (_, i) => ({ url: "https://a/" + i }));
  await g.PricePilotCommon.upsertItem({ url: "https://a/new", title: "t", site: "amazon", price: 5 });
  assert.equal(local.trackedItems.length, 200);
  assert.equal(local.trackedItems[0].url, "https://a/1");
  assert.equal(local.trackedItems[199].url, "https://a/new");
});

test("upsertItem: a dead extension context does not throw into the page", async () => {
  const { g, warnings, events } = L();
  g.chrome.storage.local.get = async () => { throw new Error("Extension context invalidated"); };
  const it = await g.PricePilotCommon.upsertItem({ url: "https://a/1", title: "t", site: "amazon", price: 5 });
  assert.equal(it.price, 5);
  assert.equal(warnings.length, 1);
  assert.equal(events.length, 1); // the overlay still gets the item
});

test("debounce: many calls, one run with the last arguments", async () => {
  const C = L().g.PricePilotCommon;
  const seen = [];
  const d = C.debounce((x) => seen.push(x), 10);
  d(1); d(2); d(3);
  assert.deepEqual(seen, []);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, [3]);
});
