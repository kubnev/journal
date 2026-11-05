// Journal: a short daily check-in on how you feel — mood, energy, stress, sleep, habits and a few
// lines of reflection. Insights put it next to your spending, so emotional spending shows up.
import * as store from '../store.js';
import { html, raw, money, pct, num, today, fmtDate, formData, toast, confirmDlg, dayKey, parseDay, toNum, stat, pad, chipPicker, wireChipAdd } from '../ui.js';
import * as C from '../charts.js';
import { expenses, val } from '../spend/calc.js';
import { simpleMode } from '../networth/calc.js';
import { go, query, refresh } from '../main.js';

export const MOODS = ['😣', '😕', '😐', '🙂', '😄'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export const habitList = () => store.getSettings().habits || [];
const entries = () => [...store.all('days')].sort((a, b) => a.id.localeCompare(b.id));
// spending per day (display currency), excluding bills that are charged automatically
function spendByDay() {
  const m = new Map();
  for (const t of expenses()) if (!t.recurringId) m.set(t.date, (m.get(t.date) || 0) + val(t));
  return m;
}

export function streaks() {
  const set = new Set(store.all('days').map(d => d.id));
  let cur = 0;
  const d = new Date();
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1);   // today not written yet doesn't break the streak
  while (set.has(dayKey(d))) { cur++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  for (const k of [...set].sort()) {
    run = prev && Math.round((parseDay(k) - parseDay(prev)) / 864e5) === 1 ? run + 1 : 1;
    best = Math.max(best, run); prev = k;
  }
  return { current: cur, best, total: set.size };
}

const scale = (name, v, labels = MOODS) => html`<div class="seg rate" role="radiogroup" aria-label="${name}">${labels.map((m, i) => html`<button type="button" data-rate="${name}" data-v="${i + 1}" class="${+v === i + 1 ? 'on' : ''}" aria-label="${i + 1} of 5">${m}</button>`)}<input type="hidden" name="${name}" value="${v || ''}"></div>`;
const NUMS = ['1', '2', '3', '4', '5'];

// the 7 days up to `day`: mood per day, sleep and habits — so the side column is worth a glance
function weekCard(day) {
  const ds = Array.from({ length: 7 }, (_, i) => { const d = parseDay(day); d.setDate(d.getDate() - 6 + i); return dayKey(d); });
  const es = ds.map(k => store.get('days', k));
  const got = es.filter(Boolean);
  const sleep = mean(got.map(e => +e.sleep).filter(x => x > 0)), mood = mean(got.map(e => +e.mood).filter(x => x > 0)), stress = mean(got.map(e => +e.stress).filter(x => x > 0));
  const hab = habitList().map(h => ({ h, n: got.filter(e => e.habits?.[h]).length })).filter(x => x.n);
  return html`<div class="card"><div class="card-head"><h2>Last 7 days</h2><span class="hint">${got.length}/7 checked in</span></div>
    <div class="week-strip">${ds.map((k, i) => html`<a href="#/journal?day=${k}" class="${k === day ? 'on' : ''}" title="${fmtDate(k)}"><span class="small muted">${DOW[parseDay(k).getDay()].slice(0, 2)}</span><span class="wk-mood">${es[i]?.mood ? MOODS[es[i].mood - 1] : es[i] ? '✎' : '·'}</span></a>`)}</div>
    <dl class="kv small mt"><dt>Average mood</dt><dd>${mood ? num(mood, 1) + ' / 5' : '—'}</dd><dt>Average stress</dt><dd>${stress ? num(stress, 1) + ' / 5' : '—'}</dd><dt>Average sleep</dt><dd>${sleep ? num(sleep, 1) + ' h' : '—'}</dd></dl>
    ${hab.length ? html`<div class="small muted mt">Habits this week</div><div class="chips mt" style="gap:6px">${hab.map(x => html`<span class="tag">${x.h} ${x.n}×</span>`)}</div>` : ''}</div>`;
}

// ================= today / any day =================
export async function journalDay(el) {
  const pro = !simpleMode();
  const day = query().get('day') || today();
  const j = store.get('days', day) || { id: day };
  const st = streaks();
  const shift = n => { const d = parseDay(day); d.setDate(d.getDate() + n); return dayKey(d); };
  const habits = [...new Set([...habitList(), ...Object.keys(j.habits || {})])];
  const isToday = day === today();
  const dayTx = expenses().filter(t => t.date === day);
  const spent = dayTx.reduce((s, t) => s + val(t), 0);

  el.innerHTML = String(html`
    <div class="page-head"><div><h1>${isToday ? 'How are you today?' : fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric' })}</h1>
      <div class="sub">${fmtDate(day, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} · ${st.current ? `${st.current}-day journaling streak` : 'Two minutes — start a streak today'}</div></div>
      <div class="actions"><a class="btn" href="#/journal?day=${shift(-1)}" aria-label="Previous day">←</a><input type="date" id="jd" value="${day}" aria-label="Pick a day"><a class="btn" href="#/journal?day=${shift(1)}" aria-label="Next day">→</a>${!isToday ? html`<a class="btn" href="#/journal">Today</a>` : ''}</div></div>
    <div class="grid g-2-1">
      <form id="jf" class="stack" autocomplete="off">
        <fieldset><legend>Check-in</legend><div class="form-grid">
          <label class="field">Mood${scale('mood', j.mood)}</label>
          <label class="field">Energy${scale('energy', j.energy, NUMS)}</label>
          <label class="field">Stress <span class="hint">1 calm · 5 very stressed</span>${scale('stress', j.stress, NUMS)}</label>
          <label class="field">Sleep (hours)<input name="sleep" type="number" step="0.5" min="0" max="24" value="${j.sleep ?? ''}"></label>
          <label class="field full">What's on your mind?<textarea name="mind" rows="3" placeholder="Anything — worries, plans, what you're looking forward to">${j.mind || ''}</textarea></label>
        </div>
        ${habits.length ? html`<h3 class="mt">Habits</h3><div class="chips">${habits.map(h => html`<label class="chip"><input type="checkbox" name="habit:${h}" ${j.habits?.[h] ? raw('checked') : ''}><span>${h}</span></label>`)}</div>` : html`<p class="small muted mt">Add daily habits to track in <a href="#/settings">Settings</a>.</p>`}
        </fieldset>
        <fieldset><legend>Reflection</legend><div class="form-grid">
          ${j.recap ? html`<label class="field full">How did the day go?<textarea name="recap" rows="3">${j.recap}</textarea></label>` : ''}
          ${pro ? html`<label class="field span2">What went well<textarea name="good" rows="3">${j.good || ''}</textarea></label>
          <label class="field span2">What was hard<textarea name="hard" rows="3">${j.hard || j.improve || ''}</textarea></label>` : ''}
          <label class="field full">Three things you're grateful for<textarea name="gratitude" rows="2" placeholder="Small things count">${j.gratitude || ''}</textarea></label>
          <label class="field full">Note to self for tomorrow<textarea name="lesson" rows="2">${j.lesson || ''}</textarea></label>
        </div>
        ${pro ? html`<h3 class="mt">Tags</h3>${chipPicker('tags', store.getSettings().dayTags || [], j.tags || [])}` : ''}
        </fieldset>
        <div class="form-actions">${store.get('days', day) ? html`<button type="button" class="btn danger" data-del>Delete entry</button>` : ''}<button class="btn primary">Save journal</button></div>
      </form>

      <div class="stack journal-side">
        ${weekCard(day)}
        <div class="card"><div class="card-head"><h2>This day</h2></div>
          <dl class="kv">
            <dt>Spent</dt><dd>${dayTx.length ? money(spent) : '—'}</dd>
            <dt>Expenses logged</dt><dd>${dayTx.length}</dd>
            <dt>Journaling streak</dt><dd>${st.current} day${st.current === 1 ? '' : 's'} (best ${st.best})</dd>
          </dl>
          <div class="row mt"><button class="btn sm" data-quick-add>+ Add expense</button><a class="btn sm" href="#/spending/calendar?m=${day.slice(0, 7)}&day=${day}">See the day's spending</a></div>
        </div>
        <div class="card"><div class="card-head"><h2>Recent entries</h2><a class="hint" href="#/journal/history">History →</a></div>
          ${entries().reverse().slice(0, 12).map(e => html`<a href="#/journal?day=${e.id}" class="row entry-row ${e.id === day ? 'on' : ''}"><span>${fmtDate(e.id, { weekday: 'short', month: 'short', day: 'numeric' })}</span><span>${e.mood ? MOODS[e.mood - 1] : ''}</span><span class="spacer"></span><span class="small muted ellipsis">${(e.mind || e.recap || e.intention || '').slice(0, 40)}</span></a>`)}
          ${!store.all('days').length ? html`<p class="muted small">No entries yet. A two-minute check-in each day builds the picture that Insights turns into patterns — including how your mood and your spending move together.</p>` : ''}
        </div>
      </div>
    </div>`);

  wireChipAdd(el);
  el.querySelector('#jd').onchange = e => e.target.value && go('/journal?day=' + e.target.value);
  el.querySelectorAll('[data-rate]').forEach(b => b.onclick = () => {
    const name = b.dataset.rate, inp = el.querySelector(`input[name=${name}]`);
    const on = inp.value === b.dataset.v;
    inp.value = on ? '' : b.dataset.v;
    el.querySelectorAll(`[data-rate=${name}]`).forEach(x => x.classList.toggle('on', !on && x === b));
  });
  const form = el.querySelector('#jf');
  form.onsubmit = async e => {
    e.preventDefault();
    const f = formData(form);
    const obj = { ...j, id: day };
    for (const k of ['mind', 'recap', 'good', 'hard', 'gratitude', 'lesson']) if (k in f) obj[k] = f[k];
    for (const k of ['mood', 'energy', 'stress', 'sleep']) if (k in f) obj[k] = toNum(f[k]);
    if ('tags' in f) obj.tags = f.tags;
    obj.habits = {};
    for (const h of habits) obj.habits[h] = !!f['habit:' + h];
    await store.put('days', obj);
    toast('Journal saved');
    refresh();
  };
  el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDlg('Delete journal entry?', `Delete the entry for ${fmtDate(day)}?`))) return;
    await store.del('days', day); toast('Entry deleted'); refresh();
  });
}

