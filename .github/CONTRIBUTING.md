# Contributing to PricePilot

Thanks for taking the time to contribute.

## Ground rules

- Keep it vanilla JS — no build step, no bundler, no npm packages added to the extension itself.
- Read `CONTRACT.md` before touching any shared lib. The shared-globals pattern is intentional.
- Every new lib function needs a matching test in `tests/`.
- Run `npm test` before opening a PR — all 102 tests must pass.

## Setup

```bash
git clone https://github.com/divshettyy/pricepilot
# Load unpacked from chrome://extensions (no build step)
npm test   # optional, needs Node 20+
```

## What to work on

Check [open issues](https://github.com/divshettyy/pricepilot/issues) — anything labeled `good first issue` is a good starting point.

## Pull request checklist

- [ ] `npm test` passes
- [ ] No new npm dependencies added to the extension (devDependencies for tests are fine)
- [ ] No tracking, analytics, or external API calls added
- [ ] Credentials never stored in plaintext
- [ ] PR description explains the problem being solved

## Reporting a bug

Use the [bug report template](ISSUE_TEMPLATE/bug_report.md). Include: browser version, the store/page where it happened, and what you expected vs. what you saw.
