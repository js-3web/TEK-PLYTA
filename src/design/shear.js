// Ścinanie płyty poza strefami przebicia — PN-EN 1992-1-1, 6.2.2 (bez zbrojenia na ścinanie).
// vEd = √(vx² + vy²) — górne ograniczenie z obwiedni |vx|, |vy| (SGN); w węźle największa wartość
// z otoczenia (szum różniczkowania momentów); przy podporach liniowych × 1,05 (zmierzone niedoszacowanie
// w odległości d od lica do 4,4 % przy oczku 0,5 m — tests/sily-poprzeczne.test.js).
// Pomijane: węzły bliżej niż d od podpór liniowych (sprawdzenie w d od lica, 6.2.1(8)) i bliżej niż 2d
// od słupów oraz sił skupionych (strefa przebicia — 6.4).
// vRd,c = [CRd,c·k·(100·ρl·fck)^(1/3)]·d ≥ vmin·d (6.2a, 6.2b, σcp = 0); ρl — z warstwy rozciąganej:
// przyjmujemy mniejsze z √(ρx·ρy) dołu i góry przy zbrojeniu zapewnionym (po stronie bezpiecznej).

import { adjacency } from '../ordering.js';
import { distPointSeg } from '../geometry/polygon.js';

const distToPolyline = (p, pts, closed) => {
  let m = Infinity; const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) m = Math.min(m, distPointSeg(p, pts[i], pts[(i + 1) % n]));
  return m;
};

export function vRdc({ d, rho, mat }) {
  const dmm = d * 1000, k = Math.min(2, 1 + Math.sqrt(200 / dmm));
  const r = Math.min(0.02, rho), CRdc = mat.norm.CRdc(mat.gammaC);
  const v = Math.max(CRdc * k * Math.cbrt(100 * r * mat.fck), (mat.norm.vminCoef ?? 0.035) * k ** 1.5 * Math.sqrt(mat.fck)); // MPa
  return { vRd: v * dmm, v, k, rho: r }; // vRd [kN/m] = MPa · mm
}

export function checkShear({ geo, mesh, env, provided, depths, mat, h0 }) {
  const N = mesh.nodes.length, adj = adjacency(N, mesh.elems), e = env.nodes.ULS;
  const vAbs = Float64Array.from({ length: N }, (_, i) =>
    Math.hypot(Math.max(Math.abs(e.vx.max[i]), Math.abs(e.vx.min[i])), Math.max(Math.abs(e.vy.max[i]), Math.abs(e.vy.min[i]))));
  const dMin = Math.min(depths.bottom.x, depths.bottom.y, depths.top.x, depths.top.y);
  const lines = [...geo.walls.map(w => w.pts), ...geo.edges.map(k => k.pts)];
  const util = new Float32Array(N), vEd = new Float32Array(N), vR = new Float32Array(N);
  let worst = { util: 0, i: -1 };
  for (let i = 0; i < N; i++) {
    const p = mesh.nodes[i];
    const dLine = lines.length ? Math.min(...lines.map(l => distToPolyline(p, l, false))) : Infinity;
    const nearCol = geo.columns.some(c => distToPolyline(p, c.pts, true) < 2 * dMin);
    const nearP = geo.pointLoads.some(q => Math.hypot(p[0] - q.p[0], p[1] - q.p[1]) < 2 * dMin);
    if (dLine < dMin || nearCol || nearP) { util[i] = NaN; continue; }
    let v = Math.max(vAbs[i], ...adj[i].map(k => vAbs[k]));
    if (dLine < 2 * h0) v *= 1.05;
    const rhoB = Math.sqrt(provided.bottomX[i] / (1000 * depths.bottom.x * 1000) * provided.bottomY[i] / (1000 * depths.bottom.y * 1000));
    const rhoT = Math.sqrt(provided.topX[i] / (1000 * depths.top.x * 1000) * provided.topY[i] / (1000 * depths.top.y * 1000));
    const R = vRdc({ d: dMin, rho: Math.min(rhoB, rhoT), mat });
    vEd[i] = v; vR[i] = R.vRd; util[i] = v / R.vRd;
    if (util[i] > worst.util) worst = { util: util[i], i };
  }
  const warnings = worst.util > 1 ? [{ code: 'scinanie', msg: `Ścinanie 6.2.2: vEd/vRd,c = ${worst.util.toFixed(2)} przy X=${mesh.nodes[worst.i][0].toFixed(2)} Y=${mesh.nodes[worst.i][1].toFixed(2)} m — płyta bez zbrojenia na ścinanie nie przenosi; zwiększ grubość lub zbrojenie podłużne.` }] : [];
  return { util, vEd, vRd: vR, maxUtil: worst.util, at: worst.i >= 0 ? mesh.nodes[worst.i] : null, warnings };
}
