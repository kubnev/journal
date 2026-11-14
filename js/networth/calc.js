// Net worth calculations. Pure functions over the store.
import { all, getSettings } from '../store.js';
import { toDisplay, ccyOf } from '../fx.js';
import { today, dayKey, parseDay } from '../ui.js';

// Display order: savings → bills & bonds → investments → things you own → cash (debts last).
// ci = fixed colour slot, so a category keeps its colour whatever the order.
// liquid: can be turned into cash within days without major loss
export const ASSET_CATS = [
  { id: 'savings', label: 'Savings & money market', liquid: true, ci: 1 },
  { id: 'deposit', label: 'Term deposits', liquid: false, ci: 5 },
  { id: 'bonds', label: 'Bills & bonds', liquid: true, ci: 2 },
  { id: 'brokerage', label: 'Stocks & funds', liquid: true, ci: 3 },
  { id: 'retirement', label: 'Retirement & pension', liquid: false, ci: 4 },
  { id: 'business', label: 'Business equity', liquid: false, ci: 7 },
  { id: 'realestate', label: 'Real estate', liquid: false, ci: 6 },
  { id: 'vehicle', label: 'Vehicles', liquid: false, ci: 8 },
  { id: 'valuables', label: 'Valuables & collectibles', liquid: false, ci: 11 },
  { id: 'receivable', label: 'Money owed to you', liquid: false, ci: 9 },
  { id: 'otherasset', label: 'Other assets', liquid: false, ci: 10 },
  { id: 'cash', label: 'Cash & current accounts', liquid: true, ci: 0 },
];
export const LIAB_CATS = [
  { id: 'mortgage', label: 'Mortgage', shortTerm: false },
  { id: 'auto', label: 'Auto loan', shortTerm: false },
  { id: 'student', label: 'Student loan', shortTerm: false },
  { id: 'credit', label: 'Credit card', shortTerm: true },
  { id: 'personal', label: 'Personal loan', shortTerm: false },
  { id: 'tax', label: 'Taxes owed', shortTerm: true },
  { id: 'otherdebt', label: 'Other debt', shortTerm: false },
];
// Simple input mode: five kinds of asset + debt. Every detailed category belongs to exactly one,
// so switching modes never loses information (the detailed category is kept underneath).
export const GROUPS = [
  { id: 'savings', label: 'Savings', hint: 'Money you put aside — savings accounts, term deposits, money-market funds.', cat: 'savings', ci: 1 },
  { id: 'bonds', label: 'Bills & bonds', hint: 'Treasury bills, government and corporate bonds you hold to maturity.', cat: 'bonds', ci: 2 },
  { id: 'investments', label: 'Investments', hint: 'Long-term holdings — funds, stocks, pension, a share in a business.', cat: 'brokerage', ci: 3 },
  { id: 'assets', label: 'Assets', hint: 'Things you own outright — home, car, gold, watches, collectibles.', cat: 'otherasset', ci: 4 },
  { id: 'cash', label: 'Cash', hint: 'Money you spend day to day — current account, card balance, cash at home.', cat: 'cash', ci: 0 },
];
export const DEBT = { id: 'debt', label: 'Debt', hint: 'Anything you owe — loans, credit card balance, money borrowed from someone.', cat: 'otherdebt' };
const CAT_GROUP = { cash: 'cash', savings: 'savings', deposit: 'savings', bonds: 'bonds', brokerage: 'investments', retirement: 'investments', business: 'investments', realestate: 'assets', vehicle: 'assets', valuables: 'assets', receivable: 'assets', otherasset: 'assets' };
export const groupOf = a => (a.kind === 'liability' ? 'debt' : CAT_GROUP[a.category] || 'assets');
export const groupInfo = id => GROUPS.find(g => g.id === id) || DEBT;
export const simpleMode = () => getSettings().mode !== 'pro';
// The breakdown used by charts and tables: simple types in Simple mode, detailed categories in Pro
export const assetCats = () => (simpleMode() ? GROUPS : ASSET_CATS);
export const liabCats = () => (simpleMode() ? [DEBT] : LIAB_CATS);
export const catKey = a => (simpleMode() ? groupOf(a) : a.category);
export const typeLabel = a => (simpleMode() ? groupInfo(groupOf(a)).label : catLabel(a.category));

