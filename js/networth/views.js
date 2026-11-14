import * as store from '../store.js';
import { html, raw, money, pct, num, pnlClass, stat, fmtDate, today, modal, toast, confirmDlg, formData, toNum, parseDay, dayKey } from '../ui.js';
import * as C from '../charts.js';
import { ASSET_CATS, LIAB_CATS, assetCats, liabCats, GROUPS, DEBT, groupOf, groupInfo, simpleMode, typeLabel, isLiquid, nwSeries, pointAt, baseline, changes, debtMetrics, interestOverview, lastUpdateOf, catKey, CUSTODY, custodyOf, custodyLabel, PURPOSES, purposeOf, TIERS, positions, concentration, canMature, maturities, bankExposure, currencyExposure, staleAccounts, capitalYears, cashAtHand } from './calc.js';
import { ccyOf, moneyIn, ccySelect, displayCcy, sameMoney } from '../fx.js';
import { go, refresh, query } from '../main.js';

const RANGES = [['all', 'All'], ['1y', '1Y'], ['3y', '3Y'], ['5y', '5Y']];
let nativeFirst = (() => { try { return localStorage.getItem('journal.nativeFirst') === '1'; } catch { return false; } })();
let range = 'all';
export const catColor = (id, p) => { const c = assetCats().find(x => x.id === id); if (c) return p.series[(c.ci ?? 0) % 8]; return p.series[(liabCats().findIndex(x => x.id === id) + 2) % 8]; };
function emptyNW() {
  return html`<div class="empty"><div class="empty-title">Start tracking your net worth</div><p>Add what you own (savings, investments, property) and what you owe (loans, cards). Then update the balances every so often — each update becomes a point in your history.</p>
    <a class="btn primary" href="#/networth/accounts">+ Add accounts</a></div>`;
}
function rangeFilter(series) {
  if (range === 'all' || !series.length) return series;
  const yrs = { '1y': 1, '3y': 3, '5y': 5 }[range];
  const last = parseDay(series.at(-1).date);
  const cut = dayKey(new Date(last.getFullYear() - yrs, last.getMonth(), last.getDate()));
  const i = series.findIndex(p => p.date >= cut);
  return series.slice(Math.max(0, i - 1));
}

// Chart labels for dates: "Oct 6" while the history is short, "Oct ’26" once it spans many months
// (a bare "Oct 26" reads like the 26th).
export const monthYear = d => `${fmtDate(d, { month: 'short' })} ’${d.slice(2, 4)}`;
export function dateLabels(dates) {
  if (!dates.length) return [];
  const span = (parseDay(dates.at(-1)) - parseDay(dates[0])) / 864e5;
  return span <= 200 ? dates.map(d => fmtDate(d, { month: 'short', day: 'numeric' })) : dates.map(monthYear);
}

// The type order used everywhere (Savings → Investments → Assets → Cash → Debt, or the Pro
// categories in the same order); inside a type, the biggest balance first.
const typeList = () => [...assetCats().map(c => ({ ...c, debt: false })), ...liabCats().map(c => ({ ...c, debt: true }))];
const typeIdx = a => typeList().findIndex(t => t.id === catKey(a) && t.debt === (a.kind === 'liability'));
export const byType = point => (a, b) => typeIdx(a) - typeIdx(b) || (point.byAcct[b.id] || 0) - (point.byAcct[a.id] || 0) || a.name.localeCompare(b.name);

// Net worth by type as bars — shown while there's only one date of balances (no trend yet)
export function typeBreakdown(cur) {
  const p = C.palette();
  const debtCats = liabCats();
  const cats = [...assetCats(), ...debtCats].filter(c => (cur.byCat[c.id] || 0) > 0);
  return html`<div class="breakdown">${cats.map(c => { const v = cur.byCat[c.id], debt = debtCats.includes(c), share = cur.assets ? v / cur.assets : 0, col = catColor(c.id, p);
    return html`<div class="bd-row"><span class="bd-label"><span class="dot" style="background:${col}"></span>${c.label}</span><span class="bd-bar"><span style="width:${Math.min(100, share * 100)}%;background:${col}"></span></span><b class="${debt ? 'neg' : ''}">${money(debt ? -v : v)}</b><span class="muted small bd-pct">${debt ? '' : pct(share, 1)}</span></div>`; })}</div>`;
}
// date of the latest balance you recorded for any account
export const lastUpdate = () => store.all('nwSnapshots').map(s => s.date).filter(d => d <= today()).sort().at(-1) || null;
const notEnough = text => html`<div class="not-enough"><b>Not enough data yet</b><span>${text}</span></div>`;

// ================= interest (estimates, shown on Insights) =================
export function interestCard(io = interestOverview()) {
  return html`<div class="card mt" data-tour="interest"><div class="card-head"><h2>Interest</h2><span class="hint">estimates at today's balances — nothing is added for you</span></div>
    ${io.earn.length ? html`<div class="interest-sum">
        <div><span class="stat-label">Per day</span><b>${money(io.earnDay, { decimals: 2 })}</b></div>
        <div><span class="stat-label">Per month</span><b class="pos">${money(io.earnMonth)}</b></div>
        <div><span class="stat-label">Per year</span><b>${money(io.earnYear)}</b></div>
        <div><span class="stat-label">Blended APY</span><b>${pct(io.blended, 2)}</b></div>
        ${io.payYear ? html`<div><span class="stat-label">Debt interest / month</span><b class="neg">${money(-io.payMonth)}</b></div>` : ''}
      </div>
      <div class="table-wrap mt" style="border:0"><table class="data compact"><thead><tr><th>Account</th><th class="num">APY</th><th class="num">Balance</th><th class="num">Per month</th><th class="num">Per year</th><th class="num">Since last update</th></tr></thead><tbody>
        ${io.earn.map(x => html`<tr><td><b>${x.a.name}</b>${x.lastUpdate ? html` <span class="muted small">updated ${fmtDate(x.lastUpdate, { month: 'short', day: 'numeric' })}</span>` : ''}</td><td class="num">${num(x.apy, 2)}%</td><td class="num">${moneyIn(x.native, ccyOf(x.a))}</td><td class="num pos">${money(x.perMonth)}</td><td class="num">${money(x.perYear)}</td><td class="num">${money(x.sinceUpdate)}</td></tr>`)}
        ${io.pay.map(x => html`<tr><td><b>${x.a.name}</b> <span class="muted small">debt</span></td><td class="num">${num(x.rate, 2)}% APR</td><td class="num neg">${money(-x.owed)}</td><td class="num neg">${money(-x.perMonth)}</td><td class="num neg">${money(-x.perYear)}</td><td class="num muted">—</td></tr>`)}
      </tbody></table></div>
      ${io.idleValue > 0 ? html`<p class="small muted" style="margin:10px 0 0">${money(io.idleValue)} in cash & savings earns nothing${io.blended ? html` — at your blended ${pct(io.blended, 2)} it would make about ${money(io.idleValue * io.blended / 12)} a month` : ''}.</p>` : ''}`
      : html`<p class="small muted" style="margin:0">Give a savings account its interest rate (Accounts → Edit → APY) and this shows what it earns per day, month and year. Your balances stay exactly what you type.</p>`}
  </div>`;
}

