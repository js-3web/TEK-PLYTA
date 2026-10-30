// Wymiarowanie całej płyty na wzorcu DXF: spójność modułów (obwiednie → Wood–Armer → przekrój, przebicie).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { slabEnvelopes } from '../src/combinations.js';
import { designSlab } from '../src/design/slab.js';
import { designSection } from '../src/design/bending.js';

const geo = importGeometry(readDxf(readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1')));
const mesh = generateMesh(geo, { h0: 0.5 });
const h = 0.25;
const { cases } = analyzeSlab(geo, mesh, {
  slab: { E: 33e6, nu: 0.2, t: h }, columns: { 'domyślne': { E: 33e6, H: 3.6, bottom: 'fixed' } },
  walls: { 'domyślne': { E: 8e6, t: 0.25, H: 3.6, bottom: 'pinned' } }, edges: { 'domyślne': { type: 'pinned' } },
  loads: { Q1: 3, Q2: 7.5, L1: 6.2, P1: 25 },
});
const env = slabEnvelopes(cases, { G0: { type: 'G' }, L1: { type: 'G' }, Q1: { type: 'Q', category: 'B' }, Q2: { type: 'Q', category: 'E' }, P1: { type: 'Q', category: 'E' } });
const design = {
  concrete: 'C30/37', steel: 'B500SP', h, cover: { bottom: 0.025, top: 0.025 },
  bottom: { phiX: 0.012, phiY: 0.012, outer: 'x' }, top: { phiX: 0.012, phiY: 0.012, outer: 'x' },
  base: { bottom: { x: 754, y: 754 }, top: { x: 754, y: 754 } }, // #12 co 150
};
const r = designSlab({ geo, mesh, env, design });

test('zbrojenie w węźle = przekrój 1 m dla momentu wymiarującego; dozbrojenie = As,req − siatka', () => {
  for (const [key, L] of Object.entries(r.nodes)) {
    for (let i = 0; i < mesh.nodes.length; i += 37) {
      const M = Math.abs(L.design[i]);
      if (M < 1e-9 || L.fail[i]) continue;
      const s = designSection(M, h, L.d, r.mat);
      assert.ok(Math.abs(L.AsReq[i] - s.AsReq) < 1e-9, `${key} węzeł ${i}`);
      assert.ok(Math.abs(L.AsExtra[i] - Math.max(0, s.AsReq - 754)) < 1e-9);
    }
    // uśrednianie nad słupami nie zwiększa momentu i nie dotyczy dołu
    L.design.forEach((v, i) => assert.ok(Math.abs(v) <= Math.abs(L.peak[i]) + 1e-12, `${key} ${i}`));
    if (key.startsWith('bottom')) L.design.forEach((v, i) => assert.equal(v, L.peak[i]));
  }
});

test('przebicie: typy słupów wzorca, β uproszczone, siła = obwiednia SGN reakcji', () => {
  const types = Object.fromEntries(r.punching.map(p => [p.label, p.type]));
  // S3 przy narożu wklęsłym (13,8; 6,7) → krawędziowy + ostrzeżenie; S4 przy krawędzi y = 14,2;
  // S6, S7 przy narożach wypukłych (24; 6,7) i (24; 14,2)
  assert.deepEqual(types, { S1: 'wewnetrzny', S2: 'wewnetrzny', S3: 'krawedziowy', S4: 'krawedziowy', S5: 'wewnetrzny', S6: 'narozny', S7: 'narozny' });
  assert.ok(r.warnings.some(w => w.code === 'przebicie-naroze-wklesle' && w.msg.includes('S3')));
  for (const p of r.punching) {
    assert.equal(p.beta, { wewnetrzny: 1.15, krawedziowy: 1.4, narozny: 1.5 }[p.type]);
    assert.equal(p.VEd, Math.max(0, env.supports.ULS.find(s => s.label === p.label).V.max));
  }
  // S1 sprawdzony ręcznie: u1 = 1,6 + 4π·0,213 = 4,277 m; d = (219 + 207)/2 = 213 mm
  const s1 = r.punching.find(p => p.label === 'S1');
  assert.ok(Math.abs(s1.u1 - (1.6 + 4 * Math.PI * 0.213)) < 1e-3);
  assert.ok(Math.abs(s1.rho - Math.sqrt(754 / 219000 * 754 / 207000)) < 1e-9);
});
