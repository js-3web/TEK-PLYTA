// Element kontrolny MITC3 (Mindlin–Reissner).
// Wzorzec płyty grubej: związek Wanga dla płyt swobodnie podpartych (twardo),
//   w_Mindlin = w_Kirchhoff + M / (kappa G t),  M = (Mx + My) / (1 + nu)  — moment Marcusa.
//   C.M. Wang, J.N. Reddy, K.H. Lee, "Shear Deformable Beams and Plates", Elsevier 2000.
//   Dla t/a = 0,1, nu = 0,3: w = 0,004273 qa^4/D (z wartości Kirchhoffa wg Timoshenki).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stiffness } from '../src/mitc3.js';
import { parallelogramMesh, simplySupported } from '../src/mesh.js';
import { solvePlate } from '../src/model.js';

const E = 30e6, nu = 0.3, a = 6, q = 10;
const near = (v, ref, tol, msg) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v.toPrecision(5)} vs ${ref}`);

function ssSquare(n, t, element = 'MITC3') {
  const A = [a, 0], B = [0, a];
  const mesh = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat: { E, nu, t }, q, fix: simplySupported(mesh, A, B), element });
  const D = E * t ** 3 / (12 * (1 - nu * nu));
  const c = mesh.id(n / 2, n / 2);
  return { r, w: r.w(c) * D / (q * a ** 4), m: r.m[c][0] / (q * a * a) };
}

test('MITC3: ruchy sztywne i symetria macierzy', () => {
  const xy = [[0.1, 0.2], [1.3, 0.4], [0.5, 1.1]];
  const K = stiffness(xy, { E, nu, t: 0.2 });
  // ruch sztywny: w = c0 + c1 x + c2 y, obroty zgodne (gamma = 0)
  const modes = [xy.flatMap(() => [1, 0, 0]), xy.flatMap(([x]) => [x, 0, -1]), xy.flatMap(([, y]) => [y, 1, 0])];
  const sc = Math.max(...K.flat().map(Math.abs));
  for (const u of modes) for (const row of K) assert.ok(Math.abs(row.reduce((s, k, j) => s + k * u[j], 0)) < 1e-9 * sc);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) assert.ok(Math.abs(K[i][j] - K[j][i]) <= 1e-9 * Math.abs(K[i][i]));
});

test('MITC3: brak blokady ścinania — płyta bardzo cienka (t/a = 0,001) daje wynik Kirchhoffa', () => {
  near(ssSquare(32, 0.006).w, 0.00406, 0.01, 'ugięcie');
});

test('MITC3: płyta gruba (t/a = 0,1) — ugięcie z odkształceniem postaciowym (Wang)', () => {
  const { w } = ssSquare(32, 0.6);
  near(w, 0.004273, 0.01, 'ugięcie');
});

test('MITC3: równowaga reakcji', () => {
  const { r } = ssSquare(8, 0.2);
  assert.ok(Math.abs(r.totalReaction + r.totalLoad) <= 1e-9 * r.totalLoad);
});

test('DKT i MITC3 zgodne dla płyty cienkiej (różnica momentu w środku < 1 %)', () => {
  near(ssSquare(32, 0.06, 'MITC3').m, ssSquare(32, 0.06, 'DKT').m, 0.01, 'moment MITC3 vs DKT');
});
