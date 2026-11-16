"use strict";
// The manifest, the files it names, and the module contract in CONTRACT.md.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, read, load } = require("./helpers");

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));
const SOURCES = ["background.js"]
  .concat(fs.readdirSync(path.join(ROOT, "lib")).map((f) => "lib/" + f))
  .concat(fs.readdirSync(path.join(ROOT, "content")).map((f) => "content/" + f))
  .concat(["popup/popup.js"]);
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

test("manifest: MV3 basics", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.ok(manifest.name && manifest.name.length <= 75);       // Chrome Web Store limit
  assert.ok(manifest.description && manifest.description.length <= 132);
  assert.equal(typeof manifest.background.service_worker, "string");
  assert.equal(manifest.background.scripts, undefined);          // MV2 leftovers
  assert.equal(manifest.browser_action, undefined);
  assert.equal(manifest.content_security_policy, undefined);     // no loosened CSP
});

test("manifest: every file it names exists", () => {
  const files = [manifest.background.service_worker, manifest.action.default_popup];
  manifest.content_scripts.forEach((cs) => files.push(...cs.js));
  files.forEach((f) => assert.ok(exists(f), "missing " + f));
});

test("manifest: popup loads local scripts only, and they exist", () => {
  const html = read("popup/popup.html");
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0);
  srcs.forEach((s) => {
    assert.ok(!/^(https?:)?\/\//.test(s), "remote script " + s);
    assert.ok(exists(path.join("popup", s)), "missing popup script " + s);
  });
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>\s*\S/.test(html), "inline script is blocked by the MV3 CSP");
});

test("manifest: permissions match the chrome APIs the code calls", () => {
  const NEEDS = { storage: "storage", alarms: "alarms", notifications: "notifications" }; // api -> permission
  const FREE = new Set(["runtime", "action", "tabs"]); // tabs.create needs no permission
  const used = new Set();
  SOURCES.forEach((f) => { for (const m of read(f).matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) used.add(m[1]); });
  for (const api of used) {
    if (FREE.has(api)) continue;
    assert.ok(NEEDS[api], "code uses chrome." + api + ": add it to this test and to the manifest");
    assert.ok(manifest.permissions.includes(NEEDS[api]), "missing permission " + NEEDS[api]);
  }
  for (const p of manifest.permissions) {
    assert.ok([...used].some((api) => NEEDS[api] === p), "unused permission " + p);
  }
});

test("manifest: host access is limited to the store domains, over https", () => {
  const allowed = /^https:\/\/\*\.(amazon\.in|amazon\.com|flipkart\.com|zomato\.com|swiggy\.com)\/\*$/;
  const hosts = manifest.host_permissions.concat(...manifest.content_scripts.map((cs) => cs.matches));
  hosts.forEach((h) => assert.match(h, allowed));
  assert.ok(!hosts.includes("<all_urls>"));
});

test("privacy rule: source code names no host outside the store domains", () => {
  const ok = /(^|\.)(amazon\.in|amazon\.com|flipkart\.com|zomato\.com|swiggy\.com)$/;
  SOURCES.forEach((f) => {
    for (const m of read(f).matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
      assert.match(m[1].toLowerCase(), ok, f + " names " + m[1]);
    }
  });
});

