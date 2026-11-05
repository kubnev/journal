import * as store from './store.js';
import { html, raw, $, $$, esc, toast } from './ui.js';
import { destroyAll } from './charts.js';
import { checkForUpdate, applyUpdate } from './version.js';

import homeView from './home.js';
import settingsView from './settings.js';
import * as SP from './spend/views.js';
import { txnModal } from './spend/txn.js';
import { postDueRecurring } from './spend/calc.js';
import * as N from './networth/views.js';
import { flows } from './networth/flows.js';
import * as J from './journal/views.js';
import { openHelp } from './help.js';
import { cleanupTourDemo } from './tour.js';
import { exportBackupFlow } from './backup.js';
import { initTips } from './tips.js';
import { modeChosen, chooserView } from './mode.js';
import { migrateCurrencies, refreshRates, ensureRates, currenciesInUse, usingFallback } from './fx.js';

// Sidebar navigation: Overview, then the three sections (which you can fold and reorder).
const I = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  grid: 'M3 13h8V3H3zm0 8h8v-6H3zm10 0h8V11h-8zm0-18v6h8V3z',
  wallet: 'M3 7h18v12H3zM3 11h18M16 15h2',
  refresh: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4',
  flow: 'M4 17l6-6 4 4 6-8M14 7h6v6',
  pie: 'M12 3v9h9A9 9 0 1 1 12 3zM15 3.5A9 9 0 0 1 20.5 9H15z',
  star: 'M12 2l3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  cal: 'M5 4h14v16H5zM5 9h14M9 2v4M15 2v4',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  list: 'M4 6h16M4 12h16M4 18h10',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  book: 'M4 4h7v16H4zM13 4h7v16h-7z',
  bank: 'M3 10h18L12 4zM5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  swap: 'M4 8h14l-4-4M20 16H6l4 4',
};
const NAV = [
  { group: null, items: [{ path: '/', label: 'Overview', icon: I.home }] },
  { id: 'networth', group: 'Net worth', items: [
    { path: '/networth', label: 'Net worth', icon: I.grid },
    { path: '/networth/accounts', label: 'Accounts & holdings', icon: I.wallet },
    { path: '/networth/flows', label: 'Money in & out', icon: I.swap },
    { path: '/networth/analytics', label: 'Analytics', icon: I.pie },
  ] },
  { id: 'spending', group: 'Spending', items: [
    { path: '/spending', label: 'Spending', icon: I.chart },
    { path: '/spending/transactions', label: 'Transactions', icon: I.list },
    { path: '/spending/calendar', label: 'Calendar', icon: I.cal },
    { path: '/spending/budgets', label: 'Budgets', icon: I.target },
    { path: '/spending/recurring', label: 'Subscriptions & bills', icon: I.refresh },
    { path: '/spending/categories', label: 'Categories', icon: I.book },
  ] },
  { id: 'journal', group: 'Journal', items: [
    { path: '/journal', label: 'Today', icon: I.pen },
    { path: '/journal/history', label: 'History', icon: I.cal },
    { path: '/journal/insights', label: 'Insights', icon: I.bulb },
  ] },
];
const ALL_ITEMS = NAV.flatMap(g => g.items);
// Sidebar sections can be collapsed and put in any order (settings.nav). Overview always stays on top.
const navPrefs = () => { const n = store.getSettings().nav || {}; return { order: Array.isArray(n.order) ? n.order : [], collapsed: n.collapsed && typeof n.collapsed === 'object' ? n.collapsed : {} }; };
function navGroups() {
  const { order } = navPrefs(), sections = NAV.filter(g => g.id);
  const rank = g => { const i = order.indexOf(g.id); return i < 0 ? 100 + sections.indexOf(g) : i; };
  return [...sections].sort((a, b) => rank(a) - rank(b));
}
const chevron = raw('<svg class="nav-chev" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>');
const grip = raw('<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>');

