// Licencja Ed25519 offline: klucz wydany narzędziem scripts/license.mjs przechodzi weryfikację WebCrypto;
// podmiana treści, obcy klucz, wygaśnięcie — odrzucone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyLicense, b64u } from '../src/app/license-core.js';

const dir = mkdtempSync(join(tmpdir(), 'lic-'));
const out = execFileSync('node', ['scripts/license.mjs', 'keygen', dir]).toString();
const pub = out.match(/'([A-Za-z0-9_-]{43})'/)[1];
const issue = (...a) => execFileSync('node', ['scripts/license.mjs', 'issue', join(dir, 'tekplyta-private.pem'), ...a]).toString().trim();

test('poprawna licencja; podmieniona treść i obcy klucz odrzucone; wygasła odrzucona', async () => {
  const key = issue('Biuro Testowe', '2030-12-31');
  const ok = await verifyLicense(key, pub, '2026-10-30');
  assert.equal(ok.ok, true, ok.msg); assert.equal(ok.payload.name, 'Biuro Testowe');
  const [p, s] = key.split('.');
  const forged = b64u.enc(new TextEncoder().encode(JSON.stringify({ ...ok.payload, name: 'Ktoś inny' })));
  assert.equal((await verifyLicense(`${forged}.${s}`, pub)).ok, false);
  const other = mkdtempSync(join(tmpdir(), 'lic2-'));
  const pub2 = execFileSync('node', ['scripts/license.mjs', 'keygen', other]).toString().match(/'([A-Za-z0-9_-]{43})'/)[1];
  assert.equal((await verifyLicense(key, pub2)).ok, false);
  assert.match((await verifyLicense(key, pub, '2031-01-01')).msg, /wygasła/);
  assert.equal((await verifyLicense(`${p}.${s}`, null)).ok, false, 'bez klucza publicznego — wersja deweloperska');
});

test('keygen odmawia zapisu klucza prywatnego w repozytorium', () => {
  assert.throws(() => execFileSync('node', ['scripts/license.mjs', 'keygen', 'tmp-keys'], { stdio: 'pipe' }));
});
