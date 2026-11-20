<div align="center">

# 🛒 PricePilot

**Real prices on Amazon & Flipkart India. No affiliate links. No tracking. No subscription.**

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://github.com/divshettyy/pricepilot)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-F7DF1E?logo=javascript&logoColor=black)](https://github.com/divshettyy/pricepilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![No Tracking](https://img.shields.io/badge/Tracking-Zero-red)](https://github.com/divshettyy/pricepilot)
[![Tests](https://img.shields.io/badge/Tests-102%20passing-success)](https://github.com/divshettyy/pricepilot/actions)

A local-only Chrome (Manifest V3) extension that exposes what Indian shopping sites hide — price history, fake discounts, real net price after bank card offers, and cross-store comparisons — **all computed inside your browser. Nothing leaves it.**

</div>

---

## Why PricePilot?

Indian e-commerce runs on psychological pricing. Products sit at inflated MRPs, then get "60% off" that's actually the real price. Honey and Buy Hatke track you and rewrite your affiliate cookies. Keepa is Amazon-only. Fakespot shut down in 2025.

PricePilot fixes this with zero telemetry, no account, no server.

```
┌─────────────────────────────────────────────────────────────────┐
│  🛍️  PricePilot                                      [×]        │
├─────────────────────────────────────────────────────────────────┤
│  Sony WH-1000XM5 Headphones                                     │
│                                                                 │
│  Current price:  ₹24,990                                        │
│  Lowest seen:    ₹19,990  (3 months ago)                        │
│  Deal verdict:   ⚠️  NOT a deal — 25% above historic low        │
│                                                                 │
│  With HDFC card: ₹22,491  (10% instant discount)               │
│  With ICICI card: ₹23,241  (6.99% cashback)                    │
│                                                                 │
│  Cross-store: Flipkart ₹23,490  ← better right now             │
│                                                                 │
│  Review trust: ⚡ 4.3★ adjusted  (1,240 reviews, low risk)     │
│  Unit price: N/A                                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## Features

| Feature | What it does |
|---|---|
| 📈 **Price history** | Tracks every price you see, per product URL. No day-one gap — starts immediately. |
| 🚨 **Fake-discount detection** | Compares current price to your recorded history. Flags "60% off MRP" scams with visible logic. |
| 💳 **Card-offer net price** | Parses instant-discount and cashback text for 20+ Indian bank cards. Shows real out-of-pocket cost. |
| 🔔 **Price-drop alerts** | Set a target price. Get a Chrome notification when it's hit — no email, no account. |
| 🔄 **Cross-store lookup** | Finds the same product on the other store (Amazon ↔ Flipkart). Rejects mismatches (XM4 ≠ XM5). |
| ⭐ **Review trust score** | Bayesian-adjusted rating + authenticity flags. Heuristic, not Fakespot — but Fakespot is gone. |
| ⚖️ **Unit-price normalization** | ₹/100g, ₹/GB, ₹/tablet — compares different pack sizes fairly. |
| 🍔 **Zomato vs Swiggy** | Full bill comparison for the same restaurant: delivery fee, surge, platform fee, GST. |
| 🎚️ **Adjustable weights** | Set how much price vs. rating vs. discount vs. delivery matters to *you*. |
| 🕵️ **On-page overlay** | Shadow DOM panel injected into the product page. See verdicts without opening the popup. |

---

## How it compares

*Researched November 2026. Y = yes, N = no, partial = limited.*

| | **PricePilot** | Buyhatke | Keepa | PriceHistory.app | Honey | Smartprix |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Price history | ✅ | ✅ | ✅ | ✅ | ⚠️ | ⚠️ |
| Price-drop alerts | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Fake-discount verdict (visible rules)** | ✅ | ❌ hidden | ❌ | ❌ hidden | ❌ | ❌ |
| **Net price with your bank cards** | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ |
| **Cross-store (rejects spec mismatches)** | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Review trust check | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Unit price (₹/100g, ₹/GB)** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Zomato vs Swiggy full bill** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Adjustable scoring weights** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Zero tracking / no affiliate rewrites** | ✅ | ❌ tracks | ✅ | ❓ | ❌ lawsuit | ❌ affiliate |

**Where competitors still win:**
- **History on day one:** Keepa crawls millions of products continuously. PricePilot starts tracking when *you* first visit.
- **Coupon codes / cashback portals:** require a crowdsourced database and affiliate deals.
- **Email alerts / cross-device sync:** require a server. PricePilot is intentionally server-free.

---

## Install

> No build step. No npm install. Load the folder directly.

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this repo's root folder
4. Browse any Amazon/Flipkart/Zomato/Swiggy page — tracking starts automatically

Supports Chrome, Edge, Brave, and any Chromium browser.

---

## Usage

**Compare tab** — tick 2+ tracked products → **Compare selected** → ranked best pick with score breakdown.

**Watchlist tab** — set a target price on any item → get notified when it drops.

**Food tab** — compare the same restaurant order on Zomato vs. Swiggy.

**Settings tab** — add your bank cards for net-price calculation, tune the weighting sliders.

---

## How it works

```
Browser visits product page
        │
        ▼
Content script extracts: title, price, rating, discount%, delivery fee
        │
        ▼
chrome.storage.local: appends price point to history (capped at 200 items)
        │
        ▼
Scoring engine (lib/scoring.js): min-max normalize + weighted sum
        │
        ▼
History engine (lib/history.js): compare current vs. recorded low → deal verdict
        │
        ▼
Overlay (content/overlay.js): inject Shadow DOM panel into the live page
        │
        ▼
Background service worker: cross-store fetch, watchlist alarm polling
```

All network calls go only to the four store domains (`amazon.in`, `flipkart.com`, `zomato.com`, `swiggy.com`) with `credentials: "omit"`. No analytics, no tracking pixel, no external API.

---

## Privacy

> **Zero data collection. All logic runs in your browser.**

- No account required
- No data ever leaves your device
- No affiliate cookie injection or rewriting
- No background requests to third-party servers
- Storage: `chrome.storage.local` (history, watchlist) and `chrome.storage.sync` (settings) — both stay in Chrome's local sandboxed storage

---

## Tech stack

- **Vanilla JavaScript** — no build step, no bundler, no `import`/`export`. See `CONTRACT.md` for the shared-globals pattern.
- **Chrome Manifest V3** — service worker, per-site content scripts, popup UI
- **Zero npm dependencies** — `npm test` only (Node 20+, optional): `102 tests, 0 deps`
- Storage: `chrome.storage.local` + `chrome.storage.sync`

---

## Roadmap

- [ ] Chrome Web Store submission + icon set
- [ ] Richer price-history chart in popup (sparkline)
- [ ] Meesho, Myntra, Nykaa support
- [ ] Export watchlist / history to CSV

---

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for guidelines.

For bugs or feature requests, use the [issue templates](.github/ISSUE_TEMPLATE/).

---

## License

MIT — see [LICENSE](LICENSE).
