// Help drawer: help for the page you're on, plus the full guide.
import { html, raw } from './ui.js';
import { startTour } from './tour.js';

const GUIDE = [
  { id: 'overview', title: 'Overview', match: p => p === '/', body: `
    <p>One glance across the three parts: your net worth and how it changed, what you spent this month, how long your cash would last, the net-worth trend, today's journal with the last seven days, and this month's spending with the bills coming up.</p>
    <ul><li>Everything is worked out from what you entered. Where there isn't enough yet, it says so instead of guessing.</li>
    <li><b>Update balances</b> every so often (monthly is plenty) — each update is a point on your net-worth history.</li>
    <li><b>+ Expense</b> (or the <kbd>N</kbd> key) logs spending from any page.</li></ul>` },
  { id: 'nw', title: 'Net worth', match: p => p === '/networth', body: `
    <p>How your net worth moved over time. Net worth = everything you own − everything you owe, built from your <b>balance updates</b>; accounts you don't update keep their last value.</p>
    <ul><li><b>Growth per year</b> — the steady yearly rate from the first update in the range to today (needs a year of history).</li>
    <li><b>Change per update</b> — how much net worth moved between one update and the next.</li>
    <li><b>What it's made of, over time</b> — your assets by type, stacked.</li>
    <li><b>Account by account</b> — each balance, how it changed since the previous update, and its trend.</li>
    <li>The range buttons (1Y/3Y/5Y) zoom everything. With a single update the charts wait for your second one.</li></ul>
    <p>How your money is spread and how healthy it looks today is on <b>Insights</b>.</p>` },
  { id: 'accounts', title: 'Accounts', match: p => p === '/networth/accounts', body: `
    <p>Every asset and debt, grouped by type (Savings, Investments, Assets, Cash, Debt — or the detailed categories in Pro input). Each group shows its total and share of your assets; the chips at the top jump to a group.</p>
    <ul><li><b>Update</b> — record a new balance (today or an earlier date). The old value stays in the account's history; delete a wrong entry from the same dialog. <b>Update all</b> does every account in one go.</li>
    <li><b>Edit</b> — change the account itself: name, type, currency, interest rate. Close or delete it from there too.</li>
    <li><b>Interest / yield (APY)</b> — savings, money-market funds, deposits, bills and bonds. Used for the interest estimates on Insights; balances never grow on their own.</li>
    <li><b>Pro input</b> adds institution, purpose, liquidity and — for term deposits and bonds — a maturity date with a reminder a week before.</li>
    <li><b>Close</b> an account (Edit → Close) when it's sold or paid off — its history stays.</li></ul>
    <p><b>Trading capital</b> (bottom of the page) is for money you don't count as yours yet. Add what you put into your trading accounts in a year — count the capital you start the year with as put in on 1 January, and use a minus for money taken out — then set the balance at the end of the year. Result = balance − put in. It never touches your net worth; it's a starting point for your tax records.</p>` },
  { id: 'analytics', title: 'Insights', match: p => p === '/networth/analytics', body: `
    <p>How your money is spread and how healthy it looks <b>today</b>. (How it changed over time is on Net worth.)</p>
    <ul><li><b>Where it sits</b> and <b>how fast you could reach it</b> — assets by type, and a ladder from instant cash to illiquid.</li>
    <li><b>Interest</b> — what each account with an APY would earn per day, month and year, what your debts cost, and cash that earns nothing. Estimates only.</li>
    <li><b>Banks</b> — bank money added up per bank against the deposit guarantee limit (set yours in Settings); anything above it is unprotected if that bank fails. With more than one currency you also see your split by currency.</li>
    <li><b>Health check</b> — rules of thumb: cash runway against your target, liquid runway, interest vs spending, idle cash, concentration, and whether your balances are up to date.</li>
    <li><b>Target allocation</b> — set a target % per type. Red drift = outside the rebalancing band (5 points, or 25% of the target if smaller).</li></ul>` },
  { id: 'spending', title: 'Spending', match: p => p === '/spending', body: `
    <p>Month-by-month view of where your money goes. Use ← → to move between months.</p>
    <ul><li><b>Spending through the month</b> — cumulative spending vs last month and your budget pace.</li>
    <li><b>Usual month</b> — your average monthly spending from what you've logged lately (up to 90 days, at least a week). With no recent spending it uses the amount set in Settings.</li>
    <li><b>Projected month-end</b> = spent so far + your average daily spend for the remaining days + bills still due. Shown from day 7 of the month.</li>
    <li><b>Needs vs wants</b> — how this month's spending splits. Each category is a need or a want — change it in Settings → Categories.</li></ul>` },
  { id: 'transactions', title: 'Transactions', match: p => p === '/spending/transactions', body: `
    <p>Every expense, grouped by day. Filter by category or text; switch to <b>All time</b> to search everything.</p>
    <ul><li>Click an expense to edit or delete it.</li>
    <li><b>Paid from account</b> + <b>Take it off this account's balance</b> links spending to net worth: the account's balance drops today by the amount (converted to its currency). Editing or deleting the expense puts it back. On a credit card it adds to what you owe.</li>
    <li><b>Import CSV</b> takes your bank's statement export: money going out becomes expenses, money coming in is skipped, duplicates are skipped and merchants you've categorised before are recognised.</li>
    <li>Moving money between your own accounts isn't spending — just update both balances.</li></ul>` },
  { id: 'calendar', title: 'Calendar', match: p => p === '/spending/calendar', body: `<p>Each day shows what you spent (darker = more) and 🔁 bills that are coming up. Click a day to see its expenses or add one on that date. "—" marks a no-spend day.</p>` },
  { id: 'budgets', title: 'Budgets', match: p => p === '/settings/budgets', body: `
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
  { id: 'categories', title: 'Categories', match: p => p === '/settings/categories', body: `<p>Rename, add or remove spending categories and choose whether each is a <b>need</b> or a <b>want</b>. Pro input adds subcategories. 10–20 categories is the sweet spot.</p>` },
  { id: 'journal', title: 'Journal', match: p => p === '/journal', body: `
    <p>A two-minute daily check-in: mood, energy, stress, sleep, habits and a few lines on what's on your mind. Use ← → or the date picker to fill in or read other days.</p>
    <ul><li>Habits to tick are set in Settings → Lists.</li><li>Pro input adds "what went well / what was hard" and tags.</li><li>Entries stay in this browser like everything else.</li></ul>` },
  { id: 'jhistory', title: 'Journal history', match: p => p === '/journal/history', body: `<p>A calendar of your entries (emoji = mood) with what you spent each day, a year of consistency at a glance, and the month's entries to read back.</p>` },
  { id: 'jinsights', title: 'Journal insights', match: p => p === '/journal/insights', body: `<p>Mood, energy and stress over time, habit completion, sleep — and <b>how you feel vs what you spend</b>: average everyday spending on good vs low mood days, calm vs stressed days, rested vs tired days. Bills are left out so only day-to-day choices count. Small samples are noisy — a prompt for reflection, not a verdict.</p>` },
  { id: 'settings', title: 'Settings & data', match: p => p === '/settings', body: `<ul><li><b>Backups</b> — your data lives only in this browser. Export a backup now and then (you can get a weekly reminder). Backups are encrypted with a password you choose — keep it somewhere safe, a lost password can't be recovered.</li><li><b>Delete all data</b> — the Danger zone wipes everything this app stored in this browser.</li><li><b>Budgets</b> and <b>Categories</b> — the two tabs at the top.</li><li><b>Lists</b> — payment methods, journal habits and tags. <b>Transactions CSV</b> — import your bank statement or export everything.</li><li><b>Check for update</b> — load the newest version.</li></ul>` },
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

