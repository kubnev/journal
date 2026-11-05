# Ledgerline — where your money sits, what it earns, where it goes

A private, local-first finance tracker that runs in the browser. Built for people without a steady salary (traders, freelancers): **no income to log** — you update your balances every so often and the app follows your money from those snapshots.

- **Net worth** — every account (bank, savings, exchanges, brokers, wallets, property, debts) grouped by type, valued over time from balance snapshots, with allocation, custody and liquidity analytics.
- **Money in & out** — log deposits into and withdrawals from brokers, exchanges and other accounts; per year you see what you put in, took out, and what the accounts made on top, with a CSV export for your tax records.
- **Interest** — what each yield account earns per day / month / year, interest earned since the last update and this year, what debts cost, and cash that earns nothing.
- **Spending** — log expenses in seconds (button or the `N` key), optionally taking them off an account's balance; budgets, subscriptions & bills.
- **Journal** — a two-minute daily check-in (mood, energy, stress, sleep, habits) with insights on how you feel vs what you spend.

**First launch:** choose Simple or Pro input → a few *starting estimates* (usual monthly spending, budget, net worth a year ago) → a guided tour on temporary sample data, which is deleted when the tour ends. Figures based on an estimate are marked "estimate" until there's a full calendar month of logged spending.

**Privacy mode** (eye button or the `H` key) hides every amount as “$•••” for using the app in public.

Everything is stored in the browser (IndexedDB). There is no server, no account and no tracking, and backups are password-encrypted.

**Live:** https://kubnev.github.io/journal/

## Net worth
Six simple account types (Savings, Investments, Trading capital, Assets, Cash, Debt), or detailed categories in Pro mode.
- dated balance snapshots; accounts with an APY grow daily between updates (APY changes keep the old rate for the past)
- Accounts & holdings grouped by type with totals; holdings with live prices
- custody, purpose, liquidity and concentration analytics; balance-sheet checks (cash runway, debt-to-asset…)
- target allocation with a 5/25 rebalancing band (drift beyond 5 points, or 25% of the target if smaller)

## Spending
- **Expenses:** amount, category, date, note and optionally the account it was paid from — tick "take it off this account's balance" to lower that balance (reversed on edit or delete; on a credit card it adds to what you owe). Pro input adds subcategory, merchant, payment method, tags, need/want, "repeats" and "leave out of totals".
- **Spending dashboard:** spending through the month vs last month and budget pace, projected month-end, safe-to-spend per day, categories vs your 3-month average, monthly spending history, needs vs wants, weekdays and top merchants.
- **Calendar**, **Budgets**, **Subscriptions & bills** (charge day + account, auto-added, optionally taken off the account balance), editable **Categories**.
- **Bank CSV import:** money going out becomes expenses, money coming in is skipped; duplicates skipped; European number formats handled. Export to CSV.

## Journal
Daily check-in: mood, energy, stress, sleep, habits (editable in Settings), what's on your mind, reflection and notes to self. History calendar with mood and daily spending; Insights compares everyday spending on good/low mood, calm/stressed and rested/tired days.

## Simple or Pro input
Chosen on first launch and changeable in Settings. The mode only changes **how much you fill in**. Every page, chart and report is available in both, and switching never deletes anything.

## Currencies
Every account, transaction and bill keeps its own currency. Totals are converted to the display currency using ECB reference rates (via Frankfurter, with Coinbase as fallback), at the rate of each transaction's or snapshot's date.

## The old trading-journal version
The full previous app (trading journal, daily journal and net worth) is preserved on the branch [`archive/trading-journal-v0.7.1`](https://github.com/kubnev/journal/tree/archive/trading-journal-v0.7.1). Use *Code → Download ZIP* on that branch to get it. Data from that version is converted automatically:
- Net-worth accounts that were linked to a trading account become normal accounts holding their value at the time of conversion.
- Monthly cash-flow totals become spending entries (income is not tracked).
- Old journal entries are shown again in the Journal. Old trades stay untouched in the browser database; they're not shown, and "Delete all data" removes them.

## Live prices for holdings
Net-worth accounts can track individual holdings (quantity × price). **Update prices** fetches prices directly from the browser:
- **Crypto:** Binance public API, with Coinbase as fallback. No key needed. Binance is unavailable from US IPs, so US users get Coinbase.
- **Stocks/ETFs:** Finnhub. It needs a free API key, which you add under Settings → Price data. The key is stored only in your browser.
- **Currency:** USD prices are converted to your base currency with ECB rates (Frankfurter), with Coinbase rates as fallback.

Each update writes today's snapshot, so the history builds itself.

## Tests
`tests/e2e.mjs` drives the whole app in Chromium with Playwright (external price and exchange-rate APIs are mocked):

```sh
python3 -m http.server 8765 &
node tests/e2e.mjs                 # all test groups
ONLY='journal|interest' node tests/e2e.mjs   # a subset
```

Set `PLAYWRIGHT=/path/to/playwright/index.mjs` if Playwright isn't installed where Node can find it.

## Releasing a new version
1. Bump `APP_VERSION` in `js/version.js` and add a `CHANGELOG` line.
2. Run `node scripts/version.mjs "release notes"`. This regenerates `version.json`, which the in-app "Check for app update" reads.
3. Commit and push to `main`.

## Design language
Modelled on Claude's interface. The colour tokens at the top of `css/app.css` are close approximations, not official values:
- **Light:** ivory `#faf9f5` with a clay `#c96442` accent.
- **Dark:** charcoal `#262624` with a clay `#d97757` accent.
- **Type:** headings use a serif. Source Serif 4 (OFL, in `vendor/fonts`) stands in for Claude's proprietary typefaces.
- **Modes:** Light / Dark / Auto.

To reuse the design in other apps, copy the token block and the `@font-face` rules.

## Run locally
The app uses ES modules, so it must be served over HTTP rather than opened as a file:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Publish with GitHub Pages
Repository → **Settings → Pages** → *Deploy from a branch* → pick the branch and `/ (root)` → Save.
There is no build step: `index.html` at the root is the site.

## Structure
```
index.html               app shell (Content-Security-Policy, no inline scripts)
css/app.css              styles (light/dark tokens)
vendor/                  Chart.js 4 (MIT) and Source Serif 4 (OFL), vendored — no CDN
js/main.js               router, navigation, quick add, notices
js/store.js              IndexedDB persistence, backup validation, wipe
js/migrate.js            one-time conversion from the trading-journal version
js/backup.js, crypto.js  password-encrypted backups (AES-256-GCM, PBKDF2)
js/fx.js                 currencies & exchange rates
js/spend/                categories, calculations, transaction form, views, CSV
js/networth/             calculations, live prices, views, interest page, money in & out (flows.js), balance adjustments (ledger.js)
js/journal/              daily check-in, history, insights
tests/e2e.mjs            end-to-end browser tests
js/home.js               overview page
js/mode.js               Simple / Pro input mode
js/tips.js               "?" help on every field
js/help.js, tour.js      help drawer + guided tour
js/onboarding.js         starting estimates
js/demo.js               demo data
```
