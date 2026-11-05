// Money in & out: deposits into and withdrawals from your accounts (mainly brokers and exchanges),
// per calendar year — what you put in, what you took out, and how much the accounts made or lost
// on top of that. Handy at tax time. Amounts are cash moved, not realised gains.
import * as store from '../store.js';
import { html, raw, money, pct, stat, fmtDate, today, modal, toast, confirmDlg, toNum, download } from '../ui.js';
import * as C from '../charts.js';
import { groupOf, typeLabel, valueAt, pointAt } from './calc.js';
import { flow, undoFlow, adjustable } from './ledger.js';
import { ccySelect, ccyOf, moneyIn, toDisplay, displayCcy } from '../fx.js';
import { refresh, query } from '../main.js';
import { byType } from './views.js';

const acct = id => store.get('nwAccounts', id);
const val = f => toDisplay(+f.amount || 0, f.currency, f.date);
// accounts that count as "invested in the market" by default
const isMarket = a => a && a.kind !== 'liability' && ['investments', 'trading'].includes(groupOf(a));
const yearOf = d => d.slice(0, 4);

async function editFlow(f = {}) {
  const accts = store.all('nwAccounts').filter(a => a.kind !== 'liability' && (!a.archivedAt || a.id === f.accountId)).sort(byType(pointAt(today())));
  if (!accts.length) { toast('Add an account first', 'error'); return false; }
  const a0 = acct(f.accountId) || accts.find(isMarket) || accts[0];
  const res = await modal({
    title: f.id ? 'Edit entry' : 'Money in or out', wide: true,
    body: String(html`<form id="flf" class="form-grid" autocomplete="off">
      <div class="field full"><div class="seg type-seg" role="radiogroup"><button type="button" data-dir="in" class="${f.dir !== 'out' ? 'on' : ''}">Put in (deposit)</button><button type="button" data-dir="out" class="${f.dir === 'out' ? 'on' : ''}">Took out (withdrawal)</button></div><input type="hidden" name="dir" value="${f.dir === 'out' ? 'out' : 'in'}"></div>
      <label class="field span2">Account<select name="accountId">${accts.map(a => html`<option value="${a.id}" ${a.id === a0.id ? raw('selected') : ''}>${a.name} · ${typeLabel(a)}</option>`)}</select></label>
      <label class="field">Amount<input name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${f.amount ?? ''}" placeholder="0.00"></label>
      <label class="field">Currency${raw(ccySelect('currency', f.currency || ccyOf(a0)))}</label>
      <label class="field">Date<input name="date" type="date" required value="${f.date || today()}"></label>
      <label class="field span2">Note <span class="hint">optional</span><input name="note" maxlength="80" value="${f.note || ''}" placeholder="e.g. monthly ETF buy, took profits"></label>
      <label class="check full adjf"><input type="checkbox" name="adjust" ${f.applied ? raw('checked') : ''}> Also change this account's balance today <span class="hint" id="adj-hint"></span></label>
    </form>`),
    onMount: w => {
      const fm = w.querySelector('#flf');
      w.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { fm.dir.value = b.dataset.dir; w.querySelectorAll('[data-dir]').forEach(x => x.classList.toggle('on', x === b)); sync(); });
      const sync = () => {
        const a = acct(fm.accountId.value), ok = adjustable(a);
        fm.adjust.disabled = !ok; if (!ok) fm.adjust.checked = false;
        w.querySelector('#adj-hint').textContent = !ok ? '— its value comes from holdings' : f.applied ? '— already applied; changes are adjusted' : `— leave off if you'll type the new balance on Update balances anyway`;
      };
      fm.accountId.addEventListener('change', () => { const a = acct(fm.accountId.value); if (a && !f.id) fm.currency.value = ccyOf(a); sync(); });
      sync();
      setTimeout(() => fm.amount.focus());
    },
    actions: [...(f.id ? [{ label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => {
      const fm = w.querySelector('#flf');
      const amount = toNum(fm.amount.value);
      if (!(amount > 0)) { toast('Enter an amount above zero', 'error'); return false; }
      if (!fm.date.value) { toast('Pick a date', 'error'); return false; }
      return { dir: fm.dir.value === 'out' ? 'out' : 'in', accountId: fm.accountId.value, amount, currency: fm.currency.value, date: fm.date.value, note: fm.note.value.trim(), adjust: fm.adjust.checked && !fm.adjust.disabled };
    } }],
  });
  if (res === 'delete') {
    if (!(await confirmDlg('Delete this entry?', f.applied ? 'The balance change it made is reversed too.' : 'Balances are not affected.'))) return false;
    await undoFlow(f.applied); await store.del('nwFlows', f.id); toast('Entry deleted'); return true;
  }
  if (!res || typeof res !== 'object') return false;
  if (f.applied) await undoFlow(f.applied);
  const { adjust, ...d } = res;
  const applied = adjust ? await flow(d.accountId, d.amount, d.currency, d.dir) : null;
  await store.put('nwFlows', { ...f, ...d, applied });
  toast(`${d.dir === 'in' ? 'Deposit' : 'Withdrawal'} saved${applied ? ' · balance updated' : ''}`);
  return true;
}

// Per account for one calendar year: money in, money out, value at the start and end, and the result
// (end − start − net money in). The start is 1 January, or the first balance update in that year
// for an account you started tracking later (money moved before that date is already in its value).
function yearSummary(yr) {
  const t = today(), from = `${yr}-01-01`, to = `${yr}-12-31` < t ? `${yr}-12-31` : t;
  const flows = store.all('nwFlows').filter(f => yearOf(f.date) === yr);
  const snaps = [...store.all('nwSnapshots')].sort((a, b) => a.date.localeCompare(b.date));
  const ids = new Set([...flows.map(f => f.accountId), ...store.all('nwAccounts').filter(a => isMarket(a) && (!a.archivedAt || a.archivedAt >= from)).map(a => a.id)]);
  const rows = [];
  for (const id of ids) {
    const a = acct(id);
    if (!a) continue;
    const firstSnap = snaps.find(s => s.balances && id in s.balances)?.date;
    if (!firstSnap || firstSnap > to) { if (!flows.some(f => f.accountId === id)) continue; }
    const start = firstSnap && firstSnap > from ? firstSnap : from;
    const own = flows.filter(f => f.accountId === id);
    const counted = own.filter(f => f.date > start || start === from);
    const inn = own.filter(f => f.dir !== 'out').reduce((s, f) => s + val(f), 0), out = own.filter(f => f.dir === 'out').reduce((s, f) => s + val(f), 0);
    const cin = counted.filter(f => f.dir !== 'out').reduce((s, f) => s + val(f), 0), cout = counted.filter(f => f.dir === 'out').reduce((s, f) => s + val(f), 0);
    const v0 = firstSnap && firstSnap <= to ? toDisplay(valueAt(a, start), ccyOf(a), start) : null;
    const v1 = firstSnap && firstSnap <= to ? toDisplay(valueAt(a, to), ccyOf(a), to) : null;
    rows.push({ a, inn, out, net: inn - out, v0, v1, start, result: v0 != null && v1 != null ? v1 - v0 - (cin - cout) : null });
  }
  rows.sort((x, y) => byType(pointAt(to))(x.a, y.a));
  const sum = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return { yr, from, to, flows, rows, inn: sum('inn'), out: sum('out'), net: sum('inn') - sum('out'), result: rows.some(r => r.result != null) ? sum('result') : null, v0: sum('v0') };
}

function exportCSV(sum) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [['date', 'account', 'type', 'amount', 'currency', `amount_${displayCcy()}`, 'note'].join(',')];
  for (const f of [...sum.flows].sort((a, b) => a.date.localeCompare(b.date))) lines.push([f.date, q(acct(f.accountId)?.name || ''), f.dir === 'out' ? 'withdrawal' : 'deposit', f.amount, f.currency, Math.round(val(f) * 100) / 100, q(f.note)].join(','));
  lines.push('', ['account', 'money_in', 'money_out', 'net_in', 'value_start', 'value_end', 'result'].join(','));
  for (const r of sum.rows) lines.push([q(r.a.name), ...[r.inn, r.out, r.net, r.v0, r.v1, r.result].map(x => (x == null ? '' : Math.round(x * 100) / 100))].join(','));
  download(`money-in-out-${sum.yr}.csv`, lines.join('\n'), 'text/csv');
}

