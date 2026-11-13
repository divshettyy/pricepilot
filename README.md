# PricePilot

A local-only Chrome (Manifest V3) extension that tracks price, rating, discount and delivery fee across **Amazon, Flipkart, Zomato and Swiggy** while you browse, and recommends the best pick with a transparent, weighted score. Same job as apps like Buy Hatke — but everything stays in your browser: no account, no server, no telemetry, nothing leaves the four store domains it talks to.

## Features

- **Auto-tracking** — content scripts on Amazon/Flipkart/Zomato/Swiggy pages extract `{title, price, rating, discountPct, deliveryFee}` and store it locally, deduped by canonical URL (capped at 200 items).
- **Weighted "Best Pick" scoring** (`lib/scoring.js`) — min-max normalized price/delivery, rating/5, discount %, combined via sliders you control (price / rating / discount / delivery importance). No black box — read the function yourself.
- **Price history & deal verdicts** (`lib/history.js`) — local timeseries per URL, used to flag a current price as a genuine deal vs. a fake "discount" off an inflated MRP.
- **Price-drop watchlist & alerts** (`background.js`) — set a target price per item, get a `chrome.notifications` alert when it's hit or when the price drops at all.
- **Card-offer net price** (`lib/offers.js`) — parses Indian bank/card offer text (instant discount, cashback, flat-off) against the cards you've saved in Settings and computes the real net price.
- **Review-trust heuristics** (`lib/reviews.js`) — volume-aware (Bayesian-adjusted) rating plus labeled authenticity flags — heuristics, not fraud detection, meant to tell you where to look.
- **Unit-price normalization** (`lib/unitprice.js`) — parses pack size out of the title and computes price-per-standard-unit so differently-sized packs are comparable.
- **Cross-store lookup** (`lib/crossstore.js`, `background.js`) — service-worker-side search of the *other* store domains for a matching item, so you can compare across sites without manually re-searching.
- **Zomato vs Swiggy compare** (`lib/food.js`) — restaurant matching and cart-bill parsing across both food apps, including delivery fee and platform/GST charges.
- **On-page overlay** (`content/overlay.js`) — a Shadow-DOM panel injected into the page itself, so verdicts show up without opening the popup.

Amazon/Flipkart extraction uses stable DOM selectors with a text-regex fallback. Zomato/Swiggy use heuristic text-pattern scanning instead of CSS selectors, since both are React SPAs with randomized/minified class names that break selectors on every deploy — best-effort, and may need retuning after a site redesign.

## How it compares

Researched November 2026. Y = yes, N = no, partial = limited.

| | PricePilot | Buyhatke | Keepa | PriceHistory.app | Honey | Smartprix |
|---|---|---|---|---|---|---|
| Price history | Y, from your first visit | Y, about 3 months | Y, full | Y | partial | partial |
| Price-drop alerts | Y, browser notification | Y | Y | Y | Y | Y |
| Fake-discount verdict with visible rules | Y | marketed, rules hidden | read the chart yourself | "deal score", rules hidden | N | N |
| Net price with **your** bank cards | Y | partial | N | N | N | unclear |
| Live cross-store match (rejects XM4 vs XM5, 128 vs 256 GB, Pro vs base) | Y, Amazon and Flipkart | Y | N, Amazon only | Y | N | Y |
| Review trust check (Fakespot shut down in July 2025) | Y, heuristic | N | N | N | N | N |
| Unit price (₹/100g, ₹/GB) | Y | N | N | N | N | N |
| Zomato vs Swiggy, same restaurant, full bill | Y | N | N | N | N | N |
| Weights you control | Y | N | N | N | N | N |
| No tracking, no affiliate cookie rewriting | Y | N, tracks usage | Y | unclear | N, lawsuit | N, affiliate |

**Where competitors still win:**
- **History on day one:** Keepa and PriceBefore crawl millions of products all the time. PricePilot's history starts the first time you open a product.
- **Coupons and cashback:** both need a crowdsourced code database and affiliate deals.
- **Email or Telegram alerts and cross-device sync:** they need a server. PricePilot uses only browser notifications.
- **Large watchlists:** the store sites block bots. Keep the watchlist under about 40 items.

## Tech stack

- Vanilla JavaScript (classic scripts, no build step, no bundler, no `import`/`export`) — see `CONTRACT.md` for the shared-globals pattern every file follows.
- Chrome Extension **Manifest V3**: a service worker (`background.js`), content scripts per site, and a popup UI (`popup/`).
- Storage: `chrome.storage.local` (tracked items, price history, watchlist, cross-store cache) and `chrome.storage.sync` (weights, settings) — no external database, no backend.
- No third-party npm dependencies.

## Prerequisites

- A Chromium-based browser (Chrome, Edge, Brave, etc.) with Developer mode support for unpacked extensions.
- No Node.js, no build tooling, and no environment variables are required — this is a static, unpacked extension.

## Install & run

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repo's root folder.
3. Browse a product page on Amazon/Flipkart or a restaurant on Zomato/Swiggy — it gets tracked automatically.
4. Click the toolbar icon to open the popup:
   - **Compare** tab: tick 2+ tracked items, hit **Compare selected**, get a ranked best pick with a score breakdown.
   - **Watchlist** tab: set a target price on any tracked item for drop alerts.
   - **Food** tab: compare a Zomato order against the equivalent Swiggy order.
   - **Settings** tab: save your bank cards (for net-price offer calculation) and tune the compare weight sliders.

No icons are bundled yet — Chrome falls back to its default puzzle-piece icon. Drop `icons/16.png` / `48.png` / `128.png` and reference them under `"icons"` in `manifest.json` if you want a custom one.

## Configuration

No `.env` file or environment variables are used — all configuration (weights, saved cards, alert settings) lives in `chrome.storage.sync` and is set from the popup's Settings tab, not from a config file.

## Usage notes / known limitations

- Zomato/Swiggy extraction is regex-heuristic over page text, not structured data — accuracy depends on page layout and may drift. If an extraction looks wrong, check what the regexes in `content/zomato.js` / `content/swiggy.js` matched.
- Not published to the Chrome Web Store — unpacked/dev install only, for now.
- Cross-store search and watchlist checks fetch pages directly from the four store domains (`amazon.in`, `amazon.com`, `flipkart.com`, `zomato.com`, `swiggy.com`) with `credentials: "omit"` — no other network calls are made anywhere in the codebase.

## Companion web tool

A no-install, manual-entry version (paste price/rating/discount for a few options, get the same weighted best-pick scoring) is published separately as a Claude artifact, for quick one-off comparisons when you're not using the extension.

## Roadmap

- Chrome Web Store packaging and a real icon set.
- More store integrations beyond the current four.
- Richer price-history visualizations in the popup.

## Project status

Early-stage, actively developed, functional for personal use. Internal implementation notes for contributors live in `CONTRACT.md`.

## License

MIT — see [LICENSE](LICENSE).