export const catInfo = id => ASSET_CATS.find(c => c.id === id) || LIAB_CATS.find(c => c.id === id) || { id, label: id };
export const catLabel = id => catInfo(id).label;
export const isLiquid = a => (a.liquid === true || a.liquid === false ? a.liquid : !!catInfo(a.category).liquid);
// kinds of account that can carry an interest rate and a maturity date
export const canMature = a => a.kind !== 'liability' && ['savings', 'deposit', 'bonds'].includes(a.category);

// Who holds it
export const CUSTODY = [
  { id: 'bank', label: 'Bank' },
  { id: 'broker', label: 'Broker / fund platform' },
  { id: 'state', label: 'Government / treasury' },
  { id: 'physical', label: 'Physical / property' },
  { id: 'other', label: 'Other' },
];
const CUSTODY_DEFAULT = { cash: 'bank', savings: 'bank', deposit: 'bank', bonds: 'broker', brokerage: 'broker', retirement: 'broker', realestate: 'physical', vehicle: 'physical', valuables: 'physical', business: 'other', receivable: 'other', otherasset: 'other' };
export const custodyOf = a => a.custody || CUSTODY_DEFAULT[a.category] || 'other';
export const custodyLabel = id => CUSTODY.find(c => c.id === id)?.label || id;

// What the money is for — user-defined buckets with sensible defaults
export const PURPOSES = ['Emergency fund', 'Spending', 'Safe reserve', 'Long-term investing', 'Retirement', 'Short-term goals', 'Home & property', 'Personal assets', 'Business'];
const PURPOSE_DEFAULT = { cash: 'Spending', savings: 'Emergency fund', deposit: 'Safe reserve', bonds: 'Safe reserve', brokerage: 'Long-term investing', retirement: 'Retirement', realestate: 'Home & property', vehicle: 'Personal assets', valuables: 'Personal assets', business: 'Business', receivable: 'Short-term goals', otherasset: 'Personal assets' };
export const purposeOf = a => (a.purpose || '').trim() || PURPOSE_DEFAULT[a.category] || 'Other';

// Liquidity tiers (how fast you could get to the money)
export const TIERS = ['Cash — instant', 'Sellable — days', 'Locked until a date', 'Illiquid — months+'];
export function tierOf(a) {
  if (['cash', 'savings'].includes(a.category) && a.liquid !== false) return TIERS[0];
  if (['deposit', 'retirement'].includes(a.category) && a.liquid !== true) return TIERS[2];
  return isLiquid(a) ? TIERS[1] : TIERS[3];
}

const sortedSnaps = () => [...all('nwSnapshots')].sort((a, b) => a.date.localeCompare(b.date));

// Value of one account on a date: the latest balance you recorded on or before that date.
// Nothing grows on its own — interest only shows up when you update the balance.
export function valueAt(acct, date, snaps = sortedSnaps()) {
  if (acct.archivedAt && date >= acct.archivedAt) return 0;
  let v = null;
  for (const s of snaps) { if (s.date > date) break; if (s.balances && acct.id in s.balances && s.balances[acct.id] !== null && s.balances[acct.id] !== '') v = +s.balances[acct.id]; }
  return v ?? 0;
}
// date of the latest balance you recorded for an account
export function lastUpdateOf(acct) {
  let d = null;
  for (const s of sortedSnaps()) if (s.date <= today() && s.balances && acct.id in s.balances && s.balances[acct.id] !== '' && s.balances[acct.id] != null) d = s.date;
  return d;
}

export function pointAt(date, snaps = sortedSnaps()) {
  const accts = all('nwAccounts');
  // byAcctNative: in each account's own currency; everything else in the display currency
  const p = { date, assets: 0, liabilities: 0, liquid: 0, shortDebt: 0, byCat: {}, byAcct: {}, byAcctNative: {}, byCustody: {}, byPurpose: {}, byTier: {} };
  for (const a of accts) {
    const native = valueAt(a, date, snaps);
    const v = toDisplay(native, ccyOf(a), date);
    p.byAcctNative[a.id] = native;
    p.byAcct[a.id] = v;
    const k = catKey(a);
    p.byCat[k] = (p.byCat[k] || 0) + v;
    if (a.kind === 'liability') { p.liabilities += v; if (catInfo(a.category).shortTerm) p.shortDebt += v; }
    else {
      p.assets += v; if (isLiquid(a)) p.liquid += v;
      const c = custodyOf(a), pu = purposeOf(a), t = tierOf(a);
      p.byCustody[c] = (p.byCustody[c] || 0) + v; p.byPurpose[pu] = (p.byPurpose[pu] || 0) + v; p.byTier[t] = (p.byTier[t] || 0) + v;
    }
  }
  p.net = p.assets - p.liabilities;
  p.liquidNet = p.liquid - p.liabilities;
  return p;
}

