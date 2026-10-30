// Siły poprzeczne z równowagi (vx = ∂mx/∂x + ∂mxy/∂y) — porównanie z rozwiązaniem Naviera
// (szereg podwójny liczony w teście, niezależnie od MES) i z belką ciągłą.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parallelogramMesh, simplySupported } from '../src/mesh.js';
import { buildModel } from '../src/model.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { adjacency } from '../src/ordering.js';

// Navier, płyta kwadratowa a = 1 swobodnie podparta, q = 1: w = Σ 16q/(π⁶ D m n (m²+n²)²) sin(mπx) sin(nπy)
// Qx = −D ∂(∇²w)/∂x = Σ 16q/(π³ n (m²+n²)) cos(mπx) sin(nπy)   (m, n nieparzyste)
function navierQx(x, y, N = 401) {
  let Q = 0;
  for (let m = 1; m < N; m += 2) for (let n = 1; n < N; n += 2) Q += 16 / (Math.PI ** 3 * n * (m * m + n * n)) * Math.cos(m * Math.PI * x) * Math.sin(n * Math.PI * y);
  return Q;
}

test('płyta kwadratowa swobodnie podparta: vx wewnątrz = Navier (0,5 %), ∫vx dy na x = a/4 = Navier', () => {
  const n = 32, mesh = parallelogramMesh({ a: [1, 0], b: [0, 1], nx: n, ny: n });
  const r = buildModel({ nodes: mesh.nodes, elems: mesh.elems, mat: { E: 1e4, nu: 0.3, t: 0.05 }, fix: simplySupported(mesh, [1, 0], [0, 1]) }).solveCase({ q: 1 });
  for (const [i, j] of [[8, 16], [8, 8], [12, 20], [16, 8]]) {
    const ref = navierQx(i / n, j / n), v = r.v[mesh.id(i, j)][0];
    assert.ok(Math.abs(v - ref) < 0.005 * 0.3376 + 0.005 * Math.abs(ref), `vx(${i / n}, ${j / n}) = ${v} vs ${ref}`);
  }
  // całka na linii x = a/4: z szeregu ∫sin(nπy)dy = 2/(nπ)
  let ref = 0; for (let m = 1; m < 801; m += 2) for (let k = 1; k < 801; k += 2) ref += 16 / (Math.PI ** 3 * k * (m * m + k * k)) * Math.cos(m * Math.PI / 4) * 2 / (k * Math.PI);
  let I = 0; for (let j = 0; j < n; j++) I += (r.v[mesh.id(8, j)][0] + r.v[mesh.id(8, j + 1)][0]) / 2 / n;
  assert.ok(Math.abs(I / ref - 1) < 0.005, `∫vx = ${I} vs ${ref}`);
  // symetria: vy = vx po obrocie, w środku zero
  assert.ok(Math.abs(r.v[mesh.id(16, 16)][0]) < 1e-9 && Math.abs(r.v[mesh.id(16, 16)][1]) < 1e-9);
});

test('belka ciągła 2 × 6 m (siatka generatora): v(x) = 3/8·gL − g·x w przęśle, skok nad podporą', () => {
  const L = 6, B = 2, g = 5;
  const geo = { outline: [[0, 0], [2 * L, 0], [2 * L, B], [0, B]], holes: [], columns: [], edges: [], lineLoads: [], pointLoads: [], areaLoads: [],
    walls: [0, L, 2 * L].map((x, i) => ({ label: `W${i + 1}`, pts: [[x, 0], [x, B]] })) };
  const mesh = generateMesh(geo, { h0: 0.25 });
  const r = analyzeSlab(geo, mesh, { slab: { E: 30e6, nu: 0, t: 0.2, gamma: g / 0.2 }, walls: { 'domyślne': { rigid: true } } }).cases.get('G0');
  // Pojedyncze węzły nieregularnej siatki: rozrzut gradientu do ±8 % (szum momentów wzmacniany
  // różniczkowaniem); średnie w pasmach co 0,25 m: 2 % (brak przesunięcia wartości).
  // Bliżej podpory niż ~2 oczka średnia węzłowa przez załamanie momentów rozmywa gradient — ścinanie
  // i tak sprawdzane w odległości d od lica (6.2.1(8)).
  const bins = new Map();
  mesh.nodes.forEach((p, i) => {
    if (!(p[0] > 0.6 && p[0] < 5.4 && p[1] > 0.3 && p[1] < 1.7)) return;
    const ex = 3 / 8 * g * L - g * p[0];
    assert.ok(Math.abs(r.v[i][0] - ex) < 0.08 * 5 / 8 * g * L, `x=${p[0].toFixed(2)}: ${r.v[i][0]} vs ${ex}`);
    const k = Math.round(p[0] * 4); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(r.v[i][0] - ex);
  });
  for (const [k, d] of bins) assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) / d.length) < 0.02 * 5 / 8 * g * L, `pasmo x≈${k / 4}`);
  // nad podporą pośrednią (x = 6) w odległości d = 0,17 m: największa |v| z otoczenia węzła ≥ 0,95 dokładnej
  // (kontrola 6.2.2 mnoży vEd przy podporach liniowych przez 1,05 — pokrywa ten zapas)
  const adj = adjacency(mesh.nodes.length, mesh.elems), v0 = r.v.map(v => Math.hypot(v[0], v[1]));
  for (const s of [-1, 1]) {
    const sel = mesh.nodes.map((p, i) => [p, i]).filter(([p]) => Math.abs(p[0] - (6 + s * 0.17)) < 0.125 && p[1] > 0.3 && p[1] < 1.7);
    const ex = 5 / 8 * g * L - g * 0.17;
    for (const [, i] of sel) assert.ok(Math.max(v0[i], ...adj[i].map(k => v0[k])) >= 0.95 * ex, `x=${mesh.nodes[i][0].toFixed(2)}`);
  }
});
