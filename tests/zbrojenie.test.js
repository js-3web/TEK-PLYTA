// Dobór prętów (etap B). Wartości oczekiwane liczone ręcznie (komentarze).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseExtra, anchorageLength, areaPerMeter, punchingLayout, selectRebar, checkMeshSpacing } from '../src/design/rebar.js';
import { designMaterials } from '../src/norms/en1992-pl.js';
import { defaultProject, runProject } from '../src/app/pipeline.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v} vs ${ref}`);
const mat = designMaterials('C30/37');

test('dodatki w rozstawie siatki: ΔAs = 600 mm²/m przy s = 150 → ϕ12 (754), nie ϕ10 (524)', () => {
  // ϕ10: 78,54·1000/150 = 523,6 < 600;  ϕ12: 113,10·1000/150 = 754,0 ≥ 600
  close(areaPerMeter(10, 150), 523.6, 'ϕ10 co 150');
  const r = chooseExtra(600, 150);
  assert.deepEqual([r.phi, r.s, r.perSpacing], [12, 150, 1]); close(r.As, 754.0, 'As');
  assert.equal(chooseExtra(0, 150), null);
});

test('ΔAs = 4000 mm²/m przy s = 150: ϕ25 za mało (3272) → dwa pręty na rozstaw: ϕ20 co 75 (4189), światło 55 ≥ 20 mm', () => {
  const r = chooseExtra(4000, 150);
  assert.deepEqual([r.phi, r.s, r.perSpacing], [20, 75, 2]); close(r.As, 4188.8, 'As');
  assert.equal(chooseExtra(20000, 150).fail, true);
});

test('lbd (8.4): ϕ16, C30/37, γc = 1,4 — dobre warunki 541 mm, słabe 773 mm', () => {
  // fctd = 1,0·2,0/1,4 = 1,4286; fbd = 2,25·1,4286 = 3,2143; lb,rqd = 16/4·434,78/3,2143 = 541,1
  const g = anchorageLength(16, mat);
  close(g.fbd, 3.2143, 'fbd'); close(g.lbd, 541.06, 'lbd');
  // słabe: fbd = 0,7·3,2143 = 2,25 → lb,rqd = 4·434,78/2,25 = 772,9
  close(anchorageLength(16, mat, { good: false }).lbd, 772.95, 'lbd słabe');
  // lb,min = max(0,3·lb,rqd; 10ϕ; 100) — dla ϕ8: lb,rqd = 270,5 > 100
  close(anchorageLength(8, mat).lbd, 270.53, 'ϕ8');
});

test('rozstaw maksymalny 9.3.1.1(3): h = 200, s = 300 → przekroczone 2h ≤ 250; s = 150 bez uwag', () => {
  const d = { h: 0.2, bottom: { sX: 0.3, sY: 0.15 }, top: { sX: 0.15, sY: 0.15 } };
  assert.equal(checkMeshSpacing(d).length, 1);
  assert.equal(checkMeshSpacing({ ...d, bottom: { sX: 0.15, sY: 0.15 } }).length, 0);
});

test('przebicie 9.4.3: słup 400×400, d = 200, Asw = 387 mm²/obw., uout,ef = 4,651 m → 2 obwody ϕ8: 8 i 11 gałęzi', () => {
  // uout = 1,6 + 2π·r → r = 0,4857 m; s0 = 0,5d = 100, sr = 0,75d = 150;
  // n = ⌊(0,4857 − 1,5·0,2 − 0,1)/0,15⌋ + 1 = 1 → min 2 obwody: r = 0,10 i 0,25 m
  // r = 0,10: P = 1,6 + 0,628 = 2,228 m, st ≤ 1,5d = 0,3 → ⌈7,43⌉ = 8;  Asw: ⌈387/50,27⌉ = 8 → 8 gałęzi ϕ8
  // r = 0,25: P = 3,171 m → ⌈10,57⌉ = 11 gałęzi; Asw,min = 0,08·√30/500·150·288/1,5 = 25,3 mm² ≤ 50,3
  const sq = [[4.8, 4.8], [5.2, 4.8], [5.2, 5.2], [4.8, 5.2]];
  const geo = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]], holes: [] };
  const lay = punchingLayout({ label: 'S1', d: 0.2, shearReinforcement: { AswPerPerimeter: 387.3, uOutEf: 4.6513 } }, { label: 'S1', pts: sq }, geo, mat);
  close(lay.rOut, 0.48565, 'r uout', 2e-3);
  assert.equal(lay.nPerimeters, 2); assert.equal(lay.phi, 8);
  assert.deepEqual(lay.perimeters.map(p => p.legs), [8, 11]);
  assert.deepEqual([lay.s0, lay.sr], [0.1, 0.15]);
});

test('wzorzec DXF: strefy pokrywają wszystkie węzły z ΔAs > 0; zapewnione ≥ wymagane; dodatki z katalogu', () => {
  const p = { ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
    loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } } };
  const res = runProject(p);
  assert.equal(res.ok, true);
  const rb = res.rebar;
  assert.ok(!rb.warnings.some(w => w.code === 'zbrojenie-niepokryte'), JSON.stringify(rb.warnings));
  for (const [key, L] of Object.entries(rb.layers)) for (const z of L.zones) {
    if (z.bar.fail) continue;
    assert.ok([8, 10, 12, 16, 20, 25].includes(z.bar.phi), `${z.id} ϕ`);
    assert.ok(z.bar.As + 1e-9 >= z.dAsMax, `${z.id}: ${z.bar.As} < ${z.dAsMax}`);
    assert.ok(z.rect.x1 > z.rect.x0 && z.rect.y1 > z.rect.y0, `${z.id} prostokąt`);
  }
  assert.ok(Object.values(rb.layers).some(L => L.zones.length), 'wzorzec wymaga dozbrojenia');
});
