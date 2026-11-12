// Overview: net worth first — what you own, how it's moving, where it sits — then cash runway,
// today's journal and a compact look at this month's spending.
import * as store from './store.js';
import { html, money, pct, num, pnlClass, stat, fmtDate, today, dayKey, parseDay } from './ui.js';
import { MOODS, streaks } from './journal/views.js';
import * as C from './charts.js';
import { nwSeries, assetCats, baseline, interestOverview } from './networth/calc.js';
import { lastUpdate, typeBreakdown, catColor, dateLabels } from './networth/views.js';
import * as S from './spend/calc.js';
import { catLabel } from './spend/categories.js';
import { startTour } from './tour.js';

export default async function home(el) {
  const hasAny = ['txns', 'nwAccounts', 'days'].some(c => store.all(c).length);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (!hasAny) {
    el.innerHTML = String(html`
      <section class="hero"><h1>${greet}.</h1>
        <p>A private place to keep track of <b>what you own</b>, <b>where your money goes</b> and <b>how you're doing</b>. Everything stays in this browser — nothing is uploaded.</p></section>
      <div class="grid g3">
        <div class="choice"><h2>Add your accounts</h2><p class="small muted">Savings, investments, exchanges, cash, things you own — and any debts. Update the balances whenever you like; each update is kept as history.</p><a class="btn primary" href="#/networth/accounts">Add accounts</a></div>
        <div class="choice"><h2>Log spending</h2><p class="small muted">Amount, category, done. Press <kbd>N</kbd> any time.</p><button class="btn" data-quick-add>+ Add expense</button></div>
        <div class="choice"><h2>Write today's check-in</h2><p class="small muted">Mood, energy, stress, sleep and a few lines — two minutes a day.</p><a class="btn" href="#/journal">Open the journal</a></div>
      </div>
      <p class="small muted mt">New here? <button class="link-btn" data-tour-start>Take the 1-minute tour</button> — it uses sample data that's removed when it ends.</p>`);
    el.querySelector('[data-tour-start]').onclick = () => startTour();
    return;
  }

  const series = nwSeries();
  const cur = series.at(-1), prev = series.at(-2), first = series[0];
  // a real year-on-year change once there is a year of history; until then, the change since you started
  const yearAgo = cur ? series.filter(p => p.date <= dayKey(new Date(parseDay(cur.date).getFullYear() - 1, parseDay(cur.date).getMonth(), parseDay(cur.date).getDate()))).at(-1) : null;
  const ref = yearAgo || (series.length > 1 ? first : null);
  const delta = cur && ref ? cur.net - ref.net : null;
  const base = baseline();
  const io = interestOverview();
  const efMonths = cur && base.avgExpenses ? ((cur.byCat.cash || 0) + (cur.byCat.savings || 0)) / base.avgExpenses : null;
  const m = S.currentMonth(), s = S.monthSummary(m);
  const cats = S.byCategory(s.ex).slice(0, 4);
  const up = S.upcoming(null, 10).filter(u => u.date >= today()).slice(0, 4);
  const st = store.getSettings();
  const last = lastUpdate();
  const daysSince = last ? Math.floor((Date.now() - parseDay(last)) / 864e5) : null;
  const aCats = assetCats(), alloc = cur ? aCats.filter(c => (cur.byCat[c.id] || 0) > 0) : [];
  const biggest = cur ? store.all('nwAccounts').filter(a => a.kind !== 'liability' && !a.archivedAt && (cur.byAcct[a.id] || 0) > 0).sort((a, b) => cur.byAcct[b.id] - cur.byAcct[a.id]).slice(0, 5) : [];
  const jToday = store.get('days', today());
  const jst = streaks();
  const target = st.plan?.emergencyMonths || 6;

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${greet}</h1><div class="sub">${fmtDate(today(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${daysSince != null ? ` · balances last updated ${daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`}` : ''}</div></div>
      <div class="actions"><button class="btn" data-quick-add>+ Add expense</button><a class="btn primary" href="#/networth/accounts?update=1">Update balances</a></div></div>
    <div class="stats big" data-tour="nw-stats">
      ${stat('Net worth', cur ? money(cur.net) : '—', { sub: cur && prev ? html`<span class="${pnlClass(cur.net - prev.net)}">${money(cur.net - prev.net, { sign: true })}</span> since ${fmtDate(prev.date, { month: 'short', day: 'numeric' })}` : cur ? 'first update' : html`<a href="#/networth/accounts">add accounts</a>` })}
      ${stat(yearAgo ? 'Past 12 months' : 'Since you started', delta != null ? money(delta, { sign: true }) : '—', { cls: pnlClass(delta), sub: delta != null ? `${ref.net > 0 ? pct(delta / ref.net, 1, { sign: true }) + ' · ' : ''}since ${fmtDate(ref.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'needs a second update' })}
      ${stat('Liquid net worth', cur ? money(cur.liquidNet) : '—', { cls: cur ? pnlClass(cur.liquidNet) : '', sub: cur?.assets ? `${pct(cur.liquid / cur.assets, 0)} of assets are liquid` : '', help: 'Liquid assets (cash, savings, investments, crypto, trading capital) minus all debts — what you could reach within days.' })}
      ${stat('Interest / month', io.earn.length ? money(io.earnMonth) : '—', { cls: io.earnMonth ? 'pos' : '', sub: io.earn.length ? `estimate · ${money(io.earnDay, { decimals: 2 })} a day` : 'no APY set', help: 'What your interest-bearing accounts would earn per month at their APY and today’s balance. An estimate — balances don’t change on their own.' })}
    </div>
    <div class="grid g-2-1 mt">
      <div class="card" data-tour="nw-chart"><div class="card-head"><h2>Net worth</h2><a class="hint" href="#/networth">Details →</a></div>${series.length > 1 ? html`<div class="chart tall"><canvas id="o-nw"></canvas></div>` : html`<div class="first-snap">${cur ? typeBreakdown(cur) : ''}<div class="not-enough"><b>Not enough data yet</b><span>The trend line starts once you've updated balances on two different days.</span></div></div>`}</div>
      <div class="card" data-tour="alloc"><div class="card-head"><h2>Where it sits</h2><a class="hint" href="#/networth/analytics">Analytics →</a></div>${alloc.length ? html`<div class="chart tall"><canvas id="o-alloc"></canvas></div>` : html`<p class="muted small">Add accounts to see how your money is split.</p>`}</div>
    </div>
    <div class="grid g3 mt">
      <div class="card" data-tour="biggest"><div class="card-head"><h2>Largest accounts</h2><a class="hint" href="#/networth/accounts">Accounts →</a></div>
        ${biggest.length ? html`<div class="stack" style="gap:7px">${biggest.map(a => html`<a class="acct-row small" href="#/networth/accounts"><span class="ellipsis">${a.name}</span><span class="muted">${pct(cur.byAcct[a.id] / cur.assets, 0)}</span><b>${money(cur.byAcct[a.id], { compact: cur.byAcct[a.id] >= 1e6 })}</b></a>`)}</div>`
          : html`<p class="small muted">Add accounts to see where most of your money is.</p>`}</div>
      <div class="card"><div class="card-head"><h2>Cash runway</h2></div>
        ${efMonths != null ? html`<div class="stat-value">${num(efMonths, 1)} months</div>
          <p class="small muted" style="margin:4px 0 0">Cash & savings cover this many months of your usual spending (${money(base.avgExpenses)} / month, ${base.source === 'set' ? html`the amount you set in <a href="#/settings">Settings</a>` : 'from what you’ve logged'}).</p>
          <div class="budget-bar mt"><span class="${efMonths < 3 ? 'over' : efMonths < target ? 'warn' : ''}" style="width:${Math.min(100, (efMonths / target) * 100)}%"></span></div><div class="small muted">target ${target} months</div>`
          : html`<div class="not-enough"><b>Not enough data yet</b><span>Log a week of spending — or set your usual monthly spending in <a href="#/settings">Settings</a> — and this shows how many months your cash & savings would last.</span></div>`}</div>
      <div class="card" data-tour="journal-mini"><div class="card-head"><h2>Journal</h2><a class="hint" href="#/journal">${jToday ? 'Today →' : 'Write →'}</a></div>
        ${jToday ? html`<div class="stat-value">${jToday.mood ? MOODS[jToday.mood - 1] : '✎'}</div><p class="small muted" style="margin:4px 0 0">${(jToday.mind || jToday.recap || 'Checked in today.').slice(0, 90)}</p>`
          : html`<p class="small muted">How are you today? A two-minute check-in — mood, energy, stress, sleep.</p><a class="btn sm" href="#/journal">Check in</a>`}
        ${jst.current || jst.total ? html`<div class="small muted mt">${jst.current ? `${jst.current}-day streak` : `${jst.total} entries`}</div>` : ''}</div>
    </div>
    <div class="card mt" data-tour="spend-mini"><div class="card-head"><h2>Spending this month</h2><a class="hint" href="#/spending">Spending →</a></div>
      <div class="grid g3" style="gap:18px">
        <div><div class="stat-label">Spent</div><div class="stat-value">${money(s.spent)}</div><div class="stat-sub">${s.budget ? html`<span class="${s.left < 0 ? 'neg' : 'pos'}">${money(Math.abs(s.left))} ${s.left < 0 ? 'over' : 'left'}</span> of ${money(s.budget)}${s.safeToday != null ? html` · <b>${money(s.safeToday)}</b>/day` : ''}` : base.avgExpenses ? `usual month ${money(base.avgExpenses)}` : html`<a href="#/spending/budgets">set a budget</a>`}</div>
          ${s.budget ? html`<div class="budget-bar mt"><span class="${s.spent > s.budget ? 'over' : ''}" style="width:${Math.min(100, (s.spent / s.budget) * 100)}%"></span><i style="left:${(s.dayNow / s.n) * 100}%"></i></div>` : ''}</div>
        <div><div class="stat-label">Top categories</div>${cats.length ? html`<dl class="kv small">${cats.map(c => html`<dt>${catLabel(c.id)}</dt><dd>${money(c.total)}</dd>`)}</dl>` : html`<p class="muted small">Nothing logged yet.</p>`}</div>
        <div><div class="stat-label">Coming up</div>${up.length ? html`<div class="upcoming col">${up.map(u => html`<div class="up-item"><span class="muted small">${fmtDate(u.date, { weekday: 'short', day: 'numeric' })}</span><span>${u.r.name}</span><b>${money(u.value)}</b></div>`)}</div>` : html`<p class="muted small">No bills in the next 10 days.</p>`}</div>
      </div></div>`);

  const p = C.palette();
  if (series.length > 1) C.moneyLine(el.querySelector('#o-nw'), { labels: dateLabels(series.map(x => x.date)), series: [{ label: 'Net worth', data: series.map(x => x.net), color: p.series[0], fill: true }, { label: 'Liquid net worth', data: series.map(x => x.liquidNet), color: p.series[2] }] });
  if (alloc.length) C.doughnut(el.querySelector('#o-alloc'), { labels: alloc.map(c => c.label), values: alloc.map(c => cur.byCat[c.id]), colors: alloc.map(c => catColor(c.id, p)), center: { value: money(cur.assets, { compact: true }), label: 'assets' } });
}
