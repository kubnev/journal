// Spending: dashboard, transactions, calendar, budgets, bills & subscriptions, categories.
import * as store from '../store.js';
import { html, raw, money, pct, num, stat, fmtDate, fmtMonth, today, modal, toast, confirmDlg, formData, toNum, parseDay, pad } from '../ui.js';
import * as C from '../charts.js';
import { ccySelect, displayCcy, ccyOf, moneyIn, sameMoney } from '../fx.js';
import { expenseCats, catById, catLabel, catColor, KINDS, saveCategories, slug, EXPENSE_DEFAULTS } from './categories.js';
import * as S from './calc.js';
import { txnModal } from './txn.js';
import { importTxnsDialog, exportTxnsCSV } from './csv.js';
import { refresh, query, go } from '../main.js';
import { simpleMode, baseline } from '../networth/calc.js';
import { applyTxnDeduction, adjustable } from '../networth/ledger.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const monthParam = () => { const m = query().get('m'); return /^\d{4}-\d{2}$/.test(m || '') ? m : S.currentMonth(); };
const monthNav = (base, m) => html`<div class="seg month-nav"><a class="btn" href="#${base}?m=${S.shiftMonth(m, -1)}" aria-label="Previous month">←</a><span class="title">${fmtMonthLong(m)}</span><a class="btn" href="#${base}?m=${S.shiftMonth(m, 1)}" aria-label="Next month">→</a>${m !== S.currentMonth() ? html`<a class="btn" href="#${base}">This month</a>` : ''}</div>`;
export const fmtMonthLong = m => parseDay(m + '-01').toLocaleDateString(store.getSettings().locale, { month: 'long', year: 'numeric' });
const addBtn = (label = '+ Add transaction') => html`<button class="btn primary" data-add>${label}</button>`;
const wireAdd = (el, opts) => el.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => { if (await txnModal({}, opts?.())) refresh(); });
const emptySpend = () => html`<div class="empty"><div class="empty-title">No transactions yet</div>
  <p>Log what you spend — it takes a few seconds. Press <kbd>N</kbd> anywhere to add one. You can also import a CSV from your bank.</p>
  <button class="btn primary" data-add>+ Add your first expense</button><button class="btn" data-import>Import bank CSV</button></div>`;
