"use strict";
// The service worker, run in node `vm` with a fake chrome API and a fake fetch.
// (Playwright routes do not intercept service-worker fetches, so this is the
// only place the watchlist check can be tested without the live network.)
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { read, plain } = require("./helpers");

function area(store) {
  return {
    async get(keys) {
      const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
      return out;
    },
    async set(obj) { for (const k of Object.keys(obj)) store[k] = structuredClone(obj[k]); },
  };
}

function boot(opts = {}) {
  const local = opts.local || {}, sync = opts.sync || {};
  const listeners = {}, notes = [], alarms = {}, fetched = [], tabs = [], badge = [], sleeps = [];
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  const sandbox = {
    console: { warn() {}, log() {}, error() {} },
    AbortController, clearTimeout, URL, structuredClone, btoa,
    setTimeout: (fn, ms) => { sleeps.push(ms); return setTimeout(fn, 0); }, // no real 3 s waits
    fetch: async (url, init) => {
      fetched.push({ url: String(url), init });
      const page = (opts.pages || {})[String(url)];
      if (page === undefined) throw new Error("offline");
      return { ok: page !== 404, text: async () => String(page) };
    },
    chrome: {
      storage: { local: area(local), sync: area(sync), onChanged: on("storageChanged") },
      action: { setBadgeText: (o) => badge.push(o.text), setBadgeBackgroundColor() {} },
      alarms: {
        async get(n) { return alarms[n]; },
        async clear(n) { delete alarms[n]; return true; },
        create(n, o) { alarms[n] = o; },
        onAlarm: on("alarm"),
      },
      notifications: { create: (id, o) => notes.push({ id, title: o.title, message: o.message }), clear() {}, onClicked: on("noteClicked") },
      runtime: { onInstalled: on("installed"), onStartup: on("startup"), onMessage: on("message") },
      tabs: { create: (o) => tabs.push(o.url) },
    },
  };
  sandbox.self = sandbox;
  const ctx = vm.createContext(sandbox);
  sandbox.importScripts = (...files) => files.forEach((f) => vm.runInContext(read(f), ctx, { filename: f }));
  vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
  const send = (msg) => new Promise((resolve) => {
    const keepOpen = listeners.message(msg, {}, resolve);
    if (!keepOpen) resolve(undefined);
  });
  return { ctx, local, sync, listeners, notes, alarms, fetched, tabs, badge, sleeps, send, run: (code) => vm.runInContext(code, ctx) };
}

const AMZ = "https://www.amazon.in/dp/B0TEST1234";
const FK = "https://www.flipkart.com/x/p/itm1";
const amazonPage = (p) => `<div id="corePrice_feature_div"><span class="a-price-whole">${p}</span></div>`;
const flipkartPage = (p) => `<div class="Nx9bqj">₹${p}</div>`;

test("service worker imports only the libraries it uses", () => {
  const src = read("background.js");
  assert.match(src, /importScripts\("lib\/history\.js", "lib\/crossstore\.js"\)/);
});

test("install: storage keys are created once and existing data is kept", async () => {
  const sw = boot({ local: { watchlist: { [AMZ]: { targetPrice: 5 } } } });
  await sw.listeners.installed();
  assert.deepEqual(sw.local.trackedItems, []);
  assert.deepEqual(sw.local.priceHistory, {});
  assert.deepEqual(sw.local.watchlist, { [AMZ]: { targetPrice: 5 } });
  assert.deepEqual(plain(sw.alarms["pp-watch"]), { delayInMinutes: 1, periodInMinutes: 360 });
});

test("alarm period follows settings, alerts off clears it", async () => {
  const sw = boot({ sync: { settings: { checkIntervalHours: 2 } } });
  await sw.run("ensureAlarm()");
  assert.equal(sw.alarms["pp-watch"].periodInMinutes, 120);
  sw.sync.settings = { checkIntervalHours: 0 };       // nonsense value falls back to 6 h
  await sw.run("ensureAlarm()");
  assert.equal(sw.alarms["pp-watch"].periodInMinutes, 360);
  sw.sync.settings = { alertsEnabled: false };
  await sw.run("ensureAlarm()");
  assert.equal(sw.alarms["pp-watch"], undefined);
});

