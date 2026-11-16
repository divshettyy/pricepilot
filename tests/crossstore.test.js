"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain } = require("./helpers");

const X = load(["lib/crossstore.js"]).g.PricePilotCross;

test("extractPriceFromHtml: Amazon core price block beats other prices on the page", () => {
  const html = '<span class="a-price-whole">99</span> sponsored ' +
    '<div id="corePriceDisplay_desktop_feature_div"><span class="a-price-whole">24,999<span class="a-price-decimal">.</span></span></div>';
  assert.equal(X.extractPriceFromHtml("amazon", html), 24999);
  assert.equal(X.extractPriceFromHtml("amazon", '<span class="a-price-whole">1,299</span>'), 1299);
  assert.equal(X.extractPriceFromHtml("amazon", "<html>no price here</html>"), null);
});

test("extractPriceFromHtml: Flipkart price class, then embedded JSON", () => {
  assert.equal(X.extractPriceFromHtml("flipkart", '<div class="Nx9bqj CxhGGd">₹25,490</div>'), 25490);
  assert.equal(X.extractPriceFromHtml("flipkart", '<div class="_30jeq3 _16Jk6d">₹ 1,09,999</div>'), 109999);
  assert.equal(X.extractPriceFromHtml("flipkart", '{"finalPrice":{"currency":"INR","value":18999}}'), 18999);
  assert.equal(X.extractPriceFromHtml("flipkart", '{"price":"749.50"}'), 749.5);
  assert.equal(X.extractPriceFromHtml("flipkart", "<html></html>"), null);
});

test("extractPriceFromHtml: blocked pages, empty input and unknown sites give null", () => {
  assert.equal(X.extractPriceFromHtml("amazon", 'Type the characters you see <span class="a-price-whole">1</span>'), null);
  assert.equal(X.extractPriceFromHtml("flipkart", 'Access Denied <div class="Nx9bqj">₹5</div>'), null);
  assert.equal(X.extractPriceFromHtml("amazon", ""), null);
  assert.equal(X.extractPriceFromHtml("amazon", null), null);
  assert.equal(X.extractPriceFromHtml("zomato", '<span class="a-price-whole">1,299</span>'), null);
});

test("matchScore: same product scores high", () => {
  const s = X.matchScore("Sony WH-1000XM5 Wireless Headphones Black", "Sony WH-1000XM5 Bluetooth Wireless Headphones (Black)");
  assert.ok(s >= 0.5, "got " + s);
  assert.equal(X.matchScore("Apple iPhone 15 128GB Blue", "Apple iPhone 15 128GB Blue"), 1);
});

test("matchScore: near-variants are hard-rejected", () => {
  assert.equal(X.matchScore("Sony WH1000XM4 Headphones", "Sony WH1000XM5 Headphones"), 0);        // model
  assert.equal(X.matchScore("Apple iPhone 15 128GB Blue", "Apple iPhone 15 256GB Blue"), 0);       // capacity
  assert.equal(X.matchScore("Apple iPhone 15 Blue", "Apple iPhone 15 Pro Blue"), 0);               // variant word
  assert.equal(X.matchScore("Samsung Galaxy S24 Ultra", "Samsung Galaxy S24"), 0);
  assert.equal(X.matchScore("", "anything at all"), 0);
  assert.equal(X.matchScore("Sony Headphones", "Prestige Pressure Cooker"), 0);
});

