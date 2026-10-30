// Generator siatki: pokrycie, zgodność, jakość, obiekty na siatce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh, buildPslg } from '../src/mesh/mesher.js';
import { dist, distPointPolyline } from '../src/geometry/polygon.js';

const geoOf = f => importGeometry(readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1')));
const template = geoOf('assets/TEK-PLYTA_wzorzec.dxf');
const mesh = generateMesh(template, { h0: 0.5 });

test('siatka pokrywa dokładnie płytę: pole elementów = pole płyty (obrys − otwory)', () => {
  assert.ok(Math.abs(mesh.quality.area - template.info.area) < 1e-9 * template.info.area);
});

test('zgodność: krawędź wewnętrzna należy do 2 elementów, brzegowa do 1 i leży na obrysie lub otworze', () => {
  const count = new Map();
  for (const e of mesh.elems) for (let k = 0; k < 3; k++) {
    const a = e[k], b = e[(k + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
    count.set(key, (count.get(key) || 0) + 1);
  }
  const bounds = [template.outline, ...template.holes.map(h => h.pts)];
  for (const [key, n] of count) {
    assert.ok(n === 1 || n === 2, `krawędź ${key} w ${n} elementach`);
    if (n === 1) {
      const [a, b] = key.split(',').map(Number);
      const mid = [(mesh.nodes[a][0] + mesh.nodes[b][0]) / 2, (mesh.nodes[a][1] + mesh.nodes[b][1]) / 2];
      assert.ok(Math.min(...bounds.map(p => distPointPolyline(mid, p, true))) < 1e-6, `krawędź brzegowa ${key} poza brzegiem płyty`);
    }
  }
});

test('jakość: kąt minimalny > 10°, mniej niż 2 % elementów poniżej 20°, orientacja CCW', () => {
  assert.ok(mesh.quality.minAngle > 10, `min kąt ${mesh.quality.minAngle}`);
  assert.ok(mesh.quality.below20 < 0.02 * mesh.quality.nElems);
  for (const [i, j, k] of mesh.elems) {
    const [a, b, c] = [mesh.nodes[i], mesh.nodes[j], mesh.nodes[k]];
    assert.ok((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]) > 0);
  }
});

test('rozmiar: bok elementu nie przekracza 1,5 × h(x) (pole rozmiaru), zagęszczenie przy słupach', () => {
  for (const e of mesh.elems) for (let k = 0; k < 3; k++) {
    const a = mesh.nodes[e[k]], b = mesh.nodes[e[(k + 1) % 3]];
    const h = mesh.size([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    assert.ok(dist(a, b) <= 1.5 * h + 1e-9, `bok ${dist(a, b).toFixed(3)} przy h = ${h.toFixed(3)}`);
  }
  // elementy w obrysie słupa: bok ≤ 1,5 × h0/4
  for (const ie of mesh.tags.regions.get('S1')) for (let k = 0; k < 3; k++) {
    const e = mesh.elems[ie];
    assert.ok(dist(mesh.nodes[e[k]], mesh.nodes[e[(k + 1) % 3]]) <= 1.5 * 0.125);
  }
});

test('obiekty na siatce: krawędzie K/W/L, regiony słupów i stref, węzeł siły skupionej', () => {
  for (const tag of ['K1', 'W1', 'L1', 'obrys', 'O1']) assert.ok(mesh.tags.segments.get(tag)?.length > 0, tag);
  for (const c of template.columns) {
    const els = mesh.tags.regions.get(c.label);
    const A = els.reduce((s, ie) => { const [a, b, d] = mesh.elems[ie].map(i => mesh.nodes[i]); return s + ((b[0] - a[0]) * (d[1] - a[1]) - (d[0] - a[0]) * (b[1] - a[1])) / 2; }, 0);
    const tolA = c.shape === 'circle' ? 0.02 : 1e-9; // okrąg zastąpiony wielokątem
    assert.ok(Math.abs(A / c.A - 1) <= tolA, `${c.label}: pole elementów ${A} vs ${c.A}`);
  }
  const lenK1 = mesh.tags.segments.get('K1').reduce((s, [i, j]) => s + dist(mesh.nodes[i], mesh.nodes[j]), 0);
  assert.ok(Math.abs(lenK1 - 6.7) < 1e-9, `długość K1 ${lenK1}`);
  const p = mesh.nodes[mesh.tags.points.get('P1')];
  assert.ok(dist(p, [20, 12]) < 1e-9);
});

test('szkielet (PSLG): przecięcie i nakładanie odcinków dzielą je we wspólnych punktach', () => {
  const g = buildPslg([
    { tag: 'A', pts: [[0, 0], [4, 0]], closed: false },
    { tag: 'B', pts: [[2, -1], [2, 1]], closed: false },   // przecina A w (2,0)
    { tag: 'C', pts: [[1, 0], [3, 0]], closed: false },   // nakłada się na A
  ]);
  const has = (x, y) => g.points.some(p => dist(p, [x, y]) < 1e-12);
  assert.ok(has(2, 0) && has(1, 0) && has(3, 0));
  const seg13 = g.segments.filter(([a, b]) => [a, b].every(i => g.points[i][1] === 0 && g.points[i][0] >= 1 && g.points[i][0] <= 3));
  assert.ok(seg13.length === 2 && seg13.every(s => s[2].includes('A') && s[2].includes('C')), 'wspólne odcinki mają obie etykiety');
});
