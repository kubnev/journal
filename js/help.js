// Help drawer (page-specific help + full guide) and a short guided tour of the app.
import * as store from './store.js';
import { html, raw, esc } from './ui.js';
import { startTour } from './tour.js';

const GUIDE = [
  { id: 'overview', title: 'Overview', match: p => p === '/', body: `
    <p>Your home page, net worth first: net worth and its 12-month change, liquid net worth, what your money earns in interest, the net-worth trend and where your money sits — then your largest accounts, cash runway, today's journal and a short look at this month's spending.</p>
    <ul><li>Numbers marked <span class="tag est">estimate</span> use your <a href="#/setup">starting estimates</a> until there's real history.</li>
    <li><b>Update balances</b> every so often (monthly is plenty) — each update is a snapshot on your net-worth history.</li>
    <li><b>+ Expense</b> (or the <kbd>N</kbd> key) logs spending from any page.</li></ul>` },
  { id: 'nw', title: 'Net worth', match: p => p === '/networth', body: `
    <p>Net worth = everything you own − everything you owe. It's built from <b>snapshots</b>: the value of each account on a date. Accounts you don't touch carry their last value forward; accounts with an APY grow daily in between.</p>
    <ul><li><b>Change per update</b> — how much net worth moved between balance updates.</li>
    <li><b>Liquid net worth</b> counts only what you could reach in days, minus all debts.</li>
    <li><b>Cash runway</b> — how many months your cash and savings cover your usual spending.</li>
    <li>The range buttons (1Y/3Y/5Y) zoom the charts. With a single snapshot the trend charts wait for your second update.</li></ul>` },
  { id: 'accounts', title: 'Accounts & holdings', match: p => p === '/networth/accounts', body: `
    <p>Every asset and debt, grouped by type (Savings, Investments, Trading capital, Assets, Cash, Debt — or the detailed categories in Pro input). Each group shows its total and share of your assets; the chips at the top jump to a group.</p>
    <ul><li><b>Interest / yield (APY)</b> — savings accounts, money-market funds, staking. The balance grows every day; the Interest page shows what it earns.</li>
    <li><b>Held at</b> (Pro) — bank, broker, crypto exchange, DeFi, self-custody wallet… used for counterparty-risk analytics.</li>
    <li><b>Purpose</b> (Pro) — e.g. Emergency fund, Trading capital. Shows as buckets in Analytics.</li>
    <li><b>Holdings</b> — list coins/stocks and quantities; <b>↻ Update prices</b> fetches live prices (crypto: Binance → Coinbase; stocks: Finnhub with a free key in Settings).</li>
    <li><b>Currency</b> — each account keeps its own; totals are converted to your display currency with ECB rates.</li>
    <li><b>Close</b> an account when sold or paid off — its history stays.</li></ul>` },
  { id: 'update', title: 'Update balances', match: p => p === '/networth/update', body: `
    <p>Record what each account is worth on a date. Fields are pre-filled with the latest values (including interest growth), so you only change what moved. Holdings accounts fill themselves. Monthly is the usual rhythm — whenever suits you is fine.</p>` },
  { id: 'interest', title: 'Interest', match: p => p === '/networth/interest', body: `
    <p>What your money earns and what your debts cost.</p>
    <ul><li>Set an <b>APY</b> on an account (Accounts → Edit). Its balance then grows daily from your last update — banks typically compound daily and pay monthly; the app follows the same curve.</li>
    <li><b>Since last update</b> and <b>This year</b> are estimates: each recorded balance grows at the APY in force then. When you type a new balance (which includes the interest actually paid), the estimate restarts from it.</li>
    <li>Changing an APY keeps the old rate for the past.</li>
    <li><b>Not earning anything</b> lists cash and savings with no APY, and what they'd earn at your blended rate.</li></ul>` },
  { id: 'flows', title: 'Money in & out', match: p => p === '/networth/flows', body: `
    <p>Log every deposit into a broker, exchange or savings account and every withdrawal back out. Per calendar year you see what you put in, what you took out and the net.</p>
    <ul><li><b>Result</b> = value at the end of the year (or today) − value at the start − money put in + money taken out. It's gains, losses, interest and fees together, estimated from your balance updates. It is <i>not</i> your realised profit for tax — use your broker's annual statement for that.</li>
    <li>Investment and trading accounts are always listed; other accounts appear once you log something for them.</li>
    <li>An account you started tracking during the year is counted from its first balance update; money moved before that is already in its value.</li>
    <li><b>Also change this account's balance today</b> is optional. Leave it off if you'll type the new balance on Update balances anyway.</li>
    <li><b>Export CSV</b> gives every entry plus the per-account totals for the year.</li></ul>` },
  { id: 'analytics', title: 'Net worth analytics', match: p => p === '/networth/analytics', body: `
    <ul><li><b>Where it's held</b> — exposure to each type of custodian. Large balances on exchanges are a counterparty risk.</li>
    <li><b>Liquidity ladder</b> — cash → liquid investments → locked/retirement → illiquid.</li>
    <li><b>Effective positions</b> — 1 ÷ Herfindahl index: how diversified your assets really are.</li>
    <li><b>Balance-sheet health</b> — rules of thumb (cash runway, debt-to-asset, concentration, exchange exposure…). Guidelines, not laws.</li>
    <li><b>Target allocation</b> — set a target % per type. Red drift = outside the rebalancing band (5 points, or 25% of the target if smaller).</li></ul>` },
  { id: 'spending', title: 'Spending', match: p => p === '/spending', body: `
    <p>Month-by-month view of where your money goes. Use ← → to move between months.</p>
    <ul><li><b>Spending through the month</b> — cumulative spending vs last month and your budget pace.</li>
    <li><b>Usual month</b> — your average over complete months (or your estimate until you have one).</li>
    <li><b>Projected month-end</b> = spent so far + your average daily spend for the remaining days + bills still due.</li>
    <li><b>Needs vs wants</b> — how this month's spending splits. Each category is a need or a want — change it on Categories.</li></ul>` },
  { id: 'transactions', title: 'Transactions', match: p => p === '/spending/transactions', body: `
    <p>Every expense, grouped by day. Filter by category or text; switch to <b>All time</b> to search everything.</p>
    <ul><li>Click an expense to edit or delete it.</li>
    <li><b>Paid from account</b> + <b>Take it off this account's balance</b> links spending to net worth: the account's balance drops today by the amount (converted to its currency). Editing or deleting the expense puts it back. On a credit card it adds to what you owe.</li>
    <li><b>Import CSV</b> takes your bank's statement export: money going out becomes expenses, money coming in is skipped, duplicates are skipped and merchants you've categorised before are recognised.</li>
    <li>Moving money between your own accounts isn't spending — just update both balances.</li></ul>` },
  { id: 'calendar', title: 'Calendar', match: p => p === '/spending/calendar', body: `<p>Each day shows what you spent (darker = more) and 🔁 bills that are coming up. Click a day to see its expenses or add one on that date. "—" marks a no-spend day.</p>` },
  { id: 'budgets', title: 'Budgets', match: p => p === '/spending/budgets', body: `
    <p>Set a total monthly budget and, optionally, limits for the categories you want to watch.</p>
    <ul><li>The marker on each bar is where you'd be if you spent evenly through the month — ahead of it means slow down.</li>
    <li><b>Fill from my averages</b> pre-fills each limit with your recent average.</li>
    <li>Leave the total blank to use the sum of the category limits.</li></ul>` },
  { id: 'recurring', title: 'Subscriptions & bills', match: p => p === '/spending/recurring', body: `
    <p>Everything that repeats: subscriptions (Netflix, Spotify, gym…) and bills (rent, utilities, phone, insurance). Set the <b>next charge date</b> — it then repeats on that day — and the <b>account it's charged to</b>.</p>
    <ul><li>With <b>add automatically</b> on, each payment is logged on its due date when you open the app. Off = a reminder you confirm with <b>Mark paid</b>.</li>
    <li><b>Take each charge off the account's balance</b> keeps that account's balance current between your updates.</li>
    <li><b>Pause</b> a subscription you cancelled — no more charges are added.</li>
    <li>Subscriptions per year make forgotten ones visible — review them once a year.</li></ul>` },
  { id: 'categories', title: 'Categories', match: p => p === '/spending/categories', body: `<p>Rename, add or remove spending categories and choose whether each is a <b>need</b> or a <b>want</b>. Pro input adds subcategories. 10–20 categories is the sweet spot.</p>` },
  { id: 'journal', title: 'Journal', match: p => p === '/journal', body: `
    <p>A two-minute daily check-in: mood, energy, stress, sleep, habits and a few lines on what's on your mind. Use ← → or the date picker to fill in or read other days.</p>
    <ul><li>Habits to tick are set in Settings → Lists.</li><li>Pro input adds "what went well / what was hard" and tags.</li><li>Entries stay in this browser like everything else.</li></ul>` },
  { id: 'jhistory', title: 'Journal history', match: p => p === '/journal/history', body: `<p>A calendar of your entries (emoji = mood) with what you spent each day, a year of consistency at a glance, and the month's entries to read back.</p>` },
  { id: 'jinsights', title: 'Journal insights', match: p => p === '/journal/insights', body: `<p>Mood, energy and stress over time, habit completion, sleep — and <b>how you feel vs what you spend</b>: average everyday spending on good vs low mood days, calm vs stressed days, rested vs tired days. Bills are left out so only day-to-day choices count. Small samples are noisy — a prompt for reflection, not a verdict.</p>` },
  { id: 'settings', title: 'Settings & data', match: p => p === '/settings', body: `<ul><li><b>Backups</b> — your data lives only in this browser. Export a backup regularly (you'll be reminded weekly). Backups are encrypted with a password you choose — keep it somewhere safe, a lost password can't be recovered.</li><li><b>Delete all data</b> — the Danger zone wipes everything this app stored in this browser.</li><li><b>Price data</b> — optional Finnhub key for stock prices.</li><li><b>Lists</b> — payment methods, journal habits and tags. <b>Transactions CSV</b> — import your bank statement or export everything.</li><li><b>Check for app update</b> — load the newest version.</li></ul>` },
  { id: 'general', title: 'Simple / Pro, themes & shortcuts', match: () => false, body: `<ul><li><b>Simple / Pro input</b> (Settings → Input mode) decides how much you fill in when adding accounts, expenses and journal entries. Every page and chart is the same in both, and switching never deletes anything.</li><li><b>Privacy mode</b> — the eye button (top right) or the <kbd>H</kbd> key hides every amount as “$•••”, for using the app in public. Press again to show them.</li><li><b>Sidebar</b> — click a section title (Net worth, Spending, Journal) to fold it away; drag the ⠿ handle that appears on hover to move a section up or down (or focus it and use ↑ ↓). Settings → Reset sidebar restores the original layout.</li><li><b>Theme</b> — Light, Dark or Auto (follows your device).</li><li>Press <kbd>?</kbd> anywhere to open this help.</li><li>Everything is stored in this browser (IndexedDB). Nothing is uploaded.</li><li><b>N</b> — add an expense from any page.</li></ul>` },
];

