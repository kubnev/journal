// Guided tour of the real pages. With no data of your own it loads sample data first so every chart
// has something in it, and removes it again when the tour ends.
import * as store from './store.js';
import { esc } from './ui.js';
import { loadDemo, removeDemo } from './demo.js';

const STEPS = [
  { title: 'Welcome to Journal', text: 'A private tracker for <b>what you own</b>, <b>where your money goes</b> and a short daily journal. This tour uses <b>sample data</b> so every chart has something in it; it\'s deleted when the tour ends.' },
  { route: '/', sel: '[data-tour=nw-stats]', title: 'Your money at a glance', text: 'Net worth and how it changed, what you could reach within days (liquid net worth) and an estimate of the interest your accounts earn.' },
  { route: '/', sel: '[data-tour=nw-chart]', title: 'Updates build the trend', text: 'Each time you update a balance, that day is kept as history and the line grows. Every few weeks or monthly is plenty.' },
  { route: '/networth/accounts', sel: '.acct-group', up: null, title: 'Accounts & holdings', text: 'Everything you own and owe, grouped by type. Each account keeps its own currency; crypto and stocks can list holdings with live prices.' },
  { route: '/networth/accounts', sel: '[data-upd]', title: 'Update a balance', text: '<b>Update</b> records today\'s value and keeps the old one as history. <b>Edit</b> changes the account itself (name, type, APY). <b>Update all</b> does every account at once.' },
  { route: '/networth', sel: '[data-tour=interest]', title: 'Interest — estimated', text: 'What your accounts would earn per day, month and year at their APY, and what your debts cost. Balances never change on their own — you update them.' },
  { route: '/networth/analytics', sel: '[data-tour=health]', title: 'Analytics', text: 'Where your money is held, what it\'s for, how liquid and concentrated it is, and your target allocation.' },
  { route: '/spending', sel: '#s-pace', up: '.card', title: 'Spending, month by month', text: 'Spending through the month vs last month and your budget. A month-end projection appears from day 7.' },
  { route: '/spending', sel: '.topbar [data-quick-add], [data-tour=add]', title: 'Log an expense in seconds', text: 'Amount, category, done — from any page with this button or the <kbd>N</kbd> key. Optionally take it off the account it was paid from.' },
  { route: '/spending/recurring', sel: '#main .tabs', title: 'Subscriptions & bills', text: 'Each subscription with the day it\'s charged — added automatically, with monthly and yearly totals.' },
  { route: '/journal', sel: '#jf fieldset', title: 'Journal', text: 'A two-minute daily check-in: mood, energy, stress, sleep, habits and what\'s on your mind.' },
  { route: '/journal/insights', sel: '[data-tour=mood-spend]', title: 'How you feel vs what you spend', text: 'Compares your everyday spending on good and bad days, calm and stressed days.' },
  { route: '/settings', sel: '[data-act=export]', title: 'Back up', text: 'Your data lives only in this browser. Export a password-protected backup now and then.' },
  { sel: '[data-tour=help]', title: 'Help any time', text: 'Press <b>?</b> for help about the page you\'re on. That\'s it — the sample data is removed when you click Done.' },
];

let tourEl = null, step = 0, withDemo = false, token = 0;
const hasOwnData = () => ['nwAccounts', 'txns', 'recurring', 'nwSnapshots', 'nwFlows', 'days'].some(c => store.all(c).some(x => !x.demo));

export async function startTour({ demo = true } = {}) {
  await endTour({ silent: true });
  step = 0;
  // sample data only when there's nothing of the user's own to show
  withDemo = demo && !hasOwnData();
  if (withDemo) { await loadDemo(); await store.saveSettings({ tourDemo: true }); window.dispatchEvent(new HashChangeEvent('hashchange')); await new Promise(r => setTimeout(r, 150)); }
  tourEl = document.createElement('div');
  tourEl.className = 'tour';
  tourEl.innerHTML = '<div class="tour-spot"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
  document.body.append(tourEl);
  window.addEventListener('resize', place);
  document.addEventListener('keydown', tourKeys);
  show();
}
function tourKeys(e) { if (e.key === 'Escape') endTour(); if (e.key === 'ArrowRight') next(1); if (e.key === 'ArrowLeft') next(-1); }
function next(d) { step += d; if (step < 0) step = 0; if (step >= STEPS.length) { endTour(); return; } show(); }