export async function flows(el) {
  const years = [...new Set([today().slice(0, 4), ...store.all('nwFlows').map(f => yearOf(f.date))])].sort();
  const yr = /^\d{4}$/.test(query().get('y') || '') ? query().get('y') : today().slice(0, 4);
  const s = yearSummary(yr);
  const ret = s.v0 > 0 && s.result != null ? s.result / (s.v0 + Math.max(0, s.net) / 2) : null;
  const months = Array.from({ length: 12 }, (_, i) => `${yr}-${String(i + 1).padStart(2, '0')}`);
  el.innerHTML = String(html`<div class="page-head"><div><h1>Money in & out</h1><div class="sub">What you put into and took out of your accounts — brokers, exchanges, savings — per year, and what the accounts made on top. For your own records and taxes.</div></div>
    <div class="actions"><div class="seg month-nav"><a class="btn" href="#/networth/flows?y=${+yr - 1}" aria-label="Previous year">←</a><span class="title">${yr}</span><a class="btn" href="#/networth/flows?y=${+yr + 1}" aria-label="Next year">→</a></div>
      <button class="btn" data-csv>Export CSV</button><button class="btn primary" data-new>+ Add in / out</button></div></div>
    <div class="stats big">
      ${stat('Put in', money(s.inn), { sub: (n => `${n} deposit${n === 1 ? '' : 's'} in ${yr}`)(s.flows.filter(f => f.dir !== 'out').length) })}
      ${stat('Taken out', money(s.out), { sub: (n => `${n} withdrawal${n === 1 ? '' : 's'}`)(s.flows.filter(f => f.dir === 'out').length) })}
      ${stat('Net put in', money(s.net, { sign: true }), { cls: s.net ? (s.net > 0 ? 'pos' : 'neg') : '', sub: s.net >= 0 ? 'more in than out' : 'more out than in' })}
      ${stat('Result on top', s.result != null ? money(s.result, { sign: true }) : '—', { cls: s.result > 0 ? 'pos' : s.result < 0 ? 'neg' : '', sub: s.result != null ? (ret != null ? `≈ ${pct(ret, 1, { sign: true })} on the money invested` : 'value change minus money moved') : 'needs balance updates', help: 'For each account: value at the end of the year (or today) − value at the start of the year − money you put in + money you took out. Gains, losses, interest and fees together. An estimate — not realised gains for tax.' })}
    </div>
    <div class="card mt" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>By account</h2><span class="hint">investments & trading accounts, plus any account with entries</span></div>
      ${s.rows.length ? html`<div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Account</th><th class="num">Put in</th><th class="num">Taken out</th><th class="num">Net in</th><th class="num">Value at start</th><th class="num">Value now / end</th><th class="num">Result</th></tr></thead><tbody>
        ${s.rows.map(r => html`<tr><td><b>${r.a.name}</b><div class="small muted">${typeLabel(r.a)}${r.start !== s.from ? ` · tracked from ${fmtDate(r.start, { month: 'short', day: 'numeric' })}` : ''}</div></td><td class="num">${r.inn ? money(r.inn) : '—'}</td><td class="num">${r.out ? money(r.out) : '—'}</td><td class="num ${r.net > 0 ? 'pos' : r.net < 0 ? 'neg' : ''}">${r.net ? money(r.net, { sign: true }) : '—'}</td><td class="num">${r.v0 != null ? money(r.v0) : '—'}</td><td class="num">${r.v1 != null ? money(r.v1) : '—'}</td><td class="num ${r.result > 0 ? 'pos' : r.result < 0 ? 'neg' : ''}">${r.result != null ? money(r.result, { sign: true }) : '—'}</td></tr>`)}
      </tbody><tfoot><tr><td>Total</td><td class="num">${money(s.inn)}</td><td class="num">${money(s.out)}</td><td class="num">${money(s.net, { sign: true })}</td><td class="num">${money(s.v0)}</td><td class="num"></td><td class="num">${s.result != null ? money(s.result, { sign: true }) : '—'}</td></tr></tfoot></table></div>`
        : html`<p class="muted small" style="padding:0 16px 16px">No investment or trading accounts yet, and nothing logged for ${yr}.</p>`}</div>
    <div class="grid g-2-1 mt">
      <div class="card"><div class="card-head"><h2>Per month</h2><span class="hint">in above the line, out below</span></div><div class="chart"><canvas id="fl-m"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Entries</h2><span class="hint">${s.flows.length} in ${yr}</span></div>
        ${s.flows.length ? html`<div class="stack" style="gap:0">${[...s.flows].sort((a, b) => b.date.localeCompare(a.date)).map(f => html`<button class="flow-row" data-edit="${f.id}"><span class="muted small">${fmtDate(f.date, { month: 'short', day: 'numeric' })}</span><span class="ellipsis"><b>${acct(f.accountId)?.name || 'deleted account'}</b>${f.note ? html` <span class="muted small">${f.note}</span>` : ''}</span><b class="${f.dir === 'out' ? 'neg' : 'pos'}">${f.dir === 'out' ? '−' : '+'}${moneyIn(+f.amount, f.currency)}</b></button>`)}</div>`
          : html`<p class="small muted">Log each deposit to a broker or exchange and each withdrawal back to your bank. The year's totals and the CSV export build from these.</p><button class="btn sm" data-new>+ Add the first one</button>`}</div>
    </div>
    <p class="small muted mt">“Result” is an estimate from your balance updates (gains, losses, interest and fees together). It is not your realised profit for tax — your broker's annual statement is the source for that.</p>`);
  const p = C.palette();
  const ins = months.map(m => s.flows.filter(f => f.date.startsWith(m) && f.dir !== 'out').reduce((a, f) => a + val(f), 0));
  const outs = months.map(m => -s.flows.filter(f => f.date.startsWith(m) && f.dir === 'out').reduce((a, f) => a + val(f), 0));
  C.make(el.querySelector('#fl-m'), {
    type: 'bar',
    data: { labels: months.map(m => fmtDate(m + '-01', { month: 'short' })), datasets: [{ label: 'Put in', data: ins, backgroundColor: p.pos, maxBarThickness: 22, stack: 's' }, { label: 'Taken out', data: outs, backgroundColor: p.neg, maxBarThickness: 22, stack: 's' }] },
    options: { plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(Math.abs(c.parsed.y))}` } } }, scales: { x: { stacked: true, ...C.plainAxis({ ticks: { maxRotation: 0 } }) }, y: { stacked: true, ...C.moneyAxis() } } },
  });
  el.querySelector('[data-csv]').onclick = () => exportCSV(s);
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-new],[data-edit]'); if (!b) return;
    if (await editFlow(b.dataset.edit ? store.get('nwFlows', b.dataset.edit) : {})) refresh();
  });
}
