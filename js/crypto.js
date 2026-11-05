// Password-protected backups, using only the browser's built-in WebCrypto.
//   key    : PBKDF2-SHA-256 (600,000 iterations, random 16-byte salt) → AES-256 key
//   cipher : AES-GCM (random 12-byte IV) — also detects a wrong password or a tampered file
// The password never leaves this function and is never stored.
const enc = new TextEncoder(), dec = new TextDecoder();
export const ITERATIONS = 600000;

const b64 = buf => {
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = s => { const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export const isEncrypted = obj => !!(obj && ['journal', 'ledgerline'].includes(obj.app) && obj.encrypted === true);

export async function encryptBackup(obj, password) {
  if (!crypto?.subtle) throw new Error('This browser can\'t encrypt (needs a secure https page).');
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  // Only what's needed to decrypt is stored in the clear — not even the export date.
  return { app: 'journal', encrypted: true, format: 1, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: b64(salt) }, cipher: { name: 'AES-GCM', iv: b64(iv) }, data: b64(ct) };
}

// Throws Error('wrong-password') when the password is wrong or the file was altered.
export async function decryptBackup(file, password) {
  const it = +file?.kdf?.iterations;
  if (file?.format !== 1 || file.kdf?.name !== 'PBKDF2' || file.cipher?.name !== 'AES-GCM' || !(it >= 100000 && it <= 10000000) || typeof file.data !== 'string') throw new Error('This encrypted backup is damaged or from an unknown version.');
  let salt, iv, ct;
  try { salt = unb64(file.kdf.salt); iv = unb64(file.cipher.iv); ct = unb64(file.data); } catch { throw new Error('This encrypted backup is damaged.'); }
  const key = await deriveKey(password, salt, it);
  let plain;
  try { plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct); } catch { throw new Error('wrong-password'); }
  return JSON.parse(dec.decode(plain));
}
