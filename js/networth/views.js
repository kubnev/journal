import * as store from '../store.js';
import { html, raw, money, pct, num, pnlClass, stat, fmtDate, today, modal, toast, confirmDlg, formData, toNum, parseDay, dayKey } from '../ui.js';
import * as C from '../charts.js';
import { ASSET_CATS, LIAB_CATS, assetCats, liabCats, GROUPS, DEBT, groupOf, groupInfo, simpleMode, typeLabel, isLiquid, nwSeries, pointAt, baseline, changes, debtMetrics, interestOverview, lastUpdateOf, catKey, CUSTODY, custodyOf, custodyLabel, PURPOSES, purposeOf, TIERS, positions, concentration } from './calc.js';
import { toDisplay, ccyOf, moneyIn, ccySelect, displayCcy, sameMoney } from '../fx.js';
import { updateAllPrices, summaryText, holdingsTotal, holdingValue, syncHoldingsSnapshot, normSymbol } from './prices.js';
import { go, refresh, query } from '../main.js';

const RANGES = [['all', 'All'], ['1y', '1Y'], ['3y', '3Y'], ['5y', '5Y']];
let nativeFirst = (() => { try { return localStorage.getItem('journal.nativeFirst') === '1'; } catch { return false; } })();
let range = 'all';
export const catColor = (id, p) => { const c = assetCats().find(x => x.id === id); if (c) return p.series[(c.ci ?? 0) % 8]; return p.series[(liabCats().findIndex(x => x.id === id) + 2) % 8]; };
function emptyNW() {
  return html`<div class="empty"><div class="empty-title">Start tracking your net worth</div><p>Add what you own (savings, investments, property) and what you owe (loans, cards). Then update the balances every so often — each update becomes a point in your history.</p>
    <a class="btn primary" href="#/networth/accounts">+ Add accounts</a></div>`;
}
const hasHoldings = () => store.all('nwAccounts').some(a => a.tracksHoldings && !a.archivedAt && (a.holdings || []).length);
function ago(iso) {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}
const priceBtn = () => (hasHoldings() ? html`<button class="btn" data-prices title="Fetch live crypto / stock prices for your holdings. Last update: ${ago(store.getSettings().priceApi?.lastUpdate)}">↻ Update prices</button>` : '');
function wirePrices(el) {
  el.querySelectorAll('[data-prices]').forEach(b => b.onclick = async () => {
    const label = b.textContent;
    b.disabled = true; b.textContent = 'Updating…';
    try {
      const r = await updateAllPrices();
      toast(summaryText(r), r.updated ? 'info' : 'error');
      if (r.updated) refresh();
    } catch (e) { toast('Price update failed: ' + e.message, 'error'); }
    finally { b.disabled = false; b.textContent = label; }
  });
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

// The type order used everywhere (Savings → Investments → Trading → Assets → Cash → Debt, or the Pro
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

// ================= interest (estimates on the Net worth page) =================
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
      : html`<p class="small muted" style="margin:0">Give a savings account its interest rate (Accounts & holdings → Edit → APY) and this shows what it earns per day, month and year. Your balances stay exactly what you type.</p>`}
  </div>`;
}

// ================= overview =================
export async function overview(el) {
  const accts = store.all('nwAccounts');
  const allSeries = nwSeries();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Net worth</h1><div class="sub">${allSeries.length ? `Last updated ${fmtDate(lastUpdate())}` : 'Everything you own minus everything you owe.'}</div></div>
    <div class="actions">${allSeries.length > 2 ? html`<div class="seg" id="rng">${RANGES.map(([k, l]) => html`<button data-r="${k}" class="${range === k ? 'on' : ''}">${l}</button>`)}</div>` : ''}${priceBtn()}<a class="btn primary" href="#/networth/accounts?update=1">Update balances</a></div></div><div id="body"></div>`);
  wirePrices(el);
  const body = el.querySelector('#body');
  if (!accts.length || !allSeries.length) { body.innerHTML = String(emptyNW()); return; }
  el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { range = b.dataset.r; el.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); draw(); });

  const draw = () => {
    C.destroyAll();
    const series = rangeFilter(allSeries);
    const cur = allSeries.at(-1), prev = allSeries.at(-2), first = series[0];
    const ch = prev ? cur.net - prev.net : null;
    const chRange = first && first !== cur ? cur.net - first.net : null;
    const base = baseline();
    const debt = debtMetrics(cur);
    const efMonths = base.avgExpenses ? ((cur.byCat.cash || 0) + (cur.byCat.savings || 0)) / base.avgExpenses : null;
    const io = interestOverview();
    const p = C.palette();
    const aCats = assetCats().filter(c => (cur.byCat[c.id] || 0) > 0);
    const lCats = liabCats().filter(c => (cur.byCat[c.id] || 0) > 0);
    const liquidShare = cur.assets ? cur.liquid / cur.assets : null;
    const chg = changes(series);
    const one = series.length < 2;
    const multiCcy = accts.some(a => !a.archivedAt && !sameMoney(ccyOf(a), displayCcy()));
    // converted to the display currency, with the account's own currency underneath (or the other way round)
    const balCell = (a, v, nat) => { const sg = a.kind === 'liability' ? -1 : 1; if (sameMoney(ccyOf(a), displayCcy())) return money(sg * v); const conv = money(sg * v), own = moneyIn(sg * nat, ccyOf(a)); return nativeFirst ? html`${own}<div class="dist">≈ ${conv}</div>` : html`${conv}<div class="dist">${own}</div>`; };
    const liquidity = html`<div class="card"><div class="card-head"><h2>Liquidity</h2></div>
      <div class="stat-label">Liquid share of assets</div><div class="stat-value">${pct(liquidShare, 0)}</div>
      <div class="meter" style="height:10px"><span style="width:${(liquidShare || 0) * 100}%;background:${p.series[0]}"></span><span style="flex:1;background:${p.neutral}"></span></div>
      <div class="legend-inline mt"><span><i style="background:${p.series[0]}"></i>Liquid ${money(cur.liquid, { compact: true })}</span><span><i style="background:${p.neutral}"></i>Illiquid ${money(cur.assets - cur.liquid, { compact: true })}</span></div>
      ${liquidShare != null && liquidShare < 0.15 ? html`<div class="callout warn mt"><span class="ic">!</span><div>Under 15% of your assets are liquid.</div></div>` : ''}</div>`;
    const debtCard = lCats.length ? html`<div class="card"><div class="card-head"><h2>Debt breakdown</h2><span class="hint">${debt.wRate != null ? `weighted APR ${num(debt.wRate, 2)}%` : ''}</span></div><div class="chart"><canvas id="n-debt"></canvas></div></div>` : '';

    body.innerHTML = String(html`
      <div class="stats big">
        ${stat('Net worth', money(cur.net), { sub: ch != null ? html`<span class="${pnlClass(ch)}">${money(ch, { sign: true })}</span> since ${fmtDate(prev.date, { month: 'short', day: 'numeric' })}` : 'first update' })}
        ${stat(range === 'all' ? 'Since you started' : `Change (${range.toUpperCase()})`, chRange != null ? money(chRange, { sign: true }) : '—', { cls: pnlClass(chRange), sub: chRange != null ? `${first.net > 0 ? pct(chRange / Math.abs(first.net), 1, { sign: true }) + ' · ' : ''}since ${fmtDate(first.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'needs a second update' })}
        ${stat('Total assets', money(cur.assets), { sub: `${accts.filter(a => a.kind !== 'liability' && !a.archivedAt).length} accounts` })}
        ${stat('Total debts', money(cur.liabilities), { cls: cur.liabilities ? 'neg' : '', sub: `${accts.filter(a => a.kind === 'liability' && !a.archivedAt).length} debts` })}
      </div>
      <div class="stats mt">
        ${stat('Liquid net worth', money(cur.liquidNet), { cls: pnlClass(cur.liquidNet), sub: 'reachable in days, minus debts', help: 'Liquid assets (cash, savings, brokerage, crypto, trading) minus all debts — what you could access in days.' })}
        ${stat('Interest / month', io.earn.length ? money(io.earnMonth) : '—', { cls: io.earnMonth ? 'pos' : '', sub: io.earn.length ? `estimate · ${pct(io.blended, 2)} blended` : 'no APY set', help: 'What your interest-bearing accounts would earn per month at their APY and today’s balance. An estimate — balances don’t change on their own.' })}
        ${stat('Debt-to-asset', pct(cur.assets ? cur.liabilities / cur.assets : null, 1), { cls: cur.assets && cur.liabilities / cur.assets > 0.5 ? 'neg' : '', help: 'Debts ÷ assets. Above 50% leaves you exposed to downturns.' })}
        ${stat('Cash runway', efMonths != null ? `${num(efMonths, 1)} mo` : '—', { cls: efMonths != null && efMonths < 3 ? 'neg' : '', sub: efMonths != null ? (base.source === 'set' ? 'using the monthly spending set in Settings' : 'cash & savings ÷ monthly spending') : 'log spending or set it in Settings', help: 'How many months your cash and savings would cover your usual monthly spending — from what you’ve logged lately, or the amount set in Settings when there’s no recent spending.' })}
      </div>
      <div class="grid g-2-1 mt">
        <div class="card" data-tour="nw-line"><div class="card-head"><h2>Net worth over time</h2><span class="hint">${allSeries.some(s => s.liabilities > 0) ? 'net worth, assets & debts' : 'each point is a date you updated'}</span></div>
          ${one ? html`<div class="first-snap">${typeBreakdown(cur)}${notEnough('The trend line starts once you’ve updated balances on two different days.')}</div>` : html`<div class="chart tall"><canvas id="n-line"></canvas></div>`}</div>
        <div class="card"><div class="card-head"><h2>Asset allocation</h2><span class="hint">by type</span></div><div class="chart tall"><canvas id="n-alloc"></canvas></div></div>
      </div>
      ${interestCard(io)}
      ${one ? html`<div class="grid ${debtCard ? 'g2' : ''} mt">${liquidity}${debtCard}</div>` : html`
      <div class="grid g-2-1 mt">
        <div class="card"><div class="card-head"><h2>Assets by type</h2><span class="hint">stacked</span></div><div class="chart"><canvas id="n-stack"></canvas></div></div>
        ${liquidity}
      </div>
      <div class="grid ${debtCard ? 'g2' : ''} mt">
        <div class="card"><div class="card-head"><h2>Change per update</h2><span class="hint">how much net worth moved between updates</span></div><div class="chart"><canvas id="n-chg"></canvas></div></div>
        ${debtCard}
      </div>`}
      <div class="card mt" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><h2>Accounts</h2><div class="row">${multiCcy ? html`<div class="seg sm" role="radiogroup" aria-label="Show balances in"><button data-native="0" class="${nativeFirst ? '' : 'on'}">${displayCcy()}</button><button data-native="1" class="${nativeFirst ? 'on' : ''}">Own currency</button></div>` : ''}<a class="hint" href="#/networth/accounts">Manage →</a></div></div>
        <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th>Account</th><th>Type</th><th class="num">Balance</th><th class="num">Change</th><th class="num">% of assets</th><th style="width:120px">Trend</th></tr></thead>
        <tbody>${accts.filter(a => !a.archivedAt).sort(byType(cur)).map(a => {
          const v = cur.byAcct[a.id] || 0, pv = prev ? prev.byAcct[a.id] || 0 : null;
          const d = pv == null ? null : (a.kind === 'liability' ? -(v - pv) : v - pv);
          const lu = lastUpdateOf(a);
          return html`<tr><td><b>${a.name}</b>${lu ? html`<div class="small muted">updated ${fmtDate(lu, { month: 'short', day: 'numeric' })}</div>` : ''}</td><td>${typeLabel(a)}</td>
            <td class="num ${a.kind === 'liability' ? 'neg' : ''}">${balCell(a, v, cur.byAcctNative[a.id] || 0)}</td><td class="num ${pnlClass(d)}">${d ? money(d, { sign: true }) : '—'}</td><td class="num">${a.kind === 'liability' ? '' : pct(cur.assets ? v / cur.assets : null, 1)}</td><td>${one ? '' : html`<div style="height:28px;width:110px"><canvas data-spark="${a.id}"></canvas></div>`}</td></tr>`;
        })}</tbody>
        <tfoot><tr><td colspan="2">Net worth</td><td class="num">${money(cur.net)}</td><td class="num ${pnlClass(ch)}">${ch != null ? money(ch, { sign: true }) : ''}</td><td colspan="2"></td></tr></tfoot></table></div></div>`);

    const labels = dateLabels(series.map(s => s.date));
    const hasDebt = series.some(s => s.liabilities > 0);
    if (!one) C.moneyLine(body.querySelector('#n-line'), {
      labels,
      // assets & debts only add a line when there are debts (otherwise assets = net worth and debts sit at 0, flattening the chart)
      series: [{ label: 'Net worth', data: series.map(s => s.net), color: p.series[0], fill: !hasDebt }, ...(hasDebt ? [{ label: 'Assets', data: series.map(s => s.assets), color: p.series[2] }, { label: 'Debts', data: series.map(s => s.liabilities), color: p.series[1] }] : [])],
    });
    C.doughnut(body.querySelector('#n-alloc'), { labels: aCats.map(c => c.label), values: aCats.map(c => cur.byCat[c.id]), colors: aCats.map(c => catColor(c.id, p)), center: { value: money(cur.assets, { compact: true }), label: 'assets' } });
    if (!one) {
      const cats = assetCats().filter(c => series.some(s => (s.byCat[c.id] || 0) > 0));
      C.make(body.querySelector('#n-stack'), {
        type: 'line',
        data: { labels, datasets: cats.map(c => ({ label: c.label, data: series.map(s => s.byCat[c.id] || 0), borderColor: catColor(c.id, p), backgroundColor: C.alpha(catColor(c.id, p), 0.55), fill: true, borderWidth: 1, tension: 0.15, cubicInterpolationMode: 'monotone', pointRadius: 0 })) },
        options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis({ ticks: { maxTicksLimit: 8, maxRotation: 0 } }), y: { stacked: true, ...C.moneyAxis() } } },
      });
      C.signBars(body.querySelector('#n-chg'), { labels: dateLabels(chg.map(d => d.date)), values: chg.map(d => d.change) });
      body.querySelectorAll('[data-spark]').forEach(cv => { const id = cv.dataset.spark; const a = store.get('nwAccounts', id); C.sparkline(cv, series.map(s => s.byAcct[id] || 0), a.kind === 'liability' ? p.series[1] : p.series[0]); });
    }
    if (lCats.length) C.doughnut(body.querySelector('#n-debt'), { labels: lCats.map(c => c.label), values: lCats.map(c => cur.byCat[c.id]), colors: lCats.map(c => catColor(c.id, p)), center: { value: money(cur.liabilities, { compact: true }), label: 'owed' } });
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
  if (a.tracksHoldings) return editHoldings(a);
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
      <label class="field span2">Name<input name="name" required value="${a.name || ''}" placeholder="e.g. Savings account, Broker, Exchange, Car"></label>
      <label class="field">Currency${raw(ccySelect('currency', a.currency || displayCcy()))}</label>
      ${balField(a)}
      <label class="field yld">Interest / yield (APY %) <span class="hint">optional</span><input name="apy" type="number" step="any" min="0" max="100" value="${a.apy ?? ''}" placeholder="e.g. 3.5"></label>
      <label class="field lia">Interest rate (APR %) <span class="hint">optional</span><input name="rate" type="number" step="any" min="0" value="${a.rate ?? ''}"></label>
      <label class="check full hld"><input type="checkbox" name="tracksHoldings" ${a.tracksHoldings ? raw('checked') : ''}> List what I hold (e.g. 0.5 BTC, 10 AAPL) and update prices automatically</label>
    </form>`),
    onMount: w => {
      const f = w.querySelector('#nf');
      const sync = () => {
        const g = f.group.value, show = (sel, on) => { const e = w.querySelector(sel); if (e) e.hidden = !on; };
        show('.yld', g !== 'debt' && g !== 'assets');
        show('.lia', g === 'debt');
        show('.hld', g === 'trading' || g === 'investments');
        const hl = f.tracksHoldings; if (w.querySelector('.hld').hidden) hl.checked = false;
        show('.bal', !hl.checked);
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
    tracksHoldings: (g === 'trading' || g === 'investments') && !!res.tracksHoldings, holdings: a.holdings || [] };
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
        <label class="field">Interest / yield (APY %) <span class="hint">savings, money market, staking</span><input name="apy" type="number" step="any" min="0" max="100" value="${a.apy ?? ''}" placeholder="e.g. 4.2"></label>
        <label class="field">Liquid?<select name="liquid"><option value="">Auto (by category)</option><option value="yes" ${a.liquid === true ? raw('selected') : ''}>Yes</option><option value="no" ${a.liquid === false ? raw('selected') : ''}>No</option></select></label>
        <label class="check full"><input type="checkbox" name="tracksHoldings" ${a.tracksHoldings ? raw('checked') : ''}> Track individual holdings (crypto / stocks) — value = quantity × price, with one-click price updates</label>
      </div>
      <label class="field full">Notes<input name="notes" value="${a.notes || ''}"></label>
    </form>`),
    onMount: w => {
      const f = w.querySelector('#nf');
      const purp = () => { f.purposeOther.hidden = f.purpose.value !== '__custom'; if (!f.purposeOther.hidden) f.purposeOther.focus(); f.purpose.options[0].textContent = `Auto (${purposeOf({ category: f.category.value })})`; };
      f.purpose.onchange = purp; f.category.addEventListener('change', purp);
      const sync = () => { const li = f.kind.value === 'liability'; w.querySelector('.lia').hidden = !li; w.querySelector('.ast').hidden = li; const bal = w.querySelector('.bal'); if (bal) bal.hidden = !li && f.tracksHoldings.checked; };
      f.tracksHoldings.onchange = sync;
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
    tracksHoldings: res.kind !== 'liability' && !!res.tracksHoldings, holdings: a.holdings || [],
    custody: res.kind === 'liability' ? '' : res.custody, purpose: res.kind === 'liability' ? '' : ((res.purpose === '__custom' ? res.purposeOther : res.purpose) || '').trim().slice(0, 40), apy: res.kind === 'liability' ? null : toNum(res.apy) };
  return finishAccountSave(a, obj, res);
}

async function finishAccountSave(a, obj, res) {
  const saved = await store.put('nwAccounts', obj);
  if (saved.tracksHoldings && !a.tracksHoldings) { await editHoldings(saved); return saved; }
  // a new account starts with the balance you gave it, recorded for today
  if (!a.id && !saved.tracksHoldings && res.balance !== '' && res.balance != null && isFinite(+res.balance)) await setBalance(saved.id, today(), saved.kind === 'liability' ? Math.abs(+res.balance) : +res.balance);
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

async function editHoldings(a) {
  const cur = ccyOf(a);
  let rows = (a.holdings || []).map(h => ({ ...h }));
  if (!rows.length) rows.push({ id: store.uid(), type: a.category === 'crypto' ? 'crypto' : 'stock', symbol: '', qty: '', price: '', cost: '' });
  const rowHtml = h => html`<tr data-id="${h.id}">
    <td><select data-k="type"><option value="crypto" ${h.type === 'crypto' ? raw('selected') : ''}>Crypto</option><option value="stock" ${h.type === 'stock' ? raw('selected') : ''}>Stock / ETF</option></select></td>
    <td><input data-k="symbol" value="${h.symbol || ''}" placeholder="BTC, AAPL" style="text-transform:uppercase;width:90px"></td>
    <td><input data-k="qty" type="number" step="any" min="0" value="${h.qty ?? ''}" style="width:110px"></td>
    <td><input data-k="price" type="number" step="any" min="0" value="${h.price ?? ''}" placeholder="auto" style="width:110px"></td>
    <td class="num" data-val>${moneyIn(holdingValue(h), cur)}</td>
    <td><input data-k="cost" type="number" step="any" min="0" value="${h.cost ?? ''}" placeholder="optional" style="width:110px"></td>
    <td><button type="button" class="icon-btn" data-rm aria-label="Remove holding">✕</button></td></tr>`;
  const res = await modal({
    title: `Holdings — ${a.name}`, wide: true,
    body: String(html`<p class="small muted">Price is per unit in ${cur}. Leave it blank and use <b>Update prices</b> to fetch it — crypto from Binance/Coinbase, stocks from Finnhub (free key in Settings). You can always type a price yourself.</p>
      <div class="table-wrap"><table class="data compact exec-table"><thead><tr><th>Type</th><th>Symbol</th><th>Quantity</th><th>Price (${cur})</th><th class="num">Value</th><th>Total cost basis</th><th></th></tr></thead><tbody id="hrows"></tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="num" id="htot"></td><td colspan="2"></td></tr></tfoot></table></div>
      <button type="button" class="btn sm mt" data-addh>+ Add holding</button>`),
    onMount: w => {
      const tb = w.querySelector('#hrows');
      const draw = () => { tb.innerHTML = String(html`${rows.map(rowHtml)}`); tot(); };
      const tot = () => { w.querySelector('#htot').textContent = moneyIn(rows.reduce((s, h) => s + holdingValue(h), 0), cur); };
      tb.addEventListener('input', e => { const tr = e.target.closest('tr'); const h = rows.find(x => x.id === tr.dataset.id); h[e.target.dataset.k] = e.target.value; if (e.target.dataset.k === 'price' || e.target.dataset.k === 'symbol') { delete h.priceSource; delete h.priceAt; } tr.querySelector('[data-val]').textContent = moneyIn(holdingValue(h), cur); tot(); });
      tb.addEventListener('change', e => { const tr = e.target.closest('tr'); const h = rows.find(x => x.id === tr.dataset.id); h[e.target.dataset.k] = e.target.value; });
      tb.addEventListener('click', e => { if (e.target.closest('[data-rm]')) { const id = e.target.closest('tr').dataset.id; rows = rows.filter(x => x.id !== id); draw(); } });
      w.querySelector('[data-addh]').onclick = () => { rows.push({ id: store.uid(), type: rows.at(-1)?.type || 'crypto', symbol: '', qty: '', price: '', cost: '' }); draw(); tb.querySelector('tr:last-child [data-k=symbol]').focus(); };
      draw();
    },
    actions: [{ label: 'Cancel' }, { label: 'Save holdings', kind: 'primary', value: () => true }],
  });
  if (res !== true) return false;
  const holdings = rows.map(h => ({ ...h, symbol: normSymbol(h.symbol), qty: toNum(h.qty), price: toNum(h.price), cost: toNum(h.cost) })).filter(h => h.symbol && h.qty);
  const fresh = { ...store.get('nwAccounts', a.id), holdings };
  await store.put('nwAccounts', fresh);
  await syncHoldingsSnapshot([fresh]);
  toast(`${holdings.length} holding${holdings.length === 1 ? '' : 's'} saved`);
  return true;
}

function holdingsCard(a) {
  const hs = a.holdings || [];
  const total = holdingsTotal(a), cur = ccyOf(a);
  const last = hs.map(h => h.priceAt).filter(Boolean).sort().at(-1);
  return html`<div class="card mt" style="padding:0"><div class="card-head" style="padding:14px 16px 0"><div><h2>${a.name} — holdings</h2><div class="small muted">${hs.length} position${hs.length === 1 ? '' : 's'} · prices ${ago(last)}</div></div>
    <div class="row"><span class="hint">${moneyIn(total, cur)}${!sameMoney(cur, displayCcy()) ? html` ≈ ${money(toDisplay(total, cur))}` : ''}</span><button class="btn sm" data-hold="${a.id}">Edit holdings</button></div></div>
    ${hs.length ? html`<div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th>Symbol</th><th>Type</th><th class="num">Quantity</th><th class="num">Price</th><th class="num">Value</th><th class="num">Weight</th><th class="num">Cost basis</th><th class="num">Unrealised P&L</th><th>Source</th></tr></thead><tbody>
      ${[...hs].sort((x, y) => holdingValue(y) - holdingValue(x)).map(h => { const v = holdingValue(h), pl = h.cost ? v - h.cost : null; return html`<tr><td><b>${h.symbol}</b></td><td>${h.type === 'crypto' ? 'Crypto' : 'Stock / ETF'}</td><td class="num">${num(+h.qty, +h.qty % 1 ? 6 : 0)}</td><td class="num">${h.price ? moneyIn(+h.price, cur) : html`<span class="muted">—</span>`}</td><td class="num">${moneyIn(v, cur)}</td><td class="num">${pct(total ? v / total : null, 1)}</td><td class="num">${h.cost ? moneyIn(+h.cost, cur) : '—'}</td><td class="num ${pnlClass(pl)}">${pl == null ? '—' : html`${moneyIn(pl, cur, { sign: true })} <span class="small">(${pct(pl / h.cost, 1, { sign: true })})</span>`}</td><td class="small muted">${h.priceSource ? `${h.priceSource}, ${ago(h.priceAt)}` : h.price ? 'manual' : 'not priced'}</td></tr>`; })}
    </tbody></table></div>` : html`<p class="muted small" style="padding:0 16px 16px">No holdings yet.</p>`}</div>`;
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
      const editable = bulk && !a.archivedAt && !a.tracksHoldings;
      return html`<tr ${a.archivedAt ? raw('style="opacity:.55"') : ''}><td><b>${a.name}</b>${a.archivedAt ? html` <span class="tag">closed ${fmtDate(a.archivedAt)}</span>` : ''}${!simpleMode() && yieldTag ? html` ${yieldTag}` : ''}</td><td>${simpleMode() ? (yieldTag || html`<span class="muted">—</span>`) : a.institution || ''}</td>
      <td class="small muted">${a.kind === 'liability' ? [typeLabel(a), a.payment ? `${moneyIn(+a.payment, ccyOf(a))}/mo` : ''].filter(Boolean).join(' · ') : [simpleMode() ? '' : typeLabel(a), custodyLabel(custodyOf(a)), purposeOf(a), isLiquid(a) ? 'liquid' : 'illiquid'].filter(Boolean).join(' · ')}</td>
      <td class="num ${a.kind === 'liability' ? 'neg' : ''}">${editable ? html`<input class="bal-input" type="number" step="any" inputmode="decimal" data-bal="${a.id}" value="${currentBalance(a) || ''}" ${a.kind === 'liability' ? raw('min="0" placeholder="owed"') : ''} aria-label="${a.name} balance in ${ccyOf(a)}"><div class="dist">${ccyOf(a)}</div>`
        : html`${moneyIn(sg * (cur.byAcctNative[a.id] || 0), ccyOf(a))}${!sameMoney(ccyOf(a), displayCcy()) ? html`<div class="dist">≈ ${money(sg * (cur.byAcct[a.id] || 0))}</div>` : ''}${lu && !a.archivedAt ? html`<div class="dist">updated ${fmtDate(lu, { month: 'short', day: 'numeric' })}</div>` : ''}`}</td>
      <td style="text-align:right;white-space:nowrap">${a.archivedAt || bulk ? '' : html`<button class="btn sm primary-soft" data-upd="${a.id}">${a.tracksHoldings ? 'Holdings' : 'Update'}</button> `}<button class="btn sm" data-edit="${a.id}">Edit</button></td></tr>`; })}
    </tbody></table></div></div>`; };
  // grouped by type (the six Simple types, or the detailed Pro categories); biggest first inside each group
  const order = (a, b) => !!a.archivedAt - !!b.archivedAt || (cur.byAcct[b.id] || 0) - (cur.byAcct[a.id] || 0) || a.name.localeCompare(b.name);
  const types = [...assetCats(), ...liabCats()].map(c => ({ ...c, debt: liabCats().includes(c), list: accts.filter(a => catKey(a) === c.id && (a.kind === 'liability') === liabCats().includes(c)).sort(order) })).filter(g => g.list.length);
  const holdingAccts = accts.filter(a => a.tracksHoldings && !a.archivedAt && a.kind !== 'liability');
  el.innerHTML = String(html`<div class="page-head"><div><h1>Accounts & holdings</h1><div class="sub">Everything you own and owe, grouped by type. <b>Update</b> records today's balance — every update is kept, so your history builds itself.</div></div>
    <div class="actions">${priceBtn()}${accts.length && !bulk ? html`<a class="btn" href="#/networth/accounts?update=1">Update all</a>` : ''}${simpleMode() ? html`<button class="btn primary" data-new>+ Add account</button>` : html`<button class="btn" data-new-l>+ Add debt</button><button class="btn primary" data-new>+ Add asset</button>`}</div></div>
    ${bulk ? html`<div class="bulk-bar"><b>Update all balances</b><span class="small muted">Type what each account is worth; leave the rest as they are.</span><span class="spacer"></span><label class="row small">On <input type="date" id="bulk-date" value="${today()}" max="${today()}"></label><a class="btn" href="#/networth/accounts">Cancel</a><button class="btn primary" data-bulk-save>Save all</button></div>` : ''}
    ${!accts.length ? html`<div class="empty"><div class="empty-title">No accounts yet</div><p>${simpleMode() ? 'Add your savings, investments, trading accounts, cash and the things you own — and any debts.' : 'Typical list: bank accounts, savings, brokers, exchanges, wallets, property — and any loans or cards.'}</p><button class="btn primary" data-new>+ Add account</button></div>` : html`
    <div class="type-strip">${types.map(g => html`<a href="#grp-${g.id}" class="type-chip"><span>${g.label}</span><b class="${g.debt ? 'neg' : ''}">${money((g.debt ? -1 : 1) * g.list.filter(a => !a.archivedAt).reduce((s, a) => s + (cur.byAcct[a.id] || 0), 0), { compact: true })}</b></a>`)}</div>`}
    ${types.map(g => html`<div id="grp-${g.id}">${sec(g.label, g.list, { debt: g.debt, hint: g.hint && simpleMode() ? g.hint.split(' — ')[0] : '' })}</div>`)}
    ${holdingAccts.length && !bulk ? html`<h2 class="mt">Holdings</h2>${holdingAccts.map(holdingsCard)}` : ''}`);
  el.querySelectorAll('.type-chip').forEach(x => x.onclick = e => { e.preventDefault(); el.querySelector(x.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  wirePrices(el);
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
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.new !== undefined) { if (await editAccount()) refresh(); }
    else if (b.dataset.newL !== undefined) { if (await editAccount({ kind: 'liability', category: 'credit' })) refresh(); }
    else if (b.dataset.edit) { if (await editAccount(store.get('nwAccounts', b.dataset.edit))) refresh(); }
    else if (b.dataset.upd) { if (await updateAccount(store.get('nwAccounts', b.dataset.upd))) refresh(); }
    else if (b.dataset.hold) { if (await editHoldings(store.get('nwAccounts', b.dataset.hold))) refresh(); }
  });
}