const wireEmpty = el => {
  wireAdd(el);
  el.querySelector('[data-import]')?.addEventListener('click', async () => { if (await importTxnsDialog()) refresh(); });
};
// subtitle: category · subcategory · merchant · method … without repeating the title or itself
const txnMeta = t => {
  const title = (t.note || t.merchant || catById(t.category).name).toLowerCase();
  const seen = new Set([title]);
  return [catById(t.category).name, t.sub, t.merchant, t.method, t.recurringId ? '🔁 recurring' : '', ...(t.tags || []).map(x => '#' + x), t.exclude ? 'not counted' : '']
    .filter(x => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase())).join(' · ');
};
const amt = t => html`<span>${moneyIn(-t.amount, ccyOf(t))}</span>`;
// ================= dashboard =================
export async function dashboard(el) {
  const m = monthParam();
  const all = store.all('txns');
  el.innerHTML = String(html`<div class="page-head"><div><h1>Spending</h1><div class="sub">Where your money goes, month by month.</div></div>
    <div class="actions">${monthNav('/spending', m)}${addBtn()}</div></div><div id="body"></div>`);
  wireAdd(el);
  const body = el.querySelector('#body');
  if (!all.length) { body.innerHTML = String(emptySpend()); wireEmpty(body); return; }
  const s = S.monthSummary(m);
  const prevM = S.shiftMonth(m, -1);
  const prevToDay = S.spentToDay(prevM, s.dayNow);
  const vsPrev = prevToDay ? (s.spent - prevToDay) / prevToDay : null;
  const cats = S.byCategory(s.ex);
  const { avg, months: avgN } = S.categoryAverages(m, 3);
  const b = S.budgetFor(m);
  const hist = S.monthsBack(m, 12).filter((x, i, a) => x.spent || a.slice(0, i).some(y => y.spent));
  const histAvg = hist.length ? hist.reduce((a, x) => a + x.spent, 0) / hist.length : 0;
  const isCur = m === S.currentMonth();
  const up = isCur ? S.upcoming(null, 14).filter(u => u.date >= today()) : [];
  const base = s.usualSpending;
  const merchants = S.byKey(s.ex, 'merchant').slice(0, 6);
  const biggest = [...s.ex].sort((a, b2) => S.val(b2) - S.val(a)).slice(0, 6);
  // everyday spending by weekday (bills left out — rent on the 1st would skew whichever weekday it fell on)
  const everyday = S.dailyTotals(s.ex.filter(t => !t.recurringId), m);
  const wd = Array(7).fill(0), wdN = Array(7).fill(0);
  for (let d = 1; d <= (s.dayNow || 0); d++) { const i = (parseDay(`${m}-${pad(d)}`).getDay() + 6) % 7; wd[i] += everyday[d - 1]; wdN[i]++; }
  const paceBudget = b.total && isCur ? b.total * (s.dayNow / s.n) : null;

  body.innerHTML = String(html`
    <div class="stats big">
      ${stat(isCur ? 'Spent this month' : 'Spent', money(s.spent), { sub: vsPrev != null ? html`<span class="${vsPrev > 0 ? 'neg' : 'pos'}">${pct(vsPrev, 0, { sign: true })}</span> vs ${fmtMonth(prevM)}${isCur ? ' at this point' : ''}` : `${s.count} transactions` })}
      ${stat('Usual month', base != null ? money(base) : '—', { sub: base != null ? (isCur && s.spent ? `${pct(s.spent / base, 0)} of it spent so far` : s.usualSource === 'set' ? 'set in Settings' : 'from your recent spending') : html`log a week, or <a href="#/settings">set it</a>`, help: 'Your average spending per month from what you’ve logged lately (up to 90 days). With no recent spending, the amount you set in Settings.' })}
      ${b.total ? stat(s.left < 0 ? 'Over budget by' : isCur ? 'Left in budget' : 'Under budget by', money(Math.abs(s.left)), { cls: s.left < 0 ? 'neg' : 'pos', sub: isCur && s.safeToday != null ? html`<b>${money(s.safeToday)}</b> safe to spend per day` : `of ${money(b.total)}`, help: 'Safe to spend per day = budget left, minus bills still due this month, divided by the days left.' })
                : stat('Daily average', money(s.avgDay), { sub: html`<a href="#/spending/budgets">set a budget</a> to get a daily limit` })}
      ${stat(isCur ? 'Projected month-end' : 'Daily average', isCur ? (s.projected != null ? money(s.projected) : '—') : money(s.avgDay), { cls: isCur && b.total && s.projected > b.total ? 'neg' : '', sub: isCur ? (s.projected == null ? 'not enough data — from day 7 of the month' : b.total ? (s.projected > b.total ? `${money(s.projected - b.total)} over budget at this pace` : 'within budget at this pace') : 'at your current pace + bills due') : `${s.noSpend} no-spend days`, help: 'Your spending so far, plus your average daily spend for the days left, plus recurring bills still due this month.' })}
      ${stat('No-spend days', `${s.noSpend}`, { sub: `of ${s.dayNow || s.n} days${isCur ? ' so far' : ''}`, help: 'Days with no expenses logged. A simple streak to aim for.' })}
    </div>
    <div class="grid g-2-1 mt">
      <div class="card"><div class="card-head"><h2>Spending through the month</h2><span class="hint">cumulative, vs last month${b.total ? ' and budget' : ''}</span></div><div class="chart tall"><canvas id="s-pace"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>By category</h2><span class="hint">${fmtMonth(m)}</span></div>${cats.length ? html`<div class="chart tall"><canvas id="s-cat"></canvas></div>` : html`<p class="muted small">No spending this month.</p>`}</div>
    </div>
    ${subsCard()}
    <div class="grid g2 mt">
      <div class="card" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Categories</h2><span class="hint">${avgN ? `vs your ${avgN}-month average` : 'averages appear after your first full month'}</span></div>
        ${cats.length ? html`<div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th>Category</th><th class="num">Spent</th><th class="num">Avg</th><th class="num">Change</th>${b.catSum ? raw('<th style="width:110px">Budget</th>') : ''}</tr></thead><tbody>
          ${cats.map(c => { const a = avg[c.id], ch = a ? (c.total - a) / a : null, bud = b.byCat[c.id]; return html`<tr class="click" data-href="#/spending/transactions?m=${m}&cat=${c.id}"><td>${catLabel(c.id)} <span class="muted small">${c.count}×</span></td><td class="num"><b>${money(c.total)}</b></td><td class="num muted">${a ? money(a) : '—'}</td><td class="num ${ch == null ? '' : ch > 0.1 ? 'neg' : ch < -0.1 ? 'pos' : ''}">${ch == null ? '—' : pct(ch, 0, { sign: true })}</td>${b.catSum ? html`<td>${bud ? html`<div class="bar-mini" title="${money(c.total)} of ${money(bud)}"><span style="width:${Math.min(100, (c.total / bud) * 100)}%" class="${c.total > bud ? 'over' : ''}"></span></div>` : html`<span class="muted small">—</span>`}</td>` : ''}</tr>`; })}
        </tbody></table></div>` : html`<p class="muted small" style="padding:0 16px 16px">Nothing yet.</p>`}</div>
      <div class="card"><div class="card-head"><h2>Monthly spending</h2><span class="hint">last ${hist.length} months${hist.length > 1 ? ` · avg ${money(histAvg)}` : ''}</span></div><div class="chart"><canvas id="s-ie"></canvas></div></div>
    </div>
    <div class="grid g3 mt">
      <div class="card"><div class="card-head"><h2>Needs vs wants</h2><span class="hint">share of this month's spending</span></div>
        ${s.spent ? html`${[['Needs', s.needs, 'Rent, bills, groceries, transport…'], ['Wants', s.wants, 'Eating out, shopping, fun…']].map(([l, v, hint]) => html`<div class="nws"><div class="row small"><b>${l}</b><span class="muted">${hint}</span><span class="spacer"></span><b>${money(v)}</b><span class="muted">${pct(v / s.spent, 0)}</span></div><div class="bar-mini lg"><span style="width:${Math.min(100, (v / s.spent) * 100)}%" class="${l === 'Wants' ? 'warn' : ''}"></span></div></div>`)}
          <p class="small muted mt">Each category is a need or a want — change it on <a href="#/spending/categories">Categories</a>.</p>` : html`<p class="small muted">Nothing spent yet this month.</p>`}
      </div>
      <div class="card"><div class="card-head"><h2>By weekday</h2><span class="hint">everyday spending, avg per day</span></div><div class="chart short"><canvas id="s-wd"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>${merchants.length >= 2 ? 'Top merchants' : 'Biggest expenses'}</h2></div>
        ${merchants.length >= 2 ? html`<dl class="kv">${merchants.map(x => html`<dt>${x.key} <span class="muted small">${x.count}×</span></dt><dd>${money(x.total)}</dd>`)}</dl>`
          : biggest.length ? html`<dl class="kv">${biggest.map(t => html`<dt>${catLabel(t.category).split(' ')[0]} ${t.note || catById(t.category).name} <span class="muted small">${fmtDate(t.date, { month: 'short', day: 'numeric' })}</span></dt><dd>${money(S.val(t))}</dd>`)}</dl>` : html`<p class="muted small">—</p>`}</div>
    </div>
    ${up.length ? html`<div class="card mt"><div class="card-head"><h2>Coming up</h2><a class="hint" href="#/spending/recurring">Subscriptions & bills →</a></div>
      <div class="upcoming">${up.slice(0, 8).map(u => html`<div class="up-item"><span class="muted small">${fmtDate(u.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${catLabel(u.r.category).split(' ')[0]} ${u.r.name}</span><b>${money(u.value)}</b></div>`)}</div></div>` : ''}
    `);
  body.querySelectorAll('tr[data-href]').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  wireSubs(body);

  const p = C.palette();
  const n = s.n, labels = Array.from({ length: n }, (_, i) => String(i + 1));
  let c1 = 0, c2 = 0;
  const prevDaily = S.dailyTotals(S.expenses(), prevM);
  const cur = s.daily.map((v, i) => (i < (s.dayNow || n) ? (c1 += v) : null));
  const prev = Array.from({ length: n }, (_, i) => (i < prevDaily.length ? (c2 += prevDaily[i]) : null));
  C.moneyLine(body.querySelector('#s-pace'), {
    labels, zero: true,
    series: [{ label: fmtMonth(m), data: cur, color: p.accent, fill: true }, { label: fmtMonth(prevM), data: prev, color: p.neutral, dash: [4, 4] },
      ...(b.total ? [{ label: 'Budget pace', data: labels.map((_, i) => (b.total * (i + 1)) / n), color: p.neg, dash: [2, 3] }] : [])],
  });
  if (cats.length) C.doughnut(body.querySelector('#s-cat'), { labels: cats.map(c => catLabel(c.id)), values: cats.map(c => c.total), colors: cats.map(c => catColor(c.id, p)), max: 8, center: { value: money(s.spent, { compact: true }), label: 'spent' } });
  C.make(body.querySelector('#s-ie'), {
    type: 'bar',
    data: { labels: hist.map(x => fmtMonth(x.m)), datasets: [{ label: 'Spending', data: hist.map(x => x.spent), backgroundColor: hist.map(x => (x.m === m ? p.accent : p.series[1])), maxBarThickness: 22 }, ...(hist.length > 1 ? [{ type: 'line', label: 'Average', data: hist.map(() => histAvg), borderColor: p.ink, borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 }] : [])] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis({ ticks: { maxRotation: 0, autoSkipPadding: 6 } }), y: C.moneyAxis({ beginAtZero: true }) } },
  });
  C.plainBars(body.querySelector('#s-wd'), { labels: DOW, values: wd.map((v, i) => (wdN[i] ? v / wdN[i] : 0)), fmt: v => money(v, { compact: true }), label: 'Avg spend' });
}

