// Changing account balances from other parts of the app: an expense paid from an account, or a
// withdrawal that lands in one. The change is written into that day's balance, so it shows up in
// net worth right away; your next balance update simply overrides it with the real number.
import * as store from '../store.js';
import { valueAt } from './calc.js';
import { conv, ccyOf } from '../fx.js';
import { today } from '../ui.js';

// accounts whose balance can be changed this way
export const adjustable = a => !!a && !a.archivedAt;

// Add `delta` (in the account's own currency) to its balance on `date`. For a debt, a positive
// delta means you owe more. Returns the delta actually applied, or null if the account can't change.
export async function adjustBalance(acctId, delta, date = today()) {
  const a = store.get('nwAccounts', acctId);
  if (!adjustable(a) || !delta) return null;
  const before = valueAt(a, date);
  let after = Math.round((before + delta) * 100) / 100;
  if (a.kind === 'liability') after = Math.max(0, after);
  const snap = store.all('nwSnapshots').find(s => s.date === date);
  await store.put('nwSnapshots', { ...(snap || { date }), balances: { ...(snap?.balances || {}), [a.id]: after } });
  return after - before;
}

// Money leaving (dir 'out') or arriving in (dir 'in') an account. `amount` is in `ccy` and is
// converted to the account's currency. Paying with a credit card increases what you owe.
export async function flow(acctId, amount, ccy, dir) {
  const a = store.get('nwAccounts', acctId);
  if (!adjustable(a) || !(+amount > 0)) return null;
  const native = Math.round(conv(+amount, ccy || ccyOf(a), ccyOf(a)) * 100) / 100;
  const sign = (dir === 'out') === (a.kind !== 'liability') ? -1 : 1;
  const applied = await adjustBalance(a.id, sign * native);
  return applied == null ? null : { acctId: a.id, delta: applied };
}
// Undo an earlier flow() result
export async function undoFlow(rec) {
  if (!rec?.acctId || !rec.delta) return;
  await adjustBalance(rec.acctId, -rec.delta);
}

// ---------- expenses paid from an account ----------
// t.deduct = the user asked for it; t.deducted = what was actually taken off (to reverse on edit/delete)
export async function applyTxnDeduction(t) {
  if (!t.deduct || !t.accountId || t.type === 'income') return { ...t, deducted: null };
  const rec = await flow(t.accountId, t.amount, t.currency, 'out');
  return { ...t, deducted: rec };
}
export async function reverseTxnDeduction(t) {
  if (t?.deducted) await undoFlow(t.deducted);
}
