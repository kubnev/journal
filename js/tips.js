// "?" help next to form fields and table headers. One dictionary, applied automatically to
// everything rendered (pages, dialogs, re-drawn sections) — hover, focus or tap to read.
//   fields  : looked up by "<form id>:<name>" first, then by input name
//   headers : looked up by the header's text

const F = {
  // ---------- net-worth account ----------
  group: 'Pick the closest fit. Cash = spending money; Savings = money put aside; Trading capital = money in your trading accounts; Investments = long-term holdings; Assets = things you own; Debt = what you owe.',
  kind: 'Asset = something you own (cash, investments, a home). Liability = something you owe (loan, card balance). Liabilities are subtracted from net worth.',
  category: 'Groups the account in charts and on Accounts, and decides the default for “Liquid?”.',
  'nf:name': 'Any name you’ll recognise, e.g. “Main bank EUR” or “Index fund”.',
  institution: 'Bank, broker or app where it’s held. Just a label.',
  currency: 'The currency this account is kept in. Enter balances in this currency — totals and charts convert it to your display currency automatically.',
  balance: 'What it’s worth today, in the account’s currency. For debts, the amount you still owe. Saved as its first balance update.',
  rate: 'Yearly interest rate on the debt. Used for the weighted average rate and to prioritise payoff.',
  payment: 'Your regular monthly payment on this debt, in the account’s currency.',
  custody: 'Who actually holds the money — bank, broker, crypto exchange, your own wallet… Used to show counterparty risk in Analytics.',
  purpose: 'What this money is for (emergency fund, retirement, house deposit…). Auto picks one from the category; choose “Other” to name your own. Shown as buckets in Analytics.',
  apy: 'Yearly interest / yield (APY). Used only for the estimates on Net worth (what it earns per day, month and year) — the balance itself only changes when you update it. Leave blank or 0 if it doesn’t earn interest.',
  liquid: 'Could you turn it into cash within a few days without a big loss? Yes for cash, savings, stocks, crypto; no for a house, car or locked pension. Auto decides by category.',
  tracksHoldings: 'Instead of typing a balance, list what you hold (e.g. 0.5 BTC, 10 AAPL). Value = quantity × price, and prices can update with one click.',
  'nf:notes': 'Anything you want to remember about this account.',
  d: 'The date you closed it. From this date the account counts as zero; history before it is kept.',

  emergencyMonths: 'How many months of spending you want to keep in cash and savings. 3–6 is the usual target.',

            // ---------- transactions ----------
  'txf:amount': 'How much it cost, as a positive number.',
  'txf:currency': 'The currency you paid in. Totals are converted to your display currency at that day’s exchange rate.',
  'txf:date': 'The day it happened. Defaults to today.',
  'txf:sub': 'A finer split inside the category, e.g. Eating out → Cafés & coffee. Optional.',
  'txf:note': 'A few words so you recognise it later, e.g. “Lunch with Alex”. Searchable.',
  merchant: 'Who you paid. Reports total your spending per merchant, and bank imports use it to auto-categorise.',
  method: 'How you paid — card, cash, transfer… Edit the list in Settings.',
  'txf:accountId': 'Which of your accounts paid for it. Optional. Tick “Take it off this account’s balance” to lower that balance too.',
  'txf:deduct': 'Lowers the account’s balance today by this amount (converted to the account’s currency). Editing or deleting the expense puts it back. For a credit card or other debt, it adds to what you owe. Your next manual balance update overrides it anyway.',
  'txf:kind': 'Need = essential (rent, groceries, bills); want = optional (eating out, shopping). Auto uses the category’s setting. Drives the needs-vs-wants split.',
  'txf:tags': 'Free labels across categories, e.g. “holiday” or “wedding”, to total a trip or project. Comma separated.',
  repeat: 'Creates a bill/subscription from this transaction, so the next ones are added automatically.',
  exclude: 'Kept in the list but left out of totals, budgets and charts — e.g. something your employer will reimburse.',

  // ---------- update a balance ----------
  'ubf:value': 'What the account is worth (or what you owe) on that date, in the account’s own currency.',
  'ubf:date': 'The day this balance is for. One value per account per day — saving the same day again replaces it.',

  // ---------- bills & subscriptions ----------
  'rf:name': 'What it is, e.g. Rent, Netflix, Gym.',
  'rf:kind': 'Subscription = something you signed up for (Netflix, Spotify, gym, cloud storage). Bill = rent, utilities, phone, insurance.',
  'rf:accountId': 'The account it’s charged to. Shown on the Spending page and in “By account”.',
  'rf:deduct': 'Each time a charge is added, the account’s balance drops by it too — so the balance stays current between your updates.',
  'rf:amount': 'The amount of each payment, in its currency.',
  'rf:currency': 'The currency it’s charged in.',
  'rf:category': 'Where each payment is counted. Subscriptions are totalled per year on this page.',
  freq: 'How often it repeats. Monthly and yearly payments keep the same day of the month.',
  next: 'The next day it’s charged. It then repeats on that day — e.g. 9 October monthly = every month on the 9th. If the date is in the past and “add automatically” is on, the missed charges are added when you save.',
  auto: 'On: each payment is added to your expenses on its due date. Off: it’s only a reminder — you confirm it with “Mark paid”.',
  until: 'Optional last date, e.g. when a contract ends. Nothing is added after it.',
  'rf:merchant': 'Who you pay. Copied onto each transaction.',
  'rf:method': 'How it’s paid. Copied onto each transaction.',

  // ---------- budgets ----------
  'bf:total': 'Your spending limit for a whole month, in the display currency. Leave blank to use the sum of the category limits.',

  // ---------- money in & out ----------
  'flf:accountId': 'The account the money went into (deposit) or came out of (withdrawal).',
  'flf:amount': 'How much you moved, as a positive number.',
  'flf:currency': 'The currency of the transfer. Totals are converted to your display currency at that day’s rate.',
  'flf:date': 'The day the money moved. The year decides which year it counts in.',
  'flf:note': 'Anything that helps later, e.g. “monthly ETF buy” or “took profits”.',
  adjust: 'Adds a deposit to (or takes a withdrawal off) the account’s balance today. Leave it off if you’ll type the new balance on Update balances anyway — otherwise it would count twice until then.',

  // ---------- journal ----------
  mood: 'How you feel overall today, from 😣 to 😄.',
  energy: '1 = drained, 5 = full of energy.',
  stress: '1 = calm, 5 = very stressed. Insights compares it with what you spend.',
  sleep: 'Hours slept last night.',
  mind: 'Whatever is on your mind — writing it down tends to take the weight off.',
  recap: 'A few lines on how the day went.',
  good: 'Something that went well — however small.',
  hard: 'What was difficult or draining today.',
  gratitude: 'A few things you’re grateful for, however small. Writing them down regularly is one of the best-studied habits for wellbeing.',
  lesson: 'A short note for tomorrow — shows up in Insights as “Notes to self”.',
  habits: 'Habits to tick off in the daily check-in, one per line.',
  dayTags: 'Labels for days (Stressed, Social, Sick…), one per line. Pro input.',

  // ---------- payment methods ----------
  payMethods: 'The ways you pay, one per line. Shown as choices on the Pro transaction form.',

  // ---------- settings ----------
  'prefs:currency': 'Totals, charts and dashboards are shown in this currency. Accounts keep their own currency and are converted using ECB rates.',
  locale: 'How numbers and dates are written (1,234.56 vs 1.234,56; month/day order).',
  pnlColors: 'Colours for profit and loss. Blue/orange is easier to tell apart with colour-vision deficiency.',
  theme: 'Light, dark, or follow your device setting.',
  finnhubKey: 'Free key from finnhub.io for US stock prices. Stored only in this browser and sent only to Finnhub. Crypto prices don’t need a key.',

  // ---------- backup password ----------
  pw: 'Encrypts the backup file. You’ll need the exact same password to restore it — a lost password can’t be recovered.',
  pw2: 'Type the password again to make sure there’s no typo.',
  show: 'Shows the password as you type, so you can check it.',
  plain: 'Saves a normal, readable file with no password. Only for when you really need that — anyone who gets the file can read all your data.',

  // ---------- CSV import ----------
  _datefmt: 'How dates are written in your file. Auto works unless days and months are ambiguous (e.g. 03/04).',
};