const ROUTES = [
  [/^\/$/, homeView],
  [/^\/settings$/, settingsView],
  [/^\/spending$/, SP.dashboard],
  [/^\/spending\/transactions$/, SP.transactions],
  [/^\/spending\/calendar$/, SP.calendar],
  [/^\/spending\/budgets$/, SP.budgets],
  [/^\/spending\/recurring$/, SP.recurring],
  [/^\/spending\/categories$/, SP.categories],
  [/^\/networth$/, N.overview],
  [/^\/networth\/accounts$/, N.accounts],
  [/^\/networth\/analytics$/, N.analytics],
  [/^\/networth\/flows$/, flows],
  [/^\/journal$/, J.journalDay],
  [/^\/journal\/history$/, J.history],
  [/^\/journal\/insights$/, J.insights],
];
// old links keep working
const REDIRECTS = { '/networth/update': '/networth/accounts', '/networth/interest': '/networth', '/networth/plan': '/networth/analytics', '/networth/moves': '/networth', '/setup': '/' };

const icon = d => raw(`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`);

export const currentPath = () => (location.hash.replace(/^#/, '').split('?')[0] || '/');
export const query = () => new URLSearchParams(location.hash.split('?')[1] || '');
export const go = path => { location.hash = '#' + path; };


const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = () => { const t = store.getSettings().theme; return t === 'auto' || !t ? (darkMQ.matches ? 'dark' : 'light') : t; };
function applyTheme() {
  const s = store.getSettings();
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('journal.theme', s.theme || 'auto'); } catch {}
  document.documentElement.dataset.pnl = s.pnlColors;
}

const THEME_LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };

function renderShell(path) {
  const s = store.getSettings();
  const mode = s.mode;
  // most specific nav item that matches the current path
  const prefs = navPrefs();
  const link = i => html`<a href="#${i.path}" class="${match === i ? 'active' : ''}">${icon(i.icon)}<span>${i.label}</span></a>`;
  const match = ALL_ITEMS.filter(i => i.path === path || (i.path !== '/' && path.startsWith(i.path + '/'))).sort((a, b) => b.path.length - a.path.length)[0];
  $('#sidebar').innerHTML = String(html`
    <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span><span>Journal</span></a>
    <div class="side-actions"><a class="btn primary" href="#/networth/accounts?update=1" data-tour="update">Update balances</a><button class="btn" data-quick-add data-tour="add" title="Add an expense (shortcut: N)">+ Expense</button></div>
    <nav class="nav" data-tour="nav">${NAV.filter(g => !g.id).flatMap(g => g.items).map(link)}
      ${navGroups().map(g => { const shut = !!prefs.collapsed[g.id], hasActive = g.items.includes(match);
        return html`<div class="nav-section ${shut ? 'shut' : ''}" data-gid="${g.id}">
          <div class="nav-group"><button type="button" class="nav-toggle" data-toggle="${g.id}" aria-expanded="${shut ? 'false' : 'true'}" title="${shut ? 'Show' : 'Hide'} ${g.group} pages">${chevron}<span>${g.group}</span>${shut && hasActive ? html`<i class="nav-dot" aria-hidden="true"></i>` : ''}</button>
            <span class="nav-grip" data-grip="${g.id}" role="button" tabindex="0" title="Drag to move this section (or use ↑ ↓)" aria-label="Move the ${g.group} section">${grip}</span></div>
          <div class="nav-items">${g.items.filter(i => !shut || i === match).map(link)}</div></div>`; })}</nav>
    <div class="sidebar-foot">
      <a href="#/settings" data-tour="settings" class="${path === '/settings' ? 'active' : ''}">${icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z')}<span>Settings & data</span></a>
      <div class="theme-switch" role="radiogroup" aria-label="Theme">${['light', 'dark', 'auto'].map(t => html`<button role="radio" data-theme-set="${t}" aria-checked="${(s.theme || 'auto') === t}">${THEME_LABEL[t]}</button>`)}</div>
      <div class="mode-badge" data-tour="mode" title="How much detail the forms ask for. Every page and chart is the same in both.">Input mode: <b>${mode === 'pro' ? 'Pro' : 'Simple'}</b> · <a href="#/settings">change</a></div>
    </div>`);
  $$('[data-theme-set]').forEach(b => b.onclick = async () => { await store.saveSettings({ theme: b.dataset.themeSet }); route(); });
  wireNav(path);
}