// ================= net worth: how it changed over time =================
export async function overview(el) {
  const accts = store.all('nwAccounts');
  const allSeries = nwSeries();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Net worth</h1><div class="sub">${allSeries.length ? `How it has moved, update by update. Last updated ${fmtDate(lastUpdate())}.` : 'Everything you own minus everything you owe.'}</div></div>
    <div class="actions">${allSeries.length > 2 ? html`<div class="seg" id="rng">${RANGES.map(([k, l]) => html`<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`)}</div>` : ''}<a class="btn primary" href="#/networth/accounts?update=1">Update balances</a></div></div><div id="body"></div>`);
  const body = el.querySelector('#body');
  if (!accts.length || !allSeries.length) { body.innerHTML = String(emptyNW()); return; }
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = b.dataset.r; el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); draw(); });

  const draw = () => {
    C.destroyAll();
    const series = rangeFilter(allSeries);
    const cur = allSeries.at(-1), prev = allSeries.at(-2), first = series[0];
    const ch = prev ? cur.net - prev.net : null;
    const chRange = first && first !== cur ? cur.net - first.net : null;
    const p = C.palette();
    const chg = changes(series);
    const one = series.length < 2;
    const yrs = !one ? (parseDay(cur.date) - parseDay(first.date)) / (365.25 * 864e5) : 0;
    const cagr = yrs >= 1 && first.net > 0 && cur.net > 0 ? Math.pow(cur.net / first.net, 1 / yrs) - 1 : null;
    const avg = chg.length ? chg.reduce((a, x) => a + x.change, 0) / chg.length : null;
    const best = chg.length ? chg.reduce((a, x) => (x.change > a.change ? x : a)) : null;
    const worst = chg.length ? chg.reduce((a, x) => (x.change < a.change ? x : a)) : null;
    const every = !one ? Math.round((parseDay(cur.date) - parseDay(first.date)) / 864e5 / (series.length - 1)) : null;
    const multiCcy = accts.some(a => !a.archivedAt && !sameMoney(ccyOf(a), displayCcy()));
    // converted to the display currency, with the account's own currency underneath (or the other way round)
    const balCell = (a, v, nat) => { const sg = a.kind === 'liability' ? -1 : 1; if (sameMoney(ccyOf(a), displayCcy())) return money(sg * v); const conv = money(sg * v), own = moneyIn(sg * nat, ccyOf(a)); return nativeFirst ? html`${own}<div class="dist">≈ ${conv}</div>` : html`${conv}<div class="dist">${own}</div>`; };
    const short = d => fmtDate(d, { month: 'short', day: 'numeric' });

    body.innerHTML = String(html`
      <div class="stats big">
        ${stat('Net worth', money(cur.net), { sub: ch != null ? html`<span class="${pnlClass(ch)}">${money(ch, { sign: true })}</span> since ${short(prev.date)}` : 'first update' })}
        ${stat(range === 'all' ? 'Since you started' : `Change (${range.toUpperCase()})`, chRange != null ? money(chRange, { sign: true }) : '—', { cls: pnlClass(chRange), sub: chRange != null ? `${first.net > 0 ? pct(chRange / Math.abs(first.net), 1, { sign: true }) + ' · ' : ''}since ${fmtDate(first.date)}` : 'needs a second update' })}
        ${stat('Total assets', money(cur.assets), { sub: `${accts.filter(a => a.kind !== 'liability' && !a.archivedAt).length} accounts` })}
        ${stat('Total debts', money(cur.liabilities), { cls: cur.liabilities ? 'neg' : '', sub: `${accts.filter(a => a.kind === 'liability' && !a.archivedAt).length} debts` })}
      </div>
      <div class="stats mt">
        ${stat('Growth per year', cagr != null ? pct(cagr, 1, { sign: true }) : '—', { cls: pnlClass(cagr), sub: cagr != null ? `over ${num(yrs, 1)} years` : 'needs a year of history', help: 'The steady yearly rate that would take your net worth from the first update in this range to today.' })}
        ${stat('Average change per update', avg != null ? money(avg, { sign: true }) : '—', { cls: pnlClass(avg), sub: chg.length ? `${chg.filter(x => x.change > 0).length} of ${chg.length} updates went up` : 'needs a second update' })}
        ${stat('Best update', best ? money(best.change, { sign: true }) : '—', { cls: best ? pnlClass(best.change) : '', sub: best ? `${short(best.date)}${worst && worst.change < 0 ? ` · worst ${money(worst.change, { sign: true })}` : ''}` : '' })}
        ${stat('Updates recorded', String(series.length), { sub: every != null ? `about every ${every} day${every === 1 ? '' : 's'}` : 'update again to start the trend' })}
      </div>
      <div class="card mt" data-tour="nw-line"><div class="card-head"><h2>Net worth over time</h2><span class="hint">${allSeries.some(s => s.liabilities > 0) ? 'net worth, assets & debts' : 'each point is a date you updated'}</span></div>
        ${one ? html`<div class="first-snap">${typeBreakdown(cur)}${notEnough('The trend line starts once you’ve updated balances on two different days.')}</div>` : html`<div class="chart tall"><canvas id="n-line"></canvas></div>`}</div>
      ${one ? '' : html`<div class="grid g2 mt">
        <div class="card"><div class="card-head"><h2>What it's made of, over time</h2><span class="hint">assets by type, stacked</span></div><div class="chart"><canvas id="n-stack"></canvas></div></div>
        <div class="card"><div class="card-head"><h2>Change per update</h2><span class="hint">how much net worth moved between updates</span></div><div class="chart"><canvas id="n-chg"></canvas></div></div>
      </div>`}
      <div class="card mt" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Account by account</h2><div class="row">${multiCcy ? html`<div class="seg sm" role="radiogroup" aria-label="Show balances in"><button data-native="0" class="${nativeFirst ? '' : 'on'}">${displayCcy()}</button><button data-native="1" class="${nativeFirst ? 'on' : ''}">Own currency</button></div>` : ''}<a class="hint" href="#/networth/accounts">Manage →</a></div></div>
        <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Account</th><th>Type</th><th class="num">Balance</th><th class="num">Change</th><th class="num">% of assets</th><th style="width:120px">Trend</th></tr></thead>
        <tbody>${accts.filter(a => !a.archivedAt).sort(byType(cur)).map(a => {
          const v = cur.byAcct[a.id] || 0, pv = prev ? prev.byAcct[a.id] || 0 : null;
          const d = pv == null ? null : (a.kind === 'liability' ? -(v - pv) : v - pv);
          const lu = lastUpdateOf(a);
          return html`<tr><td><b>${a.name}</b>${lu ? html`<div class="small muted">updated ${short(lu)}</div>` : ''}</td><td>${typeLabel(a)}</td>
            <td class="num ${a.kind === 'liability' ? 'neg' : ''}">${balCell(a, v, cur.byAcctNative[a.id] || 0)}</td><td class="num ${pnlClass(d)}">${d ? money(d, { sign: true }) : '—'}</td><td class="num">${a.kind === 'liability' ? '' : pct(cur.assets ? v / cur.assets : null, 1)}</td><td>${one ? '' : html`<div style="height:28px;width:110px"><canvas data-spark="${a.id}"></canvas></div>`}</td></tr>`;
        })}</tbody>
        <tfoot><tr><td colspan="2">Net worth</td><td class="num">${money(cur.net)}</td><td class="num ${pnlClass(ch)}">${ch != null ? money(ch, { sign: true }) : ''}</td><td colspan="2"></td></tr></tfoot></table></div></div>`);

    if (one) return;
    const labels = dateLabels(series.map(s => s.date));
    const hasDebt = series.some(s => s.liabilities > 0);
    C.moneyLine(body.querySelector('#n-line'), {
      labels,
      // assets & debts only add a line when there are debts (otherwise assets = net worth and debts sit at 0, flattening the chart)
      series: [{ label: 'Net worth', data: series.map(s => s.net), color: p.series[0], fill: !hasDebt }, ...(hasDebt ? [{ label: 'Assets', data: series.map(s => s.assets), color: p.series[2] }, { label: 'Debts', data: series.map(s => s.liabilities), color: p.series[1] }] : [])],
    });
    const cats = assetCats().filter(c => series.some(s => (s.byCat[c.id] || 0) > 0));
    C.make(body.querySelector('#n-stack'), {
      type: 'line',
      data: { labels, datasets: cats.map(c => ({ label: c.label, data: series.map(s => s.byCat[c.id] || 0), borderColor: catColor(c.id, p), backgroundColor: C.alpha(catColor(c.id, p), 0.55), fill: true, borderWidth: 1, tension: 0.15, cubicInterpolationMode: 'monotone', pointRadius: 0 })) },
      options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis({ ticks: { maxTicksLimit: 8, maxRotation: 0 } }), y: { stacked: true, ...C.moneyAxis() } } },
    });
    C.signBars(body.querySelector('#n-chg'), { labels: dateLabels(chg.map(d => d.date)), values: chg.map(d => d.change) });
    body.querySelectorAll('[data-spark]').forEach(cv => { const id = cv.dataset.spark; const a = store.get('nwAccounts', id); C.sparkline(cv, series.map(s => s.byAcct[id] || 0), a.kind === 'liability' ? p.series[1] : p.series[0]); });
  };
  draw();
  body.addEventListener('click', e => { const b = e.target.closest('[data-native]'); if (!b) return; nativeFirst = b.dataset.native === '1'; try { localStorage.setItem('journal.nativeFirst', nativeFirst ? '1' : '0'); } catch {} draw(); });
}

// ================= updating balances =================
// Every update is a dated value for one account; together they are your net-worth history.
// Recording a value for a date that already has one replaces it.
async function setBalance(acctId, date, value) {
  const snap = store.all('nwSnapshots').find(s => s.date === date);
  await store.put('nwSnapshots', { ...(snap || { date }), balances: { ...(snap?.balances || {}), [acctId]: value } });
}
async function removeBalance(acctId, date) {
  const snap = store.all('nwSnapshots').find(s => s.date === date);
  if (!snap) return;
  const balances = { ...snap.balances }; delete balances[acctId];
  if (Object.keys(balances).length) await store.put('nwSnapshots', { ...snap, balances }); else await store.del('nwSnapshots', snap.id);
}
const historyOf = a => store.all('nwSnapshots').filter(s => s.balances && a.id in s.balances && s.balances[a.id] !== '' && s.balances[a.id] != null).map(s => ({ date: s.date, v: +s.balances[a.id] })).sort((x, y) => y.date.localeCompare(x.date));

// one account: new value + its history (where a wrong entry can be removed)
async function updateAccount(a) {
  const debt = a.kind === 'liability';
  let changed = false;
  const res = await modal({
    title: `Update ${a.name}`,
    body: String(html`<form id="ubf" class="form-grid" autocomplete="off">
      <label class="field">${debt ? 'Amount owed' : 'Balance'} <span class="hint">${ccyOf(a)}</span><input name="value" type="number" step="any" ${debt ? raw('min="0"') : ''} inputmode="decimal" value="${currentBalance(a) || ''}"></label>
      <label class="field">On<input name="date" type="date" value="${today()}" max="${today()}"></label>
      <p class="small muted full" style="margin:0">Each update is kept as a point in your history — update on different days and the trend builds itself.</p>
    </form>
    <h3 class="mt">History</h3><div class="bal-history" id="ubh"></div>`),
    onMount: w => {
      const list = w.querySelector('#ubh');
      const draw = () => { const h = historyOf(a); list.innerHTML = String(h.length ? html`${h.map(x => html`<div class="bh-row"><span>${fmtDate(x.date)}</span><b>${moneyIn(debt ? -x.v : x.v, ccyOf(a))}</b><button type="button" class="icon-btn" data-rmh="${x.date}" aria-label="Remove the ${fmtDate(x.date)} value">✕</button></div>`)}` : html`<p class="small muted">No values yet.</p>`); };
      list.addEventListener('click', async e => { const b = e.target.closest('[data-rmh]'); if (!b) return; await removeBalance(a.id, b.dataset.rmh); changed = true; draw(); });
      draw();
      setTimeout(() => { const i = w.querySelector('[name=value]'); i.focus(); i.select(); });
    },
    actions: [{ label: 'Close', value: () => 'close' }, { label: 'Save', kind: 'primary', value: w => {
      const f = w.querySelector('#ubf');
      if (f.value.value === '' || !isFinite(+f.value.value)) { toast('Enter the balance', 'error'); return false; }
      if (!f.date.value || f.date.value > today()) { toast('Pick a date (today or earlier)', 'error'); return false; }
      return { value: debt ? Math.abs(+f.value.value) : +f.value.value, date: f.date.value };
    } }],
  });
  if (res && typeof res === 'object') { await setBalance(a.id, res.date, res.value); toast(`${a.name} updated`); return true; }
  return changed;
}

// ================= accounts =================
// the standard buckets plus any custom ones already used on other accounts
const purposeChoices = a => [...new Set([...PURPOSES, ...store.all('nwAccounts').map(x => (x.purpose || '').trim()).filter(Boolean), ...(a.purpose ? [a.purpose] : [])])];
// latest recorded value in the account's own currency
const currentBalance = a => Math.round((pointAt(today()).byAcctNative[a.id] || 0) * 100) / 100;
// a new account gets its starting balance here; after that, balances change with Update
const balField = a => (a.id ? '' : html`<label class="field bal">Current balance<input name="balance" type="number" step="any" inputmode="decimal" placeholder="${a.kind === 'liability' ? 'amount owed' : ''}"></label>`);
// Close / Reopen / Delete live in the edit dialog
const manageActions = a => (a.id ? [{ label: a.archivedAt ? 'Reopen' : 'Close account', kind: 'ghost', value: () => 'archive' }, { label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []);

async function editAccountSimple(a) {
  const g0 = a.id ? groupOf(a) : a.kind === 'liability' ? 'debt' : 'savings';
  const types = [...GROUPS, DEBT];
  const res = await modal({
    title: a.id ? `Edit ${a.name}` : 'Add account',
    body: String(html`<form id="nf" class="form-grid">
      <div class="field full">What is it?
        <div class="type-pick" role="radiogroup">${types.map(t => html`<label class="type-opt"><input type="radio" name="group" value="${t.id}" ${t.id === g0 ? raw('checked') : ''}><span><b>${t.label}</b><small>${t.hint}</small></span></label>`)}</div></div>
      <label class="field span2">Name<input name="name" required value="${a.name || ''}" placeholder="e.g. Savings account, Current account, Apartment"></label>
      <label class="field">Currency${raw(ccySelect('currency', a.currency || displayCcy()))}</label>
      ${balField(a)}
      <label class="field yld">Interest / yield (APY %) <span class="hint">optional</span><input name="apy" type="number" step="any" min="0" max="100" value="${a.apy ?? ''}" placeholder="e.g. 3.5"></label>
      <label class="field lia">Interest rate (APR %) <span class="hint">optional</span><input name="rate" type="number" step="any" min="0" value="${a.rate ?? ''}"></label>
    </form>`),
    onMount: w => {
      const f = w.querySelector('#nf');
      const sync = () => {
        const g = f.group.value, show = (sel, on) => { const e = w.querySelector(sel); if (e) e.hidden = !on; };
        show('.yld', g !== 'debt' && g !== 'assets');
        show('.lia', g === 'debt');
      };
      f.addEventListener('change', sync); sync();
    },
    actions: [...manageActions(a), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => { const f = w.querySelector('#nf'); if (!f.name.value.trim()) { toast('Name is required', 'error'); return false; } return formData(f); } }],
  });
  if (res === 'archive' || res === 'delete') return manageAccount(a, res);
  if (!res || typeof res !== 'object') return null;
  const g = res.group, isDebt = g === 'debt';
  // keep the detailed (Pro) category and settings if the type didn't change — switching to Pro later restores them
  const same = a.id && groupOf(a) === g;
  const obj = { ...a, name: res.name.trim(), currency: res.currency || displayCcy(),
    kind: isDebt ? 'liability' : 'asset', category: same ? a.category : groupInfo(g).cat,
    apy: isDebt ? null : toNum(res.apy), rate: isDebt ? toNum(res.rate) : null,
    maturity: same ? a.maturity ?? null : null };
  if (!same) Object.assign(obj, { custody: '', purpose: '', liquid: null, payment: isDebt ? a.payment : null });
  return finishAccountSave(a, obj, res);
}

async function editAccount(a = { kind: 'asset', category: 'savings' }) {
  if (simpleMode()) return editAccountSimple(a);
  const catOpts = kind => (kind === 'liability' ? LIAB_CATS : ASSET_CATS).map(c => html`<option value="${c.id}" ${a.category === c.id ? raw('selected') : ''}>${c.label}</option>`);
  const res = await modal({
    title: a.id ? `Edit ${a.name}` : 'Add account', wide: true,
    body: String(html`<form id="nf" class="form-grid">
      <label class="field">Type<select name="kind"><option value="asset">Asset (you own)</option><option value="liability" ${a.kind === 'liability' ? raw('selected') : ''}>Liability (you owe)</option></select></label>
      <label class="field">Category<select name="category">${catOpts(a.kind)}</select></label>
      <label class="field span2">Name<input name="name" required value="${a.name || ''}" placeholder="e.g. Checking, Retirement fund, Home"></label>
      <label class="field">Institution<input name="institution" value="${a.institution || ''}"></label>
      <label class="field">Currency <span class="hint">the account's own currency</span>${raw(ccySelect('currency', a.currency || displayCcy()))}</label>
      ${balField(a)}
      <div class="lia full form-grid" style="padding:0">
        <label class="field">Interest rate (APR %)<input name="rate" type="number" step="any" min="0" value="${a.rate ?? ''}"></label>
        <label class="field">Monthly payment<input name="payment" type="number" step="any" min="0" value="${a.payment ?? ''}"></label>
      </div>
      <div class="ast full form-grid" style="padding:0">
        <label class="field">Held at<select name="custody">${CUSTODY.map(c => html`<option value="${c.id}" ${custodyOf(a) === c.id ? raw('selected') : ''}>${c.label}</option>`)}</select></label>
        <label class="field">Purpose / bucket<select name="purpose"><option value="">Auto (${purposeOf({ category: a.category || 'cash' })})</option>${purposeChoices(a).map(p => html`<option ${a.purpose === p ? raw('selected') : ''}>${p}</option>`)}<option value="__custom">Other — type your own…</option></select><input name="purposeOther" placeholder="e.g. Wedding fund" maxlength="40" hidden style="margin-top:6px"></label>
        <label class="field">Interest / yield (APY %) <span class="hint">savings, money market, bills, bonds</span><input name="apy" type="number" step="any" min="0" max="100" value="${a.apy ?? ''}" placeholder="e.g. 4.2"></label>
        <label class="field">Liquid?<select name="liquid"><option value="">Auto (by category)</option><option value="yes" ${a.liquid === true ? raw('selected') : ''}>Yes</option><option value="no" ${a.liquid === false ? raw('selected') : ''}>No</option></select></label>
        <label class="field mat">Matures on <span class="hint">term deposits, bills, bonds — optional</span><input name="maturity" type="date" value="${a.maturity || ''}"></label>
      </div>
      <label class="field full">Notes<input name="notes" value="${a.notes || ''}"></label>
    </form>`),
    onMount: w => {
      const f = w.querySelector('#nf');
      const purp = () => { f.purposeOther.hidden = f.purpose.value !== '__custom'; if (!f.purposeOther.hidden) f.purposeOther.focus(); f.purpose.options[0].textContent = `Auto (${purposeOf({ category: f.category.value })})`; };
      f.purpose.onchange = purp; f.category.addEventListener('change', purp);
      const sync = () => { const li = f.kind.value === 'liability'; w.querySelector('.lia').hidden = !li; w.querySelector('.ast').hidden = li; w.querySelector('.mat').hidden = !canMature({ kind: f.kind.value, category: f.category.value }); };
      f.category.addEventListener('change', sync);
      f.kind.onchange = () => { f.category.innerHTML = String(html`${(f.kind.value === 'liability' ? LIAB_CATS : ASSET_CATS).map(c => html`<option value="${c.id}">${c.label}</option>`)}`); sync(); purp(); };
      sync();
    },
    actions: [...manageActions(a), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => { const f = w.querySelector('#nf'); if (!f.name.value.trim()) { toast('Name is required', 'error'); return false; } if (f.purpose.value === '__custom' && !f.purposeOther.value.trim()) { toast('Type a name for the purpose, or pick one from the list', 'error'); return false; } return formData(f); } }],
  });
  if (res === 'archive' || res === 'delete') return manageAccount(a, res);
  if (!res || typeof res !== 'object') return null;
  const yn = v => (v === 'yes' ? true : v === 'no' ? false : null);
  const obj = { ...a, kind: res.kind, category: res.category, name: res.name.trim(), institution: res.institution, notes: res.notes,
    rate: toNum(res.rate), payment: toNum(res.payment), liquid: yn(res.liquid), currency: res.currency || displayCcy(),
    maturity: canMature({ kind: res.kind, category: res.category }) && res.maturity ? res.maturity : null,
    custody: res.kind === 'liability' ? '' : res.custody, purpose: res.kind === 'liability' ? '' : ((res.purpose === '__custom' ? res.purposeOther : res.purpose) || '').trim().slice(0, 40), apy: res.kind === 'liability' ? null : toNum(res.apy) };
  return finishAccountSave(a, obj, res);
}

async function finishAccountSave(a, obj, res) {
  const saved = await store.put('nwAccounts', obj);
  // a new account starts with the balance you gave it, recorded for today
  if (!a.id && res.balance !== '' && res.balance != null && isFinite(+res.balance)) await setBalance(saved.id, today(), saved.kind === 'liability' ? Math.abs(+res.balance) : +res.balance);
  return saved;
}

// close (sold, paid off — counts as zero from that date, history kept), reopen, or delete for good
async function manageAccount(a, what) {
  if (what === 'archive') {
    if (a.archivedAt) { await store.put('nwAccounts', { ...a, archivedAt: null }); toast(`${a.name} reopened`); return true; }
    const d = await modal({ title: `Close ${a.name}`, body: String(html`<p class="small muted">From this date on the account counts as zero (sold, paid off, closed). Its history is kept.</p><label class="field">Closed on<input type="date" name="d" value="${today()}"></label>`), actions: [{ label: 'Cancel' }, { label: 'Close account', kind: 'primary', value: w => w.querySelector('[name=d]').value || false }] });
    if (typeof d === 'string' && /^\d{4}-/.test(d)) { await store.put('nwAccounts', { ...a, archivedAt: d }); toast(`${a.name} closed`); return true; }
    return false;
  }
  if (!(await confirmDlg('Delete account?', `Delete ${a.name} and all its balance history? To keep the history, close it instead.`))) return false;
  for (const s of store.all('nwSnapshots')) if (s.balances && a.id in s.balances) await removeBalance(a.id, s.date);
  await store.del('nwAccounts', a.id);
  toast(`${a.name} deleted`);
  return true;
}

export async function accounts(el) {
  const accts = store.all('nwAccounts');
  const cur = pointAt(today());
  const totalAssets = cur.assets || 0;
  const bulk = query().get('update') === '1' && accts.some(a => !a.archivedAt);   // "update all" mode: every balance becomes an input
  const sec = (title, list, { hint = '', debt = false } = {}) => { const tot = list.filter(a => !a.archivedAt).reduce((s, a) => s + (cur.byAcct[a.id] || 0), 0); return html`<div class="card mt acct-group" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><div><h2>${title}</h2>${hint ? html`<div class="small muted">${hint}</div>` : ''}</div><span class="hint"><b class="${debt ? 'neg' : ''}">${money(debt ? -tot : tot)}</b>${!debt && totalAssets ? html` · ${pct(tot / totalAssets, 1)} of assets` : ''}</span></div>
    <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Name</th><th>${simpleMode() ? 'Yield' : 'Institution'}</th><th>Details</th><th class="num">Balance</th><th></th></tr></thead><tbody>
    ${list.map(a => { const yieldTag = +a.apy ? html`<span class="tag accent">${a.apy}% APY</span>` : a.kind !== 'liability' && groupOf(a) === 'savings' ? html`<span class="tag">0% APY</span>` : a.kind === 'liability' && +a.rate ? html`<span class="tag">${a.rate}% APR</span>` : '';
      const lu = lastUpdateOf(a), sg = a.kind === 'liability' ? -1 : 1;
      const editable = bulk && !a.archivedAt;
      return html`<tr ${a.archivedAt ? raw('style="opacity:.55"') : ''}><td><b>${a.name}</b>${a.archivedAt ? html` <span class="tag">closed ${fmtDate(a.archivedAt)}</span>` : ''}${!simpleMode() && yieldTag ? html` ${yieldTag}` : ''}</td><td>${simpleMode() ? (yieldTag || html`<span class="muted">—</span>`) : a.institution || ''}</td>
      <td class="small muted">${a.kind === 'liability' ? [typeLabel(a), a.payment ? `${moneyIn(+a.payment, ccyOf(a))}/mo` : ''].filter(Boolean).join(' · ') : [canMature(a) && a.maturity ? `matures ${fmtDate(a.maturity)}` : '', simpleMode() ? '' : typeLabel(a), custodyLabel(custodyOf(a)), purposeOf(a), isLiquid(a) ? 'liquid' : 'illiquid'].filter(Boolean).join(' · ')}</td>
      <td class="num ${a.kind === 'liability' ? 'neg' : ''}">${editable ? html`<input class="bal-input" type="number" step="any" inputmode="decimal" data-bal="${a.id}" value="${currentBalance(a) || ''}" ${a.kind === 'liability' ? raw('min="0" placeholder="owed"') : ''} aria-label="${a.name} balance in ${ccyOf(a)}"><div class="dist">${ccyOf(a)}</div>`
        : html`${moneyIn(sg * (cur.byAcctNative[a.id] || 0), ccyOf(a))}${!sameMoney(ccyOf(a), displayCcy()) ? html`<div class="dist">≈ ${money(sg * (cur.byAcct[a.id] || 0))}</div>` : ''}${lu && !a.archivedAt ? html`<div class="dist">updated ${fmtDate(lu, { month: 'short', day: 'numeric' })}</div>` : ''}`}</td>
      <td style="text-align:right;white-space:nowrap">${a.archivedAt || bulk ? '' : html`<button class="btn sm primary-soft" data-upd="${a.id}">Update</button> `}<button class="btn sm" data-edit="${a.id}">Edit</button></td></tr>`; })}
    </tbody></table></div></div>`; };
  // grouped by type (the five Simple types, or the detailed Pro categories); biggest first inside each group
  const order = (a, b) => !!a.archivedAt - !!b.archivedAt || (cur.byAcct[b.id] || 0) - (cur.byAcct[a.id] || 0) || a.name.localeCompare(b.name);
  const types = [...assetCats(), ...liabCats()].map(c => ({ ...c, debt: liabCats().includes(c), list: accts.filter(a => catKey(a) === c.id && (a.kind === 'liability') === liabCats().includes(c)).sort(order) })).filter(g => g.list.length);
  el.innerHTML = String(html`<div class="page-head"><div><h1>Accounts</h1><div class="sub">Everything you own and owe, grouped by type. <b>Update</b> records today's balance — every update is kept, so your history builds itself.</div></div>
    <div class="actions">${accts.length && !bulk ? html`<a class="btn" href="#/networth/accounts?update=1">Update all</a>` : ''}${simpleMode() ? html`<button class="btn primary" data-new>+ Add account</button>` : html`<button class="btn" data-new-l>+ Add debt</button><button class="btn primary" data-new>+ Add asset</button>`}</div></div>
    ${bulk ? html`<div class="bulk-bar"><b>Update all balances</b><span class="small muted">Type what each account is worth; leave the rest as they are.</span><span class="spacer"></span><label class="row small">On <input type="date" id="bulk-date" value="${today()}" max="${today()}"></label><a class="btn" href="#/networth/accounts">Cancel</a><button class="btn primary" data-bulk-save>Save all</button></div>` : ''}
    ${!accts.length ? html`<div class="empty"><div class="empty-title">No accounts yet</div><p>${simpleMode() ? 'Add your bank accounts, savings, cash and the things you own — and any debts.' : 'Typical list: current accounts, savings, term deposits, bills and bonds, property — and any loans or cards.'}</p><button class="btn primary" data-new>+ Add account</button></div>` : html`
    <div class="type-strip">${types.map(g => html`<a href="#grp-${g.id}" class="type-chip"><span>${g.label}</span><b class="${g.debt ? 'neg' : ''}">${money((g.debt ? -1 : 1) * g.list.filter(a => !a.archivedAt).reduce((s, a) => s + (cur.byAcct[a.id] || 0), 0), { compact: true })}</b></a>`)}</div>`}
    ${types.map(g => html`<div id="grp-${g.id}">${sec(g.label, g.list, { debt: g.debt, hint: g.hint && simpleMode() ? g.hint.split(' — ')[0] : '' })}</div>`)}
    ${bulk ? '' : capitalCard()}`);
  el.querySelectorAll('.type-chip').forEach(x => x.onclick = e => { e.preventDefault(); el.querySelector(x.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  el.querySelector('[data-bulk-save]')?.addEventListener('click', async () => {
    const date = el.querySelector('#bulk-date').value;
    if (!date || date > today()) { toast('Pick a date (today or earlier)', 'error'); return; }
    const snap = store.all('nwSnapshots').find(s => s.date === date);
    const balances = { ...(snap?.balances || {}) };
    let n = 0;
    for (const inp of el.querySelectorAll('[data-bal]')) { if (inp.value === '' || !isFinite(+inp.value) || (inp.value === inp.defaultValue && date !== today())) continue; const a = store.get('nwAccounts', inp.dataset.bal); balances[a.id] = a.kind === 'liability' ? Math.abs(+inp.value) : +inp.value; n++; }
    if (!n) { toast('Nothing to save', 'error'); return; }
    await store.put('nwSnapshots', { ...(snap || { date }), balances });
    toast(`${n} balance${n === 1 ? '' : 's'} saved for ${fmtDate(date)}`);
    go('/networth');
  });
  el.addEventListener('click', async e => {
    const row = e.target.closest('[data-cap-edit]');
    if (row) { if (await editCapital(store.get('capital', row.dataset.capEdit))) refresh(); return; }
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.capNew !== undefined) { if (await editCapital()) refresh(); }
    else if (b.dataset.capBal) { if (await editCapitalBalance(b.dataset.capBal, store.get('capital', `bal-${b.dataset.capBal}`))) refresh(); }
    else if (b.dataset.new !== undefined) { if (await editAccount()) refresh(); }
    else if (b.dataset.newL !== undefined) { if (await editAccount({ kind: 'liability', category: 'credit' })) refresh(); }
    else if (b.dataset.edit) { if (await editAccount(store.get('nwAccounts', b.dataset.edit))) refresh(); }
    else if (b.dataset.upd) { if (await updateAccount(store.get('nwAccounts', b.dataset.upd))) refresh(); }
  });
}

// ================= trading capital (outside net worth) =================
// A small ledger for money that isn't counted as yours yet: what you put into trading in a year and
// what the accounts were worth at the end of it. Balance − put in = a starting point for taxes.
async function editCapital(c = {}) {
  const last = [...store.all('capital')].filter(x => x.kind !== 'balance').sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  const res = await modal({
    title: c.id ? 'Edit entry' : 'Money put into trading',
    body: String(html`<form id="capf" class="form-grid" autocomplete="off">
      <label class="field">Amount <span class="hint">minus = taken out</span><input name="amount" type="number" step="any" inputmode="decimal" required value="${c.amount ?? ''}" placeholder="0.00"></label>
      <label class="field">Currency${raw(ccySelect('currency', c.currency || last?.currency || displayCcy()))}</label>
      <label class="field">Date <span class="hint">decides the year</span><input name="date" type="date" required value="${c.date || today()}" max="${today()}"></label>
      <label class="field">Note <span class="hint">optional</span><input name="note" maxlength="80" value="${c.note || ''}" placeholder="e.g. starting capital, top-up"></label>
    </form>`),
    onMount: w => setTimeout(() => w.querySelector('[name=amount]').focus()),
    actions: [...(c.id ? [{ label: 'Delete', kind: 'danger ghost', value: () => 'delete' }] : []), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => {
      const f = w.querySelector('#capf'), amount = toNum(f.amount.value);
      if (!amount) { toast('Enter an amount', 'error'); return false; }
      if (!f.date.value || f.date.value > today()) { toast('Pick a date (today or earlier)', 'error'); return false; }
      return { kind: 'in', amount, currency: f.currency.value, date: f.date.value, note: f.note.value.trim() };
    } }],
  });
  if (res === 'delete') { await store.del('capital', c.id); toast('Entry deleted'); return true; }
  if (!res || typeof res !== 'object') return false;
  await store.put('capital', { ...c, ...res });
  toast('Saved');
  return true;
}
async function editCapitalBalance(year, bal) {
  const now = year === today().slice(0, 4);
  const last = [...store.all('capital')].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
  const res = await modal({
    title: now ? `Trading balance now (${year})` : `Trading balance at the end of ${year}`,
    body: String(html`<form id="capbf" class="form-grid" autocomplete="off">
      <label class="field">Balance <span class="hint">all trading accounts together</span><input name="amount" type="number" step="any" min="0" inputmode="decimal" required value="${bal?.amount ?? ''}" placeholder="0.00"></label>
      <label class="field">Currency${raw(ccySelect('currency', bal?.currency || last?.currency || displayCcy()))}</label>
      <p class="small muted full" style="margin:0">Not added to your net worth. It's only compared with what you put in during ${year}.</p>
    </form>`),
    onMount: w => setTimeout(() => { const i = w.querySelector('[name=amount]'); i.focus(); i.select(); }),
    actions: [...(bal ? [{ label: 'Remove', kind: 'danger ghost', value: () => 'delete' }] : []), { label: 'Cancel' }, { label: 'Save', kind: 'primary', value: w => {
      const f = w.querySelector('#capbf');
      if (f.amount.value === '' || !(+f.amount.value >= 0)) { toast('Enter the balance', 'error'); return false; }
      return { amount: +f.amount.value, currency: f.currency.value };
    } }],
  });
  if (res === 'delete') { await store.del('capital', bal.id); toast('Balance removed'); return true; }
  if (!res || typeof res !== 'object') return false;
  await store.put('capital', { ...(bal || {}), id: `bal-${year}`, kind: 'balance', date: now ? today() : `${year}-12-31`, ...res });
  toast('Saved');
  return true;
}
function capitalCard() {
  const years = capitalYears().filter((y, i) => i === 0 || y.entries.length || y.bal);
  const any = store.all('capital').length > 0;
  const thisYear = today().slice(0, 4);
  return html`<div class="card mt" id="capital" style="padding:0" data-tour="capital"><div class="card-head" style="padding:14px 16px 0"><div><h2>Trading capital</h2><div class="small muted">Kept outside your net worth. Note what you put in each year and what it's worth at the end — the difference is what you made.</div></div><button class="btn sm" data-cap-new>+ Money put in</button></div>
    ${any ? html`<div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Year</th><th class="num">Put in</th><th class="num">Balance</th><th class="num">Result</th><th></th></tr></thead><tbody>
      ${years.map(y => html`<tr><td><b>${y.year}</b><div class="small muted">${y.entries.length} entr${y.entries.length === 1 ? 'y' : 'ies'}</div></td>
        <td class="num"><b>${money(y.put)}</b></td>
        <td class="num">${y.balance != null ? html`${money(y.balance)}<div class="dist">${y.year === thisYear ? `as of ${fmtDate(y.bal.date, { month: 'short', day: 'numeric' })}` : 'at year end'}</div>` : html`<span class="muted">—</span>`}</td>
        <td class="num ${pnlClass(y.result)}">${y.result != null ? html`<b>${money(y.result, { sign: true })}</b>${y.put > 0 ? html`<div class="dist">${pct(y.result / y.put, 1, { sign: true })}</div>` : ''}` : html`<span class="muted small">set the balance</span>`}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn sm ${y.balance == null ? 'primary-soft' : ''}" data-cap-bal="${y.year}">${y.balance == null ? 'Set balance' : 'Balance'}</button></td></tr>
        ${y.entries.map(c => html`<tr class="click cap-entry" data-cap-edit="${c.id}"><td class="small muted">${fmtDate(c.date, { month: 'short', day: 'numeric' })}</td><td class="num small">${moneyIn(c.amount, c.currency, { sign: c.amount < 0 })}</td><td colspan="3" class="small muted">${c.note || (c.amount < 0 ? 'Taken out' : 'Put in')}</td></tr>`)}`)}
      </tbody></table></div>
      <p class="small muted" style="padding:0 16px 14px;margin:8px 0 0">Result = balance − what you put in that year. Count the capital you start a year with as put in on 1 January. It's a starting point for your own records, not a tax figure.</p>`
      : html`<p class="small muted" style="padding:0 16px 16px;margin:8px 0 0">Nothing noted yet. Add what you put into your trading accounts this year (including the capital you started the year with), then set the balance at the end of the year.</p>`}</div>`;
}

// ================= target allocation (shown on Insights) =================
// Rebalancing bands — the "5/25 rule": act when a category drifts more than 5 percentage points
// from its target, or more than 25% of the target itself, whichever is smaller.
const band = tg => Math.min(0.05, (tg / 100) * 0.25);
function renderTargets(host, cur) {
  const pl = store.getSettings().plan || {};
  const ta = pl.targetAllocation || {};
  const aCats = assetCats().filter(c => (cur.byCat[c.id] || 0) > 0 || +ta[c.id]);
  const targetSum = aCats.reduce((a, c) => a + (+ta[c.id] || 0), 0);
  host.innerHTML = String(html`<div class="grid g2 mt">
      <form class="card" id="tf"><div class="card-head"><h2>Target allocation</h2><span class="hint ${Math.abs(targetSum - 100) > 0.01 && targetSum ? 'neg' : ''}">${targetSum ? `targets add up to ${num(targetSum, 0)}%` : 'set a target % per type'}</span></div>
        ${aCats.length ? html`<div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th>Type</th><th class="num">Current</th><th class="num">Target %</th><th class="num">Drift</th><th class="num">Adjust by</th></tr></thead><tbody>
        ${aCats.map(c => { const curPct = cur.assets ? (cur.byCat[c.id] || 0) / cur.assets : 0; const tg = +ta[c.id] || 0; const drift = tg ? curPct - tg / 100 : null; const reb = tg ? (tg / 100) * cur.assets - (cur.byCat[c.id] || 0) : null; const out = drift != null && Math.abs(drift) > band(tg);
          return html`<tr><td style="white-space:nowrap"><span class="dot" style="background:${catColor(c.id, C.palette())}"></span>${c.label}</td><td class="num">${pct(curPct, 1)}</td><td class="num"><input name="${c.id}" type="number" min="0" max="100" step="1" value="${tg || ''}" style="width:58px;text-align:right" aria-label="${c.label} target"></td><td class="num ${out ? 'neg' : ''}">${drift == null ? '—' : num(drift * 100, 1, { sign: true }) + ' pts'}</td><td class="num ${out ? '' : 'muted'}">${reb == null ? '—' : money(reb, { sign: true })}</td></tr>`; })}
        </tbody></table></div><div class="row mt"><span class="small muted">Red = outside the rebalancing band (5 points, or 25% of the target if smaller).</span><span class="spacer"></span><button class="btn primary">Save targets</button></div>` : html`<p class="muted">Add assets first.</p>`}
      </form>
      <div class="card"><div class="card-head"><h2>Current vs target</h2></div><div class="chart"><canvas id="p-alloc"></canvas></div></div>
    </div>`);
  host.querySelector('#tf').onsubmit = async e => {
    e.preventDefault();
    const f = formData(e.target);
    const next = {};
    for (const [k, v] of Object.entries(f)) if (v !== '') next[k] = +v;
    await store.saveSettings({ plan: { targetAllocation: null } });   // replace, so cleared targets disappear
    await store.saveSettings({ plan: { targetAllocation: next } });
    toast('Targets saved'); refresh();
  };
  const p = C.palette();
  if (aCats.length) C.make(host.querySelector('#p-alloc'), {
    type: 'bar',
    data: { labels: aCats.map(c => c.label), datasets: [{ label: 'Current', data: aCats.map(c => (cur.assets ? (cur.byCat[c.id] || 0) / cur.assets : 0) * 100), backgroundColor: p.series[0], maxBarThickness: 14 }, { label: 'Target', data: aCats.map(c => +ta[c.id] || 0), backgroundColor: p.neutral, maxBarThickness: 14 }] },
    options: { indexAxis: 'y', plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${num(c.parsed.x, 1)}%` } } }, scales: { x: { grid: { color: p.grid }, border: { display: false }, ticks: { callback: v => v + '%' } }, y: C.plainAxis({ ticks: { autoSkip: false } }) } },
  });
}

