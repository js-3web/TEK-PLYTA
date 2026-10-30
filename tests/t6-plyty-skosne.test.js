// T6: płyty skośne Morleya (30°) i Razzaque'a (60°), płyta cienka L/h = 1000.
// Wartości wzorcowe: M. Grbac, D. Ribarić, "Accurate numerical solutions for standard
// skew plate benchmark problems", Zbornik radova (Građevinski fakultet Rijeka) 25(1),
// 2022, s. 237–246, doi:10.32762/zr.25.1.15 — tabl. 4 (Morley) i tabl. 8–9 (Razzaque).
// Dane: L = 100, E = 10,92, nu = 0,3, q = 1, podparcie: w = 0 (obroty swobodne).
// Klasyczne wartości Morleya (0,408 / 1,91 / 1,08) nie są dokładne (obcięty szereg) —
// dlatego test używa wartości z siatek 1024×1024 z artykułu.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh } from '../src/mesh.js';
import { solvePlate } from '../src/model.js';

const E = 10.92, nu = 0.3, L = 100, t = 0.1, q = 1, D = E * t ** 3 / (12 * (1 - nu * nu));
const deg = Math.PI / 180;
const near = (v, ref, tol, msg) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v.toFixed(4)} vs ${ref} (${((v / ref - 1) * 100).toFixed(2)} %)`);

test('T6a płyta skośna Morleya 30°, L/h = 1000 (siatka 64×64, tolerancja 1 %)', () => {
  const n = 64, A = [L, 0], B = [L * Math.cos(30 * deg), L * Math.sin(30 * deg)];
  const m = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const fix = new Map();
  for (const l of Object.values(m.edge)) for (const k of l) fix.set(k, { w: true });
  const r = solvePlate({ nodes: m.nodes, elems: m.elems, mat: { E, nu, t }, q, fix });
  const c = m.id(n / 2, n / 2), [mx, my, mxy] = r.m[c], R = Math.hypot((mx - my) / 2, mxy);
  near(r.w(c) * D / (1e-3 * q * L ** 4), 0.4134, 0.01, 'w');
  near(((mx + my) / 2 + R) / (1e-2 * q * L * L), 1.922, 0.01, 'M1');
  near(((mx + my) / 2 - R) / (1e-2 * q * L * L), 1.106, 0.01, 'M2');
});

test('T6b płyta skośna Razzaque\'a 60°, dwie krawędzie podparte, L/h = 1000 (siatka 32×32, tolerancja 1 %)', () => {
  const n = 32, A = [L, 0], B = [L * Math.cos(60 * deg), L * Math.sin(60 * deg)];
  const m = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const fix = new Map();
  for (const k of [...m.edge.bottom, ...m.edge.top]) fix.set(k, { w: true });
  const r = solvePlate({ nodes: m.nodes, elems: m.elems, mat: { E, nu, t }, q, fix });
  const c = m.id(n / 2, n / 2);
  near(r.w(c) * D / (1e-2 * q * L ** 4), 0.7912, 0.01, 'w');
  near(r.m[c][1] / (1e-1 * q * L * L), 0.9601, 0.01, 'My');
});
