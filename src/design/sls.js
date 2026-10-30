// SGU płyty: przekrój zarysowany, rysy (7.3.4) i ugięcia z zarysowaniem, pełzaniem i skurczem (7.4.3).
// Jednostki w funkcjach przekroju: mm, N, MPa (pas b = 1000 mm); momenty wejściowe w kNm/m.

import { buildModel } from '../model.js';
import { designMomentEnvelope } from './bending.js';
import { creepCoefficient, shrinkageStrain } from './creep.js';
import { pointInPolygon } from '../geometry/polygon.js';

// Przekrój prostokątny b = 1000 mm, zbrojenie rozciągane As na wysokości d, αe = Es/Ec.
// Faza I (niezarysowana): przekrój brutto (zbrojenie pominięte — po stronie bezpiecznej dla ugięć).
// Faza II: beton rozciągany pominięty; x z równania momentów statycznych.
export function crackedSection({ h, d, As, alphaE }) {
  const b = 1000, rho = As / (b * d), ar = alphaE * rho;
  const x = d * (-ar + Math.sqrt(ar * ar + 2 * ar));
  const III = b * x ** 3 / 3 + alphaE * As * (d - x) ** 2;
  return { x, III, II: b * h ** 3 / 12 };
}

// Szerokość rys wk (7.3.4) dla momentu M [kNm/m] (kombinacja quasi-stała).
// c — otulina prętów tej warstwy [mm], phi — średnica [mm], s — rozstaw [mm].
// k1 = 0,8; k2 = 0,5 (zginanie); k3 = 3,4; k4 = 0,425; kt = 0,4 (obciążenie długotrwałe) — wartości zalecane.
export function crackWidth({ M, h, d, As, c, phi, s, fctm, Ecm, Es = 200000 }) {
  const alphaE = Es / Ecm;
  const { x, III } = crackedSection({ h, d, As, alphaE });
  const Mcr = fctm * 1000 * h * h / 6 / 1e6; // kNm/m
  const sigmaS = alphaE * Math.abs(M) * 1e6 * (d - x) / III;
  const hcef = Math.min(2.5 * (h - d), (h - x) / 3, h / 2);
  const rhoPeff = As / (1000 * hcef);
  const eps = Math.max((sigmaS - 0.4 * fctm / rhoPeff * (1 + alphaE * rhoPeff)) / Es, 0.6 * sigmaS / Es); // (7.9)
  const srMax = s <= 5 * (c + phi / 2) ? 3.4 * c + 0.8 * 0.5 * 0.425 * phi / rhoPeff : 1.3 * (h - x); // (7.11), (7.14)
  const cracked = Math.abs(M) > Mcr;
  return { wk: cracked ? srMax * eps : 0, cracked, Mcr, sigmaS, x, III, hcef, rhoPeff, eps, srMax };
}

// wmax wg tabl. 7.1N (wartości zalecane; NA — do potwierdzenia), kombinacja quasi-stała, żelbet
export const WMAX = { X0: 0.4, XC1: 0.4, XC2: 0.3, XC3: 0.3, XC4: 0.3, XD1: 0.3, XD2: 0.3, XD3: 0.3, XS1: 0.3, XS2: 0.3, XS3: 0.3 };

// Sztywność efektywna pasma 1 m w jednym kierunku (7.4.3(3)): krzywizna interpolowana
// κ = ζ·κII + (1 − ζ)·κI, ζ = 1 − β(Mcr/M)², β = 0,5 (obciążenie długotrwałe).
// Zwraca EI_eff [kNm²/m] i ζ. Ec [MPa], wymiary w mm.
// zetaMin — ζ z poprzedniej iteracji: zarysowanie jest nieodwracalne (rysa się nie zamyka), więc
// ζ tylko rośnie, sztywność tylko maleje — iteracja jest monotoniczna i zbieżna.
export function effectiveStiffness({ M, h, d, As, Ec, fctm, Es = 200000, beta = 0.5, zetaMin = 0 }) {
  const { II, III } = crackedSection({ h, d, As: Math.max(As, 1e-6), alphaE: Es / Ec });
  const Mcr = fctm * 1000 * h * h / 6 / 1e6;
  const zeta = Math.max(zetaMin, Math.abs(M) > Mcr ? 1 - beta * (Mcr / Math.abs(M)) ** 2 : 0);
  const EI = 1 / (zeta / (Ec * III) + (1 - zeta) / (Ec * II)) * 1e-9; // N·mm² → kNm² (pas 1 m)
  return { EI, zeta, Mcr, II, III };
}