// One point per date you recorded balances
export function nwSeries() {
  if (!all('nwAccounts').length) return [];
  const snaps = sortedSnaps();
  return [...new Set(snaps.map(s => s.date))].filter(d => d <= today()).map(d => pointAt(d, snaps));
}

// ---------- usual spending ----------
// Your usual monthly spending. First choice: what you've logged lately — the last 90 days (or since
// you started logging again after a break of over a month), once that covers at least a week and
// you're still logging. Otherwise the amount you set in Settings. Otherwise nothing.
export const MIN_DAYS = 7;
const GAP = 30;   // a month without any expense counts as having stopped logging
export function baseline() {
  const t = today(), tk = parseDay(t);
  const ex = all('txns').filter(x => !x.exclude && x.date && x.type !== 'income' && x.date <= t);
  const dates = [...new Set(ex.map(x => x.date))].sort().reverse();
  const gap = (a, b) => Math.round((parseDay(a) - parseDay(b)) / 864e5);
  let start = null;
  if (dates.length && gap(t, dates[0]) <= GAP) { start = dates[0]; for (const d of dates.slice(1)) { if (gap(start, d) > GAP) break; start = d; } }
  const days = start ? gap(t, start) + 1 : 0;
  if (days >= MIN_DAYS) {
    const span = Math.min(days, 90);
    const fromKey = dayKey(new Date(tk.getTime() - (span - 1) * 864e5));
    const total = ex.filter(x => x.date >= fromKey).reduce((a, x) => a + toDisplay(+x.amount || 0, ccyOf(x), x.date), 0);
    return { avgExpenses: (total / span) * (365 / 12), days, enough: true, source: 'logged' };
  }
  const set = +getSettings().plan?.usualSpending;
  if (set > 0) return { avgExpenses: set, days, enough: true, source: 'set' };
  return { avgExpenses: null, days, enough: false, source: null };
}

// change in net worth between consecutive balance updates
export function changes(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) out.push({ date: series[i].date, change: series[i].net - series[i - 1].net });
  return out;
}

// ---------- interest (estimates) ----------
// What each account would earn at its APY (and each debt costs at its APR), at today's recorded
// balance. These are estimates for reference only — balances never change on their own.
export function interestOverview() {
  const accts = all('nwAccounts').filter(a => !a.archivedAt);
  const now = pointAt(today());
  const earn = accts.filter(a => a.kind !== 'liability' && +a.apy > 0).map(a => {
    const value = now.byAcct[a.id] || 0, apy = +a.apy, last = lastUpdateOf(a);
    const days = last ? Math.max(0, (parseDay(today()) - parseDay(last)) / 864e5) : 0;
    return { a, native: now.byAcctNative[a.id] || 0, value, apy, perYear: value * apy / 100, perMonth: value * apy / 1200, perDay: value * apy / 36500, sinceUpdate: value * (Math.pow(1 + apy / 100, days / 365) - 1), lastUpdate: last };
  }).filter(x => x.value > 0).sort((x, y) => y.perYear - x.perYear);
  const pay = accts.filter(a => a.kind === 'liability' && +a.rate > 0).map(a => {
    const owed = now.byAcct[a.id] || 0, rate = +a.rate;
    return { a, owed, rate, perYear: owed * rate / 100, perMonth: owed * rate / 1200 };
  }).filter(x => x.owed > 0).sort((x, y) => y.perYear - x.perYear);
  // cash & savings earning nothing
  const idle = accts.filter(a => a.kind !== 'liability' && !(+a.apy > 0) && ['cash', 'savings'].includes(a.category)).map(a => ({ a, value: now.byAcct[a.id] || 0 })).filter(x => x.value > 0).sort((x, y) => y.value - x.value);
  const sum = (l, k) => l.reduce((s, x) => s + x[k], 0);
  const earnValue = sum(earn, 'value');
  return { earn, pay, idle, earnValue, earnYear: sum(earn, 'perYear'), earnMonth: sum(earn, 'perMonth'), earnDay: sum(earn, 'perDay'), payYear: sum(pay, 'perYear'), payMonth: sum(pay, 'perMonth'),
    sinceUpdate: sum(earn, 'sinceUpdate'), blended: earnValue ? sum(earn, 'perYear') / earnValue : null, idleValue: sum(idle, 'value') };
}

