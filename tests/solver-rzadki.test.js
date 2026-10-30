// Solver rzadki (nested dissection + Cholesky up-looking) == solver profilowy (RCM + skyline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { buildModel } from '../src/model.js';
import { SparseSymMatrix, sparseCholesky, sparseSolve } from '../src/sparse.js';

test('mała macierz: rozkład rzadki odtwarza rozwiązanie układu gęstego', () => {
  // macierz 5×5 dodatnio określona z zerami poza wzorcem
  const A = [[4, 1, 0, 0, 1], [1, 5, 2, 0, 0], [0, 2, 6, 1, 0], [0, 0, 1, 3, 1], [1, 0, 0, 1, 7]];
  const cols = A.map((_, j) => A.map((r, i) => (i <= j && r[j] !== 0 ? i : -1)).filter(i => i >= 0));
  const M = new SparseSymMatrix(5, cols);
  for (let j = 0; j < 5; j++) for (const i of cols[j]) M.add(i, j, A[i][j]);
  const xTrue = [1, -2, 3, 0.5, -1];
  const b = A.map(r => r.reduce((s, v, k) => s + v * xTrue[k], 0));
  const x = sparseSolve(sparseCholesky(M), b);
  x.forEach((v, k) => assert.ok(Math.abs(v - xTrue[k]) < 1e-12));
});

test('macierz nieokreślona (płyta niepodparta): czytelny błąd', () => {
  const M = new SparseSymMatrix(2, [Int32Array.from([0]), Int32Array.from([0, 1])]);
  M.add(0, 0, 1); M.add(0, 1, 1); M.add(1, 1, 1); // [[1,1],[1,1]] — osobliwa
  assert.throws(() => sparseCholesky(M), /dodatnio określona/);
});

test('wzorzec DXF: oba solvery dają te same przemieszczenia (1e-9) i solver rzadki ma mniejszy czynnik', () => {
  const geo = importGeometry(readDxf(readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1')));
  const mesh = generateMesh(geo, { h0: 0.6 });
  const fix = new Map();
  for (const [, segs] of [['K1', mesh.tags.segments.get('K1')], ['W1', mesh.tags.segments.get('W1')]]) for (const n of segs.flat()) fix.set(n, { w: true });
  for (const c of geo.columns) for (const ie of mesh.tags.regions.get(c.label)) for (const n of mesh.elems[ie]) fix.set(n, { w: true });
  const args = { nodes: mesh.nodes, elems: mesh.elems, mat: { E: 33e6, nu: 0.2, t: 0.25 }, fix };
  const a = buildModel({ ...args, solver: 'sparse' }), b = buildModel({ ...args, solver: 'skyline' });
  const ra = a.solveCase({ q: 10 }), rb = b.solveCase({ q: 10 });
  const sc = Math.max(...rb.u.map(Math.abs));
  ra.u.forEach((v, d) => assert.ok(Math.abs(v - rb.u[d]) < 1e-9 * sc));
  assert.ok(Math.abs(ra.totalReaction - rb.totalReaction) < 1e-9 * Math.abs(rb.totalReaction));
  assert.ok(a.factorSize < b.factorSize, `czynnik rzadki ${a.factorSize} vs profil ${b.factorSize}`);
});
