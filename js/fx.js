// Multi-currency support. Every account / cash-flow entry keeps its own (native) currency;
// totals, charts and dashboards are converted into the display currency chosen in Settings.
// Rates: ECB reference rates via Frankfurter (daily history), Coinbase as fallback for the latest
// rate of currencies the ECB doesn't publish. Rates are cached locally so the app works offline.
import * as store from './store.js';
import { maskMoney } from './ui.js';

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BGN', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'RON', 'HUF', 'TRY', 'INR', 'SGD', 'HKD', 'CNY', 'ZAR', 'BRL', 'MXN', 'AED', 'USDT'];
const USD_LIKE = new Set(['USD', 'USDT']);
// Currencies the ECB publishes (Frankfurter rejects a request that names any other symbol)
const ECB = new Set(['EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'NZD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'RON', 'HUF', 'TRY', 'INR', 'SGD', 'HKD', 'CNY', 'ZAR', 'BRL', 'MXN']);
// The Bulgarian lev was fixed to the euro until it was replaced by it; derive it from EUR
const BGN_PER_EUR = 1.95583;
// Approximate units-per-USD, used only until real rates have been fetched once (flagged in the UI).
const FALLBACK = { EUR: 0.92, GBP: 0.78, BGN: 1.8, CHF: 0.86, JPY: 148, CAD: 1.36, AUD: 1.5, NZD: 1.65, SEK: 10.5, NOK: 10.6, DKK: 6.85, PLN: 3.95, CZK: 23, RON: 4.6, HUF: 360, TRY: 34, INR: 84, SGD: 1.33, HKD: 7.8, CNY: 7.2, ZAR: 18, BRL: 5.4, MXN: 18.5, AED: 3.6725 };

const fxState = () => store.getSettings().fx || { latest: null, at: null, history: {} };
export const displayCcy = () => store.getSettings().currency || 'USD';
export const ccyOf = o => (o && o.currency) || displayCcy();
export const usingFallback = () => !fxState().at;
export const ratesAt = () => fxState().at;

// sorted history dates (cached per state object)
let histKeys = null, histRef = null;
function keys() {
  const h = fxState().history || {};
  if (histRef !== h) { histRef = h; histKeys = Object.keys(h).sort(); }
  return histKeys;
}
// units of `cur` per 1 USD on `date` (nearest earlier ECB day), else latest, else fallback
export function rate(cur, date) {
  if (!cur || USD_LIKE.has(cur)) return 1;
  if (cur === 'BGN') return rate('EUR', date) * BGN_PER_EUR;
  const st = fxState();
  if (date && st.history) {
    const ks = keys();
    let lo = 0, hi = ks.length - 1, found = null;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (ks[m] <= date) { found = ks[m]; lo = m + 1; } else hi = m - 1; }
    if (found && st.history[found][cur]) return st.history[found][cur];
  }
  return st.latest?.[cur] || FALLBACK[cur] || 1;
}
// convert an amount between currencies (on a date, for history)
export function conv(amount, from, to = displayCcy(), date) {
  if (amount == null || !isFinite(amount) || !from || from === to || (USD_LIKE.has(from) && USD_LIKE.has(to))) return amount;
  return (amount / rate(from, date)) * rate(to, date);
}
export const sameMoney = (a, b) => a === b || (USD_LIKE.has(a) && USD_LIKE.has(b));
export const toDisplay = (amount, from, date) => conv(amount, from, displayCcy(), date);

// every currency present in the data except the display one (for the rates table)
export function otherCurrencies() {
  const s = new Set();
  for (const c of ['nwAccounts', 'txns', 'recurring']) for (const x of store.all(c)) if (x.currency) s.add(x.currency === 'USDT' ? 'USD' : x.currency);
  s.delete(displayCcy() === 'USDT' ? 'USD' : displayCcy());
  return [...s];
}
// currencies actually used in the data (plus display)
export function currenciesInUse() {
  const s = new Set([displayCcy()]);
  for (const c of ['nwAccounts', 'txns', 'recurring']) for (const x of store.all(c)) if (x.currency) s.add(x.currency);
  if (store.getSettings().plan?.currency) s.add(store.getSettings().plan.currency);
  if (s.has('BGN')) { s.delete('BGN'); s.add('EUR'); }
  return [...s].filter(c => !USD_LIKE.has(c));
}
const earliestDate = () => {
  const ds = [...store.all('nwSnapshots').map(s => s.date), ...store.all('txns').map(t => t.date)].filter(Boolean).sort();
  return ds[0] || null;
};