// ================= transactions =================
let showN = 200;
export async function transactions(el) {
  const q = query();
  const allTime = q.get('all') === '1';
  const m = monthParam();
  const pro = !simpleMode();
  const f = { cat: q.get('cat') || '', text: q.get('q') || '', method: q.get('method') || '' };
  const build = () => { const p = new URLSearchParams(); if (allTime) p.set('all', '1'); else p.set('m', m); for (const [k, v] of Object.entries({ cat: f.cat, q: f.text, method: f.method })) if (v) p.set(k, v); return '#/spending/transactions?' + p; };
  el.innerHTML = String(html`<div class="page-head"><div><h1>Transactions</h1><div class="sub">Every expense. Click one to edit it.</div></div>
    <div class="actions">${allTime ? html`<a class="btn" href="#/spending/transactions">By month</a>` : monthNav('/spending/transactions', m)}${!allTime ? html`<a class="btn" href="#/spending/transactions?all=1">All time</a>` : ''}<button class="btn" data-import>Import CSV</button><button class="btn" data-export>Export CSV</button>${addBtn('+ Add')}</div></div>
    <div class="filters">
      <select data-f="cat" aria-label="Category"><option value="">All categories</option>${expenseCats().map(c => html`<option value="${c.id}" ${f.cat === c.id ? raw('selected') : ''}>${c.emoji} ${c.name}</option>`)}</select>
      ${pro ? html`<select data-f="method" aria-label="Payment method"><option value="">Any payment method</option>${[...new Set(store.all('txns').map(t => t.method).filter(Boolean))].map(x => html`<option ${f.method === x ? raw('selected') : ''}>${x}</option>`)}</select>` : ''}
      <input data-f="text" type="search" placeholder="Search notes, merchants, tags…" value="${f.text}" aria-label="Search">
    </div><div id="body"></div>`);
  wireAdd(el, () => ({ date: !allTime && m !== S.currentMonth() ? `${m}-01` : undefined }));
  el.querySelector('[data-import]').onclick = async () => { if (await importTxnsDialog()) refresh(); };
  el.querySelector('[data-export]').onclick = () => exportTxnsCSV();
  el.querySelectorAll('[data-f]').forEach(i => { const ev = i.tagName === 'INPUT' ? 'change' : 'change'; i.addEventListener(ev, () => { f[i.dataset.f] = i.value.trim(); showN = 200; location.replace(build()); }); });
  const body = el.querySelector('#body');
  if (!store.all('txns').length) { body.innerHTML = String(emptySpend()); wireEmpty(body); return; }
  const needle = f.text.toLowerCase();
  let list = store.all('txns').filter(t => t.type !== 'income' && (allTime || t.date.startsWith(m)) && (!f.cat || t.category === f.cat) && (!f.method || t.method === f.method)
    && (!needle || [t.note, t.merchant, t.sub, ...(t.tags || []), catById(t.category).name].some(x => (x || '').toLowerCase().includes(needle))));
  list.sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const counted = list.filter(t => !t.exclude);
  const out = S.sum(counted);
  const fromAcct = counted.filter(t => t.deducted);
  const shown = list.slice(0, showN);
  const days = [];
  for (const t of shown) { const last = days.at(-1); if (last?.date === t.date) last.items.push(t); else days.push({ date: t.date, items: [t] }); }
  body.innerHTML = String(html`
    <div class="stats">${stat('Spent', money(out), { sub: `${allTime ? 'all time' : fmtMonth(m)}${f.cat || f.text || f.method ? ' · filtered' : ''}` })}
      ${stat('Expenses', String(counted.length), { sub: counted.length ? `avg ${money(out / counted.length)}` : '' })}
      ${stat('Paid from tracked accounts', money(S.sum(fromAcct)), { sub: `${fromAcct.length} of ${counted.length} expenses`, help: 'Expenses saved with “Take it off this account’s balance” — they lowered that account’s balance in Net worth.' })}</div>
    ${list.length ? html`<div class="txn-list mt">${days.map(d => { const dayOut = S.sum(d.items.filter(t => !t.exclude)); return html`<div class="txn-day"><div class="txn-day-head"><span>${fmtDate(d.date, { weekday: 'long', month: 'short', day: 'numeric', ...(allTime ? { year: 'numeric' } : {}) })}</span><span class="muted">${dayOut ? money(-dayOut) : ''}</span></div>
      ${d.items.map(t => html`<button class="txn" data-id="${t.id}"><span class="txn-ic" style="background:${C.alpha(catColor(t.category, C.palette()), 0.16)}">${catById(t.category).emoji || '•'}</span>
        <span class="txn-main"><b>${t.note || t.merchant || catById(t.category).name}</b><span class="small muted">${txnMeta(t)}</span></span>
        <span class="txn-amt">${amt(t)}${!sameMoney(ccyOf(t), displayCcy()) ? html`<span class="small muted">≈ ${money(-S.val(t))}</span>` : ''}</span></button>`)}</div>`; })}</div>
      ${list.length > showN ? html`<div class="row mt"><span class="spacer"></span><button class="btn" data-more>Show more (${list.length - showN} left)</button></div>` : ''}`
      : html`<div class="empty"><div class="empty-title">Nothing here</div><p>No expenses match${allTime ? '' : ` in ${fmtMonthLong(m)}`}.</p>${addBtn()}</div>`}`);
  wireAdd(body, () => ({ date: !allTime && m !== S.currentMonth() ? `${m}-01` : undefined }));
  body.querySelectorAll('.txn').forEach(b => b.onclick = async () => { if (await txnModal(store.get('txns', b.dataset.id))) refresh(); });
  body.querySelector('[data-more]')?.addEventListener('click', () => { showN += 300; refresh(); });
}

