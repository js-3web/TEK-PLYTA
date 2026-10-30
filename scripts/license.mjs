// Wydawanie licencji TEK-PŁYTA (Ed25519, offline). Klucz prywatny NIGDY nie trafia do repozytorium.
//   node scripts/license.mjs keygen <katalog>            → <katalog>/tekplyta-private.pem + klucz publiczny do app/src/license-key.js
//   node scripts/license.mjs issue <private.pem> "<Imię Nazwisko / firma>" [YYYY-MM-DD wygaśnięcia]
import { generateKeyPairSync, createPrivateKey, sign } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const b64u = b => Buffer.from(b).toString('base64url');
const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'keygen') {
  if (!a) throw new Error('Podaj katalog (poza repozytorium) na klucz prywatny.');
  if (resolve(a).startsWith(resolve('.'))) throw new Error('Katalog wewnątrz repozytorium — klucz prywatny nie może trafić do gita.');
  mkdirSync(a, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(join(a, 'tekplyta-private.pem'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`Klucz prywatny: ${join(a, 'tekplyta-private.pem')} (zrób kopię zapasową, nie udostępniaj)`);
  console.log(`Klucz publiczny (wpisz do app/src/license-key.js): '${publicKey.export({ format: 'jwk' }).x}'`);
} else if (cmd === 'issue') {
  const priv = createPrivateKey(readFileSync(a));
  const payload = { product: 'TEK-PLYTA', name: b, issued: new Date().toISOString().slice(0, 10), ...(c ? { expires: c } : {}) };
  const p = Buffer.from(JSON.stringify(payload));
  console.log(`${b64u(p)}.${b64u(sign(null, p, priv))}`);
} else console.log('Użycie: keygen <katalog> | issue <private.pem> "<nazwa>" [YYYY-MM-DD]');
