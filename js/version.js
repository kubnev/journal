// App version + "check for update". The site is static, so an update means: fetch version.json
// fresh, and if it's newer, re-download every app file into the browser cache and reload.
export const APP_VERSION = '2.0.1';

export const CHANGELOG = [
  ['2.0.1', 'The first screen offers a 1-minute tour next to Simple and Pro.'],
  ['2.0.0', 'Journal. Balances are updated right on Accounts & holdings (Update next to each account, or Update all), and every update is kept as history. Interest is an estimate on the Net worth page; balances no longer grow on their own. No more starting estimates: where there is not enough data yet, the app says so. Averages and cash runway need just a week of logged spending.'],
];

const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };

// → { available: bool, latest: string, notes: string } ; throws if offline
export async function checkForUpdate() {
  const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(`version.json responded ${r.status}`);
  const v = await r.json();
  return { available: newer(v.version, APP_VERSION), latest: v.version, notes: v.notes || '', files: v.files || [] };
}

// Refresh every app file in the HTTP cache, then reload the page.
export async function applyUpdate(files) {
  const list = ['index.html', ...files];
  await Promise.allSettled(list.map(f => fetch(f, { cache: 'reload' })));
  location.reload();
}
