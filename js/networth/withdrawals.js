// Withdrawals: money you moved out of a broker, an exchange or a business into your real accounts —
// the moment it becomes yours to spend or save. Per year: how much came out, from where, and how
// that compares with what you spent.
import * as store from '../store.js';
import { html, raw, money, pct, stat, fmtDate, today, modal, toast, confirmDlg, toNum, download } from '../ui.js';
import * as C from '../charts.js';
import { typeLabel, pointAt, wdValue } from './calc.js';
import { flow, undoFlow } from './ledger.js';
import { ccySelect, ccyOf, moneyIn, displayCcy, sameMoney } from '../fx.js';
import * as S from '../spend/calc.js';
import { refresh, query } from '../main.js';
import { byType } from './views.js';

const acct = id => store.get('nwAccounts', id);
const yearOf = d => d.slice(0, 4);
const sources = () => [...new Set(store.all('withdrawals').map(w => (w.source || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

async function editWithdrawal(w = {}) {
  const accts = store.all('nwAccounts').filter(a => a.kind !== 'liability' && (!a.archivedAt || a.id === w.accountId)).sort(byType(pointAt(today())));
  const last = [...store.all('withdrawals')].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  const res = await modal({
    title: w.id ? 'Edit withdrawal' : 'Add a withdrawal', wide: true,
    body: String(html`<form id="wdf" class="form-grid" autocomplete="off">
      <label class="field">Amount<input name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${w.amount ?? ''}" placeholder="0.00"></label>
      <label class="field">Currency${raw(ccySelect('currency', w.currency || last?.currency || displayCcy()))}</label>
      <label class="field">Date<input name="date" type="date" required value="${w.date || today()}" max="${today()}"></label>
      <label class="field">From<input name="source" maxlength="40" list="wd-src" value="${w.source ?? (w.id ? '' : last?.source || '')}" placeholder="e.g. Broker, Exchange, Business"><datalist id="wd-src">${sources().map(x => html`<option value="${x}">`)}</datalist></label>
      <label class="field span2">Into <span class="hint">optional</span><select name="accountId"><option value="">— not one of my accounts —</option>${accts.map(a => html`<option value="${a.id}" ${a.id === w.accountId ? raw('selected') : ''}>${a.name} · ${typeLabel(a)}</option>`)}</select></label>
      <label class="check full"><input type="checkbox" name="adjust" ${w.applied ? raw('checked') : ''}> Add it to that account's balance today <span class="hint" id="wd-hint"></span></label>
      <label class="field full">Note <span class="hint">optional</span><input name="note" maxlength="80" value="${w.note || ''}" placeholder="e.g. monthly living money, took profits"></label>
    </form>`),
    onMount: m => {
      const f = m.querySelector('#wdf');
      const sync = () => {
        const a = acct(f.accountId.value);
        f.adjust.disabled = !a; if (!a) f.adjust.checked = false;
        m.querySelector('#wd-hint').textContent = !a ? '— pick an account first' : w.applied ? '— already added; changes are adjusted' : `— leave off if you'll update the balance yourself`;
      };
      f.accountId.addEventListener('change', () => { const a = acct(f.accountId.value); if (a && !w.id) f.currency.value = ccyOf(a); sync(); });
      sync();
      setTimeout(() => f.amount.focus());
    },
    actions: [...(w.id ? [{ label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: m => {
      const f = m.querySelector('#wdf');
      const amount = toNum(f.amount.value);
      if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
      if (!f.date.value || f.date.value > today()) { toast('Pick a date (today or earlier)', 'error'); return false; }
      return { amount, currency: f.currency.value, date: f.date.value, source: f.source.value.trim(), accountId: f.accountId.value, note: f.note.value.trim(), adjust: f.adjust.checked && !f.adjust.disabled };
    } }],
  });
  if (res === 'delete') {
    if (!(await confirmDlg('Delete this withdrawal?', w.applied ? 'The amount it added to the account is taken off again.' : 'Balances are not affected.'))) return false;
    await undoFlow(w.applied); await store.del('withdrawals', w.id); toast('Withdrawal deleted'); return true;
  }
  if (!res || typeof res !== 'object') return false;
  if (w.applied) await undoFlow(w.applied);
  const { adjust, ...d } = res;
  const applied = adjust ? await flow(d.accountId, d.amount, d.currency, 'in') : null;
  await store.put('withdrawals', { ...w, ...d, applied });
  toast(`Withdrawal saved${applied ? ` · ${acct(d.accountId).name} updated` : ''}`);
  return true;
}

function exportCSV(yr, list, bySource) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const r2 = x => Math.round(x * 100) / 100;
  const lines = [['date', 'from', 'into_account', 'amount', 'currency', `amount_${displayCcy()}`, 'note'].join(',')];
  for (const w of [...list].sort((a, b) => a.date.localeCompare(b.date))) lines.push([w.date, q(w.source), q(acct(w.accountId)?.name || ''), w.amount, w.currency, r2(wdValue(w)), q(w.note)].join(','));
  lines.push('', ['from', 'withdrawals', `total_${displayCcy()}`].join(','));
  for (const s of bySource) lines.push([q(s.source), s.count, r2(s.total)].join(','));
  download(`withdrawals-${yr}.csv`, lines.join('\n'), 'text/csv');
}

export async function withdrawals(el) {
  const all = store.all('withdrawals');
  const t = today(), thisYear = yearOf(t);
  const yr = /^\d{4}$/.test(query().get('y') || '') ? query().get('y') : thisYear;
  const list = all.filter(w => yearOf(w.date) === yr).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const total = list.reduce((s, w) => s + wdValue(w), 0);
  const months = Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
  // months counted for the average: from the first withdrawal ever (or January) to now (or December)
  const firstEver = all.map(w => w.date).sort()[0] || t;
  const startM = yearOf(firstEver) === yr ? +firstEver.slice(5, 7) : 1, endM = yr === thisYear ? +t.slice(5, 7) : 12;
  const elapsed = yr > thisYear || yr < yearOf(firstEver) ? 0 : endM - startM + 1;
  const ex = S.expenses();
  const spentBy = months.map(m => (m <= t.slice(0, 7) ? S.sum(S.inMonth(ex, m)) : 0));
  const spent = spentBy.reduce((a, b) => a + b, 0);
  const wdBy = months.map(m => list.filter(w => w.date.startsWith(m)).reduce((s, w) => s + wdValue(w), 0));
  const srcMap = new Map();
  for (const w of list) { const k = (w.source || '').trim() || 'Not specified'; const e = srcMap.get(k) || { source: k, count: 0, total: 0 }; e.count++; e.total += wdValue(w); srcMap.set(k, e); }
  const bySource = [...srcMap.values()].sort((a, b) => b.total - a.total);
  const kept = total - spent;

  el.innerHTML = String(html`<div class="page-head"><div><h1>Withdrawals</h1><div class="sub">Money you moved out of a broker, an exchange or a business into your real accounts — and how it compares with what you spend.</div></div>
    <div class="actions"><div class="seg month-nav"><a class="btn" href="#/networth/withdrawals?y=${+yr - 1}" aria-label="Previous year">←</a><span class="title">${yr}</span><a class="btn" href="#/networth/withdrawals?y=${+yr + 1}" aria-label="Next year">→</a></div>
      ${all.length ? html`<button class="btn" data-csv>Export CSV</button>` : ''}<button class="btn primary" data-new>+ Add withdrawal</button></div></div>
    ${!all.length ? html`<div class="empty"><div class="empty-title">Nothing withdrawn yet</div>
      <p>Each time you take money out of a broker, an exchange or your business and it lands in your bank, log it here. You'll see how much you took out per month and per year, where it came from, and whether you spent more or less than you withdrew.</p>
      <button class="btn primary" data-new>+ Add your first withdrawal</button></div>` : html`
    <div class="stats big">
      ${stat(`Withdrawn in ${yr}`, money(total), { sub: `${list.length} withdrawal${list.length === 1 ? '' : 's'}` })}
      ${stat('Average per month', elapsed ? money(total / elapsed) : '—', { sub: elapsed ? `over ${elapsed} month${elapsed === 1 ? '' : 's'}${yr === thisYear ? ' so far' : ''}` : '' })}
      ${stat(`Spent in ${yr}`, spent ? money(spent) : '—', { sub: spent ? 'expenses you logged' : 'no spending logged' })}
      ${stat(kept >= 0 ? 'Kept' : 'Spent beyond withdrawals', spent && total ? money(Math.abs(kept)) : '—', { cls: spent && total ? (kept >= 0 ? 'pos' : 'neg') : '', sub: spent && total ? `${pct(spent / total, 0)} of what you withdrew was spent` : 'needs withdrawals and logged spending', help: 'Withdrawn minus the spending you logged in the same year. Positive: money that stayed in your accounts. Negative: you spent more than you took out, so it came from what you already had.' })}
    </div>
    <div class="grid g-2-1 mt">
      <div class="card"><div class="card-head"><h2>Per month</h2><span class="hint">withdrawn vs spent</span></div><div class="chart"><canvas id="wd-m"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Where it came from</h2><span class="hint">${yr}</span></div>
        ${bySource.length ? html`<div class="stack" style="gap:10px">${bySource.map(s => html`<div><div class="row small"><b>${s.source}</b><span class="muted">${s.count}×</span><span class="spacer"></span><b>${money(s.total)}</b><span class="muted">${pct(total ? s.total / total : 0, 0)}</span></div><div class="bar-mini lg"><span style="width:${total ? (s.total / total) * 100 : 0}%"></span></div></div>`)}</div>` : html`<p class="small muted">Nothing in ${yr}.</p>`}</div>
    </div>
    <div class="card mt" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Withdrawals</h2><span class="hint">${list.length} in ${yr} · click one to edit</span></div>
      ${list.length ? html`<div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Date</th><th>From</th><th>Into</th><th>Note</th><th class="num">Amount</th></tr></thead><tbody>
        ${list.map(w => html`<tr class="click" data-edit="${w.id}"><td style="white-space:nowrap">${fmtDate(w.date)}</td><td><b>${w.source || '—'}</b></td><td>${acct(w.accountId)?.name || html`<span class="muted">—</span>`}${w.applied ? html` <span class="tag">added to balance</span>` : ''}</td><td class="small muted">${w.note || ''}</td><td class="num"><b>${moneyIn(w.amount, w.currency)}</b>${!sameMoney(w.currency, displayCcy()) ? html`<div class="dist">≈ ${money(wdValue(w))}</div>` : ''}</td></tr>`)}
      </tbody><tfoot><tr><td colspan="4">Total</td><td class="num">${money(total)}</td></tr></tfoot></table></div>`
        : html`<p class="muted small" style="padding:0 16px 16px">Nothing withdrawn in ${yr}.</p>`}</div>`}`);

  el.querySelector('[data-csv]')?.addEventListener('click', () => exportCSV(yr, list, bySource));
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-new],[data-edit]'); if (!b) return;
    if (await editWithdrawal(b.dataset.edit ? store.get('withdrawals', b.dataset.edit) : {})) refresh();
  });
  if (!all.length) return;
  const p = C.palette();
  C.make(el.querySelector('#wd-m'), {
    type: 'bar',
    data: { labels: months.map(m => fmtDate(m + '-01', { month: 'short' })), datasets: [{ label: 'Withdrawn', data: wdBy, backgroundColor: p.series[0], maxBarThickness: 18 }, { label: 'Spent', data: spentBy, backgroundColor: p.neutral, maxBarThickness: 18 }] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis({ ticks: { maxRotation: 0 } }), y: C.moneyAxis({ beginAtZero: true }) } },
  });
}
