"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { load, plain } = require("./helpers");

const O = load(["lib/offers.js"]).g.PricePilotOffers;
const one = (t) => plain(O.parseOffers([t]))[0];
const HDFC10 = "10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Min purchase value ₹5,000";

test("parseOffers: percent offer with cap, minimum spend and card type", () => {
  const o = one(HDFC10);
  assert.deepEqual(
    { bank: o.bank, kind: o.kind, pct: o.pct, flat: o.flat, maxDiscount: o.maxDiscount, minSpend: o.minSpend, cardType: o.cardType },
    { bank: "HDFC", kind: "instant", pct: 10, flat: null, maxDiscount: 1500, minSpend: 5000, cardType: "credit" });
  assert.equal(o.raw, HDFC10);
});

test("parseOffers: flat amount, debit card", () => {
  const o = one("Flat ₹750 off on ICICI Bank Debit Cards");
  assert.equal(o.bank, "ICICI");
  assert.equal(o.kind, "instant");
  assert.equal(o.flat, 750);
  assert.equal(o.pct, null);
  assert.equal(o.cardType, "debit");
});

test("parseOffers: number and currency formats", () => {
  assert.equal(one("Flat Rs. 1,250 off on SBI Credit Cards").flat, 1250);
  assert.equal(one("Flat INR 2000 off on Kotak Bank Cards").flat, 2000);
  assert.equal(one("Rs 500 instant discount on Axis Bank Credit Cards").flat, 500);
  assert.equal(one("7.5% off up to Rs.1,00,000 on HSBC Credit Cards").pct, 7.5);
  assert.equal(one("7.5% off up to Rs.1,00,000 on HSBC Credit Cards").maxDiscount, 100000); // Indian grouping
  assert.equal(one("10% off on orders above ₹2,999 with RBL Bank cards").minSpend, 2999);
  assert.equal(one("5% off, minimum transaction of Rs 3,000, Yes Bank Debit Card").minSpend, 3000);
});

test("parseOffers: 'rs' inside a word is not a currency", () => {
  // "members 500 off" must not read as "Rs 500 off"
  const o = one("5% back for Prime members 500 off coupons excluded, HDFC Bank Credit Card");
  assert.equal(o.pct, 5);
  assert.equal(o.flat, null);
  assert.deepEqual(plain(O.parseOffers(["Top offers 2024 on HDFC Bank cards"])), []);
});

test("parseOffers: a ceiling without a percent is not a guaranteed flat saving", () => {
  const o = one("Up to ₹1,500 discount on SBI Credit Cards");
  assert.equal(o.flat, null);
  assert.equal(o.maxDiscount, 1500);
  assert.equal(O.bestNetPrice(20000, [o], [{ bank: "SBI", cardType: "credit" }]), null);
});

test("parseOffers: cashback, EMI and non-offers", () => {
  const cb = one("5% Cashback on Flipkart Axis Bank Card");
  assert.equal(cb.bank, "Flipkart Axis");
  assert.equal(cb.kind, "cashback");
  assert.equal(cb.cardType, "any");
  assert.equal(one("No Cost EMI on Bajaj Finserv EMI Card").kind, "emi");
  assert.deepEqual(plain(O.parseOffers(["Free delivery tomorrow", "", null, "short"])), []);
});

test("parseOffers: co-branded and multi-word banks resolve before their parent", () => {
  assert.equal(one("5% back on Amazon Pay ICICI Bank credit card").bank, "Amazon Pay ICICI");
  assert.equal(one("10% off on IDFC FIRST Bank Credit Cards").bank, "IDFC First");
  assert.equal(one("10% off on Bank of Baroda Credit Cards").bank, "Bank of Baroda");
  assert.equal(one("10% off with AMEX credit cards").bank, "American Express");
  assert.equal(one("10% off on State Bank of India debit cards").bank, "SBI");
  assert.equal(one("10% off on select Credit Cards").bank, "Unspecified");
  assert.equal(one("10% off on all orders above ₹500").bank, null);
});

test("parseOffers: splits blocks on newlines and 'Bank Offer', drops duplicates", () => {
  const offers = plain(O.parseOffers([
    "Bank Offer 10% off on HDFC Bank Credit Cards Bank Offer Flat ₹500 off on ICICI Bank Debit Cards",
    "10% off on SBI Credit Cards\n10% off on SBI Credit Cards",
  ]));
  assert.deepEqual(offers.map((o) => o.bank), ["HDFC", "ICICI", "SBI"]);
});