async function saveNav(patch) {
  const cur = navPrefs();
  await store.saveSettings({ nav: null });   // replace, so removed keys really go away
  await store.saveSettings({ nav: { ...cur, ...patch } });
}
function wireNav(path) {
  const nav = $('#sidebar .nav');
  nav.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    const id = b.dataset.toggle, collapsed = { ...navPrefs().collapsed };
    if (collapsed[id]) delete collapsed[id]; else collapsed[id] = true;
    await saveNav({ collapsed }); renderShell(path);
  });
  const saveOrder = async () => { await saveNav({ order: [...nav.querySelectorAll('.nav-section')].map(x => x.dataset.gid) }); renderShell(path); };
  nav.querySelectorAll('[data-grip]').forEach(h => {
    const sec = h.closest('.nav-section');
    // keyboard: ↑ / ↓ moves the section
    h.onkeydown = e => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const sib = e.key === 'ArrowUp' ? sec.previousElementSibling : sec.nextElementSibling;
      if (!sib?.classList.contains('nav-section')) return;
      if (e.key === 'ArrowUp') sib.before(sec); else sib.after(sec);
      const id = sec.dataset.gid;
      saveOrder().then(() => $(`#sidebar [data-grip="${id}"]`)?.focus());
    };
    // mouse & touch: drag the handle; the other sections make room as you go
    h.onpointerdown = e => {
      if (e.button > 0) return;
      e.preventDefault();
      sec.classList.add('dragging');
      const y0 = e.clientY; let moved = false;
      const move = ev => {
        const dy = ev.clientY - y0;
        if (Math.abs(dy) > 3) moved = true;
        const others = [...nav.querySelectorAll('.nav-section')].filter(x => x !== sec);
        const target = others.find(x => { const r = x.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
        if (target) { if (target !== sec.nextElementSibling) target.before(sec); }
        else if (others.length && others.at(-1) !== sec.previousElementSibling) others.at(-1).after(sec);
      };
      const up = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', up);
        sec.classList.remove('dragging');
        if (moved) saveOrder();
      };
      // listen on the document: moving the section in the DOM would drop pointer capture on the handle
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', up);
    };
  });
}

// Switching light ↔ dark cross-fades the whole page (charts included) instead of snapping.
// View Transitions where available, a short colour transition otherwise; off for reduced motion.
async function themeFade(update) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return update();
  if (document.startViewTransition) { const vt = document.startViewTransition(update); await vt.updateCallbackDone.catch(() => {}); return; }
  const root = document.documentElement;
  root.classList.add('theme-fading');
  try { await update(); } finally { setTimeout(() => root.classList.remove('theme-fading'), 450); }
}