const currentPath = () => location.hash.replace(/^#/, '').split('?')[0] || '/';
async function waitFor(sel, ms = 2500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const e = sel && [...document.querySelectorAll(sel)].find(x => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden' && !x.closest('.tour')); if (e) return e; await new Promise(r => setTimeout(r, 60)); }
  return null;
}
async function show() {
  const my = ++token;
  const s = STEPS[step];
  const card = tourEl.querySelector('.tour-card');
  card.innerHTML = `<div class="small muted">${step + 1} / ${STEPS.length}${withDemo ? ' · sample data' : ''}</div><h2>${esc(s.title)}</h2><p>${s.text}</p>
    <div class="row"><button class="btn ghost sm" data-skip>${step === STEPS.length - 1 ? 'Close' : 'End tour'}</button><span class="spacer"></span>
    ${step ? '<button class="btn sm" data-back>Back</button>' : ''}<button class="btn primary sm" data-next>${step === STEPS.length - 1 ? (withDemo ? 'Done — start fresh' : 'Done') : 'Next'}</button></div>`;
  card.querySelector('[data-next]').onclick = () => next(1);
  card.querySelector('[data-back]')?.addEventListener('click', () => next(-1));
  card.querySelector('[data-skip]').onclick = () => endTour();
  card.querySelector('[data-next]').focus();
  if (s.route && currentPath() !== s.route) { location.hash = '#' + s.route; await new Promise(r => setTimeout(r, 250)); if (my !== token) return; }
  const mobile = window.innerWidth <= 900;
  document.body.classList.toggle('nav-open', mobile && !!s.sel && /\.nav /.test(s.sel));
  let target = s.sel ? await waitFor(s.sel) : null;
  if (my !== token || !tourEl) return;
  if (target && s.up) target = target.closest(s.up) || target;
  current = target;
  if (target) target.scrollIntoView({ block: 'center', behavior: 'instant' });
  setTimeout(place, 30);
}
let current = null;
function place() {
  if (!tourEl) return;
  const spot = tourEl.querySelector('.tour-spot'), card = tourEl.querySelector('.tour-card');
  // the page may have re-rendered since the step started — find the element again
  if (current && !document.contains(current)) { const s = STEPS[step]; const e = s?.sel && [...document.querySelectorAll(s.sel)].find(x => x.getClientRects().length && !x.closest('.tour')); current = e && s.up ? e.closest(s.up) || e : e || null; }
  const target = current;
  const cw = Math.min(360, window.innerWidth - 24);
  if (!target) { spot.style.cssText = 'left:50%;top:40%;width:0;height:0'; card.style.cssText = `left:50%;top:40%;transform:translate(-50%,-50%);width:${cw}px`; return; }
  const r = target.getBoundingClientRect(), pad = 6;
  spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
  const ch = card.offsetHeight || 200;
  let left, top;
  if (window.innerWidth > 900 && r.right + 16 + cw < window.innerWidth - 12) { left = r.right + 16; top = r.top; }
  else if (window.innerWidth > 900 && r.left - cw - 16 > 12) { left = r.left - cw - 16; top = r.top; }
  else { left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left)); top = r.bottom + 14 + ch > window.innerHeight ? Math.max(12, r.top - ch - 14) : r.bottom + 14; }
  top = Math.max(12, Math.min(top, window.innerHeight - ch - 12));
  card.style.cssText = `left:${left}px;top:${top}px;width:${cw}px`;
}
export async function endTour({ silent = false } = {}) {
  const had = !!tourEl;
  token++;
  tourEl?.remove(); tourEl = null; current = null;
  document.body.classList.remove('nav-open');
  window.removeEventListener('resize', place);
  document.removeEventListener('keydown', tourKeys);
  if (!had && silent) return;
  await store.saveSettings({ tour: { done: true } });
  if (store.getSettings().tourDemo) { await removeDemo(); await store.saveSettings({ tourDemo: false }); }
  withDemo = false;
  if (!silent) { if (currentPath() !== '/') location.hash = '#/'; else window.dispatchEvent(new HashChangeEvent('hashchange')); }
}
// Sample data left behind by a tour that never finished (tab closed mid-tour) is cleaned up on the next visit
export async function cleanupTourDemo() {
  if (store.getSettings().tourDemo && !tourEl) { await removeDemo(); await store.saveSettings({ tourDemo: false }); return true; }
  return false;
}
