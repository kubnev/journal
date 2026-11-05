// Local-first persistence. Everything lives in this browser's IndexedDB.
// Collections are loaded into memory at startup; writes go through to IDB.

const DB_NAME = 'ledgerline';
const DB_VERSION = 4;

export const COLLECTIONS = [
  'nwAccounts',    // net worth: assets & liabilities
  'nwSnapshots',   // net worth: dated balance snapshots
  'nwMoves',       // legacy: planned transfers (feature removed in v1.4; kept so old backups import)
  'nwFlows',       // net worth: money you put into / took out of an account (deposits & withdrawals)
  'txns',          // spending: expenses, one record per transaction
  'recurring',     // spending: bills & subscriptions that repeat
  'days',          // journal: one entry per day (id = YYYY-MM-DD)
  'nwCashflow',    // legacy monthly totals — converted to transactions on load, kept so old backups import
];
// Stores from the old trading-journal version. Never deleted (your data stays in the browser), just not used.
export const LEGACY_STORES = ['trades', 'tAccounts', 'tTransfers', 'setups'];
const BLOB_STORE = 'images';
const META_STORE = 'meta';

export const DEFAULT_SETTINGS = {
  theme: 'auto',                  // 'auto' follows the OS setting
  currency: 'USD',
  locale: undefined,
  pnlColors: 'greenred',          // or 'blueorange' (colour-vision friendly)
  priceApi: { finnhubKey: '', lastUpdate: null },
  lastBackupAt: null,
  mode: 'simple',                 // 'simple' | 'pro' — how much detail you enter
  categories: null,               // null → built-in list (spend/categories.js); otherwise your edited list
  budgets: { total: 0, byCat: {} },   // monthly limits in the display currency
  payMethods: ['Debit card', 'Credit card', 'Cash', 'Bank transfer', 'Apple / Google Pay', 'Revolut', 'PayPal'],
  tour: { done: false },
  plan: {
    targetAllocation: {},         // category → %
    emergencyMonths: 6,
  },
  habits: ['Exercise', 'Outside / walk', 'Read', 'No alcohol', 'Screen off before bed'],
  nav: { order: [], collapsed: {} },
  backupReminder: true,           // weekly “back up” notice
  privacy: false,                 // hide amounts (for using the app in public)   // sidebar: section order and which sections are collapsed
  dayTags: ['Stressed', 'Calm', 'Social', 'Productive', 'Tired', 'Sick'],
};

let db = null;
const mem = {};
let settings = structuredClone(DEFAULT_SETTINGS);
const listeners = new Set();

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const c of [...COLLECTIONS, BLOB_STORE]) if (!d.objectStoreNames.contains(c)) d.createObjectStore(c, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null ? merge(base[k], over[k]) : over[k];
  }
  return out;
}

export async function init() {
  db = await open();
  const tx = db.transaction([...COLLECTIONS, META_STORE], 'readonly');
  await Promise.all(COLLECTIONS.map(async c => { mem[c] = await req(tx.objectStore(c).getAll()); }));
  const s = await req(tx.objectStore(META_STORE).get('settings'));
  const saved = s?.value || {};
  // migrate the old per-section switches to the single global one
  if (!saved.mode && (saved.tradingMode || saved.networthMode)) saved.mode = saved.tradingMode === 'pro' || saved.networthMode === 'pro' ? 'pro' : 'simple';
  delete saved.tradingMode; delete saved.networthMode;
  delete saved.tagLists;   // trading setting from older versions
  if (saved.plan) for (const k of ['annualExpenses', 'withdrawalRate', 'expectedReturn', 'inflation', 'currentAge', 'retirementAge', 'monthlyContribution']) delete saved.plan[k];
  settings = merge(structuredClone(DEFAULT_SETTINGS), saved);
  // Ask the browser not to evict our data under storage pressure.
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
}

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) fn(what); }

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
  emit(c);
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
  emit(c);
}

export async function del(c, id) {
  mem[c] = mem[c].filter(x => x.id !== id);
  const tx = db.transaction(c, 'readwrite');
  tx.objectStore(c).delete(id);
  await txDone(tx);
  emit(c);
}

