// Podpory sprężyste: testy z wynikiem znanym z góry (statyka i przypadki graniczne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh, clamped } from '../src/mesh.js';
import { solvePlate } from '../src/model.js';
import { columnSprings } from '../src/supports.js';

const E = 30e6, nu = 0.2, t = 0.25, a = 6, q = 10;
const D = E * t ** 3 / (12 * (1 - nu * nu));
const mat = { E, nu, t };

test('płyta na 4 sprężynach narożnych: każda przenosi Q/4, osiadanie = Q/(4k)', () => {
  const n = 12, mesh = parallelogramMesh({ a: [a, 0], b: [0, a], nx: n, ny: n });
  const kw = 5e4;
  const springs = mesh.corners.map(node => ({ node, kw }));
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat, q, springs });
  const Q = q * a * a;
  for (const node of mesh.corners) {
    assert.ok(Math.abs(-r.R[3 * node] / (Q / 4) - 1) < 1e-9, 'reakcja = Q/4');
    assert.ok(Math.abs(r.w(node) / (Q / (4 * kw)) - 1) < 1e-9, 'osiadanie = Q/(4k)');
  }
  assert.ok(Math.abs(r.totalReaction + r.totalLoad) < 1e-9 * Q, 'równowaga');
});

// Krawędzie: w = 0, obrót prostopadły do krawędzi na sprężynie k [kNm/rad/m]
function edgeRotSprings(n, kPerM) {
  const mesh = parallelogramMesh({ a: [a, 0], b: [0, a], nx: n, ny: n });
  const h = a / n, fix = new Map(), acc = new Map();
  const add = (node, d, k) => { const s = acc.get(node) || { node, ktx: 0, kty: 0 }; s[d] += k; acc.set(node, s); };
  for (const [edge, dof] of [['left', 'kty'], ['right', 'kty'], ['bottom', 'ktx'], ['top', 'ktx']])
    mesh.edge[edge].forEach((node, i, list) => {
      fix.set(node, { w: true });
      add(node, dof, kPerM * h * (i === 0 || i === list.length - 1 ? 0.5 : 1)); // pas przypadający na węzeł
    });
  const r = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat, q, fix, springs: [...acc.values()] });
  return r.w(mesh.id(n / 2, n / 2)) * D / (q * a ** 4);
}

test('sprężyny obrotowe na krawędziach: k -> 0 = przegub, k -> nieskończoność = utwierdzenie, pomiędzy monotonicznie', () => {
  const n = 32;
  const meshC = parallelogramMesh({ a: [a, 0], b: [0, a], nx: n, ny: n });
  const wCl = solvePlate({ nodes: meshC.nodes, elems: meshC.elems, mat, q, fix: clamped(meshC) }).w(meshC.id(n / 2, n / 2)) * D / (q * a ** 4);
  const ks = [0, 0.1 * D / a, D / a, 10 * D / a, 1e6 * D / a].map(k => edgeRotSprings(n, k));
  assert.ok(Math.abs(ks[0] / 0.00406 - 1) < 0.02, `k=0: ${ks[0]}`);
  assert.ok(Math.abs(ks.at(-1) / wCl - 1) < 1e-4, `k=inf: ${ks.at(-1)} vs ${wCl}`);
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i] < ks[i - 1], 'ugięcie maleje ze wzrostem k');
});

test('słup jako sprężyna: bardzo sztywna = podpora nieprzesuwna; sprężyna słupa wg E A / H, c E I / H', () => {
  const cs = columnSprings({ E: 32e6, b: 0.4, H: 3.6, bottom: 'fixed' });
  assert.ok(Math.abs(cs.kw - 32e6 * 0.16 / 3.6) < 1e-6 * cs.kw);
  assert.ok(Math.abs(cs.ktx - 4 * 32e6 * 0.4 ** 4 / 12 / 3.6) < 1e-6 * cs.ktx);
  assert.throws(() => columnSprings({ E: 32e6, b: 0.4, H: 0 }), /dodatnie/);

  const n = 16, mesh = parallelogramMesh({ a: [a, 0], b: [0, a], nx: n, ny: n });
  const fixEdges = new Map();
  for (const list of Object.values(mesh.edge)) for (const k of list) fixEdges.set(k, { w: true });
  const mid = mesh.id(n / 2, n / 2);
  const rigid = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat, q, fix: new Map([...fixEdges, [mid, { w: true }]]) });
  const spring = solvePlate({ nodes: mesh.nodes, elems: mesh.elems, mat, q, fix: fixEdges, springs: [{ node: mid, kw: 1e9 * D }] });
  const p = mesh.id(n / 4, n / 4);
  assert.ok(Math.abs(spring.w(p) / rigid.w(p) - 1) < 1e-5);
  assert.ok(Math.abs(spring.R[3 * mid] / rigid.R[3 * mid] - 1) < 1e-5);
});