let drawer = null;
export function openHelp(path) {
  closeHelp();
  const here = GUIDE.find(g => g.match(path));
  drawer = document.createElement('div');
  drawer.className = 'drawer-wrap';
  drawer.innerHTML = String(html`<aside class="drawer" role="dialog" aria-modal="true" aria-label="Help">
    <header><h2>Help</h2><button class="icon-btn" data-x aria-label="Close help">✕</button></header>
    <div class="drawer-body">
      <button class="btn primary" data-tour-start>Take the 1-minute tour</button>
      ${here ? html`<section class="help-here"><h3>On this page</h3><h2>${here.title}</h2><div class="help-text">${raw(here.body)}</div></section>` : ''}
      <h3 class="mt">All features</h3>
      ${GUIDE.filter(g => g !== here).map(g => html`<details class="help-item"><summary>${g.title}</summary><div class="help-text">${raw(g.body)}</div></details>`)}
    </div></aside>`);
  document.body.append(drawer);
  drawer.addEventListener('mousedown', e => { if (e.target === drawer) closeHelp(); });
  drawer.querySelector('[data-x]').onclick = closeHelp;
  drawer.querySelector('[data-tour-start]').onclick = () => { closeHelp(); startTour(); };
  document.addEventListener('keydown', escClose);
  drawer.querySelector('[data-x]').focus();
}
function escClose(e) { if (e.key === 'Escape') closeHelp(); }
export function closeHelp() { drawer?.remove(); drawer = null; document.removeEventListener('keydown', escClose); }

