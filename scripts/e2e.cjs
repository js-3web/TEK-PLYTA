// Test interfejsu w przeglądarce (Playwright + Chromium): Start → nowy projekt → wzorzec DXF → dane → Licz →
// wyniki → zbrojenie → rysunek DXF → raport DOCX → zapis w bazie → paczka AI. Opcjonalnie zrzuty (SHOTS=katalog).
// Wymaga Playwright (npx playwright install chromium). Uruchomienie: npm run test:ui
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Brak Playwright — test interfejsu pominięty.'); process.exit(0); }
const SHOTS = process.env.SHOTS;

(async () => {
  const port = 8097, srv = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch();
  try {
    const p = await b.newPage({ viewport: { width: 1600, height: 950 } });
    const shot = async n => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/ui-${n}.png` }); };
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => window.__TEK && document.querySelector('.hero'));
    await shot('start');
    await p.click('[data-act=newProject]');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('[data-act=openDxf]')]);
    await fc.setFiles('assets/TEK-PLYTA_wzorzec.dxf');
    await p.waitForTimeout(300); await shot('geometria');
    await p.click('[data-tab=data]');
    for (const [l, v] of [['Q1', 3], ['Q2', 7.5], ['L1', 6.2], ['P1', 25]]) { await p.fill(`[data-path="loads.${l}.value"]`, String(v)); await p.dispatchEvent(`[data-path="loads.${l}.value"]`, 'change'); }
    await p.selectOption('[data-path="loads.Q2.category"]', 'E'); await p.selectOption('[data-path="loads.P1.category"]', 'E');
    // współczynnik normowy: γc = 1,5 (zmiana wyróżniona, w raporcie jako zmieniona)
    await p.click('text=Pokaż i edytuj');
    await p.fill('[data-path="norms.ec2.gammaC"]', '1.5'); await p.dispatchEvent('[data-path="norms.ec2.gammaC"]', 'change');
    assert.ok(await p.$('input.changed[data-path="norms.ec2.gammaC"]'), 'pole zmienione wyróżnione');
    await shot('dane');
    await p.click('[data-tab=calc]'); await p.click('[data-act=run]');
    await p.waitForFunction(() => window.__TEK.res, null, { timeout: 120000 });
    const r = await p.evaluate(() => ({ ok: window.__TEK.res.ok, eq: Math.max(...window.__TEK.res.equilibrium.map(e => e.error)), n: window.__TEK.res.punching.length, z: Object.values(window.__TEK.res.rebar.layers).reduce((s, l) => s + l.zones.length, 0) }));
    assert.equal(r.ok, true); assert.ok(r.eq < 1e-6); assert.equal(r.n, 7); assert.ok(r.z > 0, 'strefy dozbrojenia');
    assert.equal(await p.evaluate(() => window.__TEK.res.paramChanges.map(c => c.path).join()), 'ec2.gammaC');
    // mapy jak w Robocie: przypadek Q2, ręczna skala, przekrój narysowany myszą
    await p.selectOption('#mapSel', 'q:mx'); await p.selectOption('#srcSel', 'case:2');
    await p.click('[data-vopt=auto]'); await p.fill('[data-vopt=bands]', '12'); await p.dispatchEvent('[data-vopt=bands]', 'change');
    await p.click('[data-act=addSection]');
    const box = await (await p.$('#cv')).boundingBox();
    await p.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.62); await p.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.62);
    await p.waitForTimeout(300);
    const sec = await p.evaluate(() => ({ n: window.__TEK.project.sections.length, auto: window.__TEK.vopt.auto, bands: window.__TEK.vopt.bands }));
    assert.deepEqual(sec, { n: 1, auto: false, bands: 12 });
    assert.ok(await p.$('svg path'), 'wykres przekroju');
    await shot('wyniki');
    await p.click('[data-vopt=auto]'); await p.selectOption('#srcSel', 'env:ULS:min'); await p.waitForTimeout(200); await shot('wyniki-obwiednia');
    await p.click('[data-tab=rebar]'); await p.waitForTimeout(300); await shot('zbrojenie');
    await p.click('[data-tab=draw]'); await p.waitForTimeout(300); await shot('rysunek');
    const [dxf] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=saveDxf]')]);
    assert.ok(dxf.suggestedFilename().endsWith('.dxf'), dxf.suggestedFilename());
    await p.click('[data-tab=report]');
    await p.fill('[data-path="meta.name"]', 'Strop żółć'); await p.dispatchEvent('[data-path="meta.name"]', 'change');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=reportDocx]')]);
    assert.equal(dl.suggestedFilename(), 'Strop zolc - raport.docx');
    await p.click('[data-act=saveVariant]'); await p.waitForTimeout(300);
    const st = await p.evaluate(() => window.__TEK.db.list('0.7.0')[0]?.warianty[0].status);
    assert.equal(st, 'aktualne');
    await p.click('[data-tab=ai]');
    const [dl2] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=aiPackage]')]);
    assert.ok(dl2.suggestedFilename().endsWith('.zip'));
    await p.click('[data-tab=start]'); await p.waitForTimeout(200); await shot('start-projekt');
    await p.click('[data-tab=podstawy]'); await shot('podstawy');
    assert.deepEqual(errs, [], 'błędy w konsoli przeglądarki');
    console.log('test interfejsu: OK');
  } finally { await b.close(); srv.kill(); }
})().catch(e => { console.error(e); process.exit(1); });