// Krzywizna skurczowa (7.21): κcs = εcs·αe·S/I, interpolowana ζ jak wyżej. S — moment statyczny
// zbrojenia rozciąganego względem środka ciężkości przekroju (faza I: osi brutto h/2; faza II: osi obojętnej).
export function shrinkageCurvature({ ecs, zeta, h, d, As, Ec, Es = 200000 }) {
  const alphaE = Es / Ec, { x, II, III } = crackedSection({ h, d, As: Math.max(As, 1e-6), alphaE });
  const kI = ecs * alphaE * As * (d - h / 2) / II, kII = ecs * alphaE * As * (d - x) / III; // 1/mm
  return (zeta * kII + (1 - zeta) * kI) * 1000; // 1/m
}

// Ugięcia długotrwałe płyty metodą 7.4.3 w MES (specyfikacja, sekcja 6):
//   1. rozwiązanie liniowe dla kombinacji quasi-stałej, Ec,eff = Ecm/(1 + φ);
//   2. w każdym elemencie i kierunku: ζ i sztywność efektywna przy zbrojeniu rzeczywistym;
//   3. nowa macierz (płyta ortotropowa), ponowne rozwiązanie — aż zmiana ugięcia < tol;
//   4. skurcz: krzywizna (7.21) jako obciążenie (osobny przypadek, dodany do ugięcia).
// Wejście:
//   analysis — wynik analyzeSlab (modelParams, caseDefs); env — slabEnvelopes; mat — designMaterials
//   reinf — { bottomX, bottomY, topX, topY }: As zapewnione [mm²/m] w węzłach (Float64Array) albo liczba
//   depths — effectiveDepths(); h [m]; phi — współczynnik pełzania; ecs — skurcz (0 = pominięty)
// onlyPermanent: tylko oddziaływania stałe G (do ugięcia natychmiastowego przed wykończeniem).
// beta — 7.4.3(3): 0,5 obciążenie długotrwałe, 1,0 jednorazowe krótkotrwałe (ugięcie natychmiastowe).
// Sprężyny podpór (słupy, ściany) dzielone przez (1 + φ) — podpory pełzają jak płyta (po stronie
// bezpiecznej dla ugięć przęseł; bez tego słupy względnie za sztywne → za mocne utwierdzenie).
export function longTermDeflection({ analysis, env, mat, reinf, depths, h, phi, ecs = 0, nu = 0.2, tol = 0.01, maxIter = 20, onlyPermanent = false, beta = 0.5 }) {
  const { modelParams: P, caseDefs } = analysis;
  const { nodes, elems } = P;
  const Ec = mat.Ecm * 1000 / (1 + phi); // MPa, (7.20)
  const hmm = h * 1000;
  const As = (key, i) => (typeof reinf[key] === 'number' ? reinf[key] : reinf[key][i]);

  // kombinacja quasi-stała: wszystkie przypadki z ψ2 (G: 1,0); obciążenie = suma przypadków
  const qp = env.schemes.QP[0].hi.map((v, c) => (onlyPermanent && env.schemes.types[c] !== 'G' ? 0 : v));
  const names = env.schemes.names, defs = names.map(n => caseDefs.find(c => c.name === n));
  const qOf = defs.map(cd => (typeof cd.q === 'function' ? cd.q : () => cd.q));
  const load = {
    q: ie => qOf.reduce((s, f, c) => s + qp[c] * f(ie), 0),
    point: defs.flatMap((cd, c) => cd.point.map(p => ({ node: p.node, P: qp[c] * p.P }))),
  };

  const D = (Dx, Dy, cracked) => {
    const n = cracked ? 0 : nu, Dxy = Math.sqrt(Dx * Dy);
    return [[Dx, n * Dxy, 0], [n * Dxy, Dy, 0], [0, 0, (1 - n) / 2 * Dxy]];
  };
  // sztywność startowa: niezarysowana, Ec,eff
  const D0 = Ec * 1e3 * h ** 3 / 12; // kNm (E w kPa)
  let Dx = new Float64Array(elems.length).fill(D0), Dy = new Float64Array(elems.length).fill(D0);
  let cracked = new Uint8Array(elems.length);
  let w = null, it = 0, change = Infinity, zetaX = new Float64Array(elems.length), zetaY = new Float64Array(elems.length);
  const signX = new Int8Array(elems.length).fill(1), signY = new Int8Array(elems.length).fill(1); // +1 rozciągany spód
  const history = [];
  let model;
  for (; it < maxIter && change > tol; it++) {
    const Dsnap = [Float64Array.from(Dx), Float64Array.from(Dy), Uint8Array.from(cracked)];
    const springs = P.springs.map(sp => ({ ...sp, kw: sp.kw / (1 + phi), ktx: sp.ktx / (1 + phi), kty: sp.kty / (1 + phi), ktxy: (sp.ktxy || 0) / (1 + phi) }));
    model = buildModel({ ...P, springs, elemD: ie => D(Dsnap[0][ie], Dsnap[1][ie], Dsnap[2][ie]) });
    const r = model.solveCase(load);
    const wNew = Float64Array.from({ length: nodes.length }, (_, i) => r.u[3 * i]);
    const wMax = Math.max(...wNew.map(Math.abs));
    if (w) change = Math.max(...wNew.map((v, i) => Math.abs(v - w[i]))) / wMax;
    w = wNew;
    history.push({ wMax, change });
    // momenty w elementach (średnia z węzłów) → kierunek rozciągania i sztywność efektywna
    for (let ie = 0; ie < elems.length; ie++) {
      const e = elems[ie], m = [0, 1, 2].map(k => (r.m[e[0]][k] + r.m[e[1]][k] + r.m[e[2]][k]) / 3);
      const pick = (mm, key0, key1, dKey, zetaMin) => {
        const top = mm < 0, key = top ? key1 : key0;
        const AsE = e.reduce((s, n) => s + As(key, n), 0) / 3;
        return effectiveStiffness({ M: Math.abs(mm) + Math.abs(m[2]), h: hmm, d: depths[top ? 'top' : 'bottom'][dKey] * 1000, As: AsE, Ec, fctm: mat.fctm, zetaMin, beta });
      };
      const sx = pick(m[0], 'bottomX', 'topX', 'x', zetaX[ie]), sy = pick(m[1], 'bottomY', 'topY', 'y', zetaY[ie]);
      signX[ie] = m[0] < 0 ? -1 : 1; signY[ie] = m[1] < 0 ? -1 : 1;
      Dx[ie] = sx.EI; Dy[ie] = sy.EI; zetaX[ie] = sx.zeta; zetaY[ie] = sy.zeta;
      cracked[ie] = sx.zeta > 0 || sy.zeta > 0 ? 1 : 0;
    }
  }
  // skurcz: krzywizna w kierunku x i y przy sztywnościach z ostatniej iteracji (ten sam model)
  let wcs = new Float64Array(nodes.length);
  if (ecs > 0) {
    // krzywizna skurczowa wygina płytę w stronę zbrojenia rozciąganego (znak momentu z rozwiązania QP)
    const kcs = elems.map((e, ie) => {
      const curv = (zeta, sign, key0, key1, dKey) => {
        const key = sign < 0 ? key1 : key0, AsE = e.reduce((s, n) => s + As(key, n), 0) / 3;
        return sign * shrinkageCurvature({ ecs, zeta, h: hmm, d: depths[sign < 0 ? 'top' : 'bottom'][dKey] * 1000, As: AsE, Ec });
      };
      return [curv(zetaX[ie], signX[ie], 'bottomX', 'topX', 'x'), curv(zetaY[ie], signY[ie], 'bottomY', 'topY', 'y'), 0];
    });
    const rcs = model.solveCase({ curvature: ie => kcs[ie] });
    wcs = Float64Array.from({ length: nodes.length }, (_, i) => rcs.u[3 * i]);
  }
  const total = Float64Array.from(w, (v, i) => v + wcs[i]);
  return { w: total, wCreep: w, wShrink: wcs, Ec, iterations: it, converged: change <= tol, history, zetaX, zetaY, cracked };
}