const H = {
  'Liquid': 'Can it become cash within days without a big loss?',
  'Change': 'Difference vs the previous period — the last balance update on Net worth, your recent average on Spending.',
  'Trend': 'Balance history of the account.',
  'Weight': 'Share of this account’s holdings.',
  'Cost basis': 'What you paid in total for the holding.',
  'Total cost basis': 'What you paid in total for this holding (optional — enables unrealised P&L).',
  'Unrealised P&L': 'Current value minus what you paid (cost basis), not locked in yet.',
  'Source': 'Where the price came from and how fresh it is.',
  'Drift': 'Current share minus target share. Red = outside the rebalancing band: 5 percentage points, or 25% of the target if that is smaller (the 5/25 rule).',
  'Adjust by': 'Roughly how much to add (+) or remove (−) to hit the target allocation.',
  'Target %': 'The share of assets you want in this category. Should add up to 100%.',
  'Current': 'The share of your assets in this category today.',
  'Yield': 'Interest the account earns per year (APY), or the interest rate on a debt (APR). Set it with Edit.',
  'Latest balance': 'Most recent recorded value, in the account’s own currency.',
  'Details': 'Custody, purpose, yield and liquidity — or rate and payment for debts.',
  'Guideline': 'A common rule of thumb. Context matters — treat it as a prompt, not a rule.',
  '% of assets': 'This account’s share of everything you own (debts not subtracted).',
  'Balance': 'Latest value, converted to your display currency.',
  'Avg': 'Your average monthly spending in this category over the last few complete months.',
  'Budget': 'Spending so far against the category’s monthly limit.',
  'Limit': 'Monthly limit for the category. Blank = no limit.',
  'This month': 'Spending so far against the limit. The marker shows where an even pace would be today.',
  'Per month': 'Per month in your display currency — for bills, the cost converted to a monthly amount (weekly × 52 ÷ 12, yearly ÷ 12…); for interest, what the balance earns at its APY.',
  'How often': 'Weekly, monthly, every 3 months or yearly.',
  'Next': 'Next payment date. Red = past due and not added yet.',
  'Used': 'How many transactions use this category.',
  'Need / want': 'Need = essential, want = optional. Drives the needs-vs-wants split on Spending.',
  'Since last update': 'Roughly what the account has earned since you last updated it, at its APY. An estimate — your next update shows the real number.',
  'APY': 'Annual percentage yield — the yearly interest rate including compounding.',
  'APR': 'Annual interest rate on the debt.',
  'Per day': 'Estimated interest per day at the current balance and APY.',
  'Per year': 'Estimated interest per year at the current balance and APY.',
};

