// Momenty w węzłach na siatce z generatora: belka ciągła 2 × 6 m (pasmo 12 × 2 m na trzech ścianach sztywnych).
// Tablice belki dwuprzęsłowej: M_podpora = −0,125·gL² = −22,5; M(x) = 3/8·g·L·x − g·x²/2 w przęśle.
// Uzasadnienie decyzji „średnia ważona kątem zamiast SPR”: SPR dopasowuje wielomian do punktów wewnątrz
// elementów, więc nad podporą (załamanie wykresu momentów) ścina szczyt — po stronie niebezpiecznej.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';

test('belka ciągła z siatki generatora (oczko 0,25 m): moment podporowy w 2 %, przęsłowy w 1 %', () => {
  const L = 6, B = 2, g = 5, h0 = 0.25;
  const geo = {
    outline: [[0, 0], [2 * L, 0], [2 * L, B], [0, B]], holes: [], columns: [], edges: [], lineLoads: [], pointLoads: [], areaLoads: [],
    walls: [0, L, 2 * L].map((x, i) => ({ label: `W${i + 1}`, pts: [[x, 0], [x, B]] })),
  };
  const mesh = generateMesh(geo, { h0 });
  const r = analyzeSlab(geo, mesh, { slab: { E: 30e6, nu: 0, t: 0.2, gamma: g / 0.2 }, walls: { 'domyślne': { rigid: true } } }).cases.get('G0');
  mesh.nodes.forEach((p, i) => {
    if (Math.abs(p[0] - L) < 1e-6)
      assert.ok(Math.abs(r.m[i][0] / -22.5 - 1) < 0.02, `podpora y=${p[1].toFixed(2)}: ${r.m[i][0]}`);
    if (p[0] > 1 && p[0] < 4.5) { // przęsło z dala od podpór
      const ex = 3 / 8 * g * L * p[0] - g * p[0] ** 2 / 2;
      assert.ok(Math.abs(r.m[i][0] - ex) < 0.01 * 12.66, `przęsło x=${p[0].toFixed(2)}: ${r.m[i][0]} vs ${ex}`);
    }
  });
});