// ================= calendar =================
export async function calendar(el) {
  const m = monthParam();
  const sel = query().get('day') || (m === S.currentMonth() ? today() : null);
  el.innerHTML = String(html`<div class="page-head"><div><h1>Calendar</h1><div class="sub">What you spent each day, and the bills coming up. Click a day to see or add to it.</div></div>
    <div class="actions">${monthNav('/spending/calendar', m)}${addBtn()}</div></div><div id="body"></div>`);
  wireAdd(el, () => ({ date: sel || undefined }));
  const body = el.querySelector('#body');
  const s = S.monthSummary(m);
  const up = S.upcoming(m).filter(u => u.date > today());
  const upBy = {}; for (const u of up) (upBy[u.date] ||= []).push(u);
  const max = Math.max(...s.daily, 1);
  const p = C.palette();
  const first = parseDay(m + '-01'), lead = (first.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(html`<div class="cell out"></div>`);
  for (let d = 1; d <= s.n; d++) {
    const k = `${m}-${pad(d)}`, v = s.daily[d - 1], u = upBy[k];
    cells.push(html`<a class="cell ${v ? 'has' : ''} ${k === today() ? 'today' : ''} ${k === sel ? 'sel' : ''}" href="#/spending/calendar?m=${m}&day=${k}" ${v ? raw(`style="background:${C.alpha(p.series[1], 0.08 + 0.42 * (v / max))}"`) : ''}>
      <span class="d">${d}</span>${v ? html`<span class="v"><span class="v-full">${money(v, { compact: v >= 10000 })}</span><span class="v-short">${money(v, { compact: true, decimals: 0 })}</span></span>` : k <= today() && k >= (store.all('txns').map(t => t.date).sort()[0] || k) ? html`<span class="n muted">—</span>` : ''}
      ${u ? html`<span class="n muted" title="${u.map(x => x.r.name).join(', ')}">🔁 ${u.length > 1 ? u.length + ' bills' : u[0].r.name}</span>` : ''}</a>`);
  }
  const dayTx = sel ? store.all('txns').filter(t => t.date === sel && t.type !== 'income') : [];
  const busiest = s.daily.indexOf(Math.max(...s.daily));
  body.innerHTML = String(html`
    <div class="stats">${stat('Spent', money(s.spent))}${stat('Daily average', money(s.avgDay))}${stat('No-spend days', `${s.noSpend}`, { sub: `of ${s.dayNow || s.n}` })}${stat('Biggest day', s.spent ? fmtDate(`${m}-${pad(busiest + 1)}`, { month: 'short', day: 'numeric' }) : '—', { sub: s.spent ? money(s.daily[busiest]) : '' })}${up.length ? stat('Bills still due', money(up.reduce((a, u) => a + u.value, 0)), { sub: `${up.length} upcoming` }) : ''}</div>
    <div class="grid g-2-1 mt">
      <div class="card"><div class="cal cal7">${DOW.map(d => html`<div class="dow">${d}</div>`)}${cells}</div>
        <div class="row small muted mt"><span class="legend-sq" style="background:${C.alpha(p.series[1], 0.15)}"></span>less<span class="legend-sq" style="background:${C.alpha(p.series[1], 0.5)}"></span>more spending · 🔁 bill due</div></div>
      <div class="card"><div class="card-head"><h2>${sel ? fmtDate(sel, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Pick a day'}</h2>${sel ? html`<button class="btn sm" data-add>+ Add</button>` : ''}</div>
        ${sel ? (dayTx.length ? html`<div class="txn-list flat">${dayTx.map(t => html`<button class="txn" data-id="${t.id}"><span class="txn-ic" style="background:${C.alpha(catColor(t.category, p), 0.16)}">${catById(t.category).emoji || '•'}</span><span class="txn-main"><b>${t.note || t.merchant || catById(t.category).name}</b><span class="small muted">${catById(t.category).name}</span></span><span class="txn-amt">${amt(t)}</span></button>`)}</div>
          <div class="row mt small"><span class="muted">Total spent</span><span class="spacer"></span><b>${money(S.sum(dayTx.filter(t => !t.exclude)))}</b></div>`
          : html`<p class="muted small">${sel > today() ? 'A future day.' : 'A no-spend day 🎉'}</p>`) : html`<p class="muted small">Click a day in the calendar.</p>`}
        ${sel && upBy[sel] ? html`<h3 class="mt">Due this day</h3>${upBy[sel].map(u => html`<div class="row small"><span>🔁 ${u.r.name}</span><span class="spacer"></span><b>${money(u.value)}</b></div>`)}` : ''}
      </div>
    </div>`);
  wireAdd(body, () => ({ date: sel || undefined }));
  body.querySelectorAll('.txn').forEach(b => b.onclick = async () => { if (await txnModal(store.get('txns', b.dataset.id))) refresh(); });
}

// ================= budgets =================
export async function budgets(el) {
  const m = S.currentMonth();
  const s = S.monthSummary(m);
  const b = S.budgetFor(m);
  const raw0 = store.getSettings().budgets || {};
  const cats = S.byCategory(s.ex);
  const spentBy = Object.fromEntries(cats.map(c => [c.id, c.total]));
  const { avg, months: avgN } = S.categoryAverages(m, 3);
  const expectNow = b.total ? b.total * (s.dayNow / s.n) : null;
  const hist = S.monthsBack(m, 6);
  el.innerHTML = String(html`<div class="page-head"><div><h1>Budgets</h1><div class="sub">A monthly limit overall and per category. Amounts in ${displayCcy()}.</div></div></div>
    ${b.total ? html`<div class="stats big">${stat(fmtMonthLong(m), money(s.spent), { sub: `of ${money(b.total)} budget` })}${stat(s.left < 0 ? 'Over budget by' : 'Left', money(Math.abs(s.left)), { cls: s.left < 0 ? 'neg' : 'pos' })}${stat('Safe per day', money(s.safeToday), { sub: `${s.daysLeft} days left`, help: 'Budget left, minus recurring bills still due this month, divided by the days left (including today).' })}${s.projected != null ? stat('Projected month-end', money(s.projected), { cls: s.projected > b.total ? 'neg' : 'pos', sub: s.projected > b.total ? `${money(s.projected - b.total)} over at this pace` : 'within budget at this pace' }) : stat('Projected month-end', '—', { sub: 'not enough data — from day 7 of the month' })}</div>
      <div class="card mt"><div class="budget-bar"><span style="width:${Math.min(100, (s.spent / b.total) * 100)}%" class="${s.spent > b.total ? 'over' : s.spent > expectNow ? 'warn' : ''}"></span><i style="left:${(s.dayNow / s.n) * 100}%" title="Where you'd be spending evenly"></i></div>
      <div class="row small muted"><span>${s.spent > expectNow ? `${money(s.spent - expectNow)} ahead of an even pace` : `${money(expectNow - s.spent)} under an even pace`}</span><span class="spacer"></span><span>today = day ${s.dayNow} of ${s.n}</span></div></div>` : html`<div class="note">Set a monthly budget below — the app then shows how much is left, a safe amount to spend per day and whether you're on pace.</div>`}
    <form id="bf" class="card mt"><div class="card-head"><h2>Monthly limits</h2>${avgN ? html`<button type="button" class="btn sm" data-fill>Fill from my ${avgN}-month averages</button>` : ''}</div>
      <label class="field" style="max-width:280px">Total monthly budget <span class="hint">blank = sum of the category limits</span><input name="total" type="number" step="any" min="0" value="${raw0.total || ''}" placeholder="${b.catSum ? String(Math.round(b.catSum)) : 'e.g. 2000'}"></label>
      <div class="table-wrap mt" style="border:0"><table class="data compact"><thead><tr><th>Category</th><th class="num">Limit</th><th class="num">Spent</th><th style="width:34%">This month</th><th class="num">Avg</th></tr></thead><tbody>
        ${expenseCats().map(c => { const lim = +raw0.byCat?.[c.id] || 0, sp = spentBy[c.id] || 0; return html`<tr><td>${c.emoji} ${c.name} <span class="tag">${KINDS[c.kind] || ''}</span></td><td class="num"><input name="c:${c.id}" type="number" step="any" min="0" value="${lim || ''}" style="width:110px;text-align:right" aria-label="${c.name} limit"></td><td class="num">${sp ? money(sp) : '—'}</td>
          <td>${lim ? html`<div class="bar-mini lg"><span style="width:${Math.min(100, (sp / lim) * 100)}%" class="${sp > lim ? 'over' : sp > lim * (s.dayNow / s.n) ? 'warn' : ''}"></span><i style="left:${(s.dayNow / s.n) * 100}%"></i></div><span class="small ${sp > lim ? 'neg' : 'muted'}">${sp > lim ? `${money(sp - lim)} over` : `${money(lim - sp)} left`}</span>` : html`<span class="muted small">no limit</span>`}</td>
          <td class="num muted">${avg[c.id] ? money(avg[c.id]) : '—'}</td></tr>`; })}
      </tbody></table></div>
      <div class="row mt"><span class="small muted">Spending in categories without a limit still counts toward the total.</span><span class="spacer"></span><button class="btn primary">Save budgets</button></div></form>
    <div class="card mt"><div class="card-head"><h2>Last 6 months</h2><span class="hint">spending vs budget</span></div><div class="chart"><canvas id="b-hist"></canvas></div></div>`);
  const form = el.querySelector('#bf');
  form.onsubmit = async e => {
    e.preventDefault();
    const f = formData(form);
    const byCat = {};
    for (const c of expenseCats()) { const v = toNum(f['c:' + c.id]); if (v > 0) byCat[c.id] = v; }
    await store.saveSettings({ budgets: null });
    await store.saveSettings({ budgets: { total: toNum(f.total) || 0, byCat } });
    toast('Budgets saved'); refresh();
  };
  el.querySelector('[data-fill]')?.addEventListener('click', () => { for (const c of expenseCats()) if (avg[c.id]) form.elements['c:' + c.id].value = Math.ceil(avg[c.id] / 10) * 10; toast('Filled with your averages, rounded up — adjust and save'); });
  const p = C.palette();
  C.make(el.querySelector('#b-hist'), {
    type: 'bar',
    data: { labels: hist.map(x => fmtMonth(x.m)), datasets: [{ label: 'Spent', data: hist.map(x => x.spent), backgroundColor: hist.map(x => (b.total && x.spent > b.total ? p.neg : p.series[0])), maxBarThickness: 28 }, ...(b.total ? [{ type: 'line', label: 'Budget', data: hist.map(() => b.total), borderColor: p.ink, borderDash: [4, 4], pointRadius: 0, borderWidth: 1.5 }] : [])] },
    options: { plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis(), y: C.moneyAxis({ beginAtZero: true }) } },
  });
}

// ================= bills & subscriptions =================
// kind: 'sub' (subscription) | 'bill'
const recKind = r => (S.isSubscription(r) ? 'sub' : 'bill');
const KIND_LABEL = { sub: 'Subscription', bill: 'Bill' };
const ordinal = n => n + (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th');
export const scheduleText = r => {
  const d = +r.day || +(r.next || '').slice(8, 10);
  if (r.freq === 'weekly') return `every ${parseDay(r.next).toLocaleDateString(store.getSettings().locale, { weekday: 'long' })}`;
  if (r.freq === 'yearly') return `every year on ${fmtDate(r.next, { month: 'long', day: 'numeric' })}`;
  if (r.freq === 'quarterly') return `every 3 months on the ${ordinal(d)}`;
  return `every month on the ${ordinal(d)}`;
};
const acctName = id => store.get('nwAccounts', id)?.name || '';

export async function editRecurring(r = {}) {
  const pro = !simpleMode();
  const kind0 = r.id ? recKind(r) : r.kind0 || 'sub';
  const catFor = () => expenseCats();
  const defCat = k => (k === 'sub' ? 'subscriptions' : 'bills');
  const accts = store.all('nwAccounts').filter(a => !a.archivedAt);
  const res = await modal({
    title: r.id ? `Edit ${r.name}` : kind0 === 'sub' ? 'Add a subscription' : 'Add a bill or subscription', wide: true,
    body: String(html`<form id="rf" class="form-grid">
      <label class="field">What is it?<select name="kind">${Object.entries(KIND_LABEL).map(([k, l]) => html`<option value="${k}" ${k === kind0 ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="field span2">Name<input name="name" required maxlength="60" value="${r.name || ''}" placeholder="e.g. Netflix, Spotify, Gym, Rent"></label>
      <label class="field">Amount<input name="amount" type="number" step="any" min="0" required value="${r.amount ?? ''}"></label>
      <label class="field">Currency${raw(ccySelect('currency', r.currency || displayCcy()))}</label>
      <label class="field">How often<select name="freq">${Object.entries(S.FREQS).map(([k, l]) => html`<option value="${k}" ${(r.freq || 'monthly') === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
      <label class="field">Next charge date <span class="hint" id="sched"></span><input name="next" type="date" required value="${r.next || today()}"></label>
      <label class="field">Category<select name="category">${catFor(kind0).map(c => html`<option value="${c.id}" ${c.id === (r.category || defCat(kind0)) ? raw('selected') : ''}>${c.emoji} ${c.name}</option>`)}</select></label>
      <label class="field">Charged to account <span class="hint">optional</span><select name="accountId"><option value="">—</option>${accts.map(a => html`<option value="${a.id}" ${a.id === r.accountId ? raw('selected') : ''} ${adjustable(a) ? '' : raw('data-fixed="1"')}>${a.name}</option>`)}</select></label>
      <label class="check full"><input type="checkbox" name="auto" ${r.auto !== false ? raw('checked') : ''}> Add it to my expenses automatically on each charge date</label>
      <label class="check full deductf"><input type="checkbox" name="deduct" ${r.deduct ? raw('checked') : ''}> Take each charge off the account's balance too</label>
      ${pro ? html`<label class="field">Ends on <span class="hint">optional</span><input name="until" type="date" value="${r.until || ''}"></label>
        <label class="field">Merchant / payee<input name="merchant" maxlength="60" value="${r.merchant || ''}"></label>
        <label class="field">Payment method<select name="method"><option value="">—</option>${(store.getSettings().payMethods || []).map(x => html`<option ${x === r.method ? raw('selected') : ''}>${x}</option>`)}</select></label>` : ''}
    </form>`),
    onMount: w => {
      const f = w.querySelector('#rf');
      const sched = () => { w.querySelector('#sched').textContent = f.next.value ? '· ' + scheduleText({ freq: f.freq.value, next: f.next.value, day: +f.next.value.slice(8, 10) }) : ''; };
      f.kind.onchange = () => { f.category.innerHTML = String(html`${catFor(f.kind.value).map(c => html`<option value="${c.id}" ${c.id === defCat(f.kind.value) ? raw('selected') : ''}>${c.emoji} ${c.name}</option>`)}`); };
      f.next.addEventListener('change', sched); f.freq.addEventListener('change', sched); sched();
      const dd = () => { const opt = f.accountId.selectedOptions[0]; w.querySelector('.deductf').hidden = !f.accountId.value || !!opt?.dataset.fixed; };
      f.accountId.addEventListener('change', dd); dd();
      setTimeout(() => (r.id ? null : f.name.focus()));
    },
    actions: [...(r.id ? [{ label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => {
      const f = w.querySelector('#rf');
      if (!f.name.value.trim()) { toast('Give it a name', 'error'); return false; }
      if (!(+f.amount.value > 0)) { toast('Enter an amount above zero', 'error'); return false; }
      if (!f.next.value) { toast('Pick the next charge date', 'error'); return false; }
      return formData(f);
    } }],
  });
  if (res === 'delete') {
    if (!(await confirmDlg('Delete this item?', `Delete “${r.name}”? Transactions it already added stay.`))) return false;
    await store.del('recurring', r.id); toast('Deleted'); return true;
  }
  if (!res || typeof res !== 'object') return false;
  const { kind0: _k, ...base } = r;
  const fixed = res.accountId && !adjustable(store.get('nwAccounts', res.accountId));
  const obj = { ...base, name: res.name.trim(), type: 'expense', isSub: res.kind === 'sub', amount: +res.amount, currency: res.currency, category: res.category, freq: res.freq, next: res.next, day: +res.next.slice(8, 10), auto: !!res.auto, accountId: res.accountId || '', deduct: !!(res.accountId && res.deduct && !fixed),
    ...(pro ? { until: res.until || '', merchant: (res.merchant || '').trim(), method: res.method || '' } : {}) };
  await store.put('recurring', obj);
  const n = await S.postDueRecurring();
  toast(`Saved${n ? ` · ${n} past payment${n > 1 ? 's' : ''} added` : ''}`);
  return true;
}

const TABS = [['subs', 'Active subscriptions'], ['bills', 'Bills'], ['paused', 'Paused'], ['all', 'All']];
const perMonth = r => S.monthlyCost({ ...r, amount: S.val({ ...r, date: today() }) });

export async function recurring(el) {
  const items = store.all('recurring').filter(r => r.type !== 'income');
  const show = TABS.some(t => t[0] === query().get('show')) ? query().get('show') : (items.some(r => !r.paused && S.isSubscription(r)) || !items.length ? 'subs' : 'all');
  const active = items.filter(r => !r.paused);
  const subs = active.filter(S.isSubscription), bills = active.filter(r => !S.isSubscription(r));
  const subsMonth = subs.reduce((a, r) => a + perMonth(r), 0), billsMonth = bills.reduce((a, r) => a + perMonth(r), 0);
  const list = (show === 'subs' ? subs : show === 'bills' ? bills : show === 'paused' ? items.filter(r => r.paused) : items)
    .sort((a, b) => (!!a.paused - !!b.paused) || (a.next || '').localeCompare(b.next || ''));
  const up = S.upcoming(null, 31);
  const overdue = items.filter(r => !r.paused && !r.auto && r.next && r.next < today());
  const count = { subs: subs.length, bills: bills.length, paused: items.filter(r => r.paused).length, all: items.length };
  el.innerHTML = String(html`<div class="page-head"><div><h1>Subscriptions & bills</h1><div class="sub">Everything that repeats — subscriptions, rent, bills — with the day it's charged and the account it comes from.</div></div>
    <div class="actions"><button class="btn" data-new="bill">+ Add bill</button><button class="btn primary" data-new="sub">+ Add subscription</button></div></div>
    ${!items.length ? html`<div class="empty"><div class="empty-title">Nothing recurring yet</div><p>Add Netflix, Spotify, the gym, your phone plan, rent… Pick the day each one is charged and the account it comes from. Each charge is added to your transactions on that day, and you see what your subscriptions cost per month and per year.</p><button class="btn primary" data-new="sub">+ Add subscription</button><button class="btn" data-new="bill">+ Add bill</button></div>` : html`
    <div class="stats big">
      ${stat('Subscriptions', `${money(subsMonth)}`, { sub: `${subs.length} active · ${money(subsMonth * 12)} / year`, help: 'All active subscriptions converted to a monthly amount. Most people find at least one they forgot about — review them once a year.' })}
      ${stat('Bills', money(billsMonth), { sub: `${bills.length} active · per month` })}
      ${stat('All fixed costs', money(subsMonth + billsMonth), { sub: `${money((subsMonth + billsMonth) * 12)} / year` })}
      ${(() => { const b = baseline().avgExpenses; return b ? stat('Share of your spending', pct((subsMonth + billsMonth) / b, 0), { sub: `of ${money(b)} usual month`, help: 'Fixed costs ÷ your usual monthly spending. The rest is everyday, flexible spending.' }) : ''; })()}
    </div>
    ${overdue.length ? html`<div class="callout warn mt"><span class="ic">!</span><div>${overdue.length} payment${overdue.length > 1 ? 's are' : ' is'} past due and not added automatically — use <b>Mark paid</b> to log ${overdue.length > 1 ? 'them' : 'it'}.</div></div>` : ''}
    <div class="tabs mt" role="tablist">${TABS.map(([k, l]) => html`<a role="tab" class="${k === show ? 'on' : ''}" href="#/spending/recurring?show=${k}">${l} <span class="muted small">${count[k]}</span></a>`)}</div>
    <div class="grid g-2-1">
      <div class="card" style="padding:0">${list.length ? html`<div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Name</th><th>Charged</th><th class="num">Amount</th><th class="num">Per month</th><th>Next</th><th></th></tr></thead><tbody>
        ${list.map(r => html`<tr ${r.paused ? raw('style="opacity:.55"') : ''}><td><b>${catById(r.category).emoji} ${r.name}</b><div class="small muted">${[KIND_LABEL[recKind(r)], acctName(r.accountId) ? `from ${acctName(r.accountId)}${r.deduct ? ' (balance updated)' : ''}` : '', r.auto ? 'auto-added' : 'reminder only', r.paused ? 'paused' : ''].filter(Boolean).join(' · ')}</div></td>
          <td class="small">${scheduleText(r)}</td>
          <td class="num">${moneyIn(+r.amount, ccyOf(r))}</td><td class="num muted">${money(perMonth(r))}</td>
          <td class="${!r.paused && r.next < today() ? 'neg' : ''}" style="white-space:nowrap">${r.paused ? '—' : r.next ? fmtDate(r.next, { month: 'short', day: 'numeric' }) : '—'}</td>
          <td style="text-align:right;white-space:nowrap">${!r.paused && !r.auto ? html`<button class="btn sm" data-paid="${r.id}">Mark paid</button> ` : ''}<button class="btn sm" data-pause="${r.id}">${r.paused ? 'Resume' : 'Pause'}</button> <button class="btn sm" data-edit="${r.id}">Edit</button></td></tr>`)}
      </tbody></table></div>` : html`<p class="muted small" style="padding:16px">Nothing here. ${show === 'subs' ? html`<button class="btn sm" data-new="sub">+ Add subscription</button>` : ''}</p>`}</div>
      <div class="card"><div class="card-head"><h2>Next 31 days</h2></div>${up.length ? html`<div class="upcoming col">${up.map(u => html`<div class="up-item"><span class="muted small">${fmtDate(u.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${u.r.name}</span><b>${money(u.value)}</b></div>`)}</div>` : html`<p class="muted small">Nothing due.</p>`}</div>
    </div>
    ${subs.length + bills.length ? html`<div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Where fixed costs go</h2><span class="hint">per month</span></div><div class="chart short"><canvas id="r-cat"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>By account</h2><span class="hint">what leaves each account per month</span></div>${byAccountTable([...subs, ...bills])}</div></div>` : ''}`}`);
  el.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.new !== undefined) { if (await editRecurring({ kind0: b.dataset.new || 'sub' })) refresh(); }
    else if (b.dataset.edit) { if (await editRecurring(store.get('recurring', b.dataset.edit))) refresh(); }
    else if (b.dataset.pause) { const r = store.get('recurring', b.dataset.pause); await store.put('recurring', { ...r, paused: !r.paused }); toast(r.paused ? `${r.name} resumed` : `${r.name} paused — no more charges added`); refresh(); }
    else if (b.dataset.paid) {
      const r = store.get('recurring', b.dataset.paid);
      await store.put('txns', await applyTxnDeduction(S.txnFromRecurring(r, r.next > today() ? today() : r.next)));
      await store.put('recurring', { ...r, next: S.nextDate(r, r.next) });
      toast(`${r.name} logged`); refresh();
    }
  });
  const fixed = [...subs, ...bills];
  if (fixed.length) {
    const by = new Map(); for (const r of fixed) by.set(r.category, (by.get(r.category) || 0) + perMonth(r));
    const rows = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const p = C.palette();
    C.plainBars(el.querySelector('#r-cat'), { labels: rows.map(x => catLabel(x[0])), values: rows.map(x => x[1]), colors: rows.map(x => catColor(x[0], p)), fmt: v => money(v, { compact: true }), horizontal: true, label: 'Per month' });
  }
}
function byAccountTable(list) {
  const m = new Map();
  for (const r of list) { const k = r.accountId && store.get('nwAccounts', r.accountId) ? r.accountId : ''; const e = m.get(k) || { n: 0, v: 0 }; e.n++; e.v += perMonth(r); m.set(k, e); }
  const rows = [...m.entries()].sort((a, b) => b[1].v - a[1].v);
  return html`<dl class="kv">${rows.map(([k, e]) => html`<dt>${k ? acctName(k) : html`<span class="muted">No account set</span>`} <span class="muted small">${e.n}×</span></dt><dd>${money(e.v)}</dd>`)}</dl>`;
}

// Spending-page card: active subscriptions by charge day
function subsCard() {
  const subs = store.all('recurring').filter(r => !r.paused && S.isSubscription(r)).sort((a, b) => (+a.day || 0) - (+b.day || 0) || a.name.localeCompare(b.name));
  const month = subs.reduce((a, r) => a + perMonth(r), 0);
  return html`<div class="card mt"><div class="card-head"><h2>Active subscriptions</h2><div class="row"><span class="hint">${subs.length ? `${money(month)} / month · ${money(month * 12)} / year` : ''}</span><button class="btn sm" data-add-sub>+ Add subscription</button></div></div>
    ${subs.length ? html`<div class="sub-grid">${subs.map(r => html`<button class="sub-item" data-edit-sub="${r.id}"><span class="sub-day"><b>${+r.day || +(r.next || '').slice(8, 10) || '—'}</b><small>${r.freq === 'monthly' ? 'monthly' : (S.FREQS[r.freq] || '').toLowerCase()}</small></span><span class="sub-main"><b>${catById(r.category).emoji} ${r.name}</b><small class="muted">${acctName(r.accountId) || 'no account set'} · next ${fmtDate(r.next, { month: 'short', day: 'numeric' })}</small></span><b class="sub-amt">${moneyIn(+r.amount, ccyOf(r))}</b></button>`)}</div>
      <div class="row mt small"><a href="#/spending/recurring?show=subs">Manage subscriptions →</a></div>`
      : html`<p class="muted small">Add Netflix, Spotify, the gym, cloud storage… with the day each is charged and the account it comes from — they're added to your transactions automatically and totalled here.</p>`}</div>`;
}
const wireSubs = el => {
  el.querySelector('[data-add-sub]')?.addEventListener('click', async () => { if (await editRecurring({ kind0: 'sub' })) refresh(); });
  el.querySelectorAll('[data-edit-sub]').forEach(b => b.onclick = async () => { if (await editRecurring(store.get('recurring', b.dataset.editSub))) refresh(); });
};

// ================= categories =================
export async function categories(el) {
  const pro = !simpleMode();
  let list = structuredClone(expenseCats());
  const used = new Map(); for (const t of store.all('txns')) used.set(t.category, (used.get(t.category) || 0) + 1);
  const row = c => html`<tr data-id="${c.id}"><td><input data-k="emoji" value="${c.emoji || ''}" maxlength="4" style="width:52px;text-align:center" aria-label="Emoji"></td>
    <td><input data-k="name" value="${c.name}" maxlength="40" aria-label="Name"></td>
    <td><select data-k="kind" aria-label="Need or want">${Object.entries(KINDS).map(([k, l]) => html`<option value="${k}" ${c.kind === k ? raw('selected') : ''}>${l}</option>`)}</select></td>
    ${pro ? html`<td><input data-k="subs" value="${(c.subs || []).join(', ')}" placeholder="comma separated" aria-label="Subcategories"></td>` : ''}
    <td class="num muted">${used.get(c.id) || 0}</td><td><button type="button" class="icon-btn" data-rm aria-label="Remove category">✕</button></td></tr>`;
  el.innerHTML = String(html`<div class="page-head"><div><h1>Categories</h1><div class="sub">Rename, add or remove spending categories. “Need” vs “want” drives the needs-vs-wants split on Spending.</div></div></div>
    <form id="cf" class="card"><div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th></th><th>Name</th><th>Need / want</th>${pro ? raw('<th>Subcategories</th>') : ''}<th class="num">Used</th><th></th></tr></thead><tbody id="rows">${list.map(row)}</tbody></table></div>
      <div class="row mt"><button type="button" class="btn sm" data-addc>+ Add category</button><button type="button" class="btn sm ghost" data-reset>Reset to defaults</button><span class="spacer"></span><button class="btn primary">Save categories</button></div>
      <p class="small muted mt">Removing a category doesn't delete its expenses — they show as “(deleted category)” until you edit them.</p></form>`);
  const tb = el.querySelector('#rows');
  const read = () => [...tb.querySelectorAll('tr')].map(tr => { const g = k => tr.querySelector(`[data-k=${k}]`)?.value.trim() || ''; const old = list.find(c => c.id === tr.dataset.id) || {}; return { ...old, id: tr.dataset.id, emoji: g('emoji') || '•', name: g('name'), kind: g('kind') === 'need' ? 'need' : 'want', subs: pro ? g('subs').split(',').map(x => x.trim()).filter(Boolean).slice(0, 20) : old.subs || [] }; });
  el.querySelector('[data-addc]').onclick = () => { list = read(); const id = 'c-' + store.uid().slice(0, 8); list.push({ id, name: '', emoji: '•', kind: 'want', subs: [] }); tb.insertAdjacentHTML('beforeend', String(row(list.at(-1)))); tb.querySelector('tr:last-child [data-k=name]').focus(); };
  tb.addEventListener('click', async e => { const b = e.target.closest('[data-rm]'); if (!b) return; const tr = b.closest('tr'); const n = used.get(tr.dataset.id) || 0; if (n && !(await confirmDlg('Remove category?', `${n} transaction${n > 1 ? 's use' : ' uses'} it. They stay, shown as a deleted category until you re-categorise them.`, 'Remove'))) return; tr.remove(); });
  el.querySelector('[data-reset]').onclick = async () => { if (!(await confirmDlg('Reset categories?', 'Go back to the built-in category list? Your transactions are kept.', 'Reset'))) return; await saveCategories(null); toast('Categories reset'); refresh(); };
  el.querySelector('#cf').onsubmit = async e => {
    e.preventDefault();
    const next = read();
    if (next.some(c => !c.name)) { toast('Every category needs a name', 'error'); return; }
    if (new Set(next.map(c => c.name.toLowerCase())).size !== next.length) { toast('Two categories have the same name', 'error'); return; }
    if (!next.length) { toast('Keep at least one category', 'error'); return; }
    await saveCategories(next); toast('Categories saved'); refresh();
  };
}
export { slug, EXPENSE_DEFAULTS };