let cleanup = null;
let routing = false, again = false, dirty = false, fading = false;
export async function route() {
  if (!fading && !routing && document.documentElement.dataset.theme && resolvedTheme() !== document.documentElement.dataset.theme) {
    fading = true;
    try { await themeFade(() => route()); } finally { fading = false; }
    return;
  }
  if (routing) { again = true; return; }
  routing = true; again = false; dirty = false;
  try {
    const path = currentPath();
    if (REDIRECTS[path]) { routing = false; location.replace('#' + REDIRECTS[path] + (location.hash.includes('?') ? '?' + location.hash.split('?')[1] : '')); return; }
    applyTheme();
    renderShell(path);
    destroyAll();
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    const main = $('#main');
    let view = null, params = [];
    for (const [re, v] of ROUTES) { const m = path.match(re); if (m) { view = v; params = m.slice(1); break; } }
    document.body.classList.toggle('home', path === '/');
    main.innerHTML = '';
    const page = document.createElement('div');
    page.className = 'page';
    main.append(page);
    // first launch: choose Simple or Pro input, then straight in
    if (!modeChosen()) { chooserView(page, () => route()); return; }
    if (!view) { page.innerHTML = `<h1>Not found</h1><p><a href="#/">Go home</a></p>`; return; }
    cleanup = await view(page, params, { mode: store.getSettings().mode });
    notices(page);
    main.scrollTop = 0;
    window.scrollTo(0, 0);
    const h = page.querySelector('h1');
    document.title = (h ? h.textContent + ' · ' : '') + 'Journal';
    // a newly used currency gets real exchange rates without needing a reload
    ensureRates().then(r => { if (r && !r.skipped && r.ok) softRoute(); }).catch(() => {});
  } catch (e) {
    console.error(e);
    $('#main').innerHTML = `<div class="page"><h1>Something went wrong</h1><pre class="err">${esc(e.stack || e.message)}</pre></div>`;
  } finally { routing = false; if (again) route(); }
}
// Background re-render (rates loaded, update found): never wipe a half-filled form or an open dialog
function softRoute() {
  if (dirty || document.querySelector('.modal-wrap')) return false;
  route(); return true;
}

// ---------- notices: backup reminder, new version, exchange rates ----------
let updateInfo = null;
const dismissed = new Set();
function notices(page, only) {
  const s = store.getSettings();
  const own = c => store.all(c).some(x => !x.demo);
  const hasData = own('txns') || own('nwAccounts');
  const stale = !s.lastBackupAt || Date.now() - new Date(s.lastBackupAt) > 7 * 864e5;
  const items = [];
  if (currenciesInUse().length && usingFallback() && !dismissed.has('fx')) items.push(['fx', 'Exchange rates haven\'t loaded yet — other currencies are converted with approximate rates.', 'Retry']);
  if (s.reviewAccounts && s.mode === 'pro' && currentPath().startsWith('/networth')) items.push(['review', 'You switched to Pro input: check your accounts\' categories, custody, purpose and liquidity so analytics are accurate.', 'Review accounts']);
  if (updateInfo?.available && !dismissed.has('update')) items.push(['update', `Version ${updateInfo.latest} is available.`, 'Load it now']);
  if (hasData && stale && s.backupReminder !== false && !dismissed.has('backup')) items.push(['backup', s.lastBackupAt ? `Last backup was ${Math.floor((Date.now() - new Date(s.lastBackupAt)) / 864e5)} days ago. Your data only lives in this browser.` : 'You haven\'t backed up yet. Your data only lives in this browser.', 'Back up now']);
  for (const [k, text, label] of items) {
    if (only && k !== only) continue;
    const d = document.createElement('div');
    d.className = 'notice';
    d.innerHTML = `<span>${text}</span><span class="spacer"></span><button class="btn sm primary" data-n="${k}">${label}</button><button class="btn sm ghost" data-x="${k}">Later</button>${k === 'backup' ? '<button class="btn sm ghost" data-never>Don\'t remind me</button>' : ''}`;
    d.querySelector('[data-never]')?.addEventListener('click', async () => { await store.saveSettings({ backupReminder: false }); d.remove(); toast('Backup reminders off. Turn them back on in Settings → Backup & restore.'); });
    d.querySelector('[data-n]').onclick = async () => {
      if (k === 'update') return applyUpdate(updateInfo.files);
      if (k === 'review') { await store.saveSettings({ reviewAccounts: false }); return currentPath() === '/networth/accounts' ? route() : go('/networth/accounts'); }
      if (k === 'fx') { const r = await refreshRates({ force: true }); toast(r.ok ? 'Exchange rates loaded' : 'Still offline: ' + (r.errors || []).join(' '), r.ok ? 'info' : 'error'); return route(); }
      if (await exportBackupFlow()) d.remove();
    };
    d.querySelector('[data-x]').onclick = () => { dismissed.add(k); d.remove(); if (k === 'review') store.saveSettings({ reviewAccounts: false }); };
    page.prepend(d);
  }
}

