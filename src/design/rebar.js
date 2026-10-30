// Dobór prętów (decyzje projektanta z 30.10.2026):
//   • siatkę podstawową zadaje projektant; program dokłada pręty DODATKOWE w rozstawie siatki
//     (wkładane między pręty siatki), np. „#12 co 150 + #16 co 150”;
//   • katalog: ϕ 8, 10, 12, 16, 20, 25 mm; rozstawy 100–300 mm co 25 mm.
// Strefy dozbrojenia: węzły z ΔAs > 0 → skupienia (sąsiedztwo siatki) → prostokąt wzdłuż prętów,
// wydłużony o al = d (9.2.1.3(2), przesunięcie obwiedni) i lbd (8.4.3–8.4.4), zaokrąglony do 50 mm.
// Zbrojenie na przebicie wg 9.4.3 i 6.4.5(4). Jednostki: m, mm², MPa.

import { adjacency } from '../ordering.js';
import { controlPerimeter } from './punching.js';

export const CATALOG = { diameters: [8, 10, 12, 16, 20, 25], spacings: [100, 125, 150, 175, 200, 225, 250, 275, 300] };
export const STIRRUPS = [8, 10, 12, 16];
const barArea = phi => Math.PI * phi * phi / 4;                    // mm²
export const areaPerMeter = (phi, s) => barArea(phi) * 1000 / s;   // mm²/m, s [mm]

// Pręty dodatkowe w rozstawie siatki s: najmniejsza ϕ z As ≥ ΔAs; gdy ϕ25 za mało — dwa pręty na rozstaw
// (co s/2), z kontrolą odstępu w świetle ≥ max(ϕ, 20 mm) (8.2(2)).
export function chooseExtra(dAs, s, { diameters = CATALOG.diameters } = {}) {
  if (!(dAs > 0)) return null;
  for (const phi of diameters) if (areaPerMeter(phi, s) >= dAs) return { phi, s, perSpacing: 1, As: areaPerMeter(phi, s) };
  for (const phi of diameters) {
    const As = 2 * areaPerMeter(phi, s);
    if (As >= dAs && s / 2 - phi >= Math.max(phi, 20)) return { phi, s: s / 2, perSpacing: 2, As };
  }
  return { fail: true, msg: `ΔAs = ${dAs.toFixed(0)} mm²/m nie mieści się w dodatkach przy siatce co ${s} mm — zwiększ siatkę lub grubość.` };
}

// Długość zakotwienia lbd (8.4.3, 8.4.4) przy α1…α5 = 1, σsd = fyd (po stronie bezpiecznej).
// good: dobre warunki przyczepności (8.4.2(2)); η2 = 1 dla ϕ ≤ 32.
export function anchorageLength(phi, mat, { good = true } = {}) {
  const fctd = mat.norm.alphaCT * mat.fctk005 / mat.gammaC;
  const fbd = 2.25 * (good ? 1.0 : 0.7) * 1.0 * fctd;               // (8.2)
  const lbRqd = phi / 4 * mat.fyd / fbd;                            // (8.3)
  const lbMin = Math.max(0.3 * lbRqd, 10 * phi, 100);               // (8.6)
  return { lbd: Math.max(lbRqd, lbMin), lbRqd, fbd, fctd };
}

// Warunki przyczepności 8.4.2(2), rys. 8.2: h ≤ 250 mm — wszystkie dobre; 250 < h ≤ 600 — górna połowa
// przekroju słaba; h > 600 — górne 300 mm słabe. Pręty dolne zawsze dobre.
export const goodBond = (face, hmm) => face === 'bottom' || hmm <= 250;

// Maksymalny rozstaw prętów płyty 9.3.1.1(3): główne 2h ≤ 250 mm w strefach max momentów (3h ≤ 400 poza),
// rozdzielcze 3h ≤ 400 (2h ≤ 250 przy max). Sprawdzamy wariant ostrzejszy (strefy największych momentów).
export function checkMeshSpacing(design) {
  const hmm = design.h * 1000, out = [];
  const sMain = Math.min(2 * hmm, 250);
  for (const face of ['bottom', 'top']) for (const dir of ['X', 'Y']) {
    const s = design[face][`s${dir}`] * 1000;
    if (s > sMain + 1e-9) out.push({ code: 'rozstaw-max', msg: `Siatka ${face === 'bottom' ? 'dolna' : 'górna'} ${dir.toLowerCase()}: rozstaw ${s.toFixed(0)} mm > ${sMain.toFixed(0)} mm (9.3.1.1(3), strefy największych momentów).` });
  }
  return out;
}

