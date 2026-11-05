// Live prices for holdings, fetched straight from the browser (public, CORS-enabled APIs).
// Nothing goes through a server of ours — the request goes from this browser to the provider.
//   crypto : Binance (all spot tickers, one request) → Coinbase spot price as fallback
//   stocks : Finnhub quote (needs the user's free API key, stored locally)
//   FX     : Frankfurter (ECB rates) → Coinbase exchange rates as fallback
import * as store from '../store.js';
import { today } from '../ui.js';
import { PEGGED } from '../fx.js';

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDP', 'PYUSD', 'USDE']);
const TIMEOUT = 12000;

async function getJSON(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`${new URL(url).host} responded ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const normSymbol = s => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, '');

// → { prices: {SYM: {usd, source}}, failed: [SYM], errors: [msg] }
export async function cryptoPricesUSD(symbols) {
  const want = [...new Set(symbols.map(normSymbol).filter(Boolean))];
  const prices = {}, errors = [];
  for (const s of want) if (STABLES.has(s)) prices[s] = { usd: 1, source: 'stablecoin (≈ $1)' };
  let todo = want.filter(s => !prices[s]);
  if (todo.length) {
    try {
      const all = await getJSON('https://api.binance.com/api/v3/ticker/price');
      const map = new Map(all.map(x => [x.symbol, +x.price]));
      for (const s of todo) {
        for (const q of ['USDT', 'USDC', 'FDUSD']) { const p = map.get(s + q); if (p > 0) { prices[s] = { usd: p, source: 'Binance' }; break; } }
      }
    } catch (e) { errors.push('Binance: ' + (e.name === 'AbortError' ? 'timed out' : e.message)); }
  }
  todo = want.filter(s => !prices[s]);
  await Promise.all(todo.map(async s => {
    try {
      const j = await getJSON(`https://api.coinbase.com/v2/prices/${encodeURIComponent(s)}-USD/spot`);
      const p = +j?.data?.amount;
      if (p > 0) prices[s] = { usd: p, source: 'Coinbase' };
    } catch (e) { /* reported as failed below */ }
  }));
  return { prices, failed: want.filter(s => !prices[s]), errors };
}

export async function stockPricesUSD(symbols, apiKey) {
  const want = [...new Set(symbols.map(normSymbol).filter(Boolean))];
  const prices = {}, errors = [];
  if (!want.length) return { prices, failed: [], errors };
  if (!apiKey) return { prices, failed: want, errors: ['Stocks need a free Finnhub API key (Settings → Price data).'] };
  await Promise.all(want.map(async s => {
    try {
      const j = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(s)}&token=${encodeURIComponent(apiKey)}`);
      if (+j?.c > 0) prices[s] = { usd: +j.c, source: 'Finnhub' };
    } catch (e) { if (!errors.length) errors.push('Finnhub: ' + (e.name === 'AbortError' ? 'timed out' : e.message)); }
  }));
  return { prices, failed: want.filter(s => !prices[s]), errors };
}

// How many units of `cur` one US dollar buys
export async function usdTo(cur) {
  cur = (cur || 'USD').toUpperCase();
  if (cur === 'USD' || cur === 'USDT') return 1;
  if (PEGGED[cur]) return (await usdTo(PEGGED[cur][0])) * PEGGED[cur][1];
  try { const j = await getJSON(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${cur}`); if (+j?.rates?.[cur] > 0) return +j.rates[cur]; } catch {}
  try { const j = await getJSON('https://api.coinbase.com/v2/exchange-rates?currency=USD'); if (+j?.data?.rates?.[cur] > 0) return +j.data.rates[cur]; } catch {}
  throw new Error(`Couldn't get the USD → ${cur} exchange rate`);
}

export const holdingValue = h => (+h.qty || 0) * (+h.price || 0);
export const holdingsTotal = a => (a.holdings || []).reduce((s, h) => s + holdingValue(h), 0);

// Record the current value of holdings accounts in today's snapshot
export async function syncHoldingsSnapshot(accounts) {
  const list = accounts.filter(a => a.tracksHoldings && !a.archivedAt);
  if (!list.length) return;
  const d = today();
  const snap = store.all('nwSnapshots').find(s => s.date === d);
  const balances = { ...(snap?.balances || {}) };
  for (const a of list) balances[a.id] = Math.round(holdingsTotal(a) * 100) / 100;
  await store.put('nwSnapshots', { ...(snap || { date: d }), balances });
}

// Fetch prices for every holding in every tracked account, store them, update today's snapshot.
// Returns a summary for the UI.
export async function updateAllPrices() {
  const accts = store.all('nwAccounts').filter(a => a.tracksHoldings && !a.archivedAt && (a.holdings || []).length);
  const holdings = accts.flatMap(a => a.holdings);
  if (!holdings.length) return { updated: 0, failed: [], errors: [], sources: {}, empty: true };
  const s = store.getSettings();
  const cryptoSyms = holdings.filter(h => h.type === 'crypto').map(h => h.symbol);
  const stockSyms = holdings.filter(h => h.type === 'stock').map(h => h.symbol);
  const [c, k] = await Promise.all([cryptoPricesUSD(cryptoSyms), stockPricesUSD(stockSyms, s.priceApi?.finnhubKey)]);
  const errors = [...c.errors, ...k.errors];
  // prices come in USD; each account is valued in its own currency
  const fxBy = {};
  for (const cur of new Set(accts.map(a => a.currency || s.currency || 'USD'))) {
    try { fxBy[cur] = await usdTo(cur); } catch (e) { errors.push(e.message); }
  }
  const now = new Date().toISOString();
  let updated = 0;
  const sources = {};
  const fx = Object.keys(fxBy).length ? 1 : null;
  if (fx != null) {
    for (const a of accts) {
      const rate = fxBy[a.currency || s.currency || 'USD'];
      if (rate == null) continue;
      let changed = false;
      const hs = a.holdings.map(h => {
        const p = (h.type === 'crypto' ? c.prices : k.prices)[normSymbol(h.symbol)];
        if (!p) return h;
        changed = true; updated++;
        sources[p.source] = (sources[p.source] || 0) + 1;
        return { ...h, price: +(p.usd * rate).toPrecision(10), priceUSD: p.usd, priceAt: now, priceSource: p.source };
      });
      if (changed) await store.put('nwAccounts', { ...a, holdings: hs });
    }
    await syncHoldingsSnapshot(store.all('nwAccounts'));
    await store.saveSettings({ priceApi: { ...(s.priceApi || {}), lastUpdate: now } });
  }
  return { updated, failed: fx == null ? [...new Set(holdings.map(h => normSymbol(h.symbol)))] : [...c.failed, ...k.failed], errors, sources };
}

export function summaryText(r) {
  if (r.empty) return 'No holdings to price yet — add holdings to an account first.';
  const src = Object.entries(r.sources).map(([k, v]) => `${k} ${v}`).join(', ');
  let msg = r.updated ? `Updated ${r.updated} price${r.updated > 1 ? 's' : ''}${src ? ` (${src})` : ''}.` : 'No prices updated.';
  if (r.failed.length) msg += ` Not found: ${r.failed.join(', ')}.`;
  if (r.errors.length) msg += ' ' + r.errors.join(' ');
  return msg;
}
