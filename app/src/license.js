// Licencja w aplikacji: klucz zapisany lokalnie (localStorage), sprawdzany offline kluczem publicznym.
import { verifyLicense } from '../../src/app/license-core.js';
import { PUBLIC_KEY } from './license-key.js';

const KEY = 'tekplyta.license';
export async function checkLicense(key) {
  let k = key;
  try { if (k == null) k = localStorage.getItem(KEY); } catch { /* brak dostępu */ }
  const r = await verifyLicense(k, PUBLIC_KEY);
  if (r.ok && key) { try { localStorage.setItem(KEY, key); } catch { /* brak dostępu */ } }
  return r;
}
