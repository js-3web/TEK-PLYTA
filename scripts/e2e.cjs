// Test interfejsu w przeglądarce (Playwright + Chromium): wzorzec DXF → dane → Licz → mapy → DOCX →
// zapis w bazie → paczka AI. Wymaga zainstalowanego Playwright (npx playwright install chromium).
// Uruchomienie: npm run test:ui
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Brak Playwright — test interfejsu pominięty.'); process.exit(0); }

(async () => {
  const port = 8097, srv = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__TEK);
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=openDxf]')]);
    await fc.setFiles('assets/TEK-PLYTA_wzorzec.dxf');
    await p.click('[data-mod=data]');
    for (const [l, v] of [['Q1', 3], ['Q2', 7.5], ['L1', 6.2], ['P1', 25]]) { await p.fill(`[data-path="loads.${l}.value"]`, String(v)); await p.dispatchEvent(`[data-path="loads.${l}.value"]`, 'change'); }
    await p.selectOption('[data-path="loads.Q2.category"]', 'E'); await p.selectOption('[data-path="loads.P1.category"]', 'E');
    await p.click('[data-mod=mesh]'); await p.click('[data-act=run]');
    await p.waitForFunction(() => window.__TEK.res, null, { timeout: 120000 });
    const r = await p.evaluate(() => ({ ok: window.__TEK.res.ok, eq: Math.max(...window.__TEK.res.equilibrium.map(e => e.error)), n: window.__TEK.res.punching.length }));
    assert.equal(r.ok, true); assert.ok(r.eq < 1e-6); assert.equal(r.n, 7);
    await p.click('[data-mod=projects]'); await p.fill('[data-path="meta.name"]', 'Strop żółć'); await p.dispatchEvent('[data-path="meta.name"]', 'change');
    await p.click('[data-mod=report]');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=reportDocx]')]);
    assert.equal(dl.suggestedFilename(), 'Strop zolc - raport.docx');
    assert.ok(await dl.path(), 'plik DOCX zapisany');
    await p.click('[data-mod=projects]'); await p.click('[data-act=saveVariant]'); await p.waitForTimeout(300);
    const st = await p.evaluate(() => window.__TEK.db.list(document.querySelector('#version').textContent.slice(1))[0].warianty[0].status);
    assert.equal(st, 'aktualne');
    await p.click('[data-mod=ai]');
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=aiPackage]')]);
    assert.ok(dl2.suggestedFilename().endsWith('.zip'));
    assert.deepEqual(errs, [], 'błędy w konsoli przeglądarki');
    console.log('test interfejsu: OK');
  } finally { await b.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
