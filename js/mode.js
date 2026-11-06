// Simple vs Pro is a choice of how you ENTER information, not of what you can see.
// Every page, chart and report is the same in both. Chosen once at first launch; changeable in Settings.
import * as store from './store.js';
import { html, modal, toast } from './ui.js';

const SIMPLE = {
  title: 'Simple',
  lead: 'Quick, plain-language input.',
  points: [
    'Accounts are one of six types: Savings, Investments, Trading capital, Assets, Cash, Debt',
    'Expenses: amount, category, date, a short note — and optionally the account it came from',
    'Subscriptions & bills: name, amount, charge day, account',
    'Everything else (liquidity, custody, purpose…) is worked out for you',
  ],
};
const PRO = {
  title: 'Pro',
  lead: 'Detailed input for deeper analysis.',
  points: [
    '11 asset and 8 debt categories (retirement, real estate, vehicles, mortgage…)',
    'Set institution, custody, purpose and liquidity per account',
    'Expenses: subcategory, merchant, payment method, tags, need/want, repeats',
    'Journal: what went well / was hard, and tags',
  ],
};
const card = (m, id, current) => html`<button type="button" class="mode-card ${current === id ? 'on' : ''}" data-pick="${id}">
  <span class="mode-title">${m.title}${current === id ? html` <span class="tag accent">current</span>` : ''}</span><span class="mode-lead">${m.lead}</span>
  <ul>${m.points.map(p => html`<li>${p}</li>`)}</ul></button>`;

export const modeChosen = () => !!store.getSettings().modeChosen;
export const modeName = () => (store.getSettings().mode === 'pro' ? 'Pro' : 'Simple');

// First launch: a deliberate choice, or the tour first
export function chooserView(el, onDone) {
  el.innerHTML = String(html`<div class="mode-choose">
    <h1>How do you want to enter your data?</h1>
    <p class="muted">Both show every chart, report and analysis. The difference is how much detail you fill in when you add an account or an expense. You can change this later in Settings.</p>
    <div class="mode-cards">${card(SIMPLE, 'simple')}${card(PRO, 'pro')}</div>
    <button type="button" class="tour-pick" data-tour-pick>
      <span class="tour-pick-ic" aria-hidden="true">▶</span>
      <span class="tour-pick-text"><span class="mode-title">Show me around first</span><span class="mode-lead">A 1-minute tour of every page on sample data, removed when it ends. Starts in Simple — switch any time.</span></span>
      <span class="tour-pick-go" aria-hidden="true">Start tour →</span>
    </button>
    <p class="small muted">Not sure? Pick Simple — you can upgrade any time without losing anything.</p></div>`);
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
    await store.saveSettings({ mode: b.dataset.pick, modeChosen: true });
    onDone();
  });
  el.querySelector('[data-tour-pick]').onclick = async () => {
    await store.saveSettings({ mode: 'simple', modeChosen: true });
    location.hash = '#/';
    onDone();
    (await import('./tour.js')).startTour();
  };
}

// Settings card
export function modeCard() {
  const cur = store.getSettings().mode === 'pro' ? 'pro' : 'simple';
  return html`<div class="card" id="mode-card"><div class="card-head"><h2>Input mode</h2><span class="hint">currently ${modeName()}</span></div>
    <p class="small muted">Changes how much you fill in — not what you can see. Every page and chart is available in both.</p>
    <div class="mode-cards compact">${card(SIMPLE, 'simple', cur)}${card(PRO, 'pro', cur)}</div></div>`;
}

export async function switchMode(to) {
  const from = store.getSettings().mode === 'pro' ? 'pro' : 'simple';
  if (to === from) return false;
  const nAcc = store.all('nwAccounts').length;
  const body = to === 'pro'
    ? `<p>Pro splits your accounts into finer categories — e.g. <b>Investments</b> becomes taxable investments, retirement, crypto or business; <b>Assets</b> becomes real estate, vehicles or other assets.</p>
       ${nAcc ? `<p>Your ${nAcc} account${nAcc === 1 ? ' is' : 's are'} placed in the closest Pro category automatically. <b>Review them on Accounts</b> and adjust the category, custody, purpose and liquidity where it matters — your analytics get more accurate.</p>` : ''}
       <p class="small muted">The expense form also gets subcategory, merchant, payment method, tags and more.</p>`
    : `<p>Simple groups everything into six types: Savings, Investments, Trading capital, Assets, Cash and Debt.</p>
       ${nAcc ? `<p><b>Nothing is deleted or reset.</b> Each detailed category falls into one of the six types, and the details you set (category, custody, purpose…) are kept — they come back if you switch to Pro again.</p>` : ''}
       <p class="small muted">Extra Pro fields are hidden from the forms; values you already entered stay on your transactions.</p>`;
  const ok = await modal({ title: `Switch to ${to === 'pro' ? 'Pro' : 'Simple'} input?`, body, actions: [{ label: 'Cancel' }, { label: `Switch to ${to === 'pro' ? 'Pro' : 'Simple'}`, kind: 'primary', value: () => true }] });
  if (ok !== true) return false;
  await store.saveSettings({ mode: to, modeChosen: true, reviewAccounts: to === 'pro' && nAcc > 0 });
  toast(`Switched to ${to === 'pro' ? 'Pro' : 'Simple'} input`);
  return true;
}
