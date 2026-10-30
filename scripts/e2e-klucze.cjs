// Test TEK-KLUCZE (Playwright): para kluczy z aplikacji → licencja akceptowana przez program (license-core);
// klucz prywatny z scripts/license.mjs wczytany w aplikacji → ten sam format; podróbka odrzucona.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Brak Playwright — test TEK-KLUCZE pominięty.'); process.exit(0); }

(async () => {
  const { verifyLicense } = await import('../src/app/license-core.js');
  const b = await chromium.launch(), ctx = await b.newContext({ acceptDownloads: true }), p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  try {
    await p.goto('file://' + resolve('dist-tools/TEK-KLUCZE.html')); await p.waitForFunction(() => window.__KL);
    // 1) nowa para w aplikacji
    const [pem] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=generate]')]);
    assert.equal(pem.suggestedFilename(), 'tekplyta-private.pem');
    assert.match(readFileSync(await pem.path(), 'utf8'), /^-----BEGIN PRIVATE KEY-----/);
    const pub = await p.evaluate(() => window.__KL.pub);
    await p.fill('#lName', 'Biuro Projektowe Test'); await p.fill('#lExp', '2030-12-31');
    await p.click('[data-act=issue]'); await p.waitForFunction(() => document.querySelector('#lOut')?.value);
    const key = await p.inputValue('#lOut');
    const ok = await verifyLicense(key, pub, '2026-10-30');
    assert.equal(ok.ok, true, ok.msg); assert.equal(ok.payload.name, 'Biuro Projektowe Test');
    const [pl, sig] = key.split('.');
    assert.equal((await verifyLicense(`${pl.slice(0, -2)}xx.${sig}`, pub)).ok, false, 'podróbka odrzucona');
    // 2) klucz prywatny z narzędzia wiersza poleceń
    const dir = mkdtempSync(join(tmpdir(), 'kl-'));
    const pubCli = execFileSync('node', ['scripts/license.mjs', 'keygen', dir]).toString().match(/'([A-Za-z0-9_-]{43})'/)[1];
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=load]')]);
    await fc.setFiles(join(dir, 'tekplyta-private.pem'));
    await p.waitForFunction(x => window.__KL.pub === x, pubCli);
    await p.fill('#lName', 'Klient CLI'); await p.fill('#lExp', ''); await p.click('[data-act=issue]');
    await p.waitForFunction(() => window.__KL.issued[0]?.name === 'Klient CLI');
    const key2 = await p.inputValue('#lOut');
    assert.equal((await verifyLicense(key2, pubCli)).ok, true, 'licencja z kluczem CLI');
    assert.deepEqual(errs, []);
    console.log('test TEK-KLUCZE: OK');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
