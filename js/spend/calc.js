// Spending calculations (expenses only — income isn't tracked; net worth comes from balances). All amounts are converted to the display currency on the transaction's date.
import { all, getSettings, put, putMany } from '../store.js';
import { toDisplay, ccyOf } from '../fx.js';
import { today, dayKey, parseDay, pad } from '../ui.js';
import { kindOf } from './categories.js';
import { baseline } from '../networth/calc.js';
import { applyTxnDeduction } from '../networth/ledger.js';

export const val = t => toDisplay(+t.amount || 0, ccyOf(t), t.date);
const counted = t => !t.exclude && t.date;
export const expenses = (list = all('txns')) => list.filter(t => counted(t) && t.type !== 'income');
export const inMonth = (list, m) => list.filter(t => t.date.startsWith(m));
export const sum = list => list.reduce((s, t) => s + val(t), 0);

export const shiftMonth = (m, n) => { const d = parseDay(m + '-01'); d.setMonth(d.getMonth() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
export const daysInMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo, 0).getDate(); };
export const currentMonth = () => today().slice(0, 7);

// totals per category (expenses) → [{ id, total, count }]
export function byCategory(list) {
  const m = new Map();
  for (const t of list) { const e = m.get(t.category) || { id: t.category, total: 0, count: 0 }; e.total += val(t); e.count++; m.set(t.category, e); }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
export function byKey(list, key) {
  const m = new Map();
  for (const t of list) { const k = (t[key] || '').trim(); if (!k) continue; const e = m.get(k.toLowerCase()) || { key: k, total: 0, count: 0 }; e.total += val(t); e.count++; m.set(k.toLowerCase(), e); }
  return [...m.values()].sort((a, b) => b.total - a.total);
}
// daily totals for a month → array indexed by day-1
export function dailyTotals(list, m) {
  const n = daysInMonth(m), out = Array(n).fill(0);
  for (const t of inMonth(list, m)) out[+t.date.slice(8, 10) - 1] += val(t);
  return out;
}

// Month summary used by the dashboard, overview and budgets
export function monthSummary(m = currentMonth()) {
  const ex = inMonth(expenses(), m);
  const spent = sum(ex);
  const n = daysInMonth(m), isCur = m === currentMonth(), isFuture = m > currentMonth();
  const dayNow = isCur ? +today().slice(8, 10) : isFuture ? 0 : n;
  const daily = dailyTotals(ex, m);
  const noSpend = daily.slice(0, dayNow).filter(v => v === 0).length;
  const avgDay = dayNow ? spent / dayNow : null;
  // projection: variable spending at the current daily pace + bills still due this month
  const due = isCur ? upcoming(m).filter(u => u.date > today() && u.date.startsWith(m) && u.type !== 'income').reduce((s, u) => s + u.value, 0) : 0;
  const recurDone = ex.filter(t => t.recurringId).reduce((s, t) => s + val(t), 0);
  const varSpent = spent - recurDone;
  // only once a week of the month has passed — before that a daily pace says little
  const projected = isCur ? (dayNow >= 7 ? spent + (varSpent / dayNow) * (n - dayNow) + due : null) : spent;
  const b = budgetFor(m);
  const left = b.total ? b.total - spent : null;
  const daysLeft = isCur ? n - dayNow + 1 : 0;
  // "safe to spend today": what's left of the budget, after bills still to come, spread over the remaining days
  const safeToday = isCur && b.total ? Math.max(0, (b.total - spent - due) / daysLeft) : null;
  const needs = ex.filter(t => kindOf(t) === 'need').reduce((s, t) => s + val(t), 0);
  const wants = spent - needs;
  const biggest = [...ex].sort((a, b2) => val(b2) - val(a))[0] || null;
  return { m, usualSpending: baseline().avgExpenses, spent, n, dayNow, daily, noSpend, avgDay, projected, due, budget: b.total, left, safeToday, daysLeft, needs, wants, count: ex.length, biggest, ex };
}

// same point in the previous month, for "vs last month"
export function spentToDay(m, day) { return sum(expenses().filter(t => t.date.startsWith(m) && +t.date.slice(8, 10) <= day)); }

// monthly totals for the last n months (inclusive of m)
export function monthsBack(m, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const k = shiftMonth(m, -i); out.push({ m: k, spent: sum(inMonth(expenses(), k)) }); }
  return out;
}
// average monthly spend per category over the n complete months before m
export function categoryAverages(m, n = 3) {
  const avg = {};
  const months = Array.from({ length: n }, (_, i) => shiftMonth(m, -(i + 1)));
  const have = months.filter(k => expenses().some(t => t.date.startsWith(k)));
  if (!have.length) return { avg, months: 0 };
  for (const k of have) for (const c of byCategory(inMonth(expenses(), k))) avg[c.id] = (avg[c.id] || 0) + c.total / have.length;
  return { avg, months: have.length };
}

