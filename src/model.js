// Model płyty: składanie macierzy sztywności, warunki brzegowe, rozwiązanie,
// reakcje i momenty w węzłach. Jednostki dowolne, ale spójne (zalecane: kN, m).
//
// Dwie fazy (ważne dla wydajności):
//   1. buildModel(...)  — siatka, podpory, macierz K i jej rozkład Cholesky'ego (drogie, raz)
//   2. model.solveCase({ q, point }) — dowolnie wiele przypadków obciążeń (tanie)
// Kombinacje obciążeń powstają potem z superpozycji przypadków (analiza liniowa).
//
// Wejście buildModel:
//   nodes:   [[x, y], ...]
//   elems:   [[i, j, k], ...]           węzły przeciwnie do ruchu wskazówek zegara
//   mat:     { E, nu, t, alpha? }
//   fix:     Map(node => { w, tx, ty, tangent? })
//             w/tx/ty: true = DOF zablokowany
//             tangent: [tx, ty] wektor krawędzi — blokuje pochodną dw/dt wzdłuż
//             krawędzi (podparcie przegubowe "twarde" na krawędzi ukośnej)
//   springs: [{ node, kw, ktx, kty, ktxy }] sprężyny podporowe w węźle (słupy, ściany);
//            ktxy — wyraz mieszany macierzy obrotowej 2×2 (ściana ukośna: obrót wokół jej osi)
//   element: 'DKT' (domyślny) albo 'MITC3'
//   elemD:   tylko DKT — funkcja (elemIndex) => macierz D 3×3 elementu (płyta ortotropowa, np. strefy
//            zarysowane w SGU); domyślnie D izotropowa z mat
//   solver:  'sparse' (domyślnie: rzadki Cholesky + zagnieżdżony podział) albo 'skyline'
//            (profilowy + RCM — zostawiony jako niezależna kontrola wyników)
//   ordering: tylko dla 'skyline': 'rcm' (domyślnie) albo 'none'
// Przypadek obciążenia:
//   q:     obciążenie równomierne na jednostkę pola albo funkcja (elemIndex) => q
//   point: [{ node, P }] siły skupione

import * as dkt from './dkt.js';
import * as mitc3 from './mitc3.js';
import { rcm, nestedDissection, adjacency } from './ordering.js';
import { SkylineMatrix, buildProfile, choleskyInPlace, choleskySolve } from './solver.js';
import { SparseSymMatrix, sparseCholesky, sparseSolve } from './sparse.js';

// Wspólny interfejs elementów: stiffness(xy, mat) i results(xy, mat, u, r, s) -> { m, q }
export const ELEMENTS = {
  DKT: {
    stiffness: (xy, mat) => dkt.stiffness(xy, dkt.plateD(mat.E, mat.t, mat.nu)),
    results: (xy, mat, u, r, s) => ({ m: dkt.moments(xy, dkt.plateD(mat.E, mat.t, mat.nu), u, r, s), q: null }),
    corners: (xy, mat) => dkt.cornerMomentMatrices(xy, dkt.plateD(mat.E, mat.t, mat.nu)).map(m => ({ m, q: null })),
  },
  MITC3: { stiffness: mitc3.stiffness, results: mitc3.results, corners: mitc3.cornerResultMatrices },
};

// Transformacja obrotów węzła do układu (pochodna styczna, pochodna normalna).
// Globalnie: tx = dw/dy, ty = -dw/dx, czyli grad w = (-ty, tx).
// Lokalnie: gt = t·grad w, gn = n·grad w. Zwraca T (2x2): [tx, ty] = T [gt, gn].
function tangentTransform([tX, tY]) {
  const L = Math.hypot(tX, tY);
  const t = [tX / L, tY / L], n = [-t[1], t[0]];
  const M = [[t[1], -t[0]], [n[1], -n[0]]]; // [gt, gn] = M [tx, ty]
  return [[M[0][0], M[1][0]], [M[0][1], M[1][1]]]; // M ortogonalna => T = M^T
}

const triArea = xy => 0.5 * ((xy[1][0] - xy[0][0]) * (xy[2][1] - xy[0][1]) - (xy[2][0] - xy[0][0]) * (xy[1][1] - xy[0][1]));