export async function delWhere(c, pred) {
  const gone = mem[c].filter(pred);
  if (!gone.length) return 0;
  mem[c] = mem[c].filter(x => !pred(x));
  const tx = db.transaction(c, 'readwrite');
  for (const g of gone) tx.objectStore(c).delete(g.id);
  await txDone(tx);
  emit(c);
  return gone.length;
}

function txDone(tx) {
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}

// ---------- settings ----------
export const getSettings = () => settings;
export async function saveSettings(patch) {
  settings = merge(settings, patch);
  const tx = db.transaction(META_STORE, 'readwrite');
  tx.objectStore(META_STORE).put({ key: 'settings', value: settings });
  await txDone(tx);
  emit('settings');
}

// ---------- images (screenshots) ----------
export async function putImage(blob) {
  const id = uid();
  const tx = db.transaction(BLOB_STORE, 'readwrite');
  tx.objectStore(BLOB_STORE).put({ id, blob, type: blob.type, createdAt: new Date().toISOString() });
  await txDone(tx);
  return id;
}
export async function getImage(id) {
  const tx = db.transaction(BLOB_STORE, 'readonly');
  const r = await req(tx.objectStore(BLOB_STORE).get(id));
  return r?.blob || null;
}
export async function delImage(id) {
  const tx = db.transaction(BLOB_STORE, 'readwrite');
  tx.objectStore(BLOB_STORE).delete(id);
  await txDone(tx);
}
async function allImages() {
  const tx = db.transaction(BLOB_STORE, 'readonly');
  return req(tx.objectStore(BLOB_STORE).getAll());
}

// Read a store left over from an older version (for one-time migrations)
export async function readLegacy(name) {
  if (!db.objectStoreNames.contains(name)) return [];
  const tx = db.transaction(name, 'readonly');
  return req(tx.objectStore(name).getAll());
}

// ---------- backup ----------
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
// decoded by hand (no fetch), so the page never needs to load anything from a URL in a backup
const dataURLToBlob = async u => {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(u);
  if (!m) throw new Error('Backup is damaged (an image is not a valid picture).');
  const bin = atob(m[2]); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: m[1] });
};

export async function exportBackup({ includeImages = true } = {}) {
  const out = { app: 'ledgerline', version: 1, exportedAt: new Date().toISOString(), settings, data: {} };
  for (const c of COLLECTIONS) out.data[c] = mem[c];
  if (includeImages) {
    out.images = [];
    for (const im of await allImages()) out.images.push({ id: im.id, data: await blobToDataURL(im.blob) });
  }
  return out;
}

