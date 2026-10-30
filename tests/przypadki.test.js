// Przypadki obciążeń: jeden rozkład macierzy, wiele rozwiązań; superpozycja.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh } from '../src/mesh.js';
import { buildModel } from '../src/model.js';

test('superpozycja: wynik dla stref A + B = suma wyników A i B (w, momenty, reakcje)', () => {
  const n = 12, a = 6, mesh = parallelogramMesh({ a: [2 * a, 0], b: [0, a], nx: 2 * n, ny: n });
  const fix = new Map();
  for (const l of Object.values(mesh.edge)) for (const k of l) fix.set(k, { w: true });
  const model = buildModel({ nodes: mesh.nodes, elems: mesh.elems, mat: { E: 30e6, nu: 0.2, t: 0.2 }, fix });
  const cx = ie => mesh.elems[ie].reduce((s, i) => s + mesh.nodes[i][0], 0) / 3;
  const A = model.solveCase({ q: ie => (cx(ie) < a ? 3 : 0) });                // strefa A: lewe pole
  const B = model.solveCase({ q: ie => (cx(ie) >= a ? 5 : 0), point: [{ node: mesh.id(n + 4, 4), P: 20 }] });
  const AB = model.solveCase({ q: ie => (cx(ie) < a ? 3 : 5), point: [{ node: mesh.id(n + 4, 4), P: 20 }] });
  const scale = Math.max(...AB.u.map(Math.abs));
  AB.u.forEach((v, d) => assert.ok(Math.abs(v - A.u[d] - B.u[d]) < 1e-10 * scale));
  AB.m.forEach((m, i) => m.forEach((v, r) => assert.ok(Math.abs(v - A.m[i][r] - B.m[i][r]) < 1e-8 * (1 + Math.abs(v)))));
  assert.ok(Math.abs(AB.totalReaction - A.totalReaction - B.totalReaction) < 1e-9 * AB.totalLoad);
  assert.ok(Math.abs(B.totalLoad - (5 * a * a + 20)) < 1e-9 * B.totalLoad, 'obciążenie strefy B + siła skupiona');
});
