// PricePilot offers — parse Indian bank/card offer text and compute the best net price for the user's saved cards.
// Classic script; attaches PricePilotOffers to self (service worker, content script, popup).
//
// Test cases (verified with node, see bottom of repo history):
//  1. "10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card Transactions. Min purchase value ₹5,000"
//     -> {bank:"HDFC", kind:"instant", pct:10, maxDiscount:1500, minSpend:5000, cardType:"credit"}
//  2. "Flat ₹750 off on ICICI Bank Debit Cards" -> {bank:"ICICI", kind:"instant", flat:750, cardType:"debit"}
//  3. "5% Cashback on Flipkart Axis Bank Card" -> {bank:"Flipkart Axis", kind:"cashback", pct:5, cardType:"any"}
//  4. "No Cost EMI on Bajaj Finserv EMI Card" -> {kind:"emi"}
//  5. bestNetPrice(20000, [#1], [{bank:"HDFC",cardType:"credit"}]) -> saving 1500, netPrice 18500
//  6. bestNetPrice(4000, [#1], HDFC credit) -> null (below min spend)
//  7. bestNetPrice(20000, [#1], [{bank:"HDFC",cardType:"debit"}]) -> null (wrong card type)
//  8. bestNetPrice(20000, [#3], [{bank:"Axis",cardType:"credit"}]) -> null (co-brand offer needs the co-brand card)
//  9. bestNetPrice(20000, [generic "10% off up to ₹500 on Axis Bank Credit Cards"], [{bank:"Flipkart Axis",cardType:"credit"}]) -> saving 500
(function (g) {
  "use strict";

  // Order matters: co-branded and multi-word names first.
  var BANKS = [
    { name: "Flipkart Axis", re: /flipkart\s*axis/i, parent: "Axis" },
    { name: "Amazon Pay ICICI", re: /amazon\s*pay\s*icici/i, parent: "ICICI" },
    { name: "IDFC First", re: /idfc(\s*first)?/i },
    { name: "Bank of Baroda", re: /bank\s*of\s*baroda|\bbob\b/i },
    { name: "Standard Chartered", re: /standard\s*chartered|\bstanchart\b/i },
    { name: "American Express", re: /american\s*express|\bamex\b/i },
    { name: "IndusInd", re: /indusind/i },
    { name: "OneCard", re: /one\s*card/i },
    { name: "Federal", re: /\bfederal\s*bank\b/i },
    { name: "Kotak", re: /kotak/i },
    { name: "HDFC", re: /\bhdfc\b/i },
    { name: "ICICI", re: /\bicici\b/i },
    { name: "SBI", re: /\bsbi\b|state\s*bank\s*of\s*india/i },
    { name: "Axis", re: /\baxis\b/i },
    { name: "Yes", re: /\byes\s*bank\b/i },
    { name: "AU", re: /\bau\s*(small\s*finance\s*)?bank\b/i },
    { name: "RBL", re: /\brbl\b/i },
    { name: "HSBC", re: /\bhsbc\b/i }
  ];

  function num(s) {
    if (s == null) return null;
    var n = Number(String(s).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  function canonicalBank(text) {
    if (!text) return null;
    for (var i = 0; i < BANKS.length; i++) {
      if (BANKS[i].re.test(text)) return BANKS[i].name;
    }
    return null;
  }

  function parentOf(bankName) {
    for (var i = 0; i < BANKS.length; i++) {
      if (BANKS[i].name === bankName) return BANKS[i].parent || bankName;
    }
    return bankName;
  }

  function parseOne(raw) {
    var text = String(raw).replace(/\s+/g, " ").trim();
    if (!text) return null;

    var pctM = /(\d+(?:\.\d+)?)\s*%/.exec(text);
    var pct = pctM ? num(pctM[1]) : null;

    var maxM = /up\s*to\s*(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(text);
    var maxDiscount = maxM ? num(maxM[1]) : null;

    var minM = /min(?:imum)?\.?\s*(?:purchase|order|txn|transaction|cart|spend)?\s*(?:value|amount)?\s*(?:of)?\s*(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(text) ||
               /(?:orders?|purchases?|transactions?)\s*(?:of|above|over|worth)\s*(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(text);
    var minSpend = minM ? num(minM[1]) : null;

    var flat = null;
    if (pct == null) {
      var flatM = /flat\s*(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)/i.exec(text) ||
                  /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(?:instant\s*)?(?:off|discount|cashback)/i.exec(text);
      flat = flatM ? num(flatM[1]) : null;
      // "Upto ₹1,500 discount" is a ceiling, not a guaranteed flat amount.
      if (flat != null && maxDiscount === flat && !/flat\s*(?:₹|rs|inr)/i.test(text)) flat = null;
    }

    var hasEmi = /\bemi\b/i.test(text);
    var actionable = pct != null || flat != null || maxDiscount != null;
    var kind;
    if (/cash\s*back/i.test(text) && actionable) kind = "cashback";
    else if (actionable) kind = "instant";
    else if (hasEmi) kind = "emi";
    else kind = "other";

    var credit = /credit/i.test(text), debit = /debit/i.test(text);
    var cardType = credit && !debit ? "credit" : debit && !credit ? "debit" : "any";

    if (kind === "other") return null; // nothing actionable

    var bank = canonicalBank(text);
    // A card offer that names no bank ("on select Credit Cards") is not usable by everyone.
    if (!bank && /\b(bank|credit\s*cards?|debit\s*cards?|cards?)\b/i.test(text)) bank = "Unspecified";

    return {
      raw: text,
      bank: bank,
      kind: kind,
      pct: pct,
      flat: flat,
      maxDiscount: maxDiscount,
      minSpend: minSpend,
      cardType: cardType
    };
  }

  function parseOffers(texts) {
    var out = [];
    var seen = {};
    (texts || []).forEach(function (block) {
      if (!block) return;
      String(block)
        .split(/\n+|(?=Bank Offer)|(?=Partner Offer)/)
        .forEach(function (line) {
          var t = line.replace(/\s+/g, " ").trim();
          if (t.length < 8 || t.length > 400) return;
          if (!/%|₹|rs\.?\s*\d|\bemi\b/i.test(t)) return;
          try {
            var o = parseOne(t);
            if (o && !seen[o.raw]) { seen[o.raw] = true; out.push(o); }
          } catch (e) { /* skip line */ }
        });
    });
    return out;
  }

  function cardMatches(offer, cards) {
    if (!offer.bank) return true; // bank-agnostic offer
    if (!cards || !cards.length) return false;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i] || {};
      var cardBank = canonicalBank(c.bank) || c.bank;
      if (!cardBank) continue;
      var bankOk = cardBank === offer.bank || parentOf(cardBank) === offer.bank;
      var typeOk = offer.cardType === "any" || !c.cardType || c.cardType === offer.cardType;
      if (bankOk && typeOk) return true;
    }
    return false;
  }

  function bestNetPrice(price, offers, cards) {
    if (price == null || !offers || !offers.length) return null;
    var best = null;
    offers.forEach(function (o) {
      if (!o || o.kind === "emi" || o.kind === "other") return;
      if (o.minSpend != null && price < o.minSpend) return;
      if (!cardMatches(o, cards)) return;
      var saving = o.pct != null
        ? Math.min(price * o.pct / 100, o.maxDiscount != null ? o.maxDiscount : Infinity)
        : (o.flat || 0);
      saving = Math.min(saving, price);
      if (saving > 0 && (!best || saving > best.savings)) {
        best = { netPrice: Math.round((price - saving) * 100) / 100, offer: o, savings: Math.round(saving * 100) / 100 };
      }
    });
    return best;
  }

  g.PricePilotOffers = {
    parseOffers: parseOffers,
    bestNetPrice: bestNetPrice,
    canonicalBank: canonicalBank,
    BANK_NAMES: BANKS.map(function (b) { return b.name; })
  };
})(typeof self !== "undefined" ? self : window);