const LAYERS = [['bottomX', 'bottom', 'x'], ['bottomY', 'bottom', 'y'], ['topX', 'top', 'x'], ['topY', 'top', 'y']];
const round50 = (v, up) => (up ? Math.ceil(v / 0.05 - 1e-9) : Math.floor(v / 0.05 + 1e-9)) * 0.05;

// Strefy dozbrojenia i dobór prętów dla całej płyty.
// uls — wynik designSlab (nodes[key].AsReq, depths, mat, punching); design — jak w designSlab (+ sX, sY).
export function selectRebar({ geo, mesh, uls, design }) {
  const { nodes } = mesh, N = nodes.length, mat = uls.mat, hmm = design.h * 1000;
  const adj = adjacency(N, mesh.elems), warnings = [...checkMeshSpacing(design)];
  const bb = geo.outline.reduce((b, [x, y]) => ({ x0: Math.min(b.x0, x), x1: Math.max(b.x1, x), y0: Math.min(b.y0, y), y1: Math.max(b.y1, y) }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  const layers = {};

  for (const [key, face, dir] of LAYERS) {
    const L = uls.nodes[key], s = design[face][dir === 'x' ? 'sX' : 'sY'] * 1000, phiBase = design[face][dir === 'x' ? 'phiX' : 'phiY'] * 1000;
    const d = uls.depths[face][dir];
    const dAs = Float64Array.from(L.AsReq, v => (Number.isFinite(v) ? Math.max(0, v - L.base) : 0));
    // Stopnie dozbrojenia (najwyżej 3 na warstwę): pręt wystarczający dla 50 % i 90 % węzłów z ΔAs > 0
    // oraz dla maksimum. Strefy ZAGNIEŻDŻONE: strefa stopnia k obejmuje węzły wymagające ≥ stopnia k;
    // w strefie wewnętrznej mocniejszy pręt zastępuje słabszy (zapewnione = siatka + max dodatków).
    // Odrzucone wcześniej: (1) jedna strefa z max ΔAs — 8,5 × 9,9 m z #25 co 75; (2) każdy wariant
    // katalogu osobno — 40 drobnych stref na wzorcu. Oba niewykonawcze.
    const options = [];
    for (const phi of CATALOG.diameters) options.push({ phi, s, perSpacing: 1, As: areaPerMeter(phi, s) });
    for (const phi of CATALOG.diameters) if (s / 2 - phi >= Math.max(phi, 20) && 2 * areaPerMeter(phi, s) > options[CATALOG.diameters.length - 1].As)
      options.push({ phi, s: s / 2, perSpacing: 2, As: 2 * areaPerMeter(phi, s) });
    options.sort((a, b) => a.As - b.As);
    const needIdx = v => (Number.isFinite(v) ? options.findIndex(o => o.As >= v) : -1);
    const demand = [];
    for (let i = 0; i < N; i++) if (dAs[i] > 1 || !Number.isFinite(L.AsReq[i])) demand.push(Number.isFinite(L.AsReq[i]) ? dAs[i] : Infinity);
    demand.sort((a, b) => a - b);
    const q = f => demand[Math.min(demand.length - 1, Math.floor(f * (demand.length - 1)))];
    const tiers = demand.length ? [...new Set([q(0.5), q(0.9), demand.at(-1)].map(needIdx))].sort((a, b) => (a < 0) - (b < 0) || a - b) : [];
    // stopień węzła: indeks w tiers najmniejszego wystarczającego pręta (−1 w tiers = nie mieści się)
    const tierOf = i => {
      if (!(dAs[i] > 1) && Number.isFinite(L.AsReq[i])) return 0;
      const k = needIdx(Number.isFinite(L.AsReq[i]) ? dAs[i] : Infinity);
      const t = tiers.findIndex(x => x >= 0 && k >= 0 && x >= k);
      return t < 0 ? tiers.length : t + 1;
    };
    const tierN = Int16Array.from({ length: N }, (_, i) => tierOf(i));
    const clusters = [];
    for (let lev = 1; lev <= tiers.length; lev++) {
      const seen = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (seen[i] || tierN[i] < lev) continue;
        const qq = [i], c = []; seen[i] = 1;
        while (qq.length) { const k = qq.pop(); c.push(k); for (const m of adj[k]) if (!seen[m] && tierN[m] >= lev) { seen[m] = 1; qq.push(m); } }
        clusters.push({ c, lev });
      }
    }
    const optionOf = lev => (tiers[lev - 1] >= 0 ? options[tiers[lev - 1]] : null);
    // prostokąty: wzdłuż prętów (u) wydłużenie al + lbd, w poprzek (t) pół rozstawu; zaokrąglenie do 50 mm
    const u = dir === 'x' ? 0 : 1, t = 1 - u;
    let zones = clusters.map(({ c, lev }) => {
      const pick = optionOf(lev);
      const anch = anchorageLength(pick ? pick.phi : 25, mat, { good: goodBond(face, hmm) });
      const ext = d + anch.lbd / 1000, us = c.map(k => nodes[k][u]), ts = c.map(k => nodes[k][t]);
      // zapotrzebowanie, które pokrywa ta strefa: węzły tego stopnia (wyższe pokrywają strefy wewnętrzne)
      const dMax = Math.max(...c.filter(k => tierN[k] === lev).map(k => (Number.isFinite(dAs[k]) ? dAs[k] : Infinity)));
      return { lo: [Math.min(...us) - ext, Math.min(...ts) - s / 2000], hi: [Math.max(...us) + ext, Math.max(...ts) + s / 2000], dAsMax: dMax, lev, nodes: c };
    });
    for (let merged = true; merged;) {
      merged = false;
      outer: for (let a = 0; a < zones.length; a++) for (let b = a + 1; b < zones.length; b++) {
        const A = zones[a], Bz = zones[b];
        if (A.lev === Bz.lev && A.lo[0] <= Bz.hi[0] && Bz.lo[0] <= A.hi[0] && A.lo[1] <= Bz.hi[1] && Bz.lo[1] <= A.hi[1]) {
          zones[a] = { lo: [Math.min(A.lo[0], Bz.lo[0]), Math.min(A.lo[1], Bz.lo[1])], hi: [Math.max(A.hi[0], Bz.hi[0]), Math.max(A.hi[1], Bz.hi[1])], dAsMax: Math.max(A.dAsMax, Bz.dAsMax), lev: A.lev, nodes: [...A.nodes, ...Bz.nodes] };
          zones.splice(b, 1); merged = true; break outer;
        }
      }
    }
    zones.sort((a, b) => a.lev - b.lev);
    const lim = u === 0 ? [[bb.x0, bb.x1], [bb.y0, bb.y1]] : [[bb.y0, bb.y1], [bb.x0, bb.x1]];
    zones = zones.map((z, n) => {
      const pick = optionOf(z.lev) ?? chooseExtra(Number.isFinite(z.dAsMax) ? z.dAsMax : 1e9, s);
      const lo = [Math.max(lim[0][0], round50(z.lo[0], false)), Math.max(lim[1][0], round50(z.lo[1], false))];
      const hi = [Math.min(lim[0][1], round50(z.hi[0], true)), Math.min(lim[1][1], round50(z.hi[1], true))];
      const rect = u === 0 ? { x0: lo[0], x1: hi[0], y0: lo[1], y1: hi[1] } : { x0: lo[1], x1: hi[1], y0: lo[0], y1: hi[0] };
      if (pick?.fail) warnings.push({ code: 'dozbrojenie-niemozliwe', msg: `${key}, strefa ${n + 1}: ${pick.msg}` });
      const lbd = pick && !pick.fail ? anchorageLength(pick.phi, mat, { good: goodBond(face, hmm) }).lbd : null;
      return { id: `${key}-${n + 1}`, layer: key, face, dir, rect, tier: z.lev, dAsMax: z.dAsMax, bar: pick, length: hi[0] - lo[0], lbd, nNodes: z.nodes.length };
    });
    layers[key] = { base: { phi: phiBase, s, As: L.base }, d, zones };
  }

  // zbrojenie zapewnione w węzłach: siatka + dodatki w strefach (do SGU, ścinania i naprężeń)
  const provided = {};
  for (const [key] of LAYERS) {
    const Ly = layers[key], A = new Float64Array(N).fill(Ly.base.As);
    for (const z of Ly.zones) if (z.bar && !z.bar.fail)
      for (let i = 0; i < N; i++) { const [x, y] = nodes[i]; if (x >= z.rect.x0 && x <= z.rect.x1 && y >= z.rect.y0 && y <= z.rect.y1) A[i] = Math.max(A[i], Ly.base.As + z.bar.As); }
    provided[key] = A;
    // kontrola: zapewnione ≥ wymagane w każdym węźle (strefa musi pokryć wszystkie węzły z ΔAs > 0)
    const bad = uls.nodes[key].AsReq.reduce((n, v, i) => n + (Number.isFinite(v) && v > A[i] + 1 ? 1 : 0), 0);
    if (bad) warnings.push({ code: 'zbrojenie-niepokryte', msg: `${key}: ${bad} węzłów z As zapewnionym < wymaganego.` });
  }

  const punching = uls.punching.map(p => punchingLayout(p, geo.columns.find(c => c.label === p.label), geo, mat)).filter(Boolean);
  return { layers, provided, punching, warnings };
}

// Zbrojenie na przebicie (strzemiona/trzpienie pionowe): obwody od s0 do uout,ef − 1,5d (6.4.5(4)),
// s0 ∈ [0,3d; 0,5d], sr ≤ 0,75d, odstęp w obwodzie ≤ 1,5d w obrębie u1 i ≤ 2d dalej (9.4.3(1)),
// Asw,min (9.11) na pojedynczą gałąź. Minimum dwa obwody (9.4.3(1)).
export function punchingLayout(p, column, geo, mat) {
  if (!p.shearReinforcement || !column) return null;
  const d = p.d, sr = Math.floor(0.75 * d * 1000 / 10) * 10 / 1000, s0 = Math.floor(0.5 * d * 1000 / 10) * 10 / 1000;
  // odległość obwodu uout,ef od lica: krokowo od lica do pierwszego przekroczenia (długość obwodu przestaje
  // rosnąć, gdy obwód wychodzi poza płytę), potem bisekcja w znalezionym przedziale
  const target = p.shearReinforcement.uOutEf, len = r => controlPerimeter(column, geo, d, r).u1, step = d / 4;
  let lo = 0, hi = null;
  for (let r = step; r <= 30 * d; r += step) { if (len(r) >= target) { hi = r; lo = r - step; break; } }
  if (hi == null) return { label: p.label, fail: true, msg: `Słup ${p.label}: obwód uout,ef = ${target.toFixed(2)} m nie mieści się w płycie — zwiększ grubość lub beton.` };
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (len(m) < target) lo = m; else hi = m; }
  const rOut = hi;
  const nPer = Math.max(2, Math.floor((rOut - 1.5 * d - s0) / sr + 1e-9) + 1);
  const radii = Array.from({ length: nPer }, (_, i) => s0 + i * sr);
  const AswReq = p.shearReinforcement.AswPerPerimeter;
  let best = null;
  for (const phi of STIRRUPS) {
    const A = barArea(phi);
    const per = radii.map(r => {
      const P = controlPerimeter(column, geo, d, r).u1, st = r <= 2 * d ? 1.5 * d : 2 * d;
      const legs = Math.max(Math.ceil(AswReq / A), Math.ceil(P / st), 4);
      const stAct = P / legs;
      const AswMin = 0.08 * Math.sqrt(mat.fck) / mat.fyk * (sr * 1000) * (stAct * 1000) / 1.5; // (9.11), α = 90°
      return { r, P, legs, st: stAct, ok: A >= AswMin };
    });
    const steel = per.reduce((s, x) => s + x.legs * A, 0);
    if (per.every(x => x.ok) && (!best || steel < best.steel - 1e-9)) best = { phi, per, steel };
  }
  return { label: p.label, d, s0, sr, rOut, nPerimeters: nPer, AswReq, ...(best ? { phi: best.phi, perimeters: best.per } : { fail: true }) };
}