// SGU całej płyty: rysy w węzłach (4 warstwy) i ugięcia długotrwałe z oceną L/250 i L/500 (7.4.1(4),(5)).
//   uls     — wynik designSlab (zbrojenie zapewnione = max(siatka, As wymagane SGN))
//   design  — jak w designSlab + rozstawy prętów { bottom: { sX, sY }, top: { sX, sY } } [m]
//   sls     — { RH [%], cement, t0 [dni], h0? [mm] (domyślnie h — wysychanie obustronne),
//               exposure: 'XC1'…, phi? i ecs? (nadpisanie wartości z zał. B),
//               fields: [{ label, pts: wielokąt [m], L [m] }] — pola do oceny ugięć (L zadaje projektant) }
// Ugięcie po wykonaniu wykończeń (L/500) w przybliżeniu: w_całk − w_natychmiastowe od G (Ecm, bez pełzania).

export function checkSlabSLS({ geo, mesh, analysis, env, uls, design, sls }) {
  const mat = uls.mat, h = design.h, hmm = h * 1000, N = mesh.nodes.length;
  const h0 = sls.h0 ?? hmm;
  const creep = creepCoefficient({ fck: mat.fck, RH: sls.RH, h0, t0: sls.t0 ?? 28, cement: sls.cement ?? 'N' });
  const shr = shrinkageStrain({ fck: mat.fck, RH: sls.RH, h0, cement: sls.cement ?? 'N' });
  const phi = sls.phi ?? creep.phi, ecs = sls.ecs ?? shr.ecs;
  const reinf = {};
  for (const k of ['bottomX', 'bottomY', 'topX', 'topY'])
    reinf[k] = Float64Array.from(uls.nodes[k].AsReq, v => Math.max(Number.isFinite(v) ? v : 0, uls.nodes[k].base));

  // --- rysy: momenty Wood–Armera z kombinacji quasi-stałej ---
  const mQP = designMomentEnvelope(env.fields.nodes, env.schemes.QP);
  const wmax = WMAX[sls.exposure ?? 'XC1'];
  const cracks = {};
  let wkMax = 0;
  for (const [key, face, dir] of [['bottomX', 'bottom', 'x'], ['bottomY', 'bottom', 'y'], ['topX', 'top', 'x'], ['topY', 'top', 'y']]) {
    const d = uls.depths[face][dir] * 1000, phiBar = design[face][dir === 'x' ? 'phiX' : 'phiY'] * 1000;
    const s = (design[face][dir === 'x' ? 'sX' : 'sY'] ?? 0.15) * 1000, c = hmm - d - phiBar / 2;
    const wk = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const M = Math.abs(mQP[key][i]);
      if (M < 1e-9) continue;
      wk[i] = crackWidth({ M, h: hmm, d, As: reinf[key][i], c, phi: phiBar, s, fctm: mat.fctm, Ecm: mat.Ecm * 1000 }).wk;
      wkMax = Math.max(wkMax, wk[i]);
    }
    cracks[key] = wk;
  }

  // --- ugięcia ---
  const common = { analysis, env, mat, reinf, depths: uls.depths, h };
  const lt = longTermDeflection({ ...common, phi, ecs });
  const inst = longTermDeflection({ ...common, phi: 0, ecs: 0, onlyPermanent: true, beta: 1.0 });
  const fields = (sls.fields ?? []).map(f => {
    let iMax = -1;
    mesh.nodes.forEach((p, i) => { if (pointInPolygon(p, f.pts) && (iMax < 0 || lt.w[i] > lt.w[iMax])) iMax = i; });
    if (iMax < 0) return { label: f.label, L: f.L, error: 'brak węzłów w polu' };
    const w = lt.w[iMax], dw = w - inst.w[iMax];
    return { label: f.label, L: f.L, node: iMax, at: mesh.nodes[iMax], w, wLim: f.L / 250, dw, dwLim: f.L / 500,
      ok: w <= f.L / 250 && dw <= f.L / 500 };
  });
  const warnings = [];
  if (!lt.converged) warnings.push({ code: 'ugiecia-brak-zbieznosci', msg: `Ugięcia: iteracja zarysowania niezbieżna po ${lt.iterations} krokach.` });
  if (wkMax > wmax) warnings.push({ code: 'rysy', msg: `Szerokość rys ${wkMax.toFixed(2)} mm > wmax = ${wmax} mm (${sls.exposure ?? 'XC1'}).` });
  return { phi, ecs, creep, shrinkage: shr, wmax, cracks, wkMax, deflection: lt, instantaneousG: inst, fields, warnings };
}