// ================= history =================
let cursor = null;
export async function history(el) {
  if (!cursor) cursor = today().slice(0, 7);
  el.innerHTML = String(html`
    <div class="page-head"><div><h1>Journal history</h1><div class="sub">Your mood and entries by day, with what you spent. Click a day to read or edit it.</div></div>
      <div class="actions cal-nav"><button class="btn" data-m="-1" aria-label="Previous month">←</button><span class="title" id="mt"></span><button class="btn" data-m="1" aria-label="Next month">→</button><button class="btn" data-m="0">This month</button></div></div>
    <div id="body"></div>`);
  const body = el.querySelector('#body');
  const spend = spendByDay();
  const draw = () => {
    const [y, m] = cursor.split('-').map(Number);
    el.querySelector('#mt').textContent = new Date(y, m - 1, 1).toLocaleDateString(store.getSettings().locale, { month: 'long', year: 'numeric' });
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
    const cells = [];
    const monthEntries = store.all('days').filter(d => d.id.startsWith(cursor));
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      if (i >= 35 && d.getMonth() !== m - 1) break;
      const k = dayKey(d), j = store.get('days', k), sp = spend.get(k);
      cells.push(html`<a class="cell ${d.getMonth() === m - 1 ? '' : 'out'} ${j ? 'has' : ''} ${k === today() ? 'today' : ''}" href="#/journal?day=${k}">
        <span class="d">${d.getDate()}</span>${j ? html`<span class="jmood" title="Mood">${j.mood ? MOODS[j.mood - 1] : '✎'}</span>` : ''}
        ${sp ? html`<span class="n muted">${money(sp, { compact: true, decimals: 0 })}</span>` : ''}</a>`);
    }
    const moods = monthEntries.map(d => d.mood).filter(Boolean);
    const stress = monthEntries.map(d => d.stress).filter(Boolean);
    body.innerHTML = String(html`
      <div class="stats">
        ${stat('Entries this month', String(monthEntries.length))}
        ${stat('Average mood', moods.length ? `${MOODS[Math.round(mean(moods)) - 1]} ${num(mean(moods), 1)}` : '—')}
        ${stat('Average stress', stress.length ? `${num(mean(stress), 1)} / 5` : '—')}
        ${stat('Avg sleep', monthEntries.some(d => d.sleep) ? num(mean(monthEntries.map(d => +d.sleep).filter(Boolean)), 1) + ' h' : '—')}
      </div>
      <div class="card mt"><div class="cal cal7">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => html`<div class="dow">${d}</div>`)}${cells}</div>
        <div class="small muted mt">Emoji = mood · amount = everyday spending that day (bills left out)</div></div>
      <div class="card mt"><div class="card-head"><h2>Consistency — last 12 months</h2><span class="hint">each square is a day you journaled</span></div><div class="yearmap" id="ym"></div></div>
      <div class="card mt"><div class="card-head"><h2>Entries</h2><span class="hint">${monthEntries.length}</span></div>
        ${monthEntries.length ? html`<div class="stack" style="gap:0">${monthEntries.sort((a, b) => b.id.localeCompare(a.id)).map(e => html`<a class="entry" href="#/journal?day=${e.id}"><div class="row"><b>${fmtDate(e.id, { weekday: 'long', month: 'short', day: 'numeric' })}</b>${e.mood ? html`<span>${MOODS[e.mood - 1]}</span>` : ''}${e.stress ? html`<span class="tag">stress ${e.stress}/5</span>` : ''}${(e.tags || []).map(t => html`<span class="tag accent">${t}</span>`)}</div>${e.mind ? html`<div class="small"><span class="muted">On my mind:</span> ${e.mind}</div>` : ''}${e.recap ? html`<div class="small"><span class="muted">Day:</span> ${e.recap}</div>` : ''}${e.gratitude ? html`<div class="small"><span class="muted">Grateful for:</span> ${e.gratitude}</div>` : ''}${e.lesson ? html`<div class="small"><span class="muted">Note to self:</span> ${e.lesson}</div>` : ''}</a>`)}</div>` : html`<p class="muted small">No entries this month.</p>`}
      </div>`);
    const set = new Set(store.all('days').map(d => d.id));
    const end = new Date(), s0 = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 364);
    s0.setDate(s0.getDate() - ((s0.getDay() + 6) % 7));
    const out = [];
    for (let d = new Date(s0); d <= end; d.setDate(d.getDate() + 1)) { const k = dayKey(d); const j = set.has(k) ? store.get('days', k) : null; out.push(`<span title="${fmtDate(k)}${j ? ' · journaled' : ''}" ${j ? `style="background:var(--accent);opacity:${0.35 + 0.13 * (j.mood || 3)}"` : ''}></span>`); }
    body.querySelector('#ym').innerHTML = out.join('');
  };
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
    const dl = +b.dataset.m;
    if (!dl) cursor = today().slice(0, 7);
    else { const [y, m] = cursor.split('-').map(Number); const d = new Date(y, m - 1 + dl, 1); cursor = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
    draw();
  });
  draw();
}

