// Sample data for the tour: six months of spending, bills and budgets, a 30-month net-worth history
// and seven weeks of journal entries. Every record is flagged `demo: true` so it can be removed
// without touching real entries.
import * as store from './store.js';
import { dayKey, monthKey } from './ui.js';
import { nextDate } from './spend/calc.js';

function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const COLS = ['nwAccounts', 'nwSnapshots', 'capital', 'txns', 'recurring', 'days'];

export const hasDemo = () => COLS.some(c => store.all(c).some(x => x.demo));
export async function removeDemo() {
  for (const c of COLS) await store.delWhere(c, x => x.demo);
  if (store.getSettings().demoBudgets) { await store.saveSettings({ budgets: null }); await store.saveSettings({ budgets: { total: 0, byCat: {} }, demoBudgets: false }); }
  if (store.getSettings().demoTargets) { await store.saveSettings({ plan: { targetAllocation: null } }); await store.saveSettings({ plan: { targetAllocation: {} }, demoTargets: false }); }
}

export async function loadDemo() {
  if (hasDemo()) await removeDemo();
  const R = rng(20261002);
  const pick = a => a[Math.floor(R() * a.length)];
  const between = (a, b) => a + R() * (b - a);
  const normal = () => { let u = 0, v = 0; while (!u) u = R(); while (!v) v = R(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const id = () => store.uid();
  const now = new Date();
  const todayK = dayKey(now);
  const r2 = x => Math.round(x * 100) / 100;

  // ---------------- spending: bills & subscriptions ----------------
  const RC = (name, amount, category, day, extra = {}) => ({ id: id(), demo: true, name, amount, currency: 'EUR', category, freq: 'monthly', day, auto: true, ...extra });
  const bills = [
    RC('Rent', 950, 'housing', 1, { sub: 'Rent', method: 'Bank transfer' }),
    RC('Electricity & heating', 85, 'bills', 6, { sub: 'Electricity', method: 'Bank transfer' }),
    RC('Internet', 32, 'bills', 12, { sub: 'Internet', method: 'Debit card' }),
    RC('Phone', 18, 'bills', 15, { sub: 'Phone', method: 'Debit card' }),
    RC('Gym', 39, 'health', 3, { sub: 'Gym & sport', method: 'Debit card' }),
    RC('Netflix', 15.99, 'subscriptions', 9, { sub: 'Streaming', method: 'Credit card' }),
    RC('Spotify', 10.99, 'subscriptions', 21, { sub: 'Streaming', method: 'Credit card' }),
    RC('iCloud', 2.99, 'subscriptions', 17, { sub: 'Software & apps', method: 'Phone wallet' }),
    RC('Cloud storage', 99, 'subscriptions', 14, { sub: 'Software & apps', method: 'Credit card', freq: 'yearly' }),
    RC('Car insurance', 210, 'transport', 20, { sub: 'Car insurance', method: 'Bank transfer', freq: 'quarterly' }),
  ];
  const txns = [];
  const T = (date, type, amount, category, note, extra = {}) => txns.push({ id: id(), demo: true, date, type, amount: r2(amount), currency: 'EUR', category, note, ...extra });
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  // past occurrences of each bill, then point it at its next date
  for (const b of bills) {
    let d = dayKey(new Date(start.getFullYear(), start.getMonth() + (b.freq === 'yearly' ? -3 : 0), Math.min(b.day, 28)));
    let guard = 0;
    while (d <= todayK && guard++ < 50) { if (d >= dayKey(start)) T(d, b.type || 'expense', b.amount, b.category, b.name, { sub: b.sub, method: b.method, recurringId: b.id, merchant: b.name }); d = nextDate(b, d); }
    b.next = d;
  }
  // everyday spending
  const GRO = ['Supermarket', 'Discount grocer', 'Corner shop', 'Organic store', 'Farmers market'], EAT = ['Delivery app', 'Grill house', 'Sushi place', 'Pizzeria', 'Street food'], CAF = ['Coffee chain', 'Corner café', 'Bakery café'];
  const SHOP = [['Clothing store', 'Clothes & shoes'], ['Online shop', 'Electronics'], ['Furniture store', 'Home & furniture'], ['Hobby shop', 'Collectibles & hobbies'], ['Shoe store', 'Clothes & shoes']];
  const METH = ['Debit card', 'Debit card', 'Phone wallet', 'Credit card', 'Cash'];
  for (let d = new Date(start); dayKey(d) <= todayK; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d), dow = d.getDay(), weekend = dow === 0 || dow === 6;
    if (R() < 0.13) continue;                                        // a no-spend day
    if (R() < (weekend ? 0.55 : 0.3)) { const g = pick(GRO); T(k, 'expense', between(14, weekend ? 95 : 45), 'groceries', g === 'Farmers market' ? 'Fruit & veg' : 'Groceries', { merchant: g, sub: g === 'Farmers market' ? 'Market & bakery' : 'Supermarket', method: pick(METH) }); }
    if (R() < 0.45) { const c = pick(CAF); T(k, 'expense', between(2.8, 5.5), 'dining', 'Coffee', { merchant: c, sub: 'Cafés & coffee', method: 'Phone wallet' }); }
    if (R() < (weekend ? 0.5 : 0.18)) { const e = pick(EAT); T(k, 'expense', between(12, weekend ? 70 : 28), 'dining', e === 'Delivery app' ? 'Delivery' : 'Dinner out', { merchant: e, sub: e === 'Delivery app' ? 'Takeaway & delivery' : 'Restaurants', method: pick(METH) }); }
    if (R() < 0.12) T(k, 'expense', between(45, 75), 'transport', 'Fuel', { merchant: pick(['Fuel station', 'Motorway services']), sub: 'Fuel', method: 'Debit card' });
    if (R() < 0.1) T(k, 'expense', between(6, 18), 'transport', 'Taxi', { merchant: 'Taxi app', sub: 'Taxi & rideshare', method: 'Credit card' });
    if (R() < 0.06) { const [m, sub] = pick(SHOP); T(k, 'expense', between(25, 160), 'shopping', sub, { merchant: m, sub, method: pick(METH), kind: sub === 'Collectibles & hobbies' ? 'want' : undefined }); }
    if (R() < 0.05) T(k, 'expense', between(12, 60), 'fun', pick(['Cinema', 'Concert tickets', 'Bowling', 'Steam game']), { sub: pick(['Events & concerts', 'Games', 'Activities']), method: pick(METH) });
    if (R() < 0.03) T(k, 'expense', between(8, 45), 'health', 'Pharmacy', { merchant: 'Pharmacy', sub: 'Pharmacy', method: 'Debit card' });
    if (R() < 0.025) T(k, 'expense', between(15, 40), 'personal', 'Haircut', { sub: 'Haircut & beauty', method: 'Cash' });
    if (R() < 0.02) T(k, 'expense', between(20, 80), 'gifts', 'Gift', { sub: 'Gifts', method: pick(METH) });
  }
  // one trip and a few one-offs
  const mk = n => monthKey(new Date(now.getFullYear(), now.getMonth() - n, 1));
  T(`${mk(3)}-08`, 'expense', 240, 'travel', 'Flights', { merchant: 'Airline', sub: 'Flights', method: 'Credit card', tags: ['holiday'] });
  T(`${mk(3)}-10`, 'expense', 380, 'travel', 'Apartment, 4 nights', { merchant: 'Holiday rental', sub: 'Accommodation', method: 'Credit card', tags: ['holiday'] });
  T(`${mk(3)}-12`, 'expense', 165, 'travel', 'Food & tours', { sub: 'Activities & food', method: 'Cash', tags: ['holiday'] });
  T(`${mk(2)}-15`, 'expense', 120, 'education', 'Online course', { sub: 'Courses', method: 'Credit card' });
  T(`${mk(1)}-22`, 'expense', 60, 'fees', 'Parking fine', { sub: 'Fines', method: 'Debit card' });
  // ---------------- journal: seven weeks of check-ins ----------------
  // low-mood / stressed days come with a little extra impulse spending, so Insights has a pattern to show
  const MIND = ['Busy week, but on top of it.', 'Quiet day, got the paperwork done.', 'Slept badly, felt foggy all day.', 'Good talk with an old friend.', 'Worried about the car repair cost.', 'Productive morning, lazy afternoon.', 'Felt restless — bought stuff I didn\'t need.', 'Long walk, cleared my head.', 'Family dinner, nice evening.', 'Too much screen time today.'];
  const HAB = ['Exercise', 'Outside / walk', 'Read', 'No alcohol', 'Screen off before bed'];
  const days = [];
  const clamp = x => Math.max(1, Math.min(5, Math.round(x)));
  for (let i = 49; i >= 1; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i), k = dayKey(d);
    if (R() < 0.2) continue;
    const mood = clamp(3.4 + normal() * 1.05), stress = clamp(5.6 - mood + normal() * 0.8), sleep = Math.round(Math.max(4.5, Math.min(9, 7 + normal() * 0.9 + (mood - 3) * 0.3)) * 2) / 2;
    days.push({ id: k, demo: true, mood, stress, energy: clamp(mood + normal() * 0.7), sleep,
      mind: pick(MIND), habits: Object.fromEntries(HAB.map(h => [h, R() < (mood >= 4 ? 0.7 : 0.35)])), lesson: R() < 0.25 ? pick(['Wait a day before buying anything big.', 'Go to bed before midnight.', 'Walk before opening the laptop.', 'Fewer coffees after 2pm.']) : '' });
    if (stress >= 4 || mood <= 2) { const [m, sub] = pick(SHOP); T(k, 'expense', between(35, 140), 'shopping', sub, { merchant: m, sub, method: 'Credit card', kind: 'want', note: 'Impulse buy' }); }
  }
  await store.putMany('recurring', bills);
  await store.putMany('txns', txns);
  await store.putMany('days', days.filter(x => !store.get('days', x.id)));
  if (!(store.getSettings().budgets?.total) && !Object.keys(store.getSettings().budgets?.byCat || {}).length) {
    await store.saveSettings({ budgets: { total: 2300, byCat: { groceries: 350, dining: 250, transport: 200, shopping: 150, fun: 100, subscriptions: 60 } }, demoBudgets: true });
  }

  // ---------------- net worth: real money only ----------------
  const A = (name, kind, category, extra = {}) => ({ id: id(), demo: true, name, kind, category, ...extra });
  const inMonths = (m, day) => dayKey(new Date(now.getFullYear(), now.getMonth() + m, day));
  const nw = {
    checking: A('Current account', 'asset', 'cash', { currency: 'EUR', institution: 'Main bank' }),
    cashHome: A('Cash at home', 'asset', 'cash', { currency: 'EUR', custody: 'physical' }),
    hysa: A('High-yield savings', 'asset', 'savings', { currency: 'EUR', institution: 'Online bank', apy: 2.75 }),
    mmf: A('Money-market fund', 'asset', 'savings', { currency: 'USD', institution: 'Broker', custody: 'broker', purpose: 'Safe reserve', apy: 4.6 }),
    deposit: A('Term deposit, 12 months', 'asset', 'deposit', { currency: 'EUR', institution: 'Main bank', apy: 3.1, maturity: inMonths(5, 14) }),
    bill: A('Treasury bill, 6 months', 'asset', 'bonds', { currency: 'EUR', custody: 'state', apy: 2.9, maturity: dayKey(new Date(now.getTime() + 24 * 864e5)) }),
    bond: A('Government bond', 'asset', 'bonds', { currency: 'EUR', custody: 'state', apy: 3.3, maturity: inMonths(31, 1) }),
    pension: A('Pension fund', 'asset', 'retirement', { currency: 'EUR' }),
    home: A('Apartment', 'asset', 'realestate', { currency: 'EUR' }),
    car: A('Car', 'asset', 'vehicle', { currency: 'EUR' }),
    gold: A('Gold coins', 'asset', 'valuables', { currency: 'EUR' }),
    mortgage: A('Mortgage', 'liability', 'mortgage', { currency: 'EUR', institution: 'Main bank', rate: 3.4, payment: 820 }),
    cc: A('Credit card', 'liability', 'credit', { currency: 'EUR', institution: 'Card issuer', rate: 21 }),
  };
  const M = 30;
  const snaps = [];
  let v = { checking: 3800, cashHome: 1500, hysa: 9000, mmf: 6000, deposit: 20000, bill: 15000, bond: 25000, pension: 18000, home: 185000, car: 19000, gold: 6500, mortgage: 142000, cc: 900 };
  for (let i = M; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    // what was put aside that month
    const saved = Math.round(Math.max(-800, 1300 + normal() * 900));
    if (i < M) {
      v.hysa = v.hysa * (1 + 0.0275 / 12) + saved * 0.6;
      v.mmf = v.mmf * (1 + 0.046 / 12) + saved * 0.25;
      v.bond *= 1 + 0.033 / 12 + normal() * 0.002;
      v.bill = i % 6 === 0 ? 15000 + (M - i) * 150 : v.bill * (1 + 0.029 / 12);
      v.deposit = i === 7 ? v.deposit * 1.031 + saved * 0.15 : v.deposit;
      v.pension = v.pension * (1 + 0.004 + normal() * 0.02) + 150;
      v.checking = Math.max(1500, 3800 + normal() * 700);
      v.home *= 1 + 0.003 + normal() * 0.004;
      v.car *= 0.99;
      v.gold *= 1 + 0.006 + normal() * 0.025;
      v.mortgage = v.mortgage * (1 + 0.034 / 12) - 820 * 0.6;
      v.cc = Math.max(200, 900 + normal() * 400);
    }
    const balances = {};
    for (const [k, a] of Object.entries(nw)) balances[a.id] = Math.round(v[k] * 100) / 100;
    snaps.push({ id: id(), demo: true, date: dayKey(d), balances });
  }
  await store.putMany('nwAccounts', Object.values(nw));
  // subscriptions & bills come out of the everyday account (or the credit card)
  await store.putMany('recurring', bills.map(b => ({ ...b, accountId: b.category === 'subscriptions' && b.method === 'Credit card' ? nw.cc.id : nw.checking.id, deduct: false })));
  await store.putMany('txns', txns.filter(t => t.recurringId).map(t => ({ ...t, accountId: store.get('recurring', t.recurringId)?.accountId || '' })));
  await store.putMany('nwSnapshots', snaps.filter(s => !store.all('nwSnapshots').some(x => x.date === s.date)));
  // trading capital kept outside net worth: what went in each year and the balance at the end
  const Y = now.getFullYear();
  await store.putMany('capital', [
    { id: id(), demo: true, kind: 'in', date: `${Y - 1}-01-01`, amount: 60000, currency: 'EUR', note: 'Starting capital' },
    { id: `bal-${Y - 1}`, demo: true, kind: 'balance', date: `${Y - 1}-12-31`, amount: 78500, currency: 'EUR' },
    { id: id(), demo: true, kind: 'in', date: `${Y}-01-01`, amount: 70000, currency: 'EUR', note: 'Starting capital' },
    ...(now.getMonth() >= 3 ? [{ id: id(), demo: true, kind: 'in', date: `${Y}-03-10`, amount: 10000, currency: 'EUR', note: 'Top-up' }] : []),
    { id: `bal-${Y}`, demo: true, kind: 'balance', date: todayK, amount: 96400, currency: 'EUR' },
  ]);
  // a sample target allocation (never touches your own targets); removed with the demo
  const pl = store.getSettings().plan;
  const simple = store.getSettings().mode !== 'pro';
  if (!Object.keys(pl.targetAllocation || {}).length) await store.saveSettings({ plan: { targetAllocation: simple ? { cash: 3, savings: 29, investments: 8, assets: 60 } : { cash: 3, savings: 9, deposit: 6, bonds: 14, retirement: 8, realestate: 53, vehicle: 4, valuables: 3 } }, demoTargets: true });
}
