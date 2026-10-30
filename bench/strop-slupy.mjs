// Pomiar: strop 60 × 30 m na siatce słupów 6 × 6 m (słupy 40 × 40 cm), cały łańcuch.
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';

const sq = (cx, cy, b) => [[cx - b / 2, cy - b / 2], [cx + b / 2, cy - b / 2], [cx + b / 2, cy + b / 2], [cx - b / 2, cy + b / 2]];
const columns = [];
for (let i = 0; i <= 10; i++) for (let j = 0; j <= 5; j++) {
  const cx = Math.min(Math.max(i * 6, 0.2), 59.8), cy = Math.min(Math.max(j * 6, 0.2), 29.8);
  const pts = sq(cx, cy, 0.4);
  columns.push({ label: `S${columns.length + 1}`, pts, shape: 'rect', A: 0.16, Ix: 0.4 ** 4 / 12, Iy: 0.4 ** 4 / 12, c: [cx, cy] });
}
const outline = [[0, 0], [60, 0], [60, 30], [0, 30]];
const geo = { outline, holes: [], columns, walls: [], edges: [], areaLoads: [{ label: 'Q1', pts: outline }], lineLoads: [], pointLoads: [] };
for (const h0 of [0.6, 0.5, 0.4]) {
  const t0 = performance.now();
  const mesh = generateMesh(geo, { h0 });
  const t1 = performance.now();
  const { model, cases } = analyzeSlab(geo, mesh, {
    slab: { E: 33e6, nu: 0.2, t: 0.25 }, columns: { 'domyślne': { E: 33e6, H: 3.6, bottom: 'fixed' } }, loads: { Q1: 5 },
  });
  const t2 = performance.now();
  console.log(`h0 ${h0} m | węzły ${mesh.quality.nNodes} | elementy ${mesh.quality.nElems} | min kąt ${mesh.quality.minAngle.toFixed(1)}° | siatka ${((t1 - t0) / 1000).toFixed(1)} s | MES (rozkład + 2 przypadki) ${((t2 - t1) / 1000).toFixed(1)} s | niewiadome ${model.neq}`);
}
