// PricePilot service worker: badge count, cross-store search, watchlist alarms and notifications.
importScripts("lib/history.js", "lib/crossstore.js");

const ALARM = "pp-watch";
const CROSS_TTL_MS = 6 * 3600 * 1000;
const MAX_WATCH = 40;

/**
 * Set the toolbar badge to the number of tracked items (blank when zero).
 * @param {unknown} items - The tracked-items array from storage (anything else counts as 0).
 */
function setBadge(items) {
  const count = Array.isArray(items) ? items.length : 0;
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
}

/** Read tracked items from local storage and refresh the toolbar badge. */
async function refreshBadge() {
  const r = await chrome.storage.local.get("trackedItems");
  setBadge(r.trackedItems);
}

/**
 * Load user settings from sync storage, merged over defaults.
 * @returns {Promise<{cards:Array, alertsEnabled:boolean, checkIntervalHours:number, overlayEnabled:boolean}>}
 */
async function getSettings() {
  const r = await chrome.storage.sync.get("settings");
  return Object.assign({ cards: [], alertsEnabled: true, checkIntervalHours: 6, overlayEnabled: true }, r.settings || {});
}

/** Create or re-sync the watchlist polling alarm to match the current interval; clears it when alerts are off. */
async function ensureAlarm() {
  const s = await getSettings();
  if (s.alertsEnabled === false) {
    await chrome.alarms.clear(ALARM);
    return;
  }
  const period = Math.max(1, Number(s.checkIntervalHours) || 6) * 60;
  const existing = await chrome.alarms.get(ALARM);
  if (!existing || existing.periodInMinutes !== period) {
    chrome.alarms.create(ALARM, { delayInMinutes: 1, periodInMinutes: period });
  }
}

let iconCache = null;
/**
 * Render the ₹ notification icon once and cache it as a data URL.
 * @returns {Promise<string>} A base64 PNG data URL (1x1 blue fallback if canvas is unavailable).
 */
async function iconUrl() {
  if (iconCache) return iconCache;
  try {
    const c = new OffscreenCanvas(64, 64);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 40px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("₹", 32, 34);
    const blob = await c.convertToBlob({ type: "image/png" });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    iconCache = "data:image/png;base64," + btoa(bin);
  } catch (err) {
    // 1x1 blue PNG fallback
    iconCache = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqP9fDwAEhAH/1LZz0wAAAABJRU5ErkJggg==";
  }
  return iconCache;
}

/**
 * Show a basic desktop notification keyed by the item URL (click opens it).
 * @param {string} url - Item URL, used as the notification id.
 * @param {string} title
 * @param {string} message
 */
async function notify(url, title, message) {
  try {
    chrome.notifications.create(url, {
      type: "basic",
      iconUrl: await iconUrl(),
      title,
      message,
      priority: 1,
    });
  } catch (err) {
    console.warn("[PricePilot] notify failed:", err);
  }
}

/**
 * Poll each watched URL (up to MAX_WATCH), record the latest price, and fire
 * target-hit or price-drop notifications. Fetches with credentials omitted and
 * paces requests 3s apart.
 */
async function checkWatchlist() {
  const s = await getSettings();
  if (s.alertsEnabled === false) return;
  const r = await chrome.storage.local.get("watchlist");
  const watch = r.watchlist || {};
  const urls = Object.keys(watch).slice(0, MAX_WATCH);
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    const w = watch[url] || {};
    try {
      const prev = await PricePilotHistory.getHistory(url);
      const last = prev.length ? prev[prev.length - 1].p : null;
      const res = await fetch(url, { credentials: "omit" });
      if (res.ok) {
        const html = await res.text();
        const site = w.site || (url.includes("flipkart") ? "flipkart" : "amazon");
        const price = PricePilotCross.extractPriceFromHtml(site, html);
        if (price != null) {
          await PricePilotHistory.addPoint(url, price);
          const name = (w.title || "Watched item").slice(0, 80);
          if (w.targetPrice != null && price <= w.targetPrice) {
            await notify(url, "Target price hit", `${name} is now ₹${price.toLocaleString("en-IN")} (target ₹${Number(w.targetPrice).toLocaleString("en-IN")}).`);
          } else if (w.notifyOnAnyDrop && last != null && price < last) {
            await notify(url, "Price dropped", `${name}: ₹${last.toLocaleString("en-IN")} → ₹${price.toLocaleString("en-IN")}.`);
          }
        }
      }
    } catch (err) {
      console.warn("[PricePilot] watch check failed:", url, err);
    }
    if (i < urls.length - 1) await new Promise((res) => setTimeout(res, 3000));
  }
}

/**
 * Cross-store search with a 6h local cache keyed by query + excluded site.
 * @param {string} query - Product search text.
 * @param {string} [excludeSite] - Store to omit (the one the user is already on).
 * @returns {Promise<Array>} Matching results from other stores.
 */
async function crossSearch(query, excludeSite) {
  const key = `${excludeSite || ""}|${(query || "").toLowerCase().trim()}`;
  const r = await chrome.storage.local.get("crossCache");
  const cache = r.crossCache || {};
  const hit = cache[key];
  if (hit && Date.now() - Date.parse(hit.at) < CROSS_TTL_MS) return hit.results;
  const results = await PricePilotCross.searchAll(query, excludeSite);
  cache[key] = { at: new Date().toISOString(), results };
  // prune expired entries
  for (const k of Object.keys(cache)) {
    if (Date.now() - Date.parse(cache[k].at) > CROSS_TTL_MS) delete cache[k];
  }
  await chrome.storage.local.set({ crossCache: cache });
  return results;
}

chrome.runtime.onInstalled.addListener(async () => {
  const r = await chrome.storage.local.get(["trackedItems", "priceHistory", "watchlist"]);
  const init = {};
  if (!Array.isArray(r.trackedItems)) init.trackedItems = [];
  if (!r.priceHistory) init.priceHistory = {};
  if (!r.watchlist) init.watchlist = {};
  if (Object.keys(init).length) await chrome.storage.local.set(init);
  await refreshBadge();
  await ensureAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  refreshBadge();
  ensureAlarm();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.trackedItems) setBadge(changes.trackedItems.newValue || []);
  if (area === "sync" && changes.settings) ensureAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) checkWatchlist();
});

chrome.notifications.onClicked.addListener((id) => {
  if (/^https:\/\//.test(id)) chrome.tabs.create({ url: id });
  chrome.notifications.clear(id);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  if (msg.type === "PP_CROSS_SEARCH") {
    crossSearch(msg.query, msg.excludeSite)
      .then((results) => sendResponse({ results }))
      .catch((err) => sendResponse({ results: [], error: String(err) }));
    return true;
  }
  if (msg.type === "PP_WATCH") {
    chrome.storage.local.get("watchlist").then(async (r) => {
      const watch = r.watchlist || {};
      watch[msg.url] = {
        targetPrice: msg.targetPrice != null && msg.targetPrice !== "" ? Number(msg.targetPrice) : null,
        notifyOnAnyDrop: !!msg.notifyOnAnyDrop,
        site: msg.site || null,
        title: msg.title || "",
        addedAt: (watch[msg.url] && watch[msg.url].addedAt) || new Date().toISOString(),
      };
      await chrome.storage.local.set({ watchlist: watch });
      await ensureAlarm();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.type === "PP_UNWATCH") {
    chrome.storage.local.get("watchlist").then(async (r) => {
      const watch = r.watchlist || {};
      delete watch[msg.url];
      await chrome.storage.local.set({ watchlist: watch });
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

refreshBadge();
