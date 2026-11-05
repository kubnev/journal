import { getSettings } from './store.js';

// ---------- escaping / templating ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

// Tagged template: interpolations are escaped unless wrapped with raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(s);
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < vals.length) {
      const v = vals[i];
      if (v instanceof Raw) out += v.s;
      else if (Array.isArray(v)) out += v.map(x => (x instanceof Raw ? x.s : esc(x))).join('');
      else if (v === false || v == null) out += '';
      else out += esc(v);
    }
  });
  return new Raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- number / date formatting ----------
const fmtCache = new Map();
function nf(key, opts) {
  const s = getSettings();
  const k = key + s.currency + (s.locale || '');
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.NumberFormat(s.locale, opts()));
  return fmtCache.get(k);
}
// Privacy mode: amounts become “$•••” everywhere (pages, charts, tooltips), keeping only the currency sign
export const privacyOn = () => !!getSettings().privacy;
export const maskMoney = f => { let done = false; return f.formatToParts(1).map(p => (p.type === 'currency' || p.type === 'literal' ? p.value : done ? '' : (done = true, '•••'))).join('').trim(); };
export function money(v, { sign = false, compact = false, decimals } = {}) {
  if (v == null || !isFinite(v)) return '—';
  if (privacyOn()) { const cur0 = getSettings().currency === 'USDT' ? 'USD' : getSettings().currency || 'USD'; return maskMoney(nf('mask', () => ({ style: 'currency', currency: cur0, maximumFractionDigits: 0 }))); }
  const cur = getSettings().currency === 'USDT' ? 'USD' : getSettings().currency || 'USD';
  const d = decimals ?? (compact ? 1 : Math.abs(v) >= 1000 ? 0 : 2);
  const f = nf(`m${compact}${d}`, () => ({ style: 'currency', currency: cur, notation: compact ? 'compact' : 'standard', minimumFractionDigits: compact ? 0 : d, maximumFractionDigits: d }));
  const s = f.format(Math.abs(v));
  if (v < 0) return '−' + s;
  return (sign && v > 0 ? '+' : '') + s;
}
export function num(v, d = 2, { sign = false } = {}) {
  if (v == null || !isFinite(v)) return '—';
  const s = nf(`n${d}`, () => ({ minimumFractionDigits: d, maximumFractionDigits: d })).format(Math.abs(v));
  if (v < 0) return '−' + s;
  return (sign && v > 0 ? '+' : '') + s;
}
export const pct = (v, d = 1, o) => (v == null || !isFinite(v) ? '—' : num(v * 100, d, o) + '%');
export const rmult = (v, d = 2) => (v == null || !isFinite(v) ? '—' : num(v, d, { sign: true }) + 'R');
export function price(v) {
  if (v == null || v === '' || !isFinite(v)) return '—';
  const a = Math.abs(v);
  const d = a >= 1000 ? 2 : a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return num(+v, d);
}
export function duration(ms) {
  if (ms == null || !isFinite(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ' + (m % 60) + 'm';
  const d = Math.floor(h / 24);
  return d + 'd ' + (h % 24) + 'h';
}

// Dates are handled as local ISO strings: 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm'.
export const pad = n => String(n).padStart(2, '0');
export const dayKey = d => { d = d instanceof Date ? d : new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const monthKey = d => dayKey(d).slice(0, 7);
export const localDT = d => { d = d instanceof Date ? d : new Date(d); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const today = () => dayKey(new Date());
export const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d || 1); };
export function fmtDate(s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!s) return '—';
  const d = s.length <= 10 ? parseDay(s) : new Date(s);
  return d.toLocaleDateString(getSettings().locale, opts);
}
export function fmtDateTime(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString(getSettings().locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export const fmtMonth = k => parseDay(k + '-01').toLocaleDateString(getSettings().locale, { month: 'short', year: 'numeric' });

// P&L class for text colouring
export const pnlClass = v => (v > 0 ? 'pos' : v < 0 ? 'neg' : 'flat');

// ---------- toast ----------
export function toast(msg, kind = 'info') {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.append(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  host.append(t);
  const ms = Math.min(9000, Math.max(2600, msg.length * 55));
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

// ---------- modal ----------
export function modal({ title, body, actions = [], wide = false, onMount }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-wrap';
    wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></header>
      <div class="modal-body">${body}</div>
      <footer>${actions.map((a, i) => `<button class="btn ${a.kind || ''}" data-act="${i}">${esc(a.label)}</button>`).join('')}</footer>
    </div>`;
    const close = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(null); });
    // Enter inside a dialog form = the main button (a real form submit would reload the page)
    const primary = () => wrap.querySelector('footer button:last-child')?.click();
    wrap.addEventListener('submit', e => { e.preventDefault(); primary(); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.matches('input:not([type=checkbox]):not([type=file]), select')) { e.preventDefault(); primary(); } });
    wrap.querySelector('[data-close]').onclick = () => close(null);
    wrap.querySelectorAll('[data-act]').forEach(b => {
      b.onclick = async () => {
        const a = actions[+b.dataset.act];
        const v = a.value ? await a.value(wrap) : a.label;
        if (v === false) return; // validation failed: keep open
        close(v);
      };
    });
    document.body.append(wrap);
    onMount?.(wrap);
    (wrap.querySelector('input,select,textarea') || wrap.querySelector('button')).focus();
  });
}
export const confirmDlg = (title, text, okLabel = 'Delete') =>
  modal({ title, body: `<p>${esc(text)}</p>`, actions: [{ label: 'Cancel' }, { label: okLabel, kind: 'danger', value: () => true }] }).then(v => v === true);

// ---------- misc ----------
export function download(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export const readFileText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f); });

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] ||= []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else if (el.multiple) o[el.name] = [...el.selectedOptions].map(x => x.value);
    else o[el.name] = el.value;
  }
  return o;
}
export const toNum = v => (v === '' || v == null ? null : isFinite(+v) ? +v : null);

// Empty-state card
export const empty = (title, text, action = '') => html`<div class="empty"><div class="empty-title">${title}</div><p>${text}</p>${raw(action)}</div>`;

// Stat tile
export function stat(label, value, { cls = '', sub = '', help = '' } = {}) {
  return html`<div class="stat"><div class="stat-label">${label}${help ? html` <span class="tip" tabindex="0" role="button" aria-label="Help: ${help}" data-tip="${help}">?</span>` : ''}</div><div class="stat-value ${cls}">${value}</div>${sub ? html`<div class="stat-sub">${sub}</div>` : ''}</div>`;
}

// small "estimate" marker next to numbers that still use the starting estimates
export const estTag = (on, what = 'your starting estimate') => (on ? html` <span class="tag est" title="Based on ${what} — replaced by your real average after a full month of logged transactions.">estimate</span>` : '');

// Simple chip-input for tags drawn from a list, allowing new entries
export function chipPicker(name, options, selected = []) {
  const all = [...new Set([...options, ...selected])];
  return html`<div class="chips" data-chips="${name}">${all.map(o => html`<label class="chip"><input type="checkbox" name="${name}" value="${o}" data-multi="1" ${selected.includes(o) ? raw('checked') : ''}><span>${o}</span></label>`)}<input class="chip-add" placeholder="+ add" data-chip-add="${name}"></div>`;
}
export function wireChipAdd(root) {
  root.addEventListener('keydown', e => {
    const inp = e.target.closest('[data-chip-add]');
    if (!inp || (e.key !== 'Enter' && e.key !== ',')) return;
    e.preventDefault();
    const v = inp.value.trim();
    if (!v) return;
    const name = inp.dataset.chipAdd;
    const existing = [...inp.parentElement.querySelectorAll('input[type=checkbox]')].find(c => c.value.toLowerCase() === v.toLowerCase());
    if (existing) existing.checked = true;
    else {
      const l = document.createElement('label');
      l.className = 'chip';
      l.innerHTML = `<input type="checkbox" name="${esc(name)}" value="${esc(v)}" data-multi="1" checked><span>${esc(v)}</span>`;
      inp.before(l);
    }
    inp.value = '';
  });
}

export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
