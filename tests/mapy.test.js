// Mapy: izolinie, przekroje, ekstrema, skala — na polach o znanym przebiegu i na belce wzorcowej.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh } from '../src/mesh.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { isolines, sectionProfile, extrema, makeScale } from '../src/viz/maps.js';

const mesh = parallelogramMesh({ a: [4, 0], b: [0, 2], nx: 16, ny: 8 });

test('izolinia pola f = x na poziomie 1,3: odcinki na prostej x = 1,3, łączna długość = wysokość 2 m', () => {
  const f = mesh.nodes.map(([x]) => x);
  const [iso] = isolines(mesh.nodes, mesh.elems, f, [1.3]);
  let L = 0;
  for (const [p, q] of iso.segs) { assert.ok(Math.abs(p[0] - 1.3) < 1e-12 && Math.abs(q[0] - 1.3) < 1e-12); L += Math.hypot(q[0] - p[0], q[1] - p[1]); }
  assert.ok(Math.abs(L - 2) < 1e-9, `długość ${L}`);
});

test('przekrój pola liniowego f = 2x + 3y: wartości dokładne; poza płytą null; ekstrema na końcach', () => {
  const f = mesh.nodes.map(([x, y]) => 2 * x + 3 * y);
  const pr = sectionProfile(mesh.nodes, mesh.elems, f, [0.1, 0.2], [3.9, 1.7], 50);
  for (const o of pr.samples) assert.ok(Math.abs(o.v - (2 * o.p[0] + 3 * o.p[1])) < 1e-9);
  assert.ok(Math.abs(pr.L - Math.hypot(3.8, 1.5)) < 1e-12);
  assert.ok(Math.abs(pr.extrema.max.v - (2 * 3.9 + 3 * 1.7)) < 1e-9 && Math.abs(pr.extrema.min.v - (0.2 + 0.6)) < 1e-9);
  assert.equal(sectionProfile(mesh.nodes, mesh.elems, f, [-1, 1], [-0.5, 1], 4).samples[0].v, null);
});

test('ekstrema i skala: symetryczna, ręczna, liczba pasm, kolor poza zakresem przycięty', () => {
  const v = [3, -7, 5, NaN, 1];
  assert.deepEqual([extrema(v).iMax, extrema(v).iMin], [2, 1]);
  const s = makeScale(v, { symmetric: true, bands: 14 });
  assert.deepEqual([s.min, s.max, s.levels.length], [-7, 7, 15]);
  const m = makeScale(v, { min: 0, max: 10, bands: 10 });
  assert.deepEqual([m.min, m.max, m.dataMin, m.dataMax], [0, 10, -7, 5]);
  assert.deepEqual(m.color(-100), m.color(0.5), 'poniżej skali — pierwsze pasmo');
});

test('przekrój przez pasmo płyty (belka ciągła 2 × 6 m): moment wzdłuż osi = M(x) belki w 3 %', () => {
  const L = 6, B = 2, g = 5;
  const geo = { outline: [[0, 0], [2 * L, 0], [2 * L, B], [0, B]], holes: [], columns: [], edges: [], lineLoads: [], pointLoads: [], areaLoads: [],
    walls: [0, L, 2 * L].map((x, i) => ({ label: `W${i + 1}`, pts: [[x, 0], [x, B]] })) };
  const m = generateMesh(geo, { h0: 0.25 });
  const r = analyzeSlab(geo, m, { slab: { E: 30e6, nu: 0, t: 0.2, gamma: g / 0.2 }, walls: { 'domyślne': { rigid: true } } }).cases.get('G0');
  const mx = r.m.map(x => x[0]);
  const pr = sectionProfile(m.nodes, m.elems, mx, [0, 1], [2 * L, 1], 240);
  for (const o of pr.samples) {
    const x = o.s, xx = x <= L ? x : 2 * L - x, ex = 3 / 8 * g * L * xx - g * xx * xx / 2;
    if (Math.abs(x - L) > 0.5 && x > 0.3 && x < 2 * L - 0.3) assert.ok(Math.abs(o.v - ex) < 0.03 * 22.5, `x=${x.toFixed(2)}: ${o.v} vs ${ex}`);
  }
  assert.ok(Math.abs(pr.extrema.min.v / -22.5 - 1) < 0.03, `min nad podporą ${pr.extrema.min.v}`);
});
