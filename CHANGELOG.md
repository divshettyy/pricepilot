# Changelog

All notable changes to PricePilot. Dates are in IST.

## 2026-11-13 — Web tool v2

Companion page: https://claude.ai/artifact/1mzNexVgH2vUCSFyoYeVTx (private)

### Added
- Saved bank cards, remembered in the browser. Pasted offer text is parsed, and each option shows the net price with your cards.
- Rating adjusted for number of ratings, with "Few ratings" and "Low trust" flags.
- Food fields: packaging, platform fee and GST are added to the price for Zomato and Swiggy options.
- Discount worked out from MRP, and unit price from the pack size in the name.
- Plain-language reasons for the winner, e.g. "Cheapest after your card offers, by ₹55".
- Two examples: headphones (Amazon vs Flipkart vs a small reseller) and a biryani order (Zomato vs Swiggy).
- `web/compare.src.html` and `web/build.js`. The build inlines `lib/offers.js`, `lib/reviews.js`, `lib/unitprice.js` and `lib/scoring.js`, so the page and the extension score the same way.

### Fixed
- Winner details ran together ("adjustedScore 83") because they weren't wrapped in elements.
- The headphones example let an unrelated cheap brand win. It now compares the same product across sellers.

### Verified
- Rendered in headless Chromium: desktop light and 390px phone dark. No console errors and no horizontal scroll.

## 2026-11-13 — v0.2.0

Based on a competitor review of Buyhatke, Keepa, camelcamelcamel, PriceHistory.app, PriceBefore, Smartprix, Honey, Capital One Shopping, CashKaro, Fakespot, ReviewMeta and Google Shopping.

### Added
- Price history per product, with a fake-discount verdict whose rules are published: price hiked before a sale, MRP inflated, new low, wait.
- Watchlist with target prices. `chrome.alarms` re-checks prices and `chrome.notifications` alerts on a drop or when the target is hit.
- Bank and card offer parsing for 18 Indian banks, including co-branded cards. Net price uses your saved cards.
- Live cross-store lookup between Amazon.in and Flipkart from the service worker.
- Review trust check: Bayesian-adjusted rating plus flags for few ratings, polarized ratings and suspiciously perfect ratings.
- Unit price: ₹/100g, ₹/100ml, ₹/pc, ₹/GB.
- Zomato vs Swiggy matching of the same restaurant, with a full bill breakdown: item total, packaging, platform fee, delivery, GST, discount, grand total.
- On-page panel in a Shadow DOM, collapsible to a verdict pill.
- Four-tab popup: Compare, Watchlist, Food, Settings. Settings has cards, alert interval, panel toggle, JSON export and clear-all.
- `CONTRACT.md` describing shared storage, item shape and library APIs.
- README comparison table, including where competitors still win.

### Changed
- Permissions cut to `storage`, `alarms` and `notifications`; `tabs`, `scripting` and `activeTab` removed.
- Scoring uses the card net price and the adjusted rating when they are available. The v0.1 call form still works.

### Fixed
- Cross-store matching accepted near-variants as the same product: WH-1000XM4 vs XM5, 128 GB vs 256 GB, iPhone 15 vs 15 Pro. Conflicting model codes, capacities and variant words (Pro, Max, Plus, Ultra and similar) now reject the match.
- Zomato and Swiggy menu price was skewed by bill totals and offer caps like "up to ₹100". Both are now excluded.

### Verified
- 18 cross-module checks in Node.
- End-to-end run in headless Chromium with the unpacked extension on a test Amazon page. Extraction, history, panel and all popup tabs worked with no errors.
- Live Flipkart lookup found the same WH-1000XM5 at ₹19,989 vs Amazon's ₹26,990.

### Known limits
- Amazon, Flipkart, Zomato and Swiggy pages have not yet been tested live in a browser.
- History starts at your first visit. There are no coupons, cashback or email alerts, because those need a server.

## 2026-11-13 — v0.1.0

### Added
- Manifest V3 extension with content scripts for Amazon, Flipkart, Zomato and Swiggy that save price, rating, discount and delivery fee.
- Badge showing the number of tracked items.
- Popup to compare 2 or more tracked items with adjustable weights and a best pick.
- First web compare page with manual entry.