async function getJSON(url) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 12000);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`); return await r.json(); }
  finally { clearTimeout(tm); }
}

// Fetch latest + history for the currencies in use. Safe to call often; skips if fresh.
// Calls are queued so two overlapping refreshes can't overwrite each other's results.
let queue = Promise.resolve();
export function refreshRates(opts) {
  const run = queue.then(() => doRefresh(opts));
  queue = run.catch(() => {});
  return run;
}
async function doRefresh({ force = false } = {}) {
  const need = currenciesInUse();
  const st = fxState();
  if (!need.length) return { ok: true, skipped: true };
  const fresh = st.at && Date.now() - new Date(st.at) < 12 * 3600e3 && need.every(c => st.latest?.[c]);
  const start = earliestDate();
  const histFrom = Object.keys(st.history || {}).sort()[0];
  const ecb = need.filter(c => ECB.has(c));
  const histOk = !start || !ecb.length || (histFrom && histFrom <= start && ecb.every(c => Object.values(st.history).some(r => r[c])));
  if (fresh && histOk && !force) return { ok: true, skipped: true };
  const latest = { ...(st.latest || {}) }, history = { ...(st.history || {}) }, errors = [];
  let ecbOk = !ecb.length;
  if (ecb.length) try {
    const j = await getJSON(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${ecb.join(',')}`);
    Object.assign(latest, j.rates || {}); ecbOk = true;
  } catch (e) { errors.push('ECB rates: ' + e.message); }
  // non-ECB currencies always, and everything if the ECB request failed
  const missing = need.filter(c => !ECB.has(c) || !ecbOk || !latest[c]);
  if (missing.length) {
    try { const j = await getJSON('https://api.coinbase.com/v2/exchange-rates?currency=USD'); for (const c of missing) if (+j?.data?.rates?.[c]) latest[c] = +j.data.rates[c]; }
    catch (e) { errors.push('Coinbase rates: ' + e.message); }
  }
  if (start && ecb.length && (!histOk || force)) {
    try {
      const j = await getJSON(`https://api.frankfurter.dev/v1/${start}..?base=USD&symbols=${ecb.join(',')}`);
      for (const [d, r] of Object.entries(j.rates || {})) history[d] = { ...(history[d] || {}), ...r };
    } catch (e) { errors.push('ECB history: ' + e.message); }
  }
  const ok = need.every(c => latest[c]);
  await store.saveSettings({ fx: { latest, history, at: ok ? new Date().toISOString() : st.at } });
  return { ok, errors, count: need.length };
}

// Called on every page view: fetches as soon as a new currency appears, at most once a minute
// per set of currencies (so an offline browser doesn't retry on every click).
let lastTry = { k: '', t: 0 };
export async function ensureRates() {
  const k = currenciesInUse().join(',');
  if (k === lastTry.k && Date.now() - lastTry.t < 60e3) return { ok: true, skipped: true };
  lastTry = { k, t: Date.now() };
  return refreshRates();
}

// Native-currency formatter for places that show an account's own currency
const nfs = new Map();
export function moneyIn(v, cur, { sign = false } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const c = cur === 'USDT' ? 'USD' : cur || displayCcy();
  const k = c + (store.getSettings().locale || '');
  if (!nfs.has(k)) nfs.set(k, new Intl.NumberFormat(store.getSettings().locale, { style: 'currency', currency: c, maximumFractionDigits: 2 }));
  if (store.getSettings().privacy) return maskMoney(nfs.get(k)) + (cur === 'USDT' ? ' ₮' : '');
  const s = nfs.get(k).format(Math.abs(v)) + (cur === 'USDT' ? ' ₮' : '');
  return v < 0 ? '−' + s : (sign && v > 0 ? '+' : '') + s;
}
export const ccySelect = (name, cur) => `<select name="${name}">${CURRENCIES.map(c => `<option ${c === cur ? 'selected' : ''}>${c}</option>`).join('')}</select>`;

// One-time: tag existing records with the currency they were entered in (the display currency at the time)
export async function migrateCurrencies() {
  const cur = displayCcy();
  for (const c of ['nwAccounts', 'txns', 'recurring']) {
    const todo = store.all(c).filter(x => !x.currency);
    if (todo.length) await store.putMany(c, todo.map(x => ({ ...x, currency: cur })));
  }
  if (!store.getSettings().plan?.currency) await store.saveSettings({ plan: { currency: cur } });
}