test("badge shows the tracked-item count", () => {
  const sw = boot();
  sw.listeners.storageChanged({ trackedItems: { newValue: [1, 2, 3] } }, "local");
  sw.listeners.storageChanged({ trackedItems: { newValue: [] } }, "local");
  assert.deepEqual(sw.badge.slice(-2), ["3", ""]);
});

test("PP_WATCH / PP_UNWATCH write the watchlist per the contract", async () => {
  const sw = boot();
  assert.deepEqual(plain(await sw.send({ type: "PP_WATCH", url: AMZ, targetPrice: "19999", notifyOnAnyDrop: 1, site: "amazon", title: "Phone" })), { ok: true });
  const w = sw.local.watchlist[AMZ];
  assert.deepEqual({ targetPrice: w.targetPrice, notifyOnAnyDrop: w.notifyOnAnyDrop, site: w.site, title: w.title },
    { targetPrice: 19999, notifyOnAnyDrop: true, site: "amazon", title: "Phone" });
  assert.ok(!Number.isNaN(Date.parse(w.addedAt)));
  assert.ok(sw.alarms["pp-watch"]);
  const first = w.addedAt;
  await sw.send({ type: "PP_WATCH", url: AMZ, targetPrice: "", notifyOnAnyDrop: false, site: "amazon", title: "Phone" });
  assert.equal(sw.local.watchlist[AMZ].targetPrice, null);   // empty box means no target
  assert.equal(sw.local.watchlist[AMZ].addedAt, first);      // re-watching keeps the original date
  await sw.send({ type: "PP_UNWATCH", url: AMZ });
  assert.deepEqual(sw.local.watchlist, {});
});

test("unknown or malformed messages are ignored", async () => {
  const sw = boot();
  assert.equal(sw.listeners.message(null, {}, () => {}), false);
  assert.equal(sw.listeners.message({ type: "SOMETHING_ELSE" }, {}, () => {}), false);
  assert.equal(sw.listeners.message({ type: 42 }, {}, () => {}), false);
});

test("watchlist check: target hit notifies, price is recorded, no cookies are sent", async () => {
  const sw = boot({
    local: { watchlist: { [AMZ]: { targetPrice: 20000, notifyOnAnyDrop: false, site: "amazon", title: "Phone" } }, priceHistory: {} },
    pages: { [AMZ]: amazonPage("19,499") },
  });
  await sw.run("checkWatchlist()");
  assert.deepEqual(sw.notes.map((n) => [n.id, n.title]), [[AMZ, "Target price hit"]]);
  assert.match(sw.notes[0].message, /19,499/);
  assert.deepEqual(sw.local.priceHistory[AMZ].map((p) => p.p), [19499]);
  assert.equal(sw.fetched[0].init.credentials, "omit");
});

test("watchlist check: above target and no drop means no notification", async () => {
  const sw = boot({
    local: { watchlist: { [AMZ]: { targetPrice: 15000, notifyOnAnyDrop: true, site: "amazon", title: "Phone" } },
      priceHistory: { [AMZ]: [{ t: new Date(Date.now() - 86400000).toISOString(), p: 19000 }] } },
    pages: { [AMZ]: amazonPage("19,499") },
  });
  await sw.run("checkWatchlist()");
  assert.deepEqual(sw.notes, []);
  assert.deepEqual(sw.local.priceHistory[AMZ].map((p) => p.p), [19000, 19499]);
});

