// Add / edit an expense. Simple: amount, category, date, note, and optionally the account it was
// paid from. Pro adds subcategory, merchant, payment method, need/want, tags, "exclude" and "repeats".
// "Take it off the account's balance" links spending to net worth: the account's balance drops.
import * as store from '../store.js';
import { html, raw, modal, toast, today, toNum } from '../ui.js';
import { ccySelect, displayCcy, moneyIn, ccyOf } from '../fx.js';
import { expenseCats, catById, KINDS } from './categories.js';
import { FREQS, nextDate } from './calc.js';
import { simpleMode, valueAt } from '../networth/calc.js';
import { applyTxnDeduction, reverseTxnDeduction, adjustable } from '../networth/ledger.js';

const lastCcy = () => { try { return localStorage.getItem('journal.lastCcy') || displayCcy(); } catch { return displayCcy(); } };
const chips = (type, sel) => html`${expenseCats().map(c => html`<label class="cat-chip"><input type="radio" name="category" value="${c.id}" ${c.id === sel ? raw('checked') : ''}><span>${c.emoji || '•'} ${c.name}</span></label>`)}`;
const subOpts = (catId, sel) => html`<option value="">—</option>${[...new Set([...(catById(catId).subs || []), ...(sel ? [sel] : [])])].map(s => html`<option ${s === sel ? raw('selected') : ''}>${s}</option>`)}`;