test("privacy rule: no affiliate tags, cookie edits, eval or remote code", () => {
  SOURCES.forEach((f) => {
    const src = read(f);
    assert.ok(!/[?&]tag=|affid=|affExtParam/i.test(src), f + ": affiliate parameter");
    assert.ok(!/document\.cookie|chrome\.cookies/.test(src), f + ": cookie access");
    assert.ok(!/\beval\s*\(|new Function\s*\(/.test(src), f + ": eval");
    assert.ok(!/sendBeacon|google-analytics|gtag\(/.test(src), f + ": telemetry");
  });
});

test("privacy rule: every fetch in the code omits cookies", () => {
  ["background.js", "lib/crossstore.js"].forEach((f) => {
    const calls = [...read(f).matchAll(/\bfetch\(([^;]*?)\);/g)].map((m) => m[1]);
    assert.ok(calls.length > 0, f);
    calls.forEach((c) => assert.match(c, /credentials:\s*"omit"/, f + ": fetch(" + c + ")"));
  });
});

test("contract: content script load order", () => {
  const LIBS = ["lib/scoring.js", "lib/history.js", "lib/offers.js", "lib/reviews.js", "lib/unitprice.js", "lib/food.js", "content/common.js"];
  const sites = { amazon: 0, flipkart: 0, zomato: 0, swiggy: 0 };
  manifest.content_scripts.forEach((cs) => {
    const site = /content\/(\w+)\.js/.exec(cs.js[LIBS.length])[1];
    assert.deepEqual(cs.js, LIBS.concat(["content/" + site + ".js", "content/overlay.js"]));
    assert.ok(cs.matches.every((m) => m.includes(site)), site + " script matches " + cs.matches);
    sites[site]++;
  });
  assert.deepEqual(sites, { amazon: 1, flipkart: 1, zomato: 1, swiggy: 1 });
});

test("contract: every library attaches its global with the documented functions", () => {
  const g = load(["lib/scoring.js", "lib/history.js", "lib/offers.js", "lib/reviews.js", "lib/unitprice.js", "lib/food.js", "lib/crossstore.js", "content/common.js"]).g;
  const API = {
    PricePilotHistory: ["addPoint", "getHistory", "analyze"],
    PricePilotCross: ["searchAll", "extractPriceFromHtml"],
    PricePilotOffers: ["parseOffers", "bestNetPrice"],
    PricePilotReviews: ["bayesian", "assess"],
    PricePilotUnit: ["parseUnit", "perUnit"],
    PricePilotScoring: ["computeScores"],
    PricePilotFood: ["normalizeName", "restaurantKey", "parseCart", "matchAcrossApps"],
    PricePilotCommon: ["upsertItem", "normalizeItem"],
  };
  for (const [name, fns] of Object.entries(API)) {
    assert.equal(typeof g[name], "object", name + " missing");
    fns.forEach((fn) => assert.equal(typeof g[name][fn], "function", name + "." + fn));
  }
});

test("contract: all scripts are classic scripts and parse", () => {
  const vm = require("node:vm");
  SOURCES.forEach((f) => {
    const src = read(f);
    assert.ok(!/^\s*(import\s|export\s)/m.test(src), f + " uses import/export");
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }));
  });
});

test("contract: analyze returns the documented shape and a known verdict", () => {
  const H = load(["lib/history.js"]).g.PricePilotHistory;
  const a = H.analyze([{ t: "2026-10-01T00:00:00Z", p: 10 }, { t: "2026-10-10T00:00:00Z", p: 12 }, { t: "2026-10-20T00:00:00Z", p: 11 }], 11, 20);
  assert.deepEqual(Object.keys(a).sort(),
    ["daysCovered", "highest", "lowest", "lowestAt", "median", "pointCount", "reasons", "trueDiscountPct", "verdict"]);
  assert.ok(["great", "good", "fair", "wait", "fake-discount", "insufficient-data"].includes(a.verdict));
});

test("contract: parsed offers have exactly the documented fields", () => {
  const O = load(["lib/offers.js"]).g.PricePilotOffers;
  const o = O.parseOffers(["10% Instant Discount up to ₹1,500 on HDFC Bank Credit Card"])[0];
  assert.deepEqual(Object.keys(o).sort(), ["bank", "cardType", "flat", "kind", "maxDiscount", "minSpend", "pct", "raw"]);
  assert.ok(["instant", "cashback", "emi", "other"].includes(o.kind));
  assert.ok(["credit", "debit", "any"].includes(o.cardType));
});

test("web tool: compare.html is the current build of its source and the libraries", () => {
  const libs = ["offers", "reviews", "unitprice", "scoring"].map((f) => `/* lib/${f}.js */\n` + read(`lib/${f}.js`)).join("\n");
  const expected = read("web/compare.src.html").replace("/*__LIBS__*/", () => libs);
  assert.ok(read("web/compare.html") === expected, "web/compare.html is stale: run `npm run build:web`");
});
