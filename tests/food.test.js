"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain } = require("./helpers");

const F = load(["lib/food.js"]).g.PricePilotFood;
const cart = (t) => plain(F.parseCart(t));

test("normalizeName / restaurantKey", () => {
  assert.equal(F.normalizeName("The Meghana Foods Restaurant & Bar Pvt. Ltd."), "meghana foods bar");
  assert.equal(F.normalizeName("Café Délice"), "cafe delice");
  assert.equal(F.normalizeName(null), "");
  assert.equal(F.restaurantKey("Meghana Foods", "Koramangala"), "meghana foods|koramangala");
  assert.equal(F.restaurantKey("Meghana Foods"), "meghana foods|");
});

test("parseCart: Swiggy layout, label and amount on separate lines", () => {
  assert.deepEqual(cart("Bill Details\nItem Total\n₹438\nDelivery Fee | 3.2 kms\n₹45\nPlatform fee\n₹10\nGST and Restaurant Charges\n₹42.15\nTO PAY\n₹535"),
    { itemTotal: 438, packaging: null, platformFee: 10, deliveryFee: 45, gst: 42.15, discount: null, grandTotal: 535 });
});

test("parseCart: Zomato layout, struck-through price first, FREE delivery", () => {
  assert.deepEqual(cart("Bill Summary\nItem total ₹520 ₹468\nDelivery partner fee FREE\nPlatform fee ₹6\nGST & restaurant charges ₹31.40\nGrand Total ₹505.40"),
    { itemTotal: 468, packaging: null, platformFee: 6, deliveryFee: 0, gst: 31.4, discount: null, grandTotal: 505.4 });
});

test("parseCart: discount is stored as a positive amount", () => {
  assert.deepEqual(cart("Item Total ₹300\nItem Discount -₹60\nPackaging charges ₹20\nTaxes ₹18\nTo Pay ₹278"),
    { itemTotal: 300, packaging: 20, platformFee: null, deliveryFee: null, gst: 18, discount: 60, grandTotal: 278 });
});

test("parseCart: 'Rs' form with thousands separators", () => {
  assert.deepEqual(cart("Subtotal Rs. 1,250\nDelivery Fee Rs 0\nRestaurant Packaging Charges Rs 40\nYou saved Rs 125\nTotal Rs. 1,165"),
    { itemTotal: 1250, packaging: 40, platformFee: null, deliveryFee: 0, gst: null, discount: 125, grandTotal: 1165 });
});

test("parseCart: too little to be a bill", () => {
  assert.equal(F.parseCart("Delivery Fee ₹30"), null);
  assert.equal(F.parseCart("Paneer Tikka ₹240\nAdd to cart"), null);
  assert.equal(F.parseCart(""), null);
  assert.equal(F.parseCart(null), null);
});

test("parseCart: 'rs' inside a word is not a currency", () => {
  // "for 2 orders 3 km" must not read as "Rs 3"
  const c = cart("Item Total ₹400\nDelivery fee for 2 orders 3 km\n₹45\nTo Pay ₹445");
  assert.equal(c.deliveryFee, 45);
});

test("parseCart: the last total on the page wins", () => {
  assert.equal(cart("Item Total ₹400\nTotal ₹430\nGST ₹20\nTo Pay ₹450").grandTotal, 450);
});

const z = (o) => Object.assign({ site: "zomato", title: "Meghana Foods", locality: "Koramangala", price: 300, deliveryFee: 0, discountPct: null, cart: null }, o);
const s = (o) => Object.assign({ site: "swiggy", title: "Meghana Foods", locality: "Koramangala", price: 300, deliveryFee: 0, discountPct: null, cart: null }, o);

test("matchAcrossApps: same restaurant pairs up, cheaper app and difference reported", () => {
  const out = plain(F.matchAcrossApps([z({ price: 320, deliveryFee: 30 }), s({ price: 300, deliveryFee: 20 })]));
  assert.equal(out.length, 1);
  assert.equal(out[0].key, "meghana foods|koramangala");
  assert.equal(out[0].cheaper, "swiggy");
  assert.equal(out[0].diff, 30);
  assert.equal(out[0].basis, "estimate");
});