// Re-render the current view (used after data changes that the view doesn't handle itself)
export const refresh = () => route();

// ---------- privacy mode: every amount shows as “$•••” ----------
const EYE = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
function paintPrivacy() {
  const on = !!store.getSettings().privacy;
  document.body.classList.toggle('privacy', on);
  $$('[data-privacy]').forEach(b => { b.innerHTML = on ? EYE_OFF : EYE; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('on', on); b.title = on ? 'Show amounts (H)' : 'Hide amounts — privacy mode (H)'; });
}
async function togglePrivacy() {
  await store.saveSettings({ privacy: !store.getSettings().privacy });
  paintPrivacy();
  if (!softRoute()) toast(store.getSettings().privacy ? 'Privacy on — the page hides amounts once you close this dialog' : 'Privacy off');
}

async function boot() {
  try { await store.init(); }
  catch (e) {
    $('#main').innerHTML = `<div class="page"><h1>Storage unavailable</h1><p>This browser blocked local storage (IndexedDB). Private/incognito windows in some browsers do this. Your data can only be saved when local storage is allowed.</p><pre class="err">${esc(e.message)}</pre></div>`;
    return;
  }
  applyTheme();
  initTips();
  // In Auto mode, follow OS light/dark changes live (charts re-render with new colours)
  darkMQ.addEventListener('change', () => { if ((store.getSettings().theme || 'auto') === 'auto' && !softRoute()) themeFade(applyTheme); });
  window.addEventListener('hashchange', route);
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (window.innerWidth < 900) document.body.classList.remove('nav-open'); }, 150); });
  $('#menu-btn').onclick = () => document.body.classList.toggle('nav-open');
  $$('[data-help]').forEach(b => b.onclick = () => openHelp(currentPath()));
  document.addEventListener('keydown', e => { if (e.key === '?' && !e.target.closest('input,textarea,select')) openHelp(currentPath()); });
  paintPrivacy();
  $$('[data-privacy]').forEach(b => b.onclick = togglePrivacy);
  document.addEventListener('keydown', e => { if ((e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input,textarea,select,[contenteditable]') && !document.querySelector('.modal-wrap')) { e.preventDefault(); togglePrivacy(); } });
  $('#sidebar').addEventListener('click', e => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
  // quick add from anywhere: sidebar / top-bar button or the N key
  const quickAdd = async () => { document.body.classList.remove('nav-open'); if (!modeChosen() || document.querySelector('.modal-wrap')) return; if (await txnModal()) route(); };
  document.addEventListener('click', e => { if (e.target.closest('[data-quick-add]')) quickAdd(); });
  document.addEventListener('keydown', e => { if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.target.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); quickAdd(); } });
  // tag records that predate per-record currencies, clear an unfinished tour's sample data, add bills that came due
  try { await migrateCurrencies(); } catch (e) { console.error(e); }
  try { await cleanupTourDemo(); } catch (e) { console.error(e); }
  try { await postDueRecurring(); } catch (e) { console.error(e); }
  route();
  $('#main').addEventListener('input', () => { dirty = true; });
  // Surface unexpected errors instead of failing silently. Benign browser noise is ignored.
  window.addEventListener('error', e => { const m = e.message || ''; if (/ResizeObserver|^Script error/.test(m)) return; toast('Something went wrong: ' + (m || 'unknown error'), 'error'); });
  window.addEventListener('unhandledrejection', e => toast('Something went wrong: ' + (e.reason?.message || e.reason || 'unknown error'), 'error'));
  // Quietly check for a newer deployed version
  setTimeout(async () => { try { updateInfo = await checkForUpdate(); if (updateInfo.available && !softRoute()) { const pg = $('#main .page'); if (pg) notices(pg, 'update'); } } catch {} }, 4000);
}
boot();
