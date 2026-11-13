# PricePilot v0.2 internal contract

Single source of truth for parallel work. All JS files are classic scripts (no import/export).
Library globals attach to `self` (works in service worker, content scripts and popup).
Pattern: `(function(g){ g.PricePilotX = {...}; })(typeof self !== 'undefined' ? self : window);`
Never throw into the host page: wrap work in try/catch, console.warn on failure.
Privacy rule: no network calls except to the 4 store domains, no telemetry, no affiliate tags, no cookie edits.

## Storage

chrome.storage.local
- `trackedItems`: Item[] (upsert by url, cap 200, oldest dropped)
- `priceHistory`: `{ [url]: [{t: ISOString, p: number}] }` — append when price changed or 12h+ since last point; cap 365 points per url
- `watchlist`: `{ [url]: {targetPrice: number|null, notifyOnAnyDrop: boolean, site, title, addedAt} }`
- `crossCache`: `{ [query]: {at: ISOString, results: CrossResult[]} }` — 6h TTL

chrome.storage.sync
- `weights`: `{price, rating, discount, delivery}` (0-1)
- `settings`: `{cards: [{bank: "HDFC", cardType: "credit"|"debit"}], alertsEnabled: true, checkIntervalHours: 6, overlayEnabled: true}`

## Item

```
{
  url, title, site: "amazon"|"flipkart"|"zomato"|"swiggy",
  price: number|null, currency: "INR", capturedAt: ISOString,
  rating: number|null, discountPct: number|null, deliveryFee: number|null,
  mrp: number|null,                       // list/strike-through price
  ratingCount: number|null,
  ratingHistogram: {5,4,3,2,1 -> percent}|null,
  offers: Offer[],                         // [] when none found
  unit: {qty: number, unit: "g"|"ml"|"pc"|"GB"}|null,
  modelId: string|null,                    // ASIN / Flipkart pid
  restaurantKey: string|null,              // food only
  locality: string|null,                   // food only
  cart: Cart|null                          // food cart/checkout pages only
}
Offer = {raw, bank: string|null, kind: "instant"|"cashback"|"emi"|"other",
         pct: number|null, flat: number|null, maxDiscount: number|null,
         minSpend: number|null, cardType: "credit"|"debit"|"any"}
Cart  = {itemTotal, packaging, platformFee, deliveryFee, gst, discount, grandTotal}  // numbers or null
CrossResult = {site, title, price, url, rating, matchScore}  // matchScore 0-1
```

## Library APIs

- `PricePilotHistory` (lib/history.js) — owner: core agent
  - `addPoint(url, price)` async
  - `getHistory(url)` async → points
  - `analyze(points, currentPrice, mrp)` → `{lowest, highest, median, lowestAt, pointCount, daysCovered, trueDiscountPct, verdict, reasons: string[]}`
    verdict ∈ `"great"|"good"|"fair"|"wait"|"fake-discount"|"insufficient-data"`
- `PricePilotCross` (lib/crossstore.js, service worker only) — owner: core agent
  - `searchAll(query, excludeSite)` async → CrossResult[] sorted by price among matchScore ≥ 0.5
  - `extractPriceFromHtml(site, html)` → number|null
- `PricePilotOffers` (lib/offers.js) — owner: marketplace agent
  - `parseOffers(texts: string[])` → Offer[]
  - `bestNetPrice(price, offers, cards)` → `{netPrice, offer, savings}|null` (only offers usable with the user's cards, or bank-agnostic ones)
- `PricePilotReviews` (lib/reviews.js) — owner: marketplace agent
  - `bayesian(rating, count, prior = 3.9, m = 50)` → number
  - `assess(item)` → `{adjustedRating, trust: "high"|"medium"|"low"|"unknown", flags: string[]}`
- `PricePilotUnit` (lib/unitprice.js) — owner: marketplace agent
  - `parseUnit(title)` → `{qty, unit}|null`
  - `perUnit(price, unit)` → `{value, label}|null` (label like "₹/100g", "₹/100ml", "₹/pc", "₹/GB")
- `PricePilotScoring` (lib/scoring.js) — owner: marketplace agent
  - `computeScores(items, weights, opts?)` same output as v0.1; when `opts.cards` given use `bestNetPrice` for price; when `ratingCount` known use `bayesian` rating
- `PricePilotFood` (lib/food.js) — owner: food agent
  - `normalizeName(name)`, `restaurantKey(name, locality)`
  - `parseCart(text)` → Cart|null
  - `matchAcrossApps(items)` → `[{key, zomato: Item, swiggy: Item, cheaper: "zomato"|"swiggy"|"same", diff}]`

## Events and messages

- After a site script upserts an item it dispatches `window.dispatchEvent(new CustomEvent('pricepilot:item', {detail: item}))`. `content/overlay.js` listens.
- `chrome.runtime.sendMessage({type: "PP_CROSS_SEARCH", query, excludeSite})` → background responds `{results: CrossResult[]}` (uses crossCache).
- `chrome.runtime.sendMessage({type: "PP_WATCH", url, targetPrice, notifyOnAnyDrop, site, title})` → background writes watchlist, ensures alarm.
- `chrome.runtime.sendMessage({type: "PP_UNWATCH", url})`.
- Alarm `pp-watch` every `settings.checkIntervalHours`: fetch up to 40 watchlist URLs sequentially, 3s apart, `extractPriceFromHtml`, `addPoint`, notify on target hit or drop. Notification click opens the URL.

## Content script load order (manifest)

lib/scoring.js, lib/history.js, lib/offers.js, lib/reviews.js, lib/unitprice.js, lib/food.js, content/common.js, content/<site>.js, content/overlay.js

`content/common.js` `upsertItem(item)` also calls `PricePilotHistory.addPoint(item.url, item.price)` and fires the `pricepilot:item` event (site scripts do not need to fire it themselves).
