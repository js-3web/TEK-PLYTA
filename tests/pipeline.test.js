// Łańcuch całego projektu (pipeline): wzorzec DXF → wszystkie wyniki; błędy danych bez domysłów.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultProject, runProject, meshArea, supportE } from '../src/app/pipeline.js';

const dxf = readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1');
const project = () => ({
  ...defaultProject(), dxf,
  loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } },
});

test('siatka #12 co 150 = 754 mm²/m; E podpór z materiału', () => {
  assert.ok(Math.abs(meshArea(0.012, 0.15) - 753.98) < 0.01);
  assert.equal(supportE({ material: 'zelbet', concrete: 'C30/37' }), 33e6);
  assert.equal(supportE({ material: 'stal' }), 210e6);
  assert.throws(() => supportE({ material: 'mur' }), /moduł E muru/);
});

test('brak wartości lub kategorii obciążenia → błąd danych, bez obliczeń', () => {
  const p = project(); delete p.loads.Q2; p.loads.P1.category = '';
  const r = runProject(p);
  assert.equal(r.ok, false); assert.equal(r.stage, 'dane');
  assert.deepEqual(r.errors.map(e => e.code).sort(), ['brak-kategorii', 'brak-obciazenia']);
});

test('wzorzec: pełne obliczenia — równowaga, mapy w węzłach, przebicie, SGU', () => {
  const r = runProject(project());
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  for (const e of r.equilibrium) assert.ok(e.error < 1e-6, `${e.case}: ${e.reactions} vs ${e.load}`);
  const N = r.mesh.nodes.length;
  for (const [k, m] of Object.entries(r.maps)) assert.equal(m.length, N, k);
  assert.equal(r.punching.length, 7);
  assert.ok(r.summary.wLtMax > 0 && r.sls.converged);
  assert.deepEqual(r.cases, ['G0', 'Q1', 'Q2', 'L1', 'P1']);
  // wynik musi dać się przesłać między wątkami (structured clone) i zapisać jako JSON
  assert.doesNotThrow(() => structuredClone(r));
});
