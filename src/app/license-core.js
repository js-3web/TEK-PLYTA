// Licencja offline (specyfikacja, sekcja 11): klucz = base64url(JSON) + "." + base64url(podpis Ed25519).
// Program zna tylko klucz PUBLICZNY (sprawdza podpis); klucz prywatny ma wyłącznie wydawca licencji
// (scripts/license.mjs, przechowywany poza repozytorium). Bez sieci, bez serwera.

const b64u = {
  enc: bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)),
};
export { b64u };

// → { ok, msg, payload? }
export async function verifyLicense(key, publicKeyB64u, today = new Date().toISOString().slice(0, 10)) {
  if (!publicKeyB64u) return { ok: false, msg: 'Klucz publiczny programu nie jest ustawiony (wersja deweloperska).' };
  if (!key) return { ok: false, msg: 'Brak klucza licencji.' };
  const [p, s] = key.trim().split('.');
  if (!p || !s) return { ok: false, msg: 'Nieprawidłowy format klucza.' };
  let pub;
  try { pub = await crypto.subtle.importKey('raw', b64u.dec(publicKeyB64u), { name: 'Ed25519' }, false, ['verify']); }
  catch { return { ok: false, msg: 'Ten system nie obsługuje Ed25519 (zaktualizuj WebView2/przeglądarkę).' }; }
  let good = false;
  try { good = await crypto.subtle.verify({ name: 'Ed25519' }, pub, b64u.dec(s), b64u.dec(p)); } catch { good = false; }
  if (!good) return { ok: false, msg: 'Podpis klucza nieprawidłowy.' };
  const payload = JSON.parse(new TextDecoder().decode(b64u.dec(p)));
  if (payload.product !== 'TEK-PLYTA') return { ok: false, msg: 'Klucz dotyczy innego programu.' };
  if (payload.expires && payload.expires < today) return { ok: false, msg: `Licencja wygasła ${payload.expires}.`, payload };
  return { ok: true, msg: `Licencja: ${payload.name}${payload.expires ? ` (do ${payload.expires})` : ''}`, payload };
}