const tipFor = el => {
  const name = el.getAttribute('name');
  if (!name) return null;
  const form = el.closest('form')?.getAttribute('id');   // not .id — an input named "id" would shadow it
  const t = (form && F[`${form}:${name}`]) || F[name];
  if (t) return t;
  if (/^c:/.test(name)) return 'Monthly limit for this category. The bar shows spending so far; the marker is where an even pace would be today. Blank = no limit.';
  return null;
};
const icon = text => { const s = document.createElement('span'); s.className = 'tip'; s.tabIndex = 0; s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Help: ' + text); s.dataset.tip = text; s.textContent = '?'; return s; };

function decorate(root) {
  // form fields: label.field / label.check holding a named input
  for (const lab of root.querySelectorAll('label.field:not([data-tipped]), label.check:not([data-tipped])')) {
    lab.dataset.tipped = '1';
    if (lab.closest('#mf, [data-notips]')) continue;   // CSV column mapper: the label already says it all
    const input = lab.querySelector('input[name], select[name], textarea[name]');
    const text = input && tipFor(input);
    if (!text) continue;
    if (lab.classList.contains('check')) { lab.append(' ', icon(text)); continue; }
    // after the label's own words, before the hint / control
    const before = [...lab.childNodes].find(n => n.nodeType === 1 && (n.matches('.hint, input, select, textarea, div, datalist') || n.querySelector?.('input,select,textarea')));
    // wrap the label's own words + "?" in one inline line (labels stack their children vertically)
    const line = document.createElement('span'); line.className = 'field-label';
    for (const n of [...lab.childNodes]) { if (n === before) break; line.append(n); }
    line.append(icon(text));
    lab.insertBefore(line, before || null);
  }
  // table headers
  for (const th of root.querySelectorAll('th:not([data-tipped])')) {
    th.dataset.tipped = '1';
    const key = th.textContent.replace(/[↑↓]/g, '').trim();
    if (H[key]) th.append(icon(H[key]));
  }
}

// one floating bubble, positioned inside the viewport
let bubble = null, owner = null;
function show(el) {
  if (!bubble) { bubble = document.createElement('div'); bubble.className = 'tip-bubble'; bubble.setAttribute('role', 'tooltip'); document.body.append(bubble); }
  owner = el; bubble.textContent = el.dataset.tip; bubble.hidden = false;
  const r = el.getBoundingClientRect(), b = bubble.getBoundingClientRect(), W = document.documentElement.clientWidth;
  let left = Math.min(Math.max(8, r.left + r.width / 2 - b.width / 2), W - b.width - 8);
  let top = r.bottom + 8;
  if (top + b.height > window.innerHeight - 8) top = r.top - b.height - 8;
  bubble.style.left = left + 'px'; bubble.style.top = Math.max(8, top) + 'px';
}
function hide() { if (bubble) bubble.hidden = true; owner = null; }

export function initTips() {
  decorate(document.body);
  let queued = false;
  new MutationObserver(() => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; decorate(document.body); }); })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('mouseover', e => { const t = e.target.closest?.('.tip[data-tip]'); if (t && t !== owner) show(t); else if (!t && owner && !owner.matches(':focus')) hide(); });
  document.addEventListener('focusin', e => { const t = e.target.closest?.('.tip[data-tip]'); if (t) show(t); });
  document.addEventListener('focusout', e => { if (e.target.closest?.('.tip[data-tip]')) hide(); });
  // a tap/click on "?" shows the help — and must not tick a checkbox, focus the input or sort a column
  document.addEventListener('click', e => {
    const t = e.target.closest?.('.tip[data-tip]');
    if (!t) { if (owner) hide(); return; }
    e.preventDefault(); e.stopPropagation();
    t.focus({ preventScroll: true }); show(t);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && owner) hide(); });
  window.addEventListener('scroll', () => owner && hide(), true);
}