test("bestNetPrice: percent saving is capped", () => {
  const offers = O.parseOffers([HDFC10]);
  const r = plain(O.bestNetPrice(20000, offers, [{ bank: "HDFC", cardType: "credit" }]));
  assert.equal(r.savings, 1500);
  assert.equal(r.netPrice, 18500);
  const under = plain(O.bestNetPrice(6000, offers, [{ bank: "HDFC", cardType: "credit" }]));
  assert.equal(under.savings, 600); // below the cap: plain 10%
  assert.equal(under.netPrice, 5400);
});

test("bestNetPrice: minimum spend, wrong card type, no cards", () => {
  const offers = O.parseOffers([HDFC10]);
  assert.equal(O.bestNetPrice(4999, offers, [{ bank: "HDFC", cardType: "credit" }]), null);
  assert.notEqual(O.bestNetPrice(5000, offers, [{ bank: "HDFC", cardType: "credit" }]), null);
  assert.equal(O.bestNetPrice(20000, offers, [{ bank: "HDFC", cardType: "debit" }]), null);
  assert.equal(O.bestNetPrice(20000, offers, [{ bank: "ICICI", cardType: "credit" }]), null);
  assert.equal(O.bestNetPrice(20000, offers, []), null);
  assert.equal(O.bestNetPrice(20000, offers, null), null);
  assert.equal(O.bestNetPrice(null, offers, [{ bank: "HDFC", cardType: "credit" }]), null);
  assert.equal(O.bestNetPrice(20000, [], [{ bank: "HDFC", cardType: "credit" }]), null);
});

test("bestNetPrice: co-brand rules", () => {
  const cobrand = O.parseOffers(["5% Cashback on Flipkart Axis Bank Card"]);
  // a plain Axis card cannot use a Flipkart Axis offer
  assert.equal(O.bestNetPrice(20000, cobrand, [{ bank: "Axis", cardType: "credit" }]), null);
  assert.equal(plain(O.bestNetPrice(20000, cobrand, [{ bank: "Flipkart Axis", cardType: "credit" }])).savings, 1000);
  // a Flipkart Axis card is an Axis card
  const generic = O.parseOffers(["10% off up to ₹500 on Axis Bank Credit Cards"]);
  assert.equal(plain(O.bestNetPrice(20000, generic, [{ bank: "Flipkart Axis", cardType: "credit" }])).savings, 500);
});

test("bestNetPrice: picks the largest saving, skips EMI, bank-agnostic offers need no card", () => {
  const offers = O.parseOffers([
    "No Cost EMI on HDFC Bank Credit Cards",
    "Flat ₹300 off on HDFC Bank Credit Cards",
    "10% off up to ₹1,000 on HDFC Bank Credit Cards",
    "5% off on all orders above ₹500",
  ]);
  const withCard = plain(O.bestNetPrice(8000, offers, [{ bank: "hdfc bank", cardType: "credit" }]));
  assert.equal(withCard.savings, 800);
  assert.equal(withCard.offer.pct, 10);
  const noCard = plain(O.bestNetPrice(8000, offers, []));
  assert.equal(noCard.savings, 400);
  assert.equal(noCard.offer.bank, null);
});

test("bestNetPrice: a saving never exceeds the price, and is rounded to paise", () => {
  const big = O.parseOffers(["Flat ₹750 off on ICICI Bank Debit Cards"]);
  const r = plain(O.bestNetPrice(500, big, [{ bank: "ICICI", cardType: "debit" }]));
  assert.equal(r.savings, 500);
  assert.equal(r.netPrice, 0);
  const pct = O.parseOffers(["7.5% off on HSBC Credit Cards"]);
  const p = plain(O.bestNetPrice(333, pct, [{ bank: "HSBC", cardType: "credit" }]));
  assert.equal(p.savings, 24.98);
  assert.equal(Math.round((p.netPrice + p.savings) * 100) / 100, 333); // the two parts add up to the price
});

test("BANK_NAMES lists the 18 supported banks", () => {
  assert.equal(O.BANK_NAMES.length, 18);
  assert.equal(new Set(O.BANK_NAMES).size, 18);
});
