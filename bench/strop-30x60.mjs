// Pomiar wydajności: strop 30 x 60 m, krawędzie podparte, węzły w losowej kolejności
// (symulacja siatki z DXF). Uruchom: node bench/strop-30x60.mjs [oczka...]
import { parallelogramMesh } from '../src/mesh.js';
import { buildModel } from '../src/model.js';

function shuffled(mesh, seed = 1) {
  const n = mesh.nodes.length, perm = Array.from({ length: n }, (_, i) => i);
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  const nodes = new Array(n); perm.forEach((p, i) => { nodes[p] = mesh.nodes[i]; });
  const map = i => perm[i];
  return { nodes, elems: mesh.elems.map(e => e.map(map)), edge: Object.fromEntries(Object.entries(mesh.edge).map(([k, v]) => [k, v.map(map)])) };
}

const sizes = process.argv.slice(2).map(Number);
for (const h of sizes.length ? sizes : [1.0, 0.5, 0.35, 0.25]) {
  const m = shuffled(parallelogramMesh({ a: [60, 0], b: [0, 30], nx: Math.round(60 / h), ny: Math.round(30 / h) }));
  const fix = new Map(); for (const l of Object.values(m.edge)) for (const k of l) fix.set(k, { w: true });
  for (const solver of ['sparse', 'skyline']) {
    const t0 = performance.now();
    const model = buildModel({ nodes: m.nodes, elems: m.elems, mat: { E: 32e6, nu: 0.2, t: 0.25 }, fix, solver });
    const t1 = performance.now();
    model.solveCase({ q: 10 });
    const t2 = performance.now();
    console.log(`oczko ${h} m | niewiadome ${model.neq} | ${solver.padEnd(7)} | czynnik ${(model.factorSize * 8 / 1e6).toFixed(0)} MB | budowa+rozkład ${((t1 - t0) / 1000).toFixed(1)} s | przypadek ${((t2 - t1) / 1000).toFixed(2)} s`);
  }
}
