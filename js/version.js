// App version + "check for update". The site is static, so an update means: fetch version.json
// fresh, and if it's newer, re-download every app file into the browser cache and reload.
export const APP_VERSION = '3.1.1';

export const CHANGELOG = [
  ['3.1.1', 'Polish: the “?” icons sit level with their labels, the delete-all confirmation reads on one line, and the journal’s mood, energy, stress and sleep fields are the same size.'],
  ['3.1.0', 'Every page has one job. Overview: net worth, this month’s spending and today’s journal at a glance. Net worth: how it changed over time. Insights: how your money is spread, what it earns and a health check — nothing shown twice. Accounts gains a small Trading capital note (what you put in per year, the balance at year end, the result) and the Withdrawals page is gone. Simple account types are Savings, Investments, Assets, Cash and Debt. Budgets and Categories moved into Settings.'],
  ['3.0.0', 'Money, rebuilt around real money. New Withdrawals page (replaces Money in & out): log what you move out of a broker, an exchange or a business, see it per month and year next to your spending. Net worth shows what moved it (withdrawn, spent, everything else) and which term deposits, bills and bonds mature next. Account types are now Savings, Bills & bonds, Investments, Assets, Cash and Debt. Insights checks how much sits at one bank against the deposit guarantee. Removed: crypto and trading categories, holdings and live prices — those accounts become plain Investments accounts and keep their history.'],
  ['2.0.2', 'Settings → Usual monthly spending: used for cash runway and your usual month whenever there is no recent logged spending; your real average takes over once you log a week again.'],
  ['2.0.1', 'The first screen offers a 1-minute tour next to Simple and Pro.'],
  ['2.0.0', 'Journal. Balances are updated right on Accounts & holdings (Update next to each account, or Update all), and every update is kept as history. Interest is an estimate on the Net worth page; balances no longer grow on their own. No more starting estimates: where there is not enough data yet, the app says so. Averages and cash runway need just a week of logged spending.'],
];

const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

// → { available: bool, latest: string, notes: string } ; throws if offline
export async function checkForUpdate() {
  const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`version.json responded ${r.status}`);
  const v = await r.json();
  return { available: newer(v.version, APP_VERSION), latest: v.version, notes: v.notes || '', files: v.files || [] };
}

// Refresh every app file in the HTTP cache, then reload the page.
export async function applyUpdate(files) {
  const list = ['index.html', ...files];
  await Promise.allSettled(list.map(f => fetch(f, { cache: 'reload' })));
  location.reload();
}