// returns the saved transaction, 'deleted', or null
export async function txnModal(t = {}, { date } = {}) {
  const pro = !simpleMode();
  const editing = !!t.id;
  const type = 'expense';
  const merchants = [...new Set(store.all('txns').map(x => (x.merchant || '').trim()).filter(Boolean))].slice(0, 200);
  const accts = store.all('nwAccounts').filter(a => !a.archivedAt || a.id === t.accountId).sort((a, b) => (a.kind === 'liability') - (b.kind === 'liability') || a.name.localeCompare(b.name));
  const lastAcct = (() => { try { return localStorage.getItem('journal.lastAcct') || ''; } catch { return ''; } })();
  const acctSel = editing ? t.accountId || '' : lastAcct && accts.some(a => a.id === lastAcct) ? lastAcct : '';
  const deduct0 = editing ? !!t.deduct : !!acctSel && (() => { try { return localStorage.getItem('journal.lastDeduct') === '1'; } catch { return false; } })();
  const methods = store.getSettings().payMethods || [];
  const res = await modal({
    title: editing ? 'Edit expense' : 'Add expense', wide: true,
    body: String(html`<form id="txf" class="form-grid" autocomplete="off">
      ${t.type === 'income' ? html`<div class="note full">This is an income entry from an older version. Income isn't tracked any more — delete it, or save it to turn it into an expense.</div>` : ''}
      <label class="field">Amount<input name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${t.amount ?? ''}" class="amount-input" placeholder="0.00"></label>
      <label class="field">Currency${raw(ccySelect('currency', t.currency || lastCcy()))}</label>
      <label class="field">Date<input name="date" type="date" required value="${t.date || date || today()}"></label>
      <div class="field full">Category<div class="cat-chips" id="cats">${chips(type, t.category)}</div></div>
      ${pro ? html`<label class="field">Subcategory<select name="sub">${subOpts(t.category, t.sub)}</select></label>` : ''}
      <label class="field ${pro ? '' : 'span2'}">Note <span class="hint">what was it?</span><input name="note" value="${t.note || ''}" maxlength="120" placeholder="e.g. Lunch with Alex"></label>
      ${pro ? html`<label class="field">Merchant / payee<input name="merchant" value="${t.merchant || ''}" list="merchants" maxlength="60"><datalist id="merchants">${merchants.map(m => html`<option>${m}</option>`)}</datalist></label>
        <label class="field">Payment method<select name="method"><option value="">—</option>${[...new Set([...methods, ...(t.method ? [t.method] : [])])].map(m => html`<option ${m === t.method ? raw('selected') : ''}>${m}</option>`)}</select></label>
        <label class="field kindf">Need or want<select name="kind"><option value="">Auto</option>${Object.entries(KINDS).map(([k, l]) => html`<option value="${k}" ${t.kind === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
        <label class="field">Tags <span class="hint">comma separated</span><input name="tags" value="${(t.tags || []).join(', ')}" maxlength="120" placeholder="holiday, work"></label>
        ${!editing ? html`<label class="field">Repeats<select name="repeat"><option value="">No</option>${Object.entries(FREQS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select></label>` : ''}
        <label class="check full"><input type="checkbox" name="exclude" ${t.exclude ? raw('checked') : ''}> Leave out of totals and budgets (e.g. a reimbursed work expense)</label>` : ''}
      ${accts.length ? html`<div class="full form-grid acct-row" style="padding:0">
        <label class="field span2">Paid from account <span class="hint">optional</span><select name="accountId"><option value="">—</option>${accts.map(a => html`<option value="${a.id}" ${a.id === acctSel ? raw('selected') : ''} ${adjustable(a) ? '' : raw('data-fixed="1"')}>${a.name}${a.kind === 'liability' ? ' (debt)' : ''}</option>`)}</select></label>
        <label class="check span2 deductf"><input type="checkbox" name="deduct" ${deduct0 ? raw('checked') : ''}> Take it off this account's balance <span class="hint" id="dd-hint"></span></label></div>` : ''}
    </form>`),
    onMount: w => {
      const f = w.querySelector('#txf');
      w.querySelector('#cats').addEventListener('change', () => { if (f.sub) f.sub.innerHTML = String(subOpts(f.querySelector('[name=category]:checked')?.value, '')); });
      const syncAcct = () => {
        if (!f.accountId) return;
        const opt = f.accountId.selectedOptions[0], a = store.get('nwAccounts', f.accountId.value);
        const df = w.querySelector('.deductf'); df.hidden = !a;
        const fixed = opt?.dataset.fixed;
        f.deduct.disabled = !!fixed; if (fixed) f.deduct.checked = false;
        w.querySelector('#dd-hint').textContent = !a ? '' : fixed ? '— its value comes from holdings' : a.kind === 'liability' ? '— adds it to what you owe' : editing && t.deducted ? '— already taken off; changes are adjusted' : '— its balance drops today';
      };
      f.accountId?.addEventListener('change', syncAcct); syncAcct();
      setTimeout(() => f.amount.focus());
    },
    actions: [
      ...(editing ? [{ label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []),
      { label: 'Cancel' },
      ...(!editing ? [{ label: 'Save & add another', value: w => read(w, true) }] : []),
      { label: 'Save', kind: 'primary', value: w => read(w, false) },
    ],
  });
  if (res === 'delete') { await reverseTxnDeduction(t); await store.del('txns', t.id); toast(t.deducted ? 'Expense deleted · balance restored' : 'Expense deleted'); return 'deleted'; }
  if (!res || typeof res !== 'object') return null;
  const { again, repeat, ...d } = res;
  // an edited expense: give back what was taken off before, then take off the new amount
  if (editing) await reverseTxnDeduction(t);
  const obj = await applyTxnDeduction({ ...t, ...d, type: 'expense' });
  const saved = await store.put('txns', obj);
  try { localStorage.setItem('journal.lastCcy', obj.currency); localStorage.setItem('journal.lastAcct', obj.accountId || ''); localStorage.setItem('journal.lastDeduct', obj.deduct ? '1' : '0'); } catch {}
  if (repeat) {
    const r = await store.put('recurring', { name: obj.note || obj.merchant || catById(obj.category).name, type: 'expense', amount: obj.amount, currency: obj.currency, category: obj.category, sub: obj.sub || '', merchant: obj.merchant || '', method: obj.method || '', accountId: obj.accountId || '', deduct: !!obj.deduct, freq: repeat, day: +obj.date.slice(8, 10), auto: true, next: nextDate({ freq: repeat, day: +obj.date.slice(8, 10) }, obj.date) });
    await store.put('txns', { ...saved, recurringId: r.id });
  }
  const acc = obj.deducted ? store.get('nwAccounts', obj.deducted.acctId) : null;
  toast(`${editing ? 'Expense updated' : 'Expense saved'}${acc ? ` · ${acc.name} ${acc.kind === 'liability' ? 'owes' : 'is now'} ${moneyIn(Math.abs(valueAt(acc, today())), ccyOf(acc))}` : ''}`);
  if (again) return txnModal({ currency: obj.currency, category: obj.category, accountId: obj.accountId, deduct: obj.deduct }, { date: obj.date });
  return saved;
}

function read(w, again) {
  const f = w.querySelector('#txf');
  const amount = toNum(f.amount.value);
  if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); f.amount.focus(); return false; }
  const category = f.querySelector('[name=category]:checked')?.value;
  if (!category) { toast('Pick a category', 'error'); return false; }
  if (!f.date.value) { toast('Pick a date', 'error'); return false; }
  const o = { type: 'expense', amount, currency: f.currency.value, date: f.date.value, category, note: f.note.value.trim() };
  if (f.accountId) Object.assign(o, { accountId: f.accountId.value, deduct: !!f.accountId.value && f.deduct.checked && !f.deduct.disabled });
  if (f.merchant) Object.assign(o, {
    sub: f.sub.value, merchant: f.merchant.value.trim(), method: f.method.value,
    kind: f.kind.value, tags: f.tags.value.split(',').map(x => x.trim()).filter(Boolean).slice(0, 10),
    exclude: f.exclude.checked, repeat: f.repeat?.value || '',
  });
  return { ...o, again };
}