export function buildModel({ nodes, elems, mat, fix = new Map(), springs = [], element = 'DKT', solver = 'sparse', ordering = 'rcm', elemD = null }) {
  const nn = nodes.length;
  const el0 = ELEMENTS[element];
  if (!el0) throw new Error(`Nieznany element: ${element}`);
  if (elemD && element !== 'DKT') throw new Error('elemD (sztywność elementów) — tylko element DKT');
  const el = elemD ? {
    stiffness: (xy, m, ie) => dkt.stiffness(xy, elemD(ie)),
    corners: (xy, m, ie) => dkt.cornerMomentMatrices(xy, elemD(ie)).map(mm => ({ m: mm, q: null })),
  } : el0;

  const T = new Array(nn).fill(null);
  for (const [node, f] of fix) if (f.tangent) T[node] = tangentTransform(f.tangent);

  // Numeracja równań: -1 = DOF zablokowany
  const eq = new Int32Array(3 * nn);
  let neq = 0;
  const order = solver === 'sparse' ? nestedDissection(nodes, elems)
    : ordering === 'rcm' ? rcm(nn, elems) : Array.from({ length: nn }, (_, i) => i);
  for (const i of order) {
    const f = fix.get(i) || {};
    const blocked = f.tangent ? [f.w, true, false] : [f.w, f.tx, f.ty];
    for (let d = 0; d < 3; d++) eq[3 * i + d] = blocked[d] ? -1 : neq++;
  }

  const elemDofs = elems.map(e => [3 * e[0], 3 * e[0] + 1, 3 * e[0] + 2, 3 * e[1], 3 * e[1] + 1, 3 * e[1] + 2, 3 * e[2], 3 * e[2] + 1, 3 * e[2] + 2]);
  const K = solver === 'sparse' ? new SparseSymMatrix(neq, sparsePattern(nn, elems, eq, neq))
    : new SkylineMatrix(neq, buildProfile(neq, elemDofs.map(ds => ds.map(d => eq[d]))));
  const area = new Float64Array(elems.length);
  // Macierze elementów przechowujemy tylko dla elementów dotykających podpór (do reakcji)
  const supportElems = new Map();

  elems.forEach((e, ie) => {
    const xy = e.map(i => nodes[i]);
    area[ie] = triArea(xy);
    const Ke = transformElement(el.stiffness(xy, mat, ie), e, T);
    const dofs = elemDofs[ie];
    if (dofs.some(d => eq[d] < 0)) supportElems.set(ie, Ke);
    for (let a = 0; a < 9; a++) {
      const ra = eq[dofs[a]];
      if (ra < 0) continue;
      for (let b = 0; b < 9; b++) {
        const cb = eq[dofs[b]];
        if (cb < 0 || cb < ra) continue;
        K.add(ra, cb, Ke[a][b]);
      }
    }
  });

  for (const sp of springs) {
    if (T[sp.node]) throw new Error(`Węzeł ${sp.node}: sprężyna i warunek styczny jednocześnie — niedozwolone`);
    [sp.kw || 0, sp.ktx || 0, sp.kty || 0].forEach((k, d) => {
      if (k < 0) throw new Error(`Węzeł ${sp.node}: ujemna sztywność sprężyny`);
      const r = eq[3 * sp.node + d];
      if (k > 0 && r >= 0) K.add(r, r, k);
    });
    const kxy = sp.ktxy || 0;
    if (kxy) {
      if ((sp.ktx || 0) * (sp.kty || 0) - kxy * kxy < -1e-9 * ((sp.ktx || 0) * (sp.kty || 0) + kxy * kxy))
        throw new Error(`Węzeł ${sp.node}: macierz sprężyny obrotowej nie jest dodatnio półokreślona`);
      const r1 = eq[3 * sp.node + 1], r2 = eq[3 * sp.node + 2];
      if (r1 >= 0 && r2 >= 0) K.add(r1, r2, kxy);
    }
  }

  // Macierze wyników w narożach (liczone raz; momenty dla każdego przypadku = mnożenie przez u)
  const withQ = element !== 'DKT', per = withQ ? 45 : 27; // na naroże: 3 (+2) wiersze × 9
  const RM = new Float64Array(elems.length * 3 * per);
  // Waga naroża = kąt elementu w węźle. Średnia ważona kątem: po obu stronach dowolnej prostej
  // przez węzeł (np. linii podpory) suma kątów = 180°, więc obie strony mają równy udział,
  // niezależnie od liczby trójkątów. Zwykła średnia dawała nad podporą +5 % (etap 4, belka ciągła).
  const cornerW = new Float64Array(elems.length * 3);
  elems.forEach((e, ie) => {
    for (let a = 0; a < 3; a++) {
      const p = nodes[e[a]], q1 = nodes[e[(a + 1) % 3]], q2 = nodes[e[(a + 2) % 3]];
      const ux = q1[0] - p[0], uy = q1[1] - p[1], vx = q2[0] - p[0], vy = q2[1] - p[1];
      cornerW[ie * 3 + a] = Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy);
    }
  });
  elems.forEach((e, ie) => {
    el.corners(e.map(i => nodes[i]), mat, ie).forEach((c, a) => {
      const o = (ie * 3 + a) * per;
      for (let r = 0; r < 3; r++) RM.set(c.m[r], o + 9 * r);
      if (withQ) for (let r = 0; r < 2; r++) RM.set(c.q[r], o + 27 + 9 * r);
    });
  });

  const profileSize = K.size;
  const L = solver === 'sparse' ? sparseCholesky(K) : choleskyInPlace(K);
  const solveLin = b => (solver === 'sparse' ? sparseSolve(L, b) : choleskySolve(K, b));

  // curvature: opcjonalnie (elemIndex) => [κx, κy, κxy] krzywizna wymuszona (skurcz); tylko DKT.
  // Momenty zwracane są wtedy jako D·κ całkowitej (bez odjęcia κ0) — przypadek służy do ugięć.
  function solveCase({ q = 0, point = [], curvature = null } = {}) {
    const qOf = typeof q === 'function' ? q : () => q;
    // Pełny wektor obciążeń (także na zablokowanych DOF — do obliczenia reakcji).
    // Obciążenie równomierne skupione w węzłach: q A / 3 na każde ugięcie.
    const fFull = new Float64Array(3 * nn);
    for (let ie = 0; ie < elems.length; ie++) {
      const qe = qOf(ie) * area[ie] / 3;
      if (qe) for (const node of elems[ie]) fFull[3 * node] += qe;
    }
    for (const { node, P } of point) fFull[3 * node] += P;
    if (curvature) {
      if (element !== 'DKT') throw new Error('Krzywizna wymuszona — tylko element DKT');
      for (let ie = 0; ie < elems.length; ie++) {
        const k0 = curvature(ie);
        if (!k0) continue;
        const e = elems[ie], Dm = elemD ? elemD(ie) : dkt.plateD(mat.E, mat.t, mat.nu);
        const fe = transformLoad(dkt.initialCurvatureLoad(e.map(i => nodes[i]), Dm, k0), e, T);
        fe.forEach((v, a) => { fFull[elemDofs[ie][a]] += v; });
      }
    }
    const F = new Float64Array(neq);
    for (let d = 0; d < 3 * nn; d++) if (eq[d] >= 0) F[eq[d]] += fFull[d];

    const x = solveLin(F);

    const uLoc = new Float64Array(3 * nn);
    for (let d = 0; d < 3 * nn; d++) if (eq[d] >= 0) uLoc[d] = x[eq[d]];
    const u = Float64Array.from(uLoc);
    for (let i = 0; i < nn; i++) if (T[i]) {
      const gt = uLoc[3 * i + 1], gn = uLoc[3 * i + 2];
      u[3 * i + 1] = T[i][0][0] * gt + T[i][0][1] * gn;
      u[3 * i + 2] = T[i][1][0] * gt + T[i][1][1] * gn;
    }

    // Reakcje: R = K u - f na DOF zablokowanych (układ lokalny węzła)
    const R = new Float64Array(3 * nn);
    for (const [ie, Ke] of supportElems) {
      const dofs = elemDofs[ie];
      for (let a = 0; a < 9; a++) {
        if (eq[dofs[a]] >= 0) continue;
        let s = 0;
        for (let b = 0; b < 9; b++) s += Ke[a][b] * uLoc[dofs[b]];
        R[dofs[a]] += s;
      }
    }
    for (let d = 0; d < 3 * nn; d++) if (eq[d] < 0) R[d] -= fFull[d];
    // Reakcje sprężyn: siła, którą sprężyna działa na płytę = -k u
    for (const sp of springs) {
      const o = 3 * sp.node, kxy = sp.ktxy || 0;
      R[o] += -(sp.kw || 0) * u[o];
      R[o + 1] += -((sp.ktx || 0) * u[o + 1] + kxy * u[o + 2]);
      R[o + 2] += -(kxy * u[o + 1] + (sp.kty || 0) * u[o + 2]);
    }

    // Momenty (i siły poprzeczne MITC3) w węzłach: średnia ważona kątem z elementów zbiegających się w węźle
    const mSum = new Float64Array(3 * nn), qSum = new Float64Array(2 * nn), cnt = new Float64Array(nn);
    const ue = new Float64Array(9);
    for (let ie = 0; ie < elems.length; ie++) {
      const e = elems[ie];
      for (let a = 0; a < 3; a++) { ue[3 * a] = u[3 * e[a]]; ue[3 * a + 1] = u[3 * e[a] + 1]; ue[3 * a + 2] = u[3 * e[a] + 2]; }
      for (let a = 0; a < 3; a++) {
        const node = e[a], o = (ie * 3 + a) * per, wgt = cornerW[ie * 3 + a];
        for (let r = 0; r < (withQ ? 5 : 3); r++) {
          let v = 0;
          for (let k = 0; k < 9; k++) v += RM[o + 9 * r + k] * ue[k];
          if (r < 3) mSum[3 * node + r] += wgt * v; else qSum[2 * node + r - 3] += wgt * v;
        }
        cnt[node] += wgt;
      }
    }
    const m = Array.from({ length: nn }, (_, i) => [mSum[3 * i] / cnt[i], mSum[3 * i + 1] / cnt[i], mSum[3 * i + 2] / cnt[i]]);
    const qs = element === 'DKT' ? null : Array.from({ length: nn }, (_, i) => [qSum[2 * i] / cnt[i], qSum[2 * i + 1] / cnt[i]]);

    let totalLoad = 0, totalReaction = 0;
    for (let i = 0; i < nn; i++) { totalLoad += fFull[3 * i]; totalReaction += R[3 * i]; }
    return { u, w: (i) => u[3 * i], m, q: qs, R, totalLoad, totalReaction };
  }

  return { solveCase, neq, profileSize, factorSize: solver === 'sparse' ? L.nnz : profileSize, nNodes: nn };
}

