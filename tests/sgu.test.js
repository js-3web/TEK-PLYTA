// SGU (etap 5b): pełzanie i skurcz (zał. B), przekrój zarysowany, rysy (7.3.4), ugięcia (7.4.3) w MES.
// Wartości oczekiwane liczone ręcznie (komentarze); ugięcia MES porównane z niezależnym całkowaniem
// krzywizn belki (Maxwell–Mohr) przy tej samej interpolacji ζ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creepCoefficient, shrinkageStrain } from '../src/design/creep.js';
import { crackedSection, crackWidth, effectiveStiffness, shrinkageCurvature, longTermDeflection } from '../src/design/sls.js';
import { designMaterials } from '../src/norms/en1992-pl.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { slabEnvelopes } from '../src/combinations.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v} vs ${ref} (${((v / ref - 1) * 100).toFixed(2)} %)`);

test('pełzanie (zał. B): C30/37, RH = 50 %, h0 = 250 mm, t0 = 28 dni, cement N → φ = 2,2907', () => {
  // fcm = 38 > 35: α1 = (35/38)^0,7 = 0,94406; α2 = (35/38)^0,2 = 0,98369
  // φRH = [1 + 0,5/(0,1·250^(1/3))·α1]·α2 = [1 + 0,79370·0,94406]·0,98369 = 1,72077
  // β(fcm) = 16,8/√38 = 2,72532;  β(t0) = 1/(0,1 + 28^0,2) = 1/(0,1 + 1,94729) = 0,48845
  // φ0 = 1,72077·2,72532·0,48845 = 2,2907 (rys. 3.1 dla tych danych: ok. 2,3 — zgodne)
  const r = creepCoefficient({ fck: 30, RH: 50, h0: 250, t0: 28, cement: 'N' });
  close(r.phiRH, 1.72077, 'φRH'); close(r.betaFcm, 2.72532, 'β(fcm)'); close(r.betaT0, 0.48845, 'β(t0)');
  close(r.phi, 2.2907, 'φ(∞,28)');
});

test('skurcz (3.8–3.12, B.11): C30/37, RH = 50 %, h0 = 250 mm, cement N → εcs = 0,4358 ‰', () => {
  // εcd,0 = 0,85·(220 + 110·4)·exp(−0,12·38/10)·1e-6·1,55·(1 − 0,5³) = 0,85·660·0,63381·1,35625 = 482,2e-6
  // (tabl. 3.2, fck 30, RH 50 — interpolacja ok. 0,478 ‰ — zgodne)
  // kh(250) = (0,85 + 0,75)/2 = 0,80 → εcd = 385,8e-6;  εca = 2,5·(30 − 10)e-6 = 50e-6
  const r = shrinkageStrain({ fck: 30, RH: 50, h0: 250, cement: 'N' });
  close(r.ecd0, 482.24e-6, 'εcd,0'); close(r.kh, 0.8, 'kh'); close(r.eca, 50e-6, 'εca');
  close(r.ecs, 435.79e-6, 'εcs');
});

test('przekrój zarysowany: b = 1000, d = 200, As = 1000 mm², αe = 15 → x = 63,90 mm, I_II = 364,8e6 mm⁴', () => {
  // αe·ρ = 15·0,005 = 0,075;  x/d = −0,075 + √(0,075² + 0,15) = 0,31949 → x = 63,899
  // I_II = 1000·63,899³/3 + 15·1000·136,101² = 86,97e6 + 277,85e6 = 364,82e6
  const r = crackedSection({ h: 250, d: 200, As: 1000, alphaE: 15 });
  close(r.x, 63.899, 'x'); close(r.III, 364.82e6, 'I_II');
});

test('rysy (7.3.4): M = 40 kNm/m, h = 250, d = 210, #12 co 150 (754 mm²), c = 34, C30/37 → wk = 0,247 mm', () => {
  // αe = 200/33 = 6,0606; ρ = 0,0035905; x = 0,187991·210 = 39,478 mm; I_II = 153,39e6 mm⁴
  // σs = 6,0606·40e6·170,522/153,39e6 = 269,5 MPa
  // hc,ef = min(2,5·40; (250 − 39,48)/3; 125) = 70,17 mm → ρp,eff = 754/70174 = 0,010745
  // εsm − εcm = max[(269,5 − 0,4·2,9/0,010745·(1 + 6,0606·0,010745))/2e5; 0,6·269,5/2e5] = max(7,73e-4; 8,09e-4) = 8,085e-4
  // sr,max = 3,4·34 + 0,8·0,5·0,425·12/0,010745 = 115,6 + 189,86 = 305,5 mm  (s = 150 ≤ 5·(34 + 6) = 200)
  // wk = 305,5·8,085e-4 = 0,2470 mm
  const r = crackWidth({ M: 40, h: 250, d: 210, As: 754, c: 34, phi: 12, s: 150, fctm: 2.9, Ecm: 33000 });
  close(r.x, 39.478, 'x'); close(r.sigmaS, 269.51, 'σs', 2e-3); close(r.hcef, 70.174, 'hc,ef');
  close(r.eps, 8.085e-4, 'εsm − εcm', 2e-3); close(r.srMax, 305.46, 'sr,max', 2e-3); close(r.wk, 0.2470, 'wk', 3e-3);
  assert.equal(r.cracked, true);
  // poniżej momentu rysującego Mcr = 2,9·1000·250²/6 = 30,2 kNm/m: brak rys
  assert.equal(crackWidth({ M: 25, h: 250, d: 210, As: 754, c: 34, phi: 12, s: 150, fctm: 2.9, Ecm: 33000 }).wk, 0);
});

// Pasmo 6 × 2 m swobodnie podparte na dwóch ścianach sztywnych (praca jednokierunkowa jak belka)
function strip({ q, t = 0.2, L = 6 }) {
  const B = 2, geo = {
    outline: [[0, 0], [L, 0], [L, B], [0, B]], holes: [], columns: [], edges: [], lineLoads: [], pointLoads: [],
    areaLoads: [{ label: 'Q1', pts: [[0, 0], [L, 0], [L, B], [0, B]] }],
    walls: [{ label: 'W1', pts: [[0, 0], [0, B]] }, { label: 'W2', pts: [[L, 0], [L, B]] }],
  };
  const mesh = generateMesh(geo, { h0: 0.2 });
  const analysis = analyzeSlab(geo, mesh, { slab: { E: 33e6, nu: 0, t }, walls: { 'domyślne': { rigid: true } }, loads: { Q1: q }, selfWeight: false });
  const env = slabEnvelopes(analysis.cases, { Q1: { type: 'G' } }); // obciążenie stałe → w QP z wsp. 1,0
  const mid = mesh.nodes.reduce((b, p, i) => (Math.hypot(p[0] - L / 2, p[1] - 1) < Math.hypot(mesh.nodes[b][0] - L / 2, mesh.nodes[b][1] - 1) ? i : b), 0);
  return { analysis, env, mid, L };
}
const mat = designMaterials('C30/37');
const depths = { bottom: { x: 0.17, y: 0.16 }, top: { x: 0.17, y: 0.16 } };

test('ugięcie bez zarysowania (małe obciążenie): w = 5qL⁴/(384·Ec,eff·I), Ec,eff = Ecm/(1 + φ)', () => {
  const { analysis, env, mid, L } = strip({ q: 2 }); // M = 2·36/8 = 9 kNm/m < Mcr = 2,9·200²/6 = 19,3
  const phi = 2;
  const r = longTermDeflection({ analysis, env, mat, reinf: { bottomX: 500, bottomY: 300, topX: 300, topY: 300 }, depths, h: 0.2, phi, nu: 0 });
  const EI = 33e6 / (1 + phi) * 0.2 ** 3 / 12; // kNm²/m
  close(r.w[mid], 5 * 2 * L ** 4 / (384 * EI), 'w środek', 0.01);
  assert.equal(r.cracked.reduce((s, v) => s + v, 0), 0, 'brak elementów zarysowanych');
});

test('ugięcie z zarysowaniem: MES (iteracja, płyta ortotropowa) = całkowanie krzywizn belki w 3 %', () => {
  const q = 12, phi = 2, As = 500, h = 200, d = 170;
  const { analysis, env, mid, L } = strip({ q });
  const r = longTermDeflection({ analysis, env, mat, reinf: { bottomX: As, bottomY: 300, topX: 300, topY: 300 }, depths, h: 0.2, phi, nu: 0 });
  assert.ok(r.converged, `zbieżność: ${JSON.stringify(r.history)}`);
  // niezależnie: w(L/2) = ∫ M(x)/EI_eff(M) · m̄(x) dx, m̄ = x/2 (x ≤ L/2), symetria → 2·∫_0^{L/2}
  const Ec = 33000 / (1 + phi), n = 2000;
  let w = 0;
  for (let k = 0; k < n; k++) {
    const x = (k + 0.5) * (L / 2) / n, M = q * x * (L - x) / 2;
    const { EI } = effectiveStiffness({ M, h, d, As, Ec, fctm: mat.fctm });
    w += 2 * M / EI * (x / 2) * (L / 2) / n;
  }
  assert.ok(r.cracked.some(v => v), 'są elementy zarysowane');
  close(r.w[mid], w, 'w środek (zarysowanie)', 0.03);
});

test('skurcz: krzywizna stała na belce swobodnie podpartej → w = κ·L²/8', () => {
  const { analysis, env, mid, L } = strip({ q: 1 }); // bez zarysowania
  const ecs = 4e-4, phi = 2, Ec = 33000 / (1 + phi), As = 500;
  const r = longTermDeflection({ analysis, env, mat, reinf: { bottomX: As, bottomY: As, topX: 300, topY: 300 }, depths, h: 0.2, phi, ecs, nu: 0 });
  // κ = εcs·αe·As·(d − h/2)/I = 4e-4·(200000/11000)·500·(170 − 100)/(1000·200³/12) [1/mm]
  const kappa = shrinkageCurvature({ ecs, zeta: 0, h: 200, d: 170, As, Ec }); // 1/m
  close(kappa, 4e-4 * (200000 / 11000) * 500 * 70 / (1000 * 200 ** 3 / 12) * 1000, 'κcs');
  close(r.wShrink[mid], kappa * L * L / 8, 'w od skurczu', 0.02);
});