// ================= target allocation (shown on Analytics) =================
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

// ================= analytics =================
export async function analytics(el, _p, { mode }) {
  const series = nwSeries();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Net worth analytics</h1><div class="sub">Where your money sits, what it's for, how concentrated it is, and how healthy the balance sheet looks.</div></div></div><div id="body"></div>`);
  const body = el.querySelector('#body');
  if (!series.length) { body.innerHTML = String(emptyNW()); return; }
  const cur = series.at(-1);
  const p = C.palette();
  const t12 = baseline();
  const y = interestOverview();
  const pos = positions(cur);
  const conc = concentration(pos);
  const posTotal = pos.reduce((a, x) => a + x.value, 0);
  const finCust = custody => custody.filter(c => !['physical', 'other'].includes(c.id));
  const custody = CUSTODY.map(c => ({ ...c, v: cur.byCustody[c.id] || 0 })).filter(c => c.v > 0).sort((a, b) => b.v - a.v);
  const purposes = Object.entries(cur.byPurpose).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const tiers = TIERS.map(t => ({ t, v: cur.byTier[t] || 0 }));
  const custTbl = html`<table class="data compact"><tbody>${custody.map(c => html`<tr><td>${c.label}</td><td class="num">${money(c.v)}</td><td class="num">${pct(c.v / cur.assets, 1)}</td></tr>`)}</tbody></table>`;
  const purpTbl = html`<table class="data compact"><tbody>${purposes.map(([k, v]) => html`<tr><td>${k}</td><td class="num">${money(v)}</td><td class="num">${pct(v / cur.assets, 1)}</td></tr>`)}</tbody></table>`;
  const crypto = store.all('nwAccounts').filter(a => a.category === 'crypto' && a.kind !== 'liability').reduce((s, a) => s + (cur.byAcct[a.id] || 0), 0);
  const annualExp = t12.avgExpenses ? t12.avgExpenses * 12 : null;
  const cash = (cur.byCat.cash || 0) + (cur.byCat.savings || 0);
  // growth
  const monthly = [];
  for (let i = 1; i < series.length; i++) monthly.push(series[i].net - series[i - 1].net);
  const yrs = series.length > 1 ? (parseDay(cur.date) - parseDay(series[0].date)) / (365.25 * 864e5) : 0;
  const cagr = yrs >= 1 && series[0].net > 0 && cur.net > 0 ? Math.pow(cur.net / series[0].net, 1 / yrs) - 1 : null;
  const health = [
    ['Cash runway', t12.avgExpenses ? cash / t12.avgExpenses : null, v => `${num(v, 1)} months`, v => v >= 6 ? 'good' : v >= 3 ? 'ok' : 'bad', '3–6+ months of spending in cash & savings'],
    ['Debt-to-asset', cur.assets ? cur.liabilities / cur.assets : null, v => pct(v, 1), v => v <= 0.3 ? 'good' : v <= 0.5 ? 'ok' : 'bad', 'under 50%, ideally under 30%'],
    ['Solvency (net worth ÷ assets)', cur.assets ? cur.net / cur.assets : null, v => pct(v, 1), v => v >= 0.5 ? 'good' : v >= 0.2 ? 'ok' : 'bad', 'above 50%'],
    ['Interest vs your spending', annualExp && y.earnYear ? y.earnYear / annualExp : null, v => pct(v, 1), v => v >= 1 ? 'good' : v >= 0.25 ? 'ok' : 'bad', 'yearly interest ÷ yearly spending (100% = interest covers it)'],
    ['Largest single position', conc.top1, v => `${pct(v, 1)} · ${pos[0]?.label}`, v => v <= 0.2 ? 'good' : v <= 0.35 ? 'ok' : 'bad', 'under ~20% of your assets'],
    ['Largest custodian type', finCust(custody).length ? finCust(custody)[0].v / finCust(custody).reduce((a, c) => a + c.v, 0) : null, v => `${pct(v, 0)} · ${finCust(custody)[0]?.label}`, v => v <= 0.5 ? 'good' : v <= 0.7 ? 'ok' : 'bad', 'share of financial assets with one type of custodian'],
    ['On crypto exchanges', cur.assets ? (cur.byCustody.cex || 0) / cur.assets : null, v => pct(v, 1), v => v <= 0.1 ? 'good' : v <= 0.25 ? 'ok' : 'bad', 'exchange balances carry counterparty risk'],
  ];
  const icon = k => (k === 'good' ? raw('<span class="pos">✔</span>') : k === 'ok' ? raw('<span style="color:var(--warn)">●</span>') : raw('<span class="neg">▲</span>'));

  body.innerHTML = String(html`
    <div class="stats big">
      ${stat('Net worth', money(cur.net), { sub: `as of ${fmtDate(cur.date)}` })}
      ${stat('Growth (CAGR)', cagr != null ? pct(cagr, 1, { sign: true }) : '—', { sub: cagr != null ? `over ${num(yrs, 1)} years` : 'needs a year of history' })}
      ${stat('Avg change / update', monthly.length ? money(monthly.reduce((a, b) => a + b, 0) / monthly.length, { sign: true }) : '—', { sub: monthly.length ? `${pct(monthly.filter(x => x > 0).length / monthly.length, 0)} of periods up` : '' })}
      ${stat('Interest per year', y.earn.length ? money(y.earnYear) : '—', { sub: y.earn.length ? `estimate · ${money(y.earnMonth)} / month` : 'no APY set' })}
      ${stat('Effective positions', conc.effective ? num(conc.effective, 1) : '—', { sub: conc.top5 != null ? `top 5 = ${pct(conc.top5, 0)} of assets` : '', help: '1 ÷ Herfindahl index of position weights: how many equal-sized positions your investments behave like. Higher = more diversified.' })}
      ${stat('Crypto exposure', pct(cur.assets ? crypto / cur.assets : null, 1), { sub: money(crypto) })}
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Where it's held</h2><span class="hint">counterparty / custody</span></div><div class="chart"><canvas id="a-cust"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>What it's for</h2><span class="hint">purpose buckets</span></div><div class="chart"><canvas id="a-purp"></canvas></div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Liquidity ladder</h2><span class="hint">how fast you could reach it</span></div><div class="chart short"><canvas id="a-tier"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Largest positions</h2><span class="hint">% of assets</span></div><div class="chart short"><canvas id="a-top"></canvas></div></div>
    </div>
    ${series.length > 1 ? html`<div class="grid g-2-1 mt">
      <div class="card"><div class="card-head"><h2>Custody over time</h2><span class="hint">stacked</span></div><div class="chart"><canvas id="a-custt"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>By custody</h2></div>${custTbl}
        <h3 class="mt">By purpose</h3>${purpTbl}</div>
    </div>` : html`<div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>By custody</h2><span class="hint">over time after your next update</span></div>${custTbl}</div>
      <div class="card"><div class="card-head"><h2>By purpose</h2></div>${purpTbl}</div>
    </div>`}
    <div class="card mt" data-tour="health"><div class="card-head"><h2>Balance-sheet health</h2><span class="hint">rules of thumb used by planners — context matters</span></div>
      <div class="table-wrap" style="border:0"><table class="data"><thead><tr><th></th><th>Measure</th><th class="num">You</th><th>Guideline</th></tr></thead><tbody>
      ${health.map(([name, v, f, judge, guide]) => html`<tr><td style="width:28px">${v == null ? html`<span class="muted">–</span>` : icon(judge(v))}</td><td>${name}</td><td class="num">${v == null ? html`<span class="muted">needs data</span>` : f(v)}</td><td class="small muted">${guide}</td></tr>`)}
      </tbody></table></div></div>
    <div id="targets"></div>`);
  renderTargets(body.querySelector('#targets'), cur);

  C.doughnut(body.querySelector('#a-cust'), { labels: custody.map(c => c.label), values: custody.map(c => c.v), colors: custody.map(c => p.series[CUSTODY.findIndex(x => x.id === c.id) % 8]), center: { value: money(cur.assets, { compact: true }), label: 'assets' } });
  C.doughnut(body.querySelector('#a-purp'), { labels: purposes.map(x => x[0]), values: purposes.map(x => x[1]), center: { value: String(purposes.length), label: 'buckets' } });
  C.plainBars(body.querySelector('#a-tier'), { labels: tiers.map(x => x.t), values: tiers.map(x => x.v), horizontal: true, fmt: v => money(v, { compact: true }), label: 'Value' });
  const top = pos.slice(0, 8);
  C.plainBars(body.querySelector('#a-top'), { labels: top.map(x => x.label), values: top.map(x => (x.value / posTotal) * 100), horizontal: true, fmt: v => num(v, 1) + '%', label: 'Share of assets' });
  const used = CUSTODY.filter(c => series.some(s => (s.byCustody[c.id] || 0) > 0));
  if (series.length > 1) C.make(body.querySelector('#a-custt'), {
    type: 'line',
    data: { labels: dateLabels(series.map(s => s.date)), datasets: used.map(c => { const col = p.series[CUSTODY.findIndex(x => x.id === c.id) % 8]; return { label: c.label, data: series.map(s => s.byCustody[c.id] || 0), borderColor: col, backgroundColor: C.alpha(col, 0.5), fill: true, borderWidth: 1, tension: 0.15, cubicInterpolationMode: 'monotone', pointRadius: 0 }; }) },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${money(c.parsed.y)}` } } }, scales: { x: C.plainAxis({ ticks: { maxTicksLimit: 8, maxRotation: 0 } }), y: { stacked: true, ...C.moneyAxis() } } },
  });
}
