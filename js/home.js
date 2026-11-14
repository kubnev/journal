// Overview: one glance across the three parts — net worth and its trend, today's journal,
// and this month's spending.
import * as store from './store.js';
import { html, money, pct, num, pnlClass, stat, fmtDate, today, dayKey, parseDay } from './ui.js';
import { MOODS, streaks } from './journal/views.js';
import * as C from './charts.js';
import { nwSeries, baseline, cashAtHand } from './networth/calc.js';
import { lastUpdate, typeBreakdown, dateLabels } from './networth/views.js';
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
        <div class="choice"><h2>Add your accounts</h2><p class="small muted">Bank accounts, savings, cash, things you own — and any debts. Update the balances whenever you like; each update is kept as history.</p><a class="btn primary" href="#/networth/accounts">Add accounts</a></div>
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
  const runway = cur && base.avgExpenses ? cashAtHand(cur) / base.avgExpenses : null;
  const m = S.currentMonth(), s = S.monthSummary(m);
  const cats = S.byCategory(s.ex).slice(0, 4);
  const up = S.upcoming(null, 10).filter(u => u.date >= today()).slice(0, 4);
  const last = lastUpdate();
  const daysSince = last ? Math.floor((Date.now() - parseDay(last)) / 864e5) : null;
  const jToday = store.get('days', today());
  const jst = streaks();
  const target = store.getSettings().plan?.emergencyMonths || 6;
  const week = Array.from({ length: 7 }, (_, i) => { const d = parseDay(today()); d.setDate(d.getDate() - 6 + i); const k = dayKey(d); return { k, e: store.get('days', k) }; });

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${greet}</h1><div class="sub">${fmtDate(today(), { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${daysSince != null ? ` · balances last updated ${daysSince === 0 ? 'today' : daysSince === 1 ? 'yesterday' : `${daysSince} days ago`}` : ''}</div></div>
      <div class="actions"><button class="btn" data-quick-add>+ Add expense</button><a class="btn primary" href="#/networth/accounts?update=1">Update balances</a></div></div>
    <div class="stats big" data-tour="nw-stats">
      ${stat('Net worth', cur ? money(cur.net) : '—', { sub: cur && prev ? html`<span class="${pnlClass(cur.net - prev.net)}">${money(cur.net - prev.net, { sign: true })}</span> since ${fmtDate(prev.date, { month: 'short', day: 'numeric' })}` : cur ? 'first update' : html`<a href="#/networth/accounts">add accounts</a>` })}
      ${stat(yearAgo ? 'Past 12 months' : 'Since you started', delta != null ? money(delta, { sign: true }) : '—', { cls: pnlClass(delta), sub: delta != null ? `${ref.net > 0 ? pct(delta / ref.net, 1, { sign: true }) + ' · ' : ''}since ${fmtDate(ref.date, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'needs a second update' })}
      ${stat('Spent this month', money(s.spent), { sub: s.budget ? html`<span class="${s.left < 0 ? 'neg' : 'pos'}">${money(Math.abs(s.left))} ${s.left < 0 ? 'over' : 'left'}</span> of ${money(s.budget)}` : base.avgExpenses ? `usual month ${money(base.avgExpenses)}` : html`<a href="#/settings/budgets">set a budget</a>` })}
      ${stat('Cash runway', runway != null ? `${num(runway, 1)} months` : '—', { cls: runway != null && runway < target / 2 ? 'neg' : '', sub: runway != null ? `target ${target} months` : cur ? html`log spending or <a href="#/settings">set it</a>` : '', help: 'How many months your cash and savings would cover your usual monthly spending — from what you’ve logged lately, or the amount set in Settings.' })}
    </div>
    <div class="grid g-2-1 mt">
      <div class="card" data-tour="nw-chart"><div class="card-head"><h2>Net worth</h2><a class="hint" href="#/networth">Net worth →</a></div>${series.length > 1 ? html`<div class="chart tall"><canvas id="o-nw"></canvas></div>` : html`<div class="first-snap">${cur ? typeBreakdown(cur) : ''}<div class="not-enough"><b>${cur ? 'Not enough data yet' : 'No accounts yet'}</b><span>${cur ? 'The trend line starts once you\'ve updated balances on two different days.' : html`<a href="#/networth/accounts">Add your accounts</a> to see your net worth here.`}</span></div></div>`}</div>
      <div class="card" data-tour="journal-mini"><div class="card-head"><h2>Journal</h2><a class="hint" href="#/journal">${jToday ? 'Today →' : 'Write →'}</a></div>
        ${jToday ? html`<div class="stat-value">${jToday.mood ? MOODS[jToday.mood - 1] : '✎'}</div><p class="small muted" style="margin:4px 0 0">${(jToday.mind || jToday.recap || 'Checked in today.').slice(0, 140)}</p>`
          : html`<p class="small muted" style="margin-top:0">How are you today? A two-minute check-in — mood, energy, stress, sleep.</p><a class="btn sm primary" href="#/journal">Check in</a>`}
        <div class="week-strip mt">${week.map(d => html`<a href="#/journal?day=${d.k}" class="${d.k === today() ? 'on' : ''}" title="${fmtDate(d.k)}"><span class="small muted">${fmtDate(d.k, { weekday: 'short' }).slice(0, 2)}</span><span class="wk-mood">${d.e?.mood ? MOODS[d.e.mood - 1] : d.e ? '✎' : '·'}</span></a>`)}</div>
        <div class="small muted mt">${jst.current ? `${jst.current}-day streak · ` : ''}${jst.total ? `${jst.total} entr${jst.total === 1 ? 'y' : 'ies'} so far` : 'No entries yet'}</div></div>
    </div>
    <div class="card mt" data-tour="spend-mini"><div class="card-head"><h2>Spending this month</h2><a class="hint" href="#/spending">Spending →</a></div>
      <div class="grid g3" style="gap:18px">
        <div><div class="stat-label">${s.budget ? 'Budget' : 'Pace'}</div>${s.budget ? html`<div class="stat-value">${pct(s.spent / s.budget, 0)}</div><div class="stat-sub">of ${money(s.budget)} used${s.safeToday != null ? html` · <b>${money(s.safeToday)}</b> a day left` : ''}</div>
          <div class="budget-bar mt"><span class="${s.spent > s.budget ? 'over' : ''}" style="width:${Math.min(100, (s.spent / s.budget) * 100)}%"></span><i style="left:${(s.dayNow / s.n) * 100}%"></i></div>`
          : html`<div class="stat-value">${s.avgDay != null ? money(s.avgDay) : '—'}</div><div class="stat-sub">a day so far${s.projected != null ? ` · about ${money(s.projected)} by month end` : ''}</div>`}</div>
        <div><div class="stat-label">Top categories</div>${cats.length ? html`<dl class="kv small">${cats.map(c => html`<dt>${catLabel(c.id)}</dt><dd>${money(c.total)}</dd>`)}</dl>` : html`<p class="muted small">Nothing logged yet.</p>`}</div>
        <div><div class="stat-label">Coming up</div>${up.length ? html`<div class="upcoming col">${up.map(u => html`<div class="up-item"><span class="muted small">${fmtDate(u.date, { weekday: 'short', day: 'numeric' })}</span><span>${u.r.name}</span><b>${money(u.value)}</b></div>`)}</div>` : html`<p class="muted small">No bills in the next 10 days.</p>`}</div>
      </div></div>`);

  if (series.length > 1) { const p = C.palette(); C.moneyLine(el.querySelector('#o-nw'), { labels: dateLabels(series.map(x => x.date)), series: [{ label: 'Net worth', data: series.map(x => x.net), color: p.series[0], fill: true }] }); }
}
