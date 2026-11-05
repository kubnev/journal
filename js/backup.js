// Backup export / restore flows (shared by Settings and the backup reminder).
import * as store from './store.js';
import { modal, toast, download, readFileText, confirmDlg, esc, today } from './ui.js';
import { encryptBackup, decryptBackup, isEncrypted } from './crypto.js';
import { migrateCurrencies, refreshRates } from './fx.js';

const MIN_LEN = 8;

// Ask for a password, encrypt, download. Returns true when a file was saved.
export async function exportBackupFlow() {
  const res = await modal({
    title: 'Export backup',
    body: `<form id="bk" class="stack" autocomplete="off">
      <p class="small muted" style="margin:0">Choose a password for this backup. You'll need it to restore the file — <b>if you forget it, the backup can't be opened by anyone, including you</b>. It isn't stored anywhere.</p>
      <label class="field">Password <span class="hint">at least ${MIN_LEN} characters — a passphrase of 4+ words is best</span><input name="pw" type="password" autocomplete="new-password" minlength="${MIN_LEN}"></label>
      <label class="field">Repeat password<input name="pw2" type="password" autocomplete="new-password"></label>
      <label class="check"><input type="checkbox" name="show"> Show password</label>
      <label class="check small muted"><input type="checkbox" name="plain"> Export without a password (anyone who gets the file can read it)</label>
    </form>`,
    onMount: w => {
      const f = w.querySelector('#bk');
      f.show.onchange = () => { f.pw.type = f.pw2.type = f.show.checked ? 'text' : 'password'; };
      f.plain.onchange = () => { f.pw.disabled = f.pw2.disabled = f.plain.checked; };
      setTimeout(() => f.pw.focus());
    },
    actions: [{ label: 'Cancel' }, { label: 'Export', kind: 'primary', value: w => {
      const f = w.querySelector('#bk');
      if (f.plain.checked) return { plain: true };
      if (f.pw.value.length < MIN_LEN) { toast(`Use at least ${MIN_LEN} characters`, 'error'); return false; }
      if (f.pw.value !== f.pw2.value) { toast('The two passwords don\'t match', 'error'); return false; }
      return { pw: f.pw.value };
    } }],
  });
  if (!res || typeof res !== 'object') return false;
  const data = store.exportBackup();
  let out = data, name = `journal-backup-${today()}.json`;
  if (!res.plain) {
    toast('Encrypting…');
    out = await encryptBackup(data, res.pw);
    name = `journal-backup-${today()}-encrypted.json`;
  }
  download(name, JSON.stringify(out));
  await store.saveSettings({ lastBackupAt: new Date().toISOString() });
  toast(res.plain ? 'Backup downloaded (not encrypted)' : 'Encrypted backup downloaded');
  return true;
}

async function askPassword(again) {
  const r = await modal({
    title: 'Encrypted backup',
    body: `<form id="bp" class="stack" autocomplete="off"><p class="small muted" style="margin:0">${again ? '<b class="neg">That password didn\'t work.</b> ' : ''}Enter the password this backup was exported with.</p>
      <label class="field">Password<input name="pw" type="password" autocomplete="current-password"></label></form>`,
    onMount: w => setTimeout(() => w.querySelector('[name=pw]').focus()),
    actions: [{ label: 'Cancel' }, { label: 'Unlock', kind: 'primary', value: w => w.querySelector('[name=pw]').value || (toast('Enter the password', 'error'), false) }],
  });
  return typeof r === 'string' ? r : null;
}

// Restore from a chosen file (encrypted or not). Returns true when data was restored.
export async function importBackupFlow(file) {
  let obj;
  try { obj = JSON.parse(await readFileText(file)); } catch { toast('Could not read that file as JSON', 'error'); return false; }
  if (isEncrypted(obj)) {
    let again = false;
    for (;;) {
      const pw = await askPassword(again);
      if (pw == null) return false;
      try { obj = await decryptBackup(obj, pw); break; }
      catch (e) { if (e.message !== 'wrong-password') { toast(e.message, 'error'); return false; } again = true; }
    }
  }
  try { store.validateBackup(obj); } catch (e) { toast(e.message, 'error'); return false; }
  const mode = await modal({
    title: 'Restore backup',
    body: `<p>Backup from <b>${esc(obj.exportedAt ? new Date(obj.exportedAt).toLocaleString() : 'unknown date')}</b>.</p><p class="small muted"><b>Replace</b> deletes current data first. <b>Merge</b> adds the backup's records and overwrites records with the same id.</p>`,
    actions: [{ label: 'Cancel' }, { label: 'Merge', value: () => 'merge' }, { label: 'Replace all', kind: 'primary', value: () => 'replace' }],
  });
  if (mode !== 'merge' && mode !== 'replace') return false;
  if (mode === 'replace' && !(await confirmDlg('Replace all data?', 'Current data in this browser will be deleted and replaced by the backup.', 'Replace'))) return false;
  try { await store.importBackup(obj, { mode }); await migrateCurrencies(); }
  catch (err) { toast(err.message, 'error'); return false; }
  toast('Backup restored');
  refreshRates().catch(() => {});
  return true;
}