// Skrót: model z jednym przypadkiem obciążenia (zgodność z wcześniejszym API i testami)
export function solvePlate({ q = 0, point = [], ...rest }) {
  const model = buildModel(rest);
  return { ...model.solveCase({ q, point }), neq: model.neq, profileSize: model.profileSize };
}

// Wzorzec macierzy rzadkiej: kolumna j zawiera wiersze i ≤ j wszystkich DOF węzłów sąsiednich
function sparsePattern(nn, elems, eq, neq) {
  const adj = adjacency(nn, elems);
  const cols = new Array(neq);
  for (let n = 0; n < nn; n++) {
    const rows = [];
    for (const m of [n, ...adj[n]]) for (let d = 0; d < 3; d++) if (eq[3 * m + d] >= 0) rows.push(eq[3 * m + d]);
    for (let d = 0; d < 3; d++) {
      const j = eq[3 * n + d];
      if (j >= 0) cols[j] = Int32Array.from(rows.filter(i => i <= j)).sort();
    }
  }
  return cols;
}

function transformElement(Ke, e, T) {
  if (!e.some(i => T[i])) return Ke;
  // G = blokowo-przekątna 9x9; Ke' = G^T Ke G
  const G = Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => (r === c ? 1 : 0)));
  e.forEach((node, a) => {
    if (!T[node]) return;
    const o = 3 * a + 1;
    G[o][o] = T[node][0][0]; G[o][o + 1] = T[node][0][1];
    G[o + 1][o] = T[node][1][0]; G[o + 1][o + 1] = T[node][1][1];
  });
  const KG = Ke.map(row => G[0].map((_, c) => row.reduce((s, v, k) => s + v * G[k][c], 0)));
  return G[0].map((_, r) => G[0].map((__, c) => G.reduce((s, gRow, k) => s + gRow[r] * KG[k][c], 0)));
}

// Wektor obciążeń elementu w układzie lokalnym węzłów z warunkiem stycznym: f' = Gᵀ f
function transformLoad(fe, e, T) {
  if (!e.some(i => T[i])) return fe;
  const out = [...fe];
  e.forEach((node, a) => {
    if (!T[node]) return;
    const o = 3 * a + 1, f1 = fe[o], f2 = fe[o + 1];
    out[o] = T[node][0][0] * f1 + T[node][1][0] * f2;
    out[o + 1] = T[node][0][1] * f1 + T[node][1][1] * f2;
  });
  return out;
}
