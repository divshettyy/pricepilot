// Loads the extension's classic scripts into a node `vm` context with a fake
// `chrome` API. No browser and no network: `fetch` is whatever the test passes.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function fakeStorageArea(store) {
  return {
    async get(keys) {
      const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
      return out;
    },
    async set(obj) {
      for (const k of Object.keys(obj)) store[k] = structuredClone(obj[k]);
    },
  };
}

// opts: {fetch, now, location}
function load(files, opts = {}) {
  const local = {}, sync = {};
  const warnings = [];
  const events = [];
  const sandbox = {
    console: { warn: (...a) => warnings.push(a.join(" ")), log() {}, error() {} },
    chrome: { storage: { local: fakeStorageArea(local), sync: fakeStorageArea(sync) } },
    fetch: opts.fetch || (async () => { throw new Error("network is off in tests"); }),
    AbortController, setTimeout, clearTimeout, URL, structuredClone,
    location: opts.location || { href: "https://www.amazon.in/dp/B0TEST1234?ref=x#frag" },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    dispatchEvent: (e) => { events.push(e); return true; },
  };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const f of files) vm.runInContext(read(f), ctx, { filename: f });
  return { g: sandbox, local, sync, warnings, events, ctx };
}

// Values built inside the vm have another realm's prototypes; deepStrictEqual
// would reject them. Compare plain data instead.
function plain(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function daysAgo(n, base) {
  return new Date((base || Date.UTC(2026, 10, 1)) - n * 24 * 3600 * 1000).toISOString();
}

module.exports = { ROOT, read, load, plain, daysAgo };