// ---------- budgets ----------
export function budgetFor() {
  const b = getSettings().budgets || {};
  const byCat = Object.fromEntries(Object.entries(b.byCat || {}).filter(([, v]) => +v > 0).map(([k, v]) => [k, +v]));
  const catSum = Object.values(byCat).reduce((a, v) => a + v, 0);
  return { total: +b.total || catSum || 0, byCat, catSum, explicitTotal: +b.total || 0 };
}

// ---------- recurring bills & subscriptions ----------
// a subscription: flagged as one, or (older entries) filed under the Subscriptions category
export const isSubscription = r => r.type !== 'income' && (r.isSub === true || (r.isSub == null && r.category === 'subscriptions'));
export const FREQS = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };
const PER_YEAR = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
export const yearlyCost = r => (+r.amount || 0) * (PER_YEAR[r.freq] || 12);
export const monthlyCost = r => yearlyCost(r) / 12;

// next date after `d` for a recurring item (keeps the chosen day of month, clamped to month length)
export function nextDate(r, d) {
  const x = parseDay(d);
  if (r.freq === 'weekly') { x.setDate(x.getDate() + 7); return dayKey(x); }
  const step = r.freq === 'yearly' ? 12 : r.freq === 'quarterly' ? 3 : 1;
  const want = +r.day || +d.slice(8, 10);
  const y = x.getFullYear(), mo = x.getMonth() + step;
  const last = new Date(y, mo + 1, 0).getDate();
  return dayKey(new Date(y, mo, Math.min(want, last)));
}
// occurrences of active recurring items in the next `days` days (or within a month key)
export function upcoming(month, days = 45) {
  const out = [], end = month ? `${month}-31` : dayKey(new Date(Date.now() + days * 864e5));
  for (const r of all('recurring')) {
    if (r.paused || !r.next || r.type === 'income') continue;
    let d = r.next, guard = 0;
    while (d <= end && guard++ < 60) {
      if (!r.until || d <= r.until) out.push({ r, date: d, type: r.type || 'expense', value: toDisplay(+r.amount || 0, ccyOf(r), d) });
      d = nextDate(r, d);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
// Add transactions for every due occurrence (auto-add items). Returns how many were added.
export async function postDueRecurring() {
  const t = today(); let n = 0;
  for (const r of all('recurring')) {
    if (r.paused || !r.auto || !r.next || r.next > t || r.type === 'income') continue;
    const tx = []; let d = r.next, guard = 0;
    while (d <= t && guard++ < 400) {
      if (r.until && d > r.until) break;
      tx.push(await applyTxnDeduction(txnFromRecurring(r, d))); d = nextDate(r, d);
    }
    if (tx.length) await putMany('txns', tx);
    await put('recurring', { ...r, next: d });
    n += tx.length;
  }
  return n;
}
export const txnFromRecurring = (r, date) => ({ type: 'expense', deduct: !!(r.deduct && r.accountId), date, amount: +r.amount, currency: r.currency, category: r.category, sub: r.sub || '', note: r.name, merchant: r.merchant || '', method: r.method || '', accountId: r.accountId || '', recurringId: r.id });