// ================= insights =================
export async function insights(el) {
  const all = entries();
  el.innerHTML = String(html`<div class="page-head"><div><h1>Journal insights</h1><div class="sub">Patterns in how you feel and sleep — and how that lines up with what you spend.</div></div></div><div id="body"></div>`);
  const body = el.querySelector('#body');
  if (all.length < 3) { body.innerHTML = String(html`<div class="empty"><div class="empty-title">Not enough entries yet</div><p>Insights appear after a few journal entries. Write today's check-in to start.</p><a class="btn primary" href="#/journal">Open today's journal</a></div>`); return; }
  const st = streaks();
  const cut = k => { const d = new Date(); d.setDate(d.getDate() - k); return dayKey(d); };
  const last30 = all.filter(e => e.id >= cut(29)), last90 = all.filter(e => e.id >= cut(89));
  const avg = (list, k) => mean(list.map(e => +e[k]).filter(x => x > 0));
  const habits = [...new Set([...habitList(), ...all.flatMap(e => Object.keys(e.habits || {}))])];
  const habitRates = habits.map(h => { const rel = last30.filter(e => e.habits && h in e.habits); return { h, rate: rel.length ? rel.filter(e => e.habits[h]).length / rel.length : null, n: rel.length }; }).filter(x => x.rate != null);
  // spending vs state — only days you journaled, everyday spending (bills left out)
  const spend = spendByDay();
  const firstTx = expenses().map(t => t.date).sort()[0];
  const withSpend = all.filter(e => firstTx && e.id >= firstTx && e.id <= today()).map(e => ({ e, spent: spend.get(e.id) || 0 }));
  const grp = f => { const l = withSpend.filter(x => f(x.e)); return { n: l.length, avg: l.length ? mean(l.map(x => x.spent)) : null }; };
  const rows = [
    ['Good mood (4–5)', grp(e => e.mood >= 4)], ['Low mood (1–2)', grp(e => e.mood && e.mood <= 2)],
    ['Calm (stress 1–2)', grp(e => e.stress && e.stress <= 2)], ['Stressed (stress 4–5)', grp(e => e.stress >= 4)],
    ['Slept 7h+', grp(e => +e.sleep >= 7)], ['Slept under 6.5h', grp(e => e.sleep && +e.sleep < 6.5)],
  ];
  const allAvg = withSpend.length ? mean(withSpend.map(x => x.spent)) : null;
  const byDow = [1, 2, 3, 4, 5, 6, 0].map(d => ({ d: DOW[d], mood: mean(all.filter(e => parseDay(e.id).getDay() === d && e.mood).map(e => e.mood)) }));

  body.innerHTML = String(html`
    <div class="stats big">
      ${stat('Current streak', `${st.current} day${st.current === 1 ? '' : 's'}`, { sub: `best ${st.best} · ${st.total} entries total` })}
      ${stat('Entries (30 days)', `${last30.length}/30`, { sub: pct(last30.length / 30, 0) + ' consistency' })}
      ${stat('Mood (30d)', avg(last30, 'mood') ? `${MOODS[Math.round(avg(last30, 'mood')) - 1]} ${num(avg(last30, 'mood'), 1)}` : '—', { sub: avg(last90, 'mood') ? `90d ${num(avg(last90, 'mood'), 1)}` : '' })}
      ${stat('Stress (30d)', avg(last30, 'stress') ? num(avg(last30, 'stress'), 1) : '—', { sub: 'out of 5' })}
      ${stat('Sleep (30d)', avg(last30, 'sleep') ? num(avg(last30, 'sleep'), 1) + ' h' : '—', { sub: 'average per night' })}
    </div>
    <div class="grid g-2-1 mt">
      <div class="card"><div class="card-head"><h2>Mood, energy & stress</h2><span class="hint">last 90 days, 7-entry average</span></div><div class="chart"><canvas id="i-mood"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Habits</h2><span class="hint">completion, last 30 days</span></div>${habitRates.length ? html`<div class="chart"><canvas id="i-hab"></canvas></div>` : html`<p class="small muted">Tick habits in your daily check-in to see completion rates.</p>`}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card" data-tour="mood-spend"><div class="card-head"><h2>How you feel vs what you spend</h2><span class="hint">everyday spending on days you journaled</span></div>
        ${withSpend.length >= 5 ? html`<div class="table-wrap" style="border:0"><table class="data compact"><thead><tr><th>On days when you were…</th><th class="num">Days</th><th class="num">Avg spent</th><th class="num">vs usual</th></tr></thead><tbody>
          ${rows.map(([l, g]) => html`<tr><td>${l}</td><td class="num">${g.n}</td><td class="num">${g.n ? money(g.avg) : '—'}</td><td class="num ${g.n && allAvg ? (g.avg > allAvg * 1.15 ? 'neg' : g.avg < allAvg * 0.85 ? 'pos' : '') : ''}">${g.n && allAvg ? pct(g.avg / allAvg - 1, 0, { sign: true }) : '—'}</td></tr>`)}
        </tbody></table></div><p class="small muted mt">Usual = ${money(allAvg)} per journaled day. Small samples are noisy — treat this as a prompt for reflection, not a rule.</p>`
          : html`<p class="small muted">Journal and log your spending for a week or so to see whether mood, stress or sleep change what you spend.</p>`}</div>
      <div class="card"><div class="card-head"><h2>Mood vs spending</h2><span class="hint">each dot is a day</span></div>${withSpend.filter(x => x.e.mood).length >= 5 ? html`<div class="chart"><canvas id="i-scatter"></canvas></div>` : html`<p class="small muted">Needs a few more days with both a mood and logged spending.</p>`}</div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><div class="card-head"><h2>Sleep</h2><span class="hint">last 30 entries</span></div><div class="chart short"><canvas id="i-sleep"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Mood by weekday</h2></div><div class="chart short"><canvas id="i-dow"></canvas></div></div>
    </div>
    <div class="card mt"><div class="card-head"><h2>Notes to self</h2><span class="hint">latest</span></div>${!all.some(e => e.lesson) ? html`<p class="small muted">Write a note to self in your daily reflection and the latest ones collect here.</p>` : ''}${all.filter(e => e.lesson).slice(-6).reverse().map(e => html`<div class="small" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="muted">${fmtDate(e.id, { month: 'short', day: 'numeric' })}</span> — ${e.lesson}</div>`)}</div>`);

  const p = C.palette();
  const series = last90;
  const ma = k => series.map((e, i) => { const w = series.slice(Math.max(0, i - 6), i + 1).map(x => +x[k]).filter(x => x > 0); return w.length ? mean(w) : null; });
  const labels = series.map(e => fmtDate(e.id, { month: 'short', day: 'numeric' }));
  C.make(body.querySelector('#i-mood'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Mood', data: ma('mood'), borderColor: p.series[0], tension: 0.3, spanGaps: true }, { label: 'Energy', data: ma('energy'), borderColor: p.series[2], tension: 0.3, spanGaps: true }, { label: 'Stress', data: ma('stress'), borderColor: p.series[1], borderDash: [4, 3], tension: 0.3, spanGaps: true }] },
    options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'top', align: 'end' }, tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${num(c.parsed.y, 1)}` } } }, scales: { x: C.plainAxis({ ticks: { maxTicksLimit: 8, maxRotation: 0 } }), y: { min: 1, max: 5, grid: { color: p.grid }, border: { display: false }, ticks: { stepSize: 1 } } } },
  });
  if (habitRates.length) C.plainBars(body.querySelector('#i-hab'), { labels: habitRates.map(x => x.h), values: habitRates.map(x => x.rate * 100), horizontal: true, fmt: v => num(v, 0) + '%', label: 'Done' });
  const sl = all.filter(e => +e.sleep > 0).slice(-30);
  C.plainBars(body.querySelector('#i-sleep'), { labels: sl.map(e => fmtDate(e.id, { month: 'short', day: 'numeric' })), values: sl.map(e => +e.sleep), fmt: v => num(v, 1) + ' h', colors: sl.map(e => (+e.sleep >= 7 ? p.series[0] : p.neutral)), label: 'Sleep' });
  C.plainBars(body.querySelector('#i-dow'), { labels: byDow.map(x => x.d), values: byDow.map(x => x.mood ?? 0), fmt: v => num(v, 1), label: 'Avg mood' });
  const pts = withSpend.filter(x => x.e.mood);
  if (pts.length >= 5) C.scatter(body.querySelector('#i-scatter'), { groups: [{ label: 'Days', color: p.accent, points: pts.map(x => ({ x: x.e.mood + (Math.random() - 0.5) * 0.25, y: x.spent, d: x.e.id })) }], xLabel: 'Mood (1–5)', yLabel: 'Spent', fmtX: v => (Number.isInteger(v) && v >= 1 && v <= 5 ? String(v) : ''), fmtY: v => money(v, { compact: true }), tip: r => `${fmtDate(r.d)}: ${money(r.y)}` });
}
