// Przebicie (6.4). Oczekiwane wartości liczone ręcznie (komentarze), niezależnie od kodu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlPerimeter, punchingCheck } from '../src/design/punching.js';
import { designMaterials } from '../src/norms/en1992-pl.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v} vs ${ref} (${((v / ref - 1) * 100).toFixed(3)} %)`);
const sq = (cx, cy, b) => [[cx - b / 2, cy - b / 2], [cx + b / 2, cy - b / 2], [cx + b / 2, cy + b / 2], [cx - b / 2, cy + b / 2]];
const slab = (holes = []) => ({ outline: [[0, 0], [10, 0], [10, 10], [0, 10]], holes });
const d = 0.2;

test('u1 słup wewnętrzny 400×400, d = 200: 2·(c1 + c2) + 4πd = 4,1133 m', () => {
  const r = controlPerimeter({ pts: sq(5, 5, 0.4) }, slab(), d);
  close(r.u1, 1.6 + 4 * Math.PI * d, 'u1', 1e-4); assert.equal(r.type, 'wewnetrzny'); close(r.u0, 1.6, 'u0', 1e-9);
});

test('u1 słup krawędziowy przy krawędzi: c2 + 2c1 + 2πd; w odstępie g = 0,1 m: c2 + 2πd + 2(c1 + g) (rys. 6.15)', () => {
  let r = controlPerimeter({ pts: sq(0.2, 5, 0.4) }, slab(), d);
  close(r.u1, 0.4 + 0.8 + 2 * Math.PI * d, 'przy krawędzi', 1e-4); assert.equal(r.type, 'krawedziowy');
  close(r.u0, Math.min(0.4 + 3 * d, 0.4 + 2 * 0.4), 'u0 = min(c2 + 3d; c2 + 2c1) = 0,8 m', 1e-9);
  r = controlPerimeter({ pts: sq(0.3, 5, 0.4) }, slab(), d);
  close(r.u1, 0.4 + 2 * Math.PI * d + 2 * (0.4 + 0.1), 'odstęp 0,1 m', 1e-4);
});

test('u1 słup narożny przy narożu: c1 + c2 + πd; u0 = min(3d; c1 + c2) = 0,6 m', () => {
  const r = controlPerimeter({ pts: sq(0.2, 0.2, 0.4) }, slab(), d);
  close(r.u1, 0.8 + Math.PI * d, 'u1', 1e-4); assert.equal(r.type, 'narozny'); close(r.u0, 0.6, 'u0', 1e-9);
});

test('otwór w odległości ≤ 6d: część obwodu między stycznymi nieefektywna (słup okrągły D = 0,4)', () => {
  const circ = Array.from({ length: 72 }, (_, i) => [5 + 0.2 * Math.cos(i * Math.PI / 36), 5 + 0.2 * Math.sin(i * Math.PI / 36)]);
  // otwór 0,4 × 0,4 m, środek 1,0 m od środka słupa: styczne pod kątem ±atan(0,2/0,8) → Δθ = 0,48996 rad
  // obwód: okrąg R = 0,2 + 0,4 = 0,6 m → u1 = 2π·0,6 − 0,6·0,48996 = 3,76991 − 0,29398 = 3,47594 m
  const hole = { label: 'O1', pts: sq(6, 5, 0.4) };
  const r = controlPerimeter({ pts: circ, c: [5, 5] }, slab([hole]), d);
  close(r.u1, 2 * Math.PI * 0.6 - 0.6 * 2 * Math.atan(0.25), 'u1 z otworem', 2e-3);
  assert.deepEqual(r.shadows, ['O1']);
  // otwór dalej niż 6d = 1,2 m od lica: bez redukcji
  const far = controlPerimeter({ pts: circ, c: [5, 5] }, slab([{ label: 'O2', pts: sq(6.8, 5, 0.4) }]), d);
  assert.deepEqual(far.shadows, []); close(far.u1, 2 * Math.PI * 0.6, 'bez otworu', 2e-3);
});

test('nośność: VEd = 600 kN, β = 1,15, słup 400×400, d = 200, ρ = 0,8 %, C30/37, γc = 1,4 — liczone ręcznie', () => {
  const mat = designMaterials('C30/37');
  const u1 = 1.6 + 4 * Math.PI * d;
  const r = punchingCheck({ VEd: 600, beta: 1.15, u1, u0: 1.6, d, rhoX: 0.008, rhoY: 0.008, mat });
  // vEd = 1,15·600e3/(4113,27·200) = 0,83875 MPa
  close(r.vEd, 0.83875, 'vEd');
  // k = 1 + √(200/200) = 2,0;  CRd,c = 0,18/1,4 = 0,12857;  (100·0,008·30)^(1/3) = 24^(1/3) = 2,88450
  // vRd,c = 0,12857·2·2,88450 = 0,74173 MPa;  vmin = 0,035·2^1,5·√30 = 0,54222 MPa
  close(r.k, 2, 'k'); close(r.vRdc, 0.74173, 'vRd,c'); close(r.vmin, 0.54222, 'vmin');
  // vEd,0 = 690000/(1600·200) = 2,15625;  ν = 0,6·(1 − 30/250) = 0,528;  vRd,max = 0,4·0,528·21,4286 = 4,52571
  close(r.vEd0, 2.15625, 'vEd,0'); close(r.vRdMax, 4.52571, 'vRd,max');
  assert.equal(r.ok, false, 'vEd > vRd,c → potrzebne zbrojenie na przebicie');
  // (6.52): fywd,ef = 250 + 0,25·200 = 300 MPa; sr = 0,75d → Asw = (0,83875 − 0,75·0,74173)·4113,27·200/(2·300) = 387,3 mm²
  close(r.shearReinforcement.fywdEf, 300, 'fywd,ef');
  close(r.shearReinforcement.AswPerPerimeter, 387.3, 'Asw', 2e-3);
  // (6.54): uout,ef = 690000/(0,74173·200) = 4651,3 mm
  close(r.shearReinforcement.uOutEf, 4.6513, 'uout,ef', 2e-3);
  // mniejsza siła: bez zbrojenia na przebicie
  assert.equal(punchingCheck({ VEd: 400, beta: 1.15, u1, u0: 1.6, d, rhoX: 0.008, rhoY: 0.008, mat }).ok, true);
});

test('słup przy narożu wklęsłym obrysu (L): typ krawędziowy, u0 = obwód słupa w płycie, flaga', () => {
  // płyta L: naroże wklęsłe w (5, 5); słup 400×400 ze środkiem w (4,8; 4,8) — prawy bok (x = 5) leży
  // na krawędzi swobodnej x = 5 (y < 5), pozostałe trzy boki w płycie
  const L = { outline: [[0, 0], [5, 0], [5, 5], [10, 5], [10, 10], [0, 10]], holes: [] };
  const r = controlPerimeter({ pts: sq(4.8, 4.8, 0.4) }, L, d);
  assert.equal(r.reentrant, true); assert.equal(r.type, 'krawedziowy');
  close(r.u0, 1.2, 'u0 = trzy boki słupa w płycie', 1e-3);
  // u1: obwód 2d minus ćwiartka poza płytą (za narożem) — mniejszy niż pełny, większy niż 3/4 pełnego
  assert.ok(r.u1 < r.full && r.u1 > 0.75 * r.full, `${r.u1} vs ${r.full}`);
});
