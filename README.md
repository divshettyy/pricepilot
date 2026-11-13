# PricePilot

Chrome (MV3) extension that tracks price, rating, discount and delivery fee across **Amazon, Flipkart, Zomato, Swiggy** while you browse, and recommends the best pick with a transparent weighted score — the same job as Buy Hatke, but local-only (no account, no server, nothing leaves your browser).

## How it works

- Content scripts (`content/amazon.js`, `content/flipkart.js`, `content/zomato.js`, `content/swiggy.js`) run on matching pages, extract `{title, price, rating, discountPct, deliveryFee}` and upsert into `chrome.storage.local.trackedItems` (deduped by canonical URL, capped at 200 items).
  - Amazon/Flipkart use stable DOM selectors with a text-regex fallback.
  - Zomato/Swiggy use heuristic text-pattern scanning instead of CSS selectors, since both are React SPAs with randomized/minified class names that break selectors on every deploy. This is best-effort and may need retuning if a site redesigns.
- `background.js` keeps the toolbar badge in sync with the tracked-item count.
- Click the toolbar icon to open the popup: see all tracked items, tick 2+ to compare, adjust weight sliders (price / rating / discount / delivery importance), and get a ranked "Best Pick" with a score breakdown.
- `lib/scoring.js` holds the scoring function (min-max normalized price/delivery, rating/5, discount %, weighted sum) — read it if you want to see exactly how "best" is computed, no black box.

## Install (unpacked, for now)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`~/pricepilot`).
3. Browse a product page on Amazon/Flipkart or a restaurant on Zomato/Swiggy — it gets tracked automatically.
4. Click the extension icon, select 2+ tracked items, hit **Compare selected**.

No icons are bundled yet (Chrome uses its default puzzle-piece icon) — drop `icons/16.png` / `48.png` / `128.png` and reference them in `manifest.json` if you want a custom icon.

## Known limitations

- Zomato/Swiggy extraction is regex-heuristic over page text, not structured data — accuracy depends on page layout and may drift. Report a bad extraction by checking what the regexes in `content/zomato.js` / `content/swiggy.js` matched.
- No price-history/alerts yet (Buy Hatke's headline feature) — current scope is point-in-time compare across currently tracked items. Could be added later with a lightweight local timeseries in `chrome.storage.local` keyed by date.
- Not published to the Chrome Web Store — unpacked/dev install only.

## Companion web tool

A no-install, manual-entry version (paste price/rating/discount for a few options, get the same weighted best-pick scoring) is published separately as a Claude artifact for quick one-off comparisons when you're not using the extension.
