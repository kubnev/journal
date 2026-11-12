// Everything lives in this browser's IndexedDB. Collections are loaded into memory at startup;
// writes go straight through to the database.

const DB_NAME = 'journal';
const DB_VERSION = 1;
const OLD_DB = 'ledgerline';   // the app's previous name — copied over once, then removed

export const COLLECTIONS = [
  'nwAccounts',    // net worth: assets & debts
  'nwSnapshots',   // net worth: dated balances
  'nwFlows',       // net worth: money put into / taken out of an account
  'txns',          // spending: one record per expense
  'recurring',     // spending: bills & subscriptions
  'days',          // journal: one entry per day (id = YYYY-MM-DD)
];
const META_STORE = 'meta';

export const DEFAULT_SETTINGS = {
  theme: 'auto',                  // 'auto' follows the device
  currency: 'USD',
  locale: undefined,
  pnlColors: 'greenred',          // or 'blueorange' (colour-vision friendly)
  priceApi: { finnhubKey: '', lastUpdate: null },
  lastBackupAt: null,
  backupReminder: true,           // weekly “back up” notice
  privacy: false,                 // hide amounts
  mode: 'simple',                 // 'simple' | 'pro' — how much detail the forms ask for
  modeChosen: false,
  reviewAccounts: false,          // nudge after switching to Pro
  categories: null,               // null → built-in list; otherwise your edited list
  budgets: { total: 0, byCat: {} },   // monthly limits in the display currency
  payMethods: ['Debit card', 'Credit card', 'Cash', 'Bank transfer', 'Phone wallet'],
  tour: { done: false },
  plan: { targetAllocation: {}, emergencyMonths: 6, usualSpending: null },
  habits: ['Exercise', 'Outside / walk', 'Read', 'No alcohol', 'Screen off before bed'],
  dayTags: ['Stressed', 'Calm', 'Social', 'Productive', 'Tired', 'Sick'],
  nav: { order: [], collapsed: {} },  // sidebar: section order and folded sections
  tourDemo: false, demoBudgets: false, demoTargets: false,  // sample data from the tour is loaded
};
// settings from older versions that no longer mean anything
const OLD_KEYS = ['estimates', 'tradingMode', 'networthMode', 'tagLists', 'v1Migrated', 'fxMigrated'];

let db = null;
const mem = {};
let settings = structuredClone(DEFAULT_SETTINGS);

const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = tx => new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

function openDb(name, version, upgrade) {
  return new Promise((res, rej) => {
    const r = version ? indexedDB.open(name, version) : indexedDB.open(name);
    r.onupgradeneeded = e => upgrade(r.result, e, r);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
const openMain = () => openDb(DB_NAME, DB_VERSION, d => {
  for (const c of COLLECTIONS) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
  if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: 'key' });
});

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

// One-time move from the database the app used under its previous name. Only today's kinds of
// records come along (income entries and planned transfers from older versions are left behind).
async function moveOldDatabase() {
  let old;
  try {
    // opening a database that doesn't exist would create it — abort that instead
    old = await openDb(OLD_DB, undefined, (_d, e, r) => { if (e.oldVersion === 0) r.transaction.abort(); });
  } catch { return; }
  try {
    const stores = [...COLLECTIONS, META_STORE].filter(c => old.objectStoreNames.contains(c));
    const tx = old.transaction(stores, 'readonly');
    const data = Object.fromEntries(await Promise.all(stores.map(async c => [c, await req(tx.objectStore(c).getAll())])));
    const drop = o => o.type === 'income';
    const wtx = db.transaction([...COLLECTIONS, META_STORE].filter(c => data[c]), 'readwrite');
    for (const c of COLLECTIONS) for (const o of data[c] || []) if (!drop(o)) wtx.objectStore(c).put(o);
    for (const m of data[META_STORE] || []) wtx.objectStore(META_STORE).put(m);
    await txDone(wtx);
    old.close();
    indexedDB.deleteDatabase(OLD_DB);
  } catch (e) { console.error('Could not move data from the old database', e); old.close(); }
}

export async function init() {
  db = await openMain();
  const has = await req(db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get('settings'));
  if (!has) await moveOldDatabase();
  const tx = db.transaction([...COLLECTIONS, META_STORE], 'readonly');
  await Promise.all(COLLECTIONS.map(async c => { mem[c] = await req(tx.objectStore(c).getAll()); }));
  const saved = (await req(tx.objectStore(META_STORE).get('settings')))?.value || {};
  for (const k of OLD_KEYS) delete saved[k];
  settings = merge(structuredClone(DEFAULT_SETTINGS), saved);
  // small per-browser preferences moved from the old key prefix
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('tj.')) { localStorage.setItem('journal.' + k.slice(3), localStorage.getItem(k)); localStorage.removeItem(k); } } catch {}
  // ask the browser not to evict our data under storage pressure
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16);
}

export const all = c => mem[c];
export const get = (c, id) => mem[c].find(x => x.id === id);

export async function put(c, obj) {
  if (!obj.id) obj.id = uid();
  obj.updatedAt = new Date().toISOString();
  if (!obj.createdAt) obj.createdAt = obj.updatedAt;
  const i = mem[c].findIndex(x => x.id === obj.id);
  if (i >= 0) mem[c][i] = obj; else mem[c].push(obj);
  const tx = db.transaction(c, 'readwrite');
  tx.objectStore(c).put(obj);
  await txDone(tx);
  return obj;
}

export async function putMany(c, objs) {
  const tx = db.transaction(c, 'readwrite');
  const st = tx.objectStore(c);
  const now = new Date().toISOString();
  for (const o of objs) {
    if (!o.id) o.id = uid();
    o.createdAt ||= now; o.updatedAt = now;
    const i = mem[c].findIndex(x => x.id === o.id);
    if (i >= 0) mem[c][i] = o; else mem[c].push(o);
    st.put(o);
  }
  await txDone(tx);
}

