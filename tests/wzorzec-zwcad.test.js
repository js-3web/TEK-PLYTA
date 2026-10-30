// Wzorzec po zapisie w ZWCAD 2022 jako DXF 2010 (AC1024, ANSI_1250) — plik od użytkownika, 2026-10-30.
// Sprawdza, że program czyta rysunek „po przejściu przez CAD” tak samo jak oryginał z ezdxf,
// i że cały łańcuch DXF → siatka → MES → obwiednie działa na nim bez błędów.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { slabEnvelopes, coefficientsAt, combine } from '../src/combinations.js';

const geoOf = f => importGeometry(readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1')));
const zw = geoOf('tests/fixtures/wzorzec-zwcad2022-r2010.dxf');

test('ZWCAD 2022 → DXF 2010: geometria identyczna z oryginałem wzorca, bez błędów i ostrzeżeń', () => {
  const org = geoOf('assets/TEK-PLYTA_wzorzec.dxf');
  assert.deepEqual(zw.errors, []);
  assert.deepEqual(zw.warnings, []);
  for (const k of ['outline', 'holes', 'columns', 'walls', 'edges', 'areaLoads', 'lineLoads', 'pointLoads'])
    assert.deepEqual(zw[k], org[k], k);
});

test('ZWCAD 2022 → DXF 2010: łańcuch do obwiedni SGN; równowaga w kombinacji rządzącej każdego słupa', () => {
  const mesh = generateMesh(zw, { h0: 0.5 });
  const { cases, warnings } = analyzeSlab(zw, mesh, {
    slab: { E: 33e6, nu: 0.2, t: 0.25 },
    columns: { 'domyślne': { E: 33e6, H: 3.6, bottom: 'fixed' } },
    walls: { 'domyślne': { E: 8e6, t: 0.25, H: 3.6, bottom: 'pinned' } },
    edges: { 'domyślne': { type: 'pinned' } },
    loads: { Q1: 3, Q2: 7.5, L1: 6.2, P1: 25 },
  });
  assert.deepEqual(warnings, []);
  const actions = {
    G0: { type: 'G' }, L1: { type: 'G' }, // L1 — ścianka działowa jako obciążenie stałe
    Q1: { type: 'Q', category: 'B' }, Q2: { type: 'Q', category: 'E' }, P1: { type: 'Q', category: 'E' },
  };
  const env = slabEnvelopes(cases, actions);
  const V = env.fields.supports.V, load = [...cases.values()].map(r => r.totalLoad);
  env.supports.ULS.forEach((s, j) => {
    assert.ok(Number.isFinite(s.V.max) && s.V.max >= s.V.min, s.label);
    const e = { govMax: Int16Array.from(env.supports.ULS, x => env.schemes.ULS.findIndex(v => v.name === x.V.govMax)) };
    const coef = coefficientsAt(V, env.schemes.ULS, e.govMax, j, +1);
    const sumV = combine(V, coef).reduce((a, b) => a + b, 0), sumL = load.reduce((a, l, c) => a + coef[c] * l, 0);
    assert.ok(Math.abs(sumV / sumL - 1) < 1e-6, `${s.label}: ${sumV} vs ${sumL}`);
  });
});