// ================= insights: how it's spread and how healthy it is, today =================
export async function analytics(el) {
  const series = nwSeries();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Insights</h1><div class="sub">${series.length ? `How your money is spread today, how fast you could reach it, what it earns and how healthy it looks. As of ${fmtDate(series.at(-1).date)}.` : 'How your money is spread, how fast you could reach it, what it earns and how healthy it looks.'}</div></div></div><div id="body"></div>`);
  const body = el.querySelector('#body');
  if (!series.length) { body.innerHTML = String(emptyNW()); return; }
  const cur = series.at(-1);
  const p = C.palette();
  const pro = !simpleMode();
  const base = baseline();
  const io = interestOverview();
  const pos = positions(cur);
  const conc = concentration(pos);
  const banks = bankExposure(cur), limit = +store.getSettings().plan?.depositLimit || 0;
  const ccys = currencyExposure(cur);
  const stale = staleAccounts(60);
  const debt = debtMetrics(cur);
  const mats = maturities();
  const aCats = assetCats().filter(c => (cur.byCat[c.id] || 0) > 0);
  const lCats = liabCats().filter(c => (cur.byCat[c.id] || 0) > 0);
  const tiers = TIERS.map(t => ({ t, v: cur.byTier[t] || 0 }));
  const reach = cashAtHand(cur);
  const runway = base.avgExpenses ? reach / base.avgExpenses : null;
  const liquidRunway = base.avgExpenses ? cur.liquid / base.avgExpenses : null;
  const target = store.getSettings().plan?.emergencyMonths || 6;
  const annualExp = base.avgExpenses ? base.avgExpenses * 12 : null;
  const custody = CUSTODY.map(c => ({ ...c, v: cur.byCustody[c.id] || 0 })).filter(c => c.v > 0).sort((a, b) => b.v - a.v);
  const purposes = Object.entries(cur.byPurpose).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const spendNote = base.source === 'set' ? 'using the monthly spending set in Settings' : 'from your logged spending';

  const health = [
    ['Cash runway', runway, v => `${num(v, 1)} months`, v => v >= target ? 'good' : v >= target / 2 ? 'ok' : 'bad', `cash and savings should cover your target of ${target} months of spending`],
    ['Liquid runway', liquidRunway, v => `${num(v, 1)} months`, v => v >= 12 ? 'good' : v >= 6 ? 'ok' : 'bad', 'everything you could turn into cash within days, in months of spending'],
    ['Interest vs your spending', annualExp && io.earnYear ? io.earnYear / annualExp : null, v => pct(v, 1), v => v >= 1 ? 'good' : v >= 0.25 ? 'ok' : 'bad', 'yearly interest ÷ yearly spending (100% = interest alone covers it)'],
    ['Cash earning nothing', base.avgExpenses && reach ? io.idleValue / base.avgExpenses : null, v => `${money(io.idleValue)} · ${num(v, 1)} months of spending`, v => v <= 3 ? 'good' : v <= 6 ? 'ok' : 'bad', 'keep a few months of spending at hand; the rest could earn interest'],
    ['Most at one bank', banks.length && limit ? banks[0].value : null, v => `${money(v)} · ${banks[0].name}`, v => v <= limit ? 'good' : 'bad', `deposit guarantee schemes cover about ${money(limit)} per bank — set your limit in Settings`],
    ['Largest single account', conc.top1, v => `${pct(v, 1)} · ${pos[0]?.label}`, v => v <= 0.35 ? 'good' : v <= 0.6 ? 'ok' : 'bad', 'how much of what you own sits in one place'],
    ...(cur.liabilities ? [['Debt-to-asset', cur.assets ? cur.liabilities / cur.assets : null, v => pct(v, 1), v => v <= 0.3 ? 'good' : v <= 0.5 ? 'ok' : 'bad', 'under 50%, ideally under 30%']] : []),
    ['Balances up to date', stale.length, v => (v ? `${v} not updated for 60+ days` : 'all updated within 60 days'), v => v === 0 ? 'good' : v <= 2 ? 'ok' : 'bad', stale.length ? `oldest: ${stale.slice(0, 3).map(x => x.a.name).join(', ')}` : 'everything on this page is only as good as your last update'],
  ];
  const icon = k => (k === 'good' ? raw('<span class="pos">✔</span>') : k === 'ok' ? raw('<span style="color:var(--warn)">●</span>') : raw('<span class="neg">▲</span>'));
  const bars = (rows, total, mark) => html`<div class="stack" style="gap:10px">${rows.map(r => html`<div><div class="row small"><b>${r.label}</b><span class="spacer"></span><b>${money(r.value)}</b><span class="muted">${pct(total ? r.value / total : 0, 0)}</span></div><div class="bar-mini lg"><span style="width:${Math.min(100, (r.value / (mark ? Math.max(mark, rows[0].value) : total || 1)) * 100)}%" class="${mark && r.value > mark ? 'over' : ''}"></span>${mark ? html`<i style="left:${Math.min(100, (mark / Math.max(mark, rows[0].value)) * 100)}%" title="Deposit guarantee limit"></i>` : ''}</div></div>`)}</div>`;
  const bankTotal = banks.reduce((a, x) => a + x.value, 0);

  body.innerHTML = String(html`
    <div class="stats big">
      ${stat('Reachable within days', money(cur.liquid), { sub: cur.assets ? `${pct(cur.liquid / cur.assets, 0)} of what you own` : '', help: 'Everything you could turn into cash within days: cash, savings, bills and bonds, funds. Property, cars and locked deposits are left out.' })}
      ${stat('Cash runway', runway != null ? `${num(runway, 1)} months` : '—', { cls: runway != null && runway < target / 2 ? 'neg' : '', sub: runway != null ? `target ${target} · ${spendNote}` : html`log spending or <a href="#/settings">set it</a>`, help: 'How many months your cash and savings would cover your usual monthly spending.' })}
      ${stat('Interest / month', io.earn.length ? money(io.earnMonth) : '—', { cls: io.earnMonth ? 'pos' : '', sub: io.earn.length ? `estimate · ${pct(io.blended, 2)} blended` : 'no APY set', help: 'What your interest-bearing accounts would earn per month at their APY and today’s balance. An estimate — balances don’t change on their own.' })}
      ${stat('Largest account', conc.top1 != null ? pct(conc.top1, 0) : '—', { sub: pos[0] ? `${pos[0].label} · of your assets` : '' })}
      ${stat('Most at one bank', banks.length ? money(banks[0].value) : '—', { cls: banks.length && limit && banks[0].value > limit ? 'neg' : '', sub: banks.length ? `${banks[0].name}${limit ? (banks[0].value > limit ? ` · above the ${money(limit, { compact: true })} guarantee` : ` · within the ${money(limit, { compact: true })} guarantee`) : ''}` : 'no bank accounts', help: 'Bank money added up per bank (the institution you typed in Pro input, otherwise the account name). Deposit guarantee schemes cover a fixed amount per bank — set yours in Settings.' })}
    </div>
    <div class="grid g2 mt">
      <div class="card" data-tour="alloc"><div class="card-head"><h2>Where it sits</h2><span class="hint">assets by type</span></div><div class="chart"><canvas id="a-alloc"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>How fast you could reach it</h2><span class="hint">liquidity ladder</span></div><div class="chart"><canvas id="a-tier"></canvas></div></div>
    </div>
    ${interestCard(io)}
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Largest accounts</h2><span class="hint">% of assets</span></div><div class="chart short"><canvas id="a-top"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Banks${ccys.length > 1 ? ' & currencies' : ''}</h2><span class="hint">${limit ? `guarantee ${money(limit, { compact: true })} per bank` : 'bank money per bank'}</span></div>
        ${banks.length ? bars(banks.slice(0, 6).map(x => ({ label: x.name, value: x.value })), bankTotal, limit) : html`<p class="small muted">No bank accounts yet.</p>`}
        ${ccys.length > 1 ? html`<h3 class="mt">By currency</h3>${bars(ccys.map(x => ({ label: x.currency, value: x.value })), cur.assets)}<p class="small muted" style="margin:8px 0 0">Anything not in ${displayCcy()} moves with the exchange rate.</p>` : ''}</div>
    </div>
    ${pro ? html`<div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Who holds it</h2><span class="hint">banks, brokers, at home</span></div><div class="chart"><canvas id="a-cust"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>What it's for</h2><span class="hint">purpose buckets</span></div><div class="chart"><canvas id="a-purp"></canvas></div></div>
    </div>` : ''}
    <div class="card mt" data-tour="health"><div class="card-head"><h2>Health check</h2><span class="hint">rules of thumb — context matters</span></div>
      <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th></th><th>Measure</th><th class="num">You</th><th>Guideline</th></tr></thead><tbody>
      ${health.map(([name, v, f, judge, guide]) => html`<tr><td style="width:28px">${v == null ? html`<span class="muted">–</span>` : icon(judge(v))}</td><td>${name}</td><td class="num">${v == null ? html`<span class="muted">needs data</span>` : f(v)}</td><td class="small muted">${guide}</td></tr>`)}
      </tbody></table></div></div>
    ${mats.length || lCats.length ? html`<div class="grid ${mats.length && lCats.length ? 'g-2-1' : ''} mt">
      ${mats.length ? html`<div class="card" style="padding:0" data-tour="maturities"><div class="card-head" style="padding:14px 16px 0"><h2>Maturing</h2><span class="hint">${(v => v ? `${money(v)} within 90 days` : 'nothing within 90 days')(mats.filter(m => m.days <= 90).reduce((t, m) => t + m.value, 0))}</span></div>
        <div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th>Account</th><th>Matures</th><th class="num">Value</th><th class="num">Yield</th></tr></thead><tbody>
        ${mats.map(m => html`<tr><td><b>${m.a.name}</b></td><td>${fmtDate(m.date)} <span class="small ${m.days < 0 ? 'neg' : m.days <= 30 ? '' : 'muted'}">${m.days < 0 ? `matured ${-m.days} day${m.days === -1 ? '' : 's'} ago — update or close it` : m.days === 0 ? 'today' : `in ${m.days} day${m.days === 1 ? '' : 's'}`}</span></td><td class="num">${money(m.value)}</td><td class="num">${+m.a.apy ? `${num(+m.a.apy, 2)}%` : '—'}</td></tr>`)}
        </tbody></table></div></div>` : ''}
      ${lCats.length ? html`<div class="card"><div class="card-head"><h2>Debt</h2><span class="hint">${debt.wRate != null ? `weighted APR ${num(debt.wRate, 2)}%` : ''}</span></div><div class="chart short"><canvas id="a-debt"></canvas></div>
        <dl class="kv small mt"><dt>Debt-to-asset</dt><dd>${pct(cur.assets ? cur.liabilities / cur.assets : null, 1)}</dd>${io.payMonth ? html`<dt>Interest per month</dt><dd class="neg">${money(io.payMonth)}</dd>` : ''}${debt.minPay ? html`<dt>Payments per month</dt><dd>${money(debt.minPay)}</dd>` : ''}</dl></div>` : ''}
    </div>` : ''}
    <div id="targets"></div>`);
  renderTargets(body.querySelector('#targets'), cur);

  C.doughnut(body.querySelector('#a-alloc'), { labels: aCats.map(c => c.label), values: aCats.map(c => cur.byCat[c.id]), colors: aCats.map(c => catColor(c.id, p)), center: { value: money(cur.assets, { compact: true }), label: 'assets' } });
  C.plainBars(body.querySelector('#a-tier'), { labels: tiers.map(x => x.t), values: tiers.map(x => x.v), horizontal: true, fmt: v => money(v, { compact: true }), label: 'Value' });
  const top = pos.slice(0, 8);
  C.plainBars(body.querySelector('#a-top'), { labels: top.map(x => x.label), values: top.map(x => (x.value / cur.assets) * 100), horizontal: true, fmt: v => num(v, 1) + '%', label: 'Share of assets' });
  if (pro) {
    C.doughnut(body.querySelector('#a-cust'), { labels: custody.map(c => c.label), values: custody.map(c => c.v), colors: custody.map(c => p.series[CUSTODY.findIndex(x => x.id === c.id) % 8]), center: { value: String(custody.length), label: 'holders' } });
    C.doughnut(body.querySelector('#a-purp'), { labels: purposes.map(x => x[0]), values: purposes.map(x => x[1]), center: { value: String(purposes.length), label: 'buckets' } });
  }
  if (lCats.length) C.doughnut(body.querySelector('#a-debt'), { labels: lCats.map(c => c.label), values: lCats.map(c => cur.byCat[c.id]), colors: lCats.map(c => catColor(c.id, p)), center: { value: money(cur.liabilities, { compact: true }), label: 'owed' } });
}