// Check the whole file before anything is written, so a damaged or crafted file can never
// leave you with half your data deleted.
const isObj = o => o && typeof o === 'object' && !Array.isArray(o);
const okId = id => (typeof id === 'string' && id.length > 0 && id.length < 200) || Number.isFinite(id);
export function validateBackup(obj) {
  if (!isObj(obj) || obj.app !== 'ledgerline' || !isObj(obj.data)) throw new Error('This file is not a backup from this app.');
  for (const c of COLLECTIONS) {
    const list = obj.data[c];
    if (list == null) continue;
    if (!Array.isArray(list)) throw new Error(`Backup is damaged ("${c}" is not a list).`);
    for (const o of list) if (!isObj(o) || !okId(o.id)) throw new Error(`Backup is damaged (a record in "${c}" has no id).`);
  }
  if (obj.images != null) {
    if (!Array.isArray(obj.images)) throw new Error('Backup is damaged (images).');
    for (const im of obj.images) if (!isObj(im) || !okId(im.id) || typeof im.data !== 'string' || !/^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(im.data)) throw new Error('Backup is damaged (an image is not a valid picture).');
  }
  if (obj.settings != null && !isObj(obj.settings)) throw new Error('Backup is damaged (settings).');
  return true;
}
// Only known settings, with values the app can actually use (a bad locale or currency would break formatting)
function cleanSettings(s) {
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS).concat(['fx', 'plan', 'tour', 'estimates'])) if (k in s) out[k] = s[k];
  const okIntl = (fn) => { try { fn(); return true; } catch { return false; } };
  if (out.currency != null && !(out.currency === 'USDT' || (typeof out.currency === 'string' && okIntl(() => new Intl.NumberFormat('en', { style: 'currency', currency: out.currency }))))) delete out.currency;
  if (out.locale != null && !(typeof out.locale === 'string' && okIntl(() => new Intl.NumberFormat(out.locale)))) out.locale = undefined;
  if (!['auto', 'light', 'dark'].includes(out.theme)) delete out.theme;
  if (!['greenred', 'blueorange'].includes(out.pnlColors)) delete out.pnlColors;
  if (!['simple', 'pro'].includes(out.mode)) delete out.mode;
  for (const k of ['backupReminder', 'privacy']) if (k in out && typeof out[k] !== 'boolean') delete out[k];
  const strList = v => Array.isArray(v) && v.every(x => typeof x === 'string');
  for (const k of ['payMethods', 'habits', 'dayTags']) if (k in out && !strList(out[k])) delete out[k];
  if ('categories' in out && out.categories !== null && !(Array.isArray(out.categories) && out.categories.every(c => isObj(c) && typeof c.id === 'string' && typeof c.name === 'string' && (c.subs == null || strList(c.subs))))) delete out.categories;
  for (const k of ['fx', 'plan', 'tour', 'priceApi', 'budgets', 'estimates', 'nav']) if (k in out && !isObj(out[k])) delete out[k];
  if (out.nav) out.nav = { order: Array.isArray(out.nav.order) ? out.nav.order.filter(x => typeof x === 'string').slice(0, 20) : [], collapsed: isObj(out.nav.collapsed) ? Object.fromEntries(Object.entries(out.nav.collapsed).filter(([k, v]) => typeof k === 'string' && v === true).slice(0, 20)) : {} };
  return out;
}

export async function importBackup(obj, { mode = 'replace' } = {}) {
  validateBackup(obj);
  // decode images first: if one fails, nothing has been deleted yet
  const images = [];
  for (const im of obj.images || []) images.push({ id: im.id, blob: await dataURLToBlob(im.data) });
  if (mode === 'replace') await clearAll({ keepSettings: true });
  for (const c of COLLECTIONS) if (Array.isArray(obj.data[c]) && obj.data[c].length) {
    const tx = db.transaction(c, 'readwrite');
    for (const o of obj.data[c]) {
      tx.objectStore(c).put(o);
      const i = mem[c].findIndex(x => x.id === o.id);
      if (i >= 0) mem[c][i] = o; else mem[c].push(o);
    }
    await txDone(tx);
  }
  for (const { id, blob } of images) {
    const tx = db.transaction(BLOB_STORE, 'readwrite');
    tx.objectStore(BLOB_STORE).put({ id, blob, type: blob.type });
    await txDone(tx);
  }
  if (obj.settings && mode === 'replace') await saveSettings(cleanSettings(obj.settings));
  emit('*');
}

export async function clearAll({ keepSettings = false } = {}) {
  const stores = [...COLLECTIONS, BLOB_STORE, ...(keepSettings ? [] : [META_STORE])];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) tx.objectStore(s).clear();
  await txDone(tx);
  for (const c of COLLECTIONS) mem[c] = [];
  if (!keepSettings) settings = structuredClone(DEFAULT_SETTINGS);
  emit('*');
}

// "Delete all data": every record, screenshot and setting, plus this app's small browser keys
export async function wipeEverything() {
  await clearAll();
  const legacy = LEGACY_STORES.filter(n => db.objectStoreNames.contains(n));
  if (legacy.length) { const tx = db.transaction(legacy, 'readwrite'); for (const n of legacy) tx.objectStore(n).clear(); await txDone(tx); }
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('tj.')) localStorage.removeItem(k); } catch {}
}

export async function storageEstimate() {
  try { return await navigator.storage.estimate(); } catch { return null; }
}
export async function isPersisted() {
  try { return await navigator.storage.persisted(); } catch { return false; }
}