export async function del(c, id) {
  mem[c] = mem[c].filter(x => x.id !== id);
  const tx = db.transaction(c, 'readwrite');
  tx.objectStore(c).delete(id);
  await txDone(tx);
}

export async function delWhere(c, pred) {
  const gone = mem[c].filter(pred);
  if (!gone.length) return 0;
  mem[c] = mem[c].filter(x => !pred(x));
  const tx = db.transaction(c, 'readwrite');
  for (const g of gone) tx.objectStore(c).delete(g.id);
  await txDone(tx);
  return gone.length;
}

// ---------- settings ----------
export const getSettings = () => settings;
export async function saveSettings(patch) {
  settings = merge(settings, patch);
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({ key: 'settings', value: settings });
  await txDone(tx);
}

// ---------- backup ----------
const APP_IDS = ['journal', 'ledgerline'];   // backups made under the previous name still restore
export const isOurApp = id => APP_IDS.includes(id);

export function exportBackup() {
  const out = { app: 'journal', version: 1, exportedAt: new Date().toISOString(), settings, data: {} };
  for (const c of COLLECTIONS) out.data[c] = mem[c];
  return out;
}

// Check the whole file before anything is written, so a damaged or crafted file can never
// leave you with half your data deleted.
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const okId = id => (typeof id === 'string' && id.length > 0 && id.length < 200) || Number.isFinite(id);
export function validateBackup(obj) {
  if (!isObj(obj) || !isOurApp(obj.app) || !isObj(obj.data)) throw new Error('This file is not a backup from this app.');
  for (const c of COLLECTIONS) {
    const list = obj.data[c];
    if (list == null) continue;
    if (!Array.isArray(list)) throw new Error(`Backup is damaged ("${c}" is not a list).`);
    for (const o of list) if (!isObj(o) || !okId(o.id)) throw new Error(`Backup is damaged (a record in "${c}" has no id).`);
  }
  if (obj.settings != null && !isObj(obj.settings)) throw new Error('Backup is damaged (settings).');
  return true;
}
// Only known settings, with values the app can actually use (a bad locale or currency would break formatting)
function cleanSettings(s) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS).concat(['fx'])) if (k in s) out[k] = s[k];
  const okIntl = fn => { try { fn(); return true; } catch { return false; } };
  if (out.currency != null && !(out.currency === 'USDT' || (typeof out.currency === 'string' && okIntl(() => new Intl.NumberFormat('en', { style: 'currency', currency: out.currency }))))) delete out.currency;
  if (out.locale != null && !(typeof out.locale === 'string' && okIntl(() => new Intl.NumberFormat(out.locale)))) out.locale = undefined;
  if (!['auto', 'light', 'dark'].includes(out.theme)) delete out.theme;
  if (!['greenred', 'blueorange'].includes(out.pnlColors)) delete out.pnlColors;
  if (!['simple', 'pro'].includes(out.mode)) delete out.mode;
  for (const k of ['backupReminder', 'privacy']) if (k in out && typeof out[k] !== 'boolean') delete out[k];
  const strList = v => Array.isArray(v) && v.every(x => typeof x === 'string');
  for (const k of ['payMethods', 'habits', 'dayTags']) if (k in out && !strList(out[k])) delete out[k];
  if ('categories' in out && out.categories !== null && !(Array.isArray(out.categories) && out.categories.every(c => isObj(c) && typeof c.id === 'string' && typeof c.name === 'string' && (c.subs == null || strList(c.subs))))) delete out.categories;
  for (const k of ['fx', 'plan', 'tour', 'priceApi', 'budgets', 'nav']) if (k in out && !isObj(out[k])) delete out[k];
  if (out.nav) out.nav = { order: Array.isArray(out.nav.order) ? out.nav.order.filter(x => typeof x === 'string').slice(0, 20) : [], collapsed: isObj(out.nav.collapsed) ? Object.fromEntries(Object.entries(out.nav.collapsed).filter(([k, v]) => typeof k === 'string' && v === true).slice(0, 20)) : {} };
  return out;
}

export async function importBackup(obj, { mode = 'replace' } = {}) {
  validateBackup(obj);
  if (mode === 'replace') await clearAll({ keepSettings: true });
  for (const c of COLLECTIONS) if (Array.isArray(obj.data[c]) && obj.data[c].length) {
    const tx = db.transaction(c, 'readwrite');
    for (const o of obj.data[c]) {
      if (o.type === 'income') continue;   // income entries from older versions
      tx.objectStore(c).put(o);
      const i = mem[c].findIndex(x => x.id === o.id);
      if (i >= 0) mem[c][i] = o; else mem[c].push(o);
    }
    await txDone(tx);
  }
  if (obj.settings && mode === 'replace') await saveSettings(cleanSettings(obj.settings));
}

export async function clearAll({ keepSettings = false } = {}) {
  const stores = [...COLLECTIONS, ...(keepSettings ? [] : [META_STORE])];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
  for (const c of COLLECTIONS) mem[c] = [];
  if (!keepSettings) settings = structuredClone(DEFAULT_SETTINGS);
}

// "Delete all data": every record and setting, plus this app's small browser keys
export async function wipeEverything() {
  await clearAll();
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('journal.') || k.startsWith('tj.')) localStorage.removeItem(k); } catch {}
  try { indexedDB.deleteDatabase(OLD_DB); } catch {}
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export async function isPersisted() {
  try { return await navigator.storage.persisted(); } catch { return false; }
}