test("matchAcrossApps: cart totals are used when both apps have a bill", () => {
  const out = plain(F.matchAcrossApps([
    z({ price: 100, cart: { grandTotal: 505.4 } }),
    s({ price: 900, cart: { grandTotal: 535 } }),
  ]));
  assert.equal(out[0].basis, "cart");
  assert.equal(out[0].cheaper, "zomato");
  assert.equal(out[0].diff, 29.6);
  // one bill only: falls back to the estimate
  const mixed = plain(F.matchAcrossApps([z({ price: 100, cart: { grandTotal: 505.4 } }), s({ price: 900 })]));
  assert.equal(mixed[0].basis, "estimate");
  assert.equal(mixed[0].cheaper, "zomato");
});

test("matchAcrossApps: under one rupee apart is 'same'; percent discount is capped at 150", () => {
  assert.equal(F.matchAcrossApps([z({ price: 300.5 }), s({ price: 300 })])[0].cheaper, "same");
  const capped = plain(F.matchAcrossApps([z({ price: 1000, discountPct: 60 }), s({ price: 800 })]));
  assert.equal(capped[0].zomatoTotal, 850); // 1000 - min(600, 150)
  assert.equal(capped[0].cheaper, "swiggy");
});

test("matchAcrossApps: different restaurants or localities do not pair", () => {
  assert.deepEqual(plain(F.matchAcrossApps([z({}), s({ title: "Empire Restaurant" })])), []);
  assert.deepEqual(plain(F.matchAcrossApps([z({}), s({ locality: "Indiranagar" })])), []);
  assert.deepEqual(plain(F.matchAcrossApps([z({})])), []);
  assert.deepEqual(plain(F.matchAcrossApps(null)), []);
});

test("matchAcrossApps: a Swiggy item is used for one pair only", () => {
  const out = F.matchAcrossApps([z({}), z({ url: "second" }), s({})]);
  assert.equal(out.length, 1);
});

test("matchAcrossApps: missing price gives no winner", () => {
  const out = plain(F.matchAcrossApps([z({ price: null }), s({})]));
  assert.equal(out[0].cheaper, "same");
  assert.equal(out[0].diff, 0);
});

test("scanPage: rating, count, median menu price, fee and best discount", () => {
  const text = "Meghana Foods\n4.4\n(12.5K+ ratings)\n60% OFF up to ₹120\nChicken Biryani\n₹320\nPaneer Biryani\n₹280\nMutton Biryani\n₹420\n20% OFF\nDelivery Fee ₹35\nBill Details\nItem Total ₹9999\nTo Pay ₹10500";
  const r = plain(F.scanPage(text));
  assert.equal(r.rating, 4.4);
  assert.equal(r.ratingCount, 12500);
  assert.equal(r.price, 300);       // median of 280, 320, 420 and the 35 fee; cap and bill amounts excluded
  assert.equal(r.deliveryFee, 35);
  assert.equal(r.discountPct, 60);
  assert.deepEqual(r.offerTexts, ["60% OFF up to ₹120", "20% OFF"]);
  assert.deepEqual(plain(F.scanPage("")), { price: null, rating: null, ratingCount: null, discountPct: null, deliveryFee: null, offerTexts: [] });
  assert.equal(F.scanPage("Delivery Partner Fee FREE").deliveryFee, 0);
});

test("parseTitle and localityFromSlug", () => {
  assert.deepEqual(plain(F.parseTitle("Order Food Online from Meghana Foods, Koramangala, Bangalore | Zomato", "Zomato", "Bangalore")),
    { name: "Meghana Foods", locality: "Koramangala" });
  assert.deepEqual(plain(F.parseTitle("Meghana Foods - Residency Road, Ashok Nagar, Bangalore | Swiggy", "Swiggy", "Bangalore")),
    { name: "Meghana Foods", locality: "Residency Road" });
  assert.deepEqual(plain(F.parseTitle("Meghana Foods | Swiggy", "Swiggy", "Bangalore")), { name: "Meghana Foods", locality: null });
  assert.equal(F.localityFromSlug("meghana-foods-residency-road-bangalore-rest3241", "Meghana Foods", "Bangalore"), "residency road");
  assert.equal(F.localityFromSlug("something-else-12", "Meghana Foods", "Bangalore"), null);
  assert.equal(F.localityFromSlug("", "Meghana Foods", "Bangalore"), null);
});