const AMAZON = [
  '<div data-asin="B0AAAAAAA1" data-index="1" data-component-type="s-search-result"><h2 aria-label="Sponsored Boat Rockerz 450 Bluetooth Headphones"><span>x</span></h2><span class="a-icon-alt">4.1 out of 5 stars</span><span class="a-price-whole">1,499</span></div>',
  '<div data-asin="B0AAAAAAA2" data-index="2" data-component-type="s-search-result"><h2 class="t"><span>Sony WH-1000XM5 Wireless Headphones &amp; Case</span></h2><span class="a-icon-alt">4.6 out of 5 stars</span><span class="a-price-whole">26,990</span></div>',
  '<div data-asin="B0AAAAAAA3" data-index="3" data-component-type="s-search-result"><h2><span>Sony WH-1000XM5 Wireless Headphones no price</span></h2></div>',
].join("\n");
const FLIPKART =
  '<a href="/sony-wh-1000xm5-wireless-headphones/p/itmabc123?pid=X" title="Sony WH-1000XM5 Wireless Headphones">x</a><div>4.5<img src="star"></div><div>₹24,990</div>' +
  '<a href="/sony-wh-1000xm5-wireless-headphones/p/itmabc123?pid=X&dup=1">dup</a>' +
  '<a href="/jbl-tune-510/p/itmdef456" title="JBL Tune 510BT Headphones">x</a><div>₹2,999</div>';

function fetchStub(calls) {
  return async (url) => {
    calls.push(String(url));
    const body = String(url).includes("amazon.in") ? AMAZON : FLIPKART;
    return { ok: true, text: async () => body };
  };
}

test("searchAll: parses both stores, keeps matches only, sorts by price", async () => {
  const calls = [];
  const C = load(["lib/crossstore.js"], { fetch: fetchStub(calls) }).g.PricePilotCross;
  const out = plain(await C.searchAll("Sony WH-1000XM5 Wireless Headphones"));
  assert.deepEqual(out.map((r) => [r.site, r.price]), [["flipkart", 24990], ["amazon", 26990]]);
  assert.equal(out[1].title, "Sony WH-1000XM5 Wireless Headphones & Case"); // entity decoded
  assert.equal(out[1].url, "https://www.amazon.in/dp/B0AAAAAAA2");
  assert.equal(out[1].rating, 4.6);
  assert.equal(out[0].url, "https://www.flipkart.com/sony-wh-1000xm5-wireless-headphones/p/itmabc123");
  assert.equal(out[0].rating, 4.5);
  assert.ok(out.every((r) => r.matchScore >= 0.5));
  assert.equal(calls.length, 2);
});

test("searchAll: only the 2 store domains are contacted, query is URL-encoded", async () => {
  const calls = [];
  const C = load(["lib/crossstore.js"], { fetch: fetchStub(calls) }).g.PricePilotCross;
  await C.searchAll("tea & coffee #1");
  assert.deepEqual(calls.sort(), [
    "https://www.amazon.in/s?k=tea%20%26%20coffee%20%231",
    "https://www.flipkart.com/search?q=tea%20%26%20coffee%20%231",
  ]);
});

test("searchAll: excludeSite skips that store; empty query makes no request", async () => {
  const calls = [];
  const C = load(["lib/crossstore.js"], { fetch: fetchStub(calls) }).g.PricePilotCross;
  const out = await C.searchAll("Sony WH-1000XM5 Wireless Headphones", "amazon");
  assert.deepEqual(calls.map((u) => new URL(u).hostname), ["www.flipkart.com"]);
  assert.deepEqual(plain(out).map((r) => r.site), ["flipkart"]);
  calls.length = 0;
  assert.deepEqual(plain(await C.searchAll("", null)), []);
  assert.deepEqual(plain(await C.searchAll(null, null)), []);
  assert.equal(calls.length, 0);
});

test("searchAll: network failure, HTTP error and bot wall all give [] without throwing", async () => {
  const fail = load(["lib/crossstore.js"], { fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual(plain(await fail.g.PricePilotCross.searchAll("Sony WH-1000XM5")), []);
  const http = load(["lib/crossstore.js"], { fetch: async () => ({ ok: false, text: async () => AMAZON }) });
  assert.deepEqual(plain(await http.g.PricePilotCross.searchAll("Sony WH-1000XM5 Wireless Headphones")), []);
  const wall = load(["lib/crossstore.js"], { fetch: async () => ({ ok: true, text: async () => "Enter the captcha " + AMAZON + FLIPKART }) });
  assert.deepEqual(plain(await wall.g.PricePilotCross.searchAll("Sony WH-1000XM5 Wireless Headphones")), []);
});