test("watchlist check: any-drop alert compares with the last recorded price", async () => {
  const sw = boot({
    local: { watchlist: { [FK]: { targetPrice: null, notifyOnAnyDrop: true, site: null, title: "" } },
      priceHistory: { [FK]: [{ t: new Date(Date.now() - 86400000).toISOString(), p: 25490 }] } },
    pages: { [FK]: flipkartPage("24,990") },
  });
  await sw.run("checkWatchlist()");
  assert.deepEqual(sw.notes.map((n) => n.title), ["Price dropped"]); // site guessed from the URL
  assert.match(sw.notes[0].message, /25,490.*24,990/);
  assert.match(sw.notes[0].message, /^Watched item/);
});

test("watchlist check: failures and bot walls are skipped, the rest still run, 3 s apart", async () => {
  const dead = "https://www.amazon.in/dp/B0DEAD00001", gone = "https://www.amazon.in/dp/B0GONE00001", wall = "https://www.amazon.in/dp/B0WALL00001";
  const w = (t) => ({ targetPrice: 99999, notifyOnAnyDrop: false, site: "amazon", title: t });
  const sw = boot({
    local: { watchlist: { [dead]: w("a"), [gone]: w("b"), [wall]: w("c"), [AMZ]: w("d") }, priceHistory: {} },
    pages: { [gone]: 404, [wall]: "Type the characters you see " + amazonPage("5"), [AMZ]: amazonPage("1,000") },
  });
  await sw.run("checkWatchlist()");
  assert.deepEqual(sw.notes.map((n) => n.id), [AMZ]);
  assert.deepEqual(Object.keys(sw.local.priceHistory), [AMZ]);
  assert.equal(sw.fetched.length, 4);
  assert.deepEqual(sw.sleeps.filter((ms) => ms === 3000).length, 3);
});

test("watchlist check: at most 40 URLs, and nothing when alerts are off", async () => {
  const watch = {};
  for (let i = 0; i < 45; i++) watch["https://www.amazon.in/dp/B0" + String(i).padStart(8, "0")] = { targetPrice: 1, site: "amazon", title: "" };
  const sw = boot({ local: { watchlist: watch } });
  await sw.run("checkWatchlist()");
  assert.equal(sw.fetched.length, 40);
  const off = boot({ local: { watchlist: watch }, sync: { settings: { alertsEnabled: false } } });
  await off.run("checkWatchlist()");
  assert.equal(off.fetched.length, 0);
});

test("only the watch alarm triggers a check", async () => {
  const sw = boot({ local: { watchlist: { [AMZ]: { targetPrice: 1, site: "amazon", title: "" } } } });
  sw.listeners.alarm({ name: "something-else" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sw.fetched.length, 0);
});

test("notification click opens https links only", () => {
  const sw = boot();
  sw.listeners.noteClicked(AMZ);
  sw.listeners.noteClicked("javascript:alert(1)");
  sw.listeners.noteClicked("http://insecure.example/");
  assert.deepEqual(sw.tabs, [AMZ]);
});

test("PP_CROSS_SEARCH: results are cached for 6 hours, then refetched", async () => {
  const search = "https://www.flipkart.com/search?q=Sony%20WH-1000XM5%20Headphones";
  const html = '<a href="/sony-wh-1000xm5-headphones/p/itmabc123" title="Sony WH-1000XM5 Headphones">x</a><div>₹24,990</div>';
  const sw = boot({ pages: { [search]: html } });
  const msg = { type: "PP_CROSS_SEARCH", query: "Sony WH-1000XM5 Headphones", excludeSite: "amazon" };
  const first = plain(await sw.send(msg));
  assert.deepEqual(first.results.map((r) => [r.site, r.price]), [["flipkart", 24990]]);
  assert.equal(sw.fetched.length, 1);
  await sw.send(msg);
  assert.equal(sw.fetched.length, 1);                          // served from crossCache
  const key = Object.keys(sw.local.crossCache)[0];
  sw.local.crossCache[key].at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
  await sw.send(msg);
  assert.equal(sw.fetched.length, 2);                          // expired entry refetched
});
