// T1, T2, T3, T4 i T5 ze specyfikacji TEK-PLYTA v1, sekcja 7.
//
// T3/T4 — wartości referencyjne: S. Timoshenko, S. Woinowsky-Krieger,
//   "Theory of Plates and Shells", 2nd ed., McGraw-Hill 1959:
//   tabl. 8 (płyta kwadratowa swobodnie podparta, nu = 0,3): w = 0,00406 qa^4/D, Mx = 0,0479 qa^2
//   tabl. 35 (płyta kwadratowa utwierdzona, nu = 0,3):       w = 0,00126 qa^4/D, Mx = 0,0231 qa^2,
//                                                           M krawędź (środek) = -0,0513 qa^2
//   Do potwierdzenia przez Jarka w egzemplarzu książki (status: wartości powszechnie cytowane).
// T5 — NAFEMS LE6 (The Standard NAFEMS Benchmarks, TNSB Rev. 3, 1990): romb o boku 1 m,
//   kąt 30°, t = 0,01 m, E = 210 GPa, nu = 0,3, p = 0,7 kPa, w = 0 na krawędziach;
//   cel: sigma1 = 0,802 MPa na dolnej powierzchni w środku (punkt E).
//   Uwaga: część dokumentacji podaje 7 kPa — błąd potwierdzony w wątku PrePoMax/Abaqus.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh, simplySupported, clamped } from '../src/mesh.js';
import { solvePlate } from '../src/model.js';

const near = (val, ref, tol, msg) =>
  assert.ok(Math.abs(val / ref - 1) <= tol, `${msg}: ${val.toPrecision(5)} vs ${ref} (odchyłka ${((val / ref - 1) * 100).toFixed(2)} %, dopuszczalne ${tol * 100} %)`);

const E = 30e6, nu = 0.3, t = 0.2, a = 6, q = 10; // kN, m
const D = E * t ** 3 / (12 * (1 - nu * nu));

function square(n, kind) {
  const A = [a, 0], B = [0, a];
  const mesh = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const fix = kind === 'ss' ? simplySupported(mesh, A, B) : clamped(mesh);
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat: { E, nu, t }, q, fix });
  const c = mesh.id(n / 2, n / 2), e = mesh.id(n / 2, 0);
  return { r, wc: r.w(c) * D / (q * a ** 4), mc: r.m[c][0] / (q * a * a), me: r.m[e][1] / (q * a * a) };
}

test('T1 równowaga: suma reakcji = suma obciążeń', () => {
  for (const kind of ['ss', 'cl']) {
    const { r } = square(8, kind);
    assert.ok(Math.abs(r.totalReaction + r.totalLoad) <= 1e-9 * r.totalLoad, kind);
  }
});

test('T2 zbieżność: błąd ugięcia maleje monotonicznie przy zagęszczaniu siatki', () => {
  const errs = [4, 8, 16, 32].map(n => Math.abs(square(n, 'ss').wc / 0.00406 - 1));
  for (let i = 1; i < errs.length; i++) assert.ok(errs[i] < errs[i - 1], `krok ${i}: ${errs}`);
});

test('T2 symetria: ugięcia symetryczne względem osi płyty kwadratowej', () => {
  const n = 8, A = [a, 0], B = [0, a];
  const mesh = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat: { E, nu, t }, q, fix: simplySupported(mesh, A, B) });
  const wc = r.w(mesh.id(n / 2, n / 2));
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const w1 = r.w(mesh.id(i, j)), w2 = r.w(mesh.id(n - i, j)), w3 = r.w(mesh.id(j, i));
    assert.ok(Math.abs(w1 - w2) < 1e-3 * wc && Math.abs(w1 - w3) < 1e-3 * wc);
  }
});

test('T3 płyta kwadratowa swobodnie podparta (Timoshenko, tabl. 8)', () => {
  const { wc, mc } = square(32, 'ss');
  near(wc, 0.00406, 0.02, 'ugięcie środka');
  near(mc, 0.0479, 0.03, 'moment środka');
});

test('T4 płyta kwadratowa utwierdzona (Timoshenko, tabl. 35)', () => {
  const { wc, mc, me } = square(32, 'cl');
  near(wc, 0.00126, 0.02, 'ugięcie środka');
  near(mc, 0.0231, 0.03, 'moment środka');
  near(me, -0.0513, 0.03, 'moment w połowie krawędzi');
});

test('T5 NAFEMS LE6 — płyta skośna, sigma1 = 0,802 MPa', () => {
  const Es = 210e9, nus = 0.3, ts = 0.01, p = 700, n = 64, ang = 30 * Math.PI / 180;
  const A = [1, 0], B = [Math.cos(ang), Math.sin(ang)];
  const mesh = parallelogramMesh({ a: A, b: B, nx: n, ny: n });
  const fix = new Map();
  for (const list of Object.values(mesh.edge)) for (const k of list) fix.set(k, { w: true });
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat: { E: Es, nu: nus, t: ts }, q: p, fix });
  const [mx, my, mxy] = r.m[mesh.id(n / 2, n / 2)];
  const m1 = (mx + my) / 2 + Math.hypot((mx - my) / 2, mxy);
  near(6 * m1 / ts ** 2 / 1e6, 0.802, 0.03, 'sigma1 [MPa]');
});