export function debtMetrics(point) {
  const debts = all('nwAccounts').filter(a => a.kind === 'liability' && !a.archivedAt);
  const total = debts.reduce((s, a) => s + (point.byAcct[a.id] || 0), 0);
  const withRate = debts.filter(a => +a.rate > 0);
  const wRate = total ? withRate.reduce((s, a) => s + (point.byAcct[a.id] || 0) * +a.rate, 0) / total : null;
  const minPay = debts.reduce((s, a) => s + toDisplay(+a.payment || 0, ccyOf(a)), 0);
  return { total, wRate, minPay, debts };
}

// Asset accounts by size, for concentration
export function positions(point) {
  return all('nwAccounts').filter(a => a.kind !== 'liability' && !a.archivedAt && (point.byAcct[a.id] || 0) > 0)
    .map(a => ({ label: a.name, value: point.byAcct[a.id] })).sort((a, b) => b.value - a.value);
}
// Herfindahl–Hirschman index over position weights; 1/HHI = "effective number of positions"
export function concentration(list) {
  const tot = list.reduce((s, p) => s + p.value, 0);
  if (!tot) return { hhi: null, effective: null, top1: null, top5: null };
  const w = list.map(p => p.value / tot);
  const hhi = w.reduce((s, x) => s + x * x, 0);
  return { hhi, effective: 1 / hhi, top1: w[0], top5: w.slice(0, 5).reduce((a, b) => a + b, 0) };
}

// ---------- maturities ----------
// Term deposits, bills and bonds with a maturity date, soonest first. days < 0 = already matured.
export function maturities() {
  const now = pointAt(today());
  return all('nwAccounts').filter(a => !a.archivedAt && canMature(a) && a.maturity)
    .map(a => ({ a, date: a.maturity, value: now.byAcct[a.id] || 0, native: now.byAcctNative[a.id] || 0, days: Math.round((parseDay(a.maturity) - parseDay(today())) / 864e5) }))
    .sort((x, y) => x.date.localeCompare(y.date));
}

// ---------- money per bank ----------
// Bank money added up per institution (the institution you typed, else the account's name) —
// deposit guarantee schemes cover a fixed amount per bank.
export function bankExposure(point) {
  const m = new Map();
  for (const a of all('nwAccounts')) {
    const v = point.byAcct[a.id] || 0;
    if (a.kind === 'liability' || a.archivedAt || custodyOf(a) !== 'bank' || v <= 0) continue;
    const name = (a.institution || '').trim() || a.name, k = name.toLowerCase();
    const e = m.get(k) || { name, value: 0 }; e.value += v; m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

// ---------- withdrawals & what moved your net worth ----------
export const wdValue = w => toDisplay(+w.amount || 0, w.currency, w.date);
const between = (list, from, to) => list.filter(x => x.date && x.date > from && x.date <= to);
export const withdrawnBetween = (from, to) => between(all('withdrawals'), from, to).reduce((s, w) => s + wdValue(w), 0);
export const spentBetween = (from, to) => between(all('txns').filter(x => !x.exclude && x.type !== 'income'), from, to).reduce((s, x) => s + toDisplay(+x.amount || 0, ccyOf(x), x.date), 0);
// Between two balance updates: how much came in as withdrawals, how much you logged as spent, and
// the rest (interest, changes in what things are worth, anything you didn't log).
export function whatMoved(first, cur) {
  if (!first || !cur || first.date >= cur.date) return null;
  const change = cur.net - first.net, withdrawn = withdrawnBetween(first.date, cur.date), spent = spentBetween(first.date, cur.date);
  return { from: first.date, to: cur.date, change, withdrawn, spent, other: change - withdrawn + spent };
}
