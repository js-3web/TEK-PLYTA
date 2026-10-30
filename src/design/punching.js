// Przebicie wg PN-EN 1992-1-1, 6.4 (specyfikacja, sekcja 6).
//
// Obwód kontrolny u1 liczony geometrycznie dla dowolnego obrysu płyty:
//   • krzywa w odległości 2d od (otoczki wypukłej) słupa — 6.4.2(1), rys. 6.13;
//   • część poza płytą odcięta — słup krawędziowy / narożny;
//   • 6.4.2(4), rys. 6.15: gdy słup leży blisko krawędzi, obwód „domknięty” prostopadle do krawędzi —
//     liczymy go jako obwód słupa przedłużonego do krawędzi i bierzemy mniejszą wartość;
//   • 6.4.2(3), rys. 6.14: otwór bliżej niż 6d od lica słupa — nieefektywna część między stycznymi
//     poprowadzonymi ze środka słupa (bez złagodzenia √(l1·l2) dla l1 > l2 — po stronie bezpiecznej).
// VEd nie jest pomniejszane o obciążenie wewnątrz obwodu (6.4.4(2) dotyczy stóp) — po stronie bezpiecznej.
// Jednostki: geometria m, siły kN, naprężenia MPa.

import { dist, distPointSeg, pointInPolygon, centroid } from '../geometry/polygon.js';

const STEP = Math.PI / 180; // krok łuków obwodu kontrolnego

function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cr(lower.at(-2), lower.at(-1), q) <= 1e-12) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cr(upper.at(-2), upper.at(-1), q) <= 1e-12) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1)); // przeciwnie do wskazówek zegara
}

// Krzywa równoległa do wielokąta wypukłego (CCW) w odległości r: odcinki + łuki w narożach
function offsetCurve(hull, r) {
  const n = hull.length, out = [];
  const normal = i => { const a = hull[i], b = hull[(i + 1) % n], L = dist(a, b); return [(b[1] - a[1]) / L, -(b[0] - a[0]) / L]; };
  for (let i = 0; i < n; i++) {
    const v = hull[i], n0 = normal((i - 1 + n) % n), n1 = normal(i);
    let a0 = Math.atan2(n0[1], n0[0]), a1 = Math.atan2(n1[1], n1[0]);
    while (a1 < a0) a1 += 2 * Math.PI;
    const k = Math.max(1, Math.ceil((a1 - a0) / STEP));
    for (let j = 0; j <= k; j++) { const a = a0 + (a1 - a0) * j / k; out.push([v[0] + r * Math.cos(a), v[1] + r * Math.sin(a)]); }
  }
  return out; // zamknięta (ostatni punkt łączy się z pierwszym)
}

const segDistPolyline = (p, pts) => { let m = Infinity; for (let i = 0; i < pts.length; i++) m = Math.min(m, distPointSeg(p, pts[i], pts[(i + 1) % pts.length])); return m; };
const polyDist = (A, B) => Math.min(...A.map(p => segDistPolyline(p, B)), ...B.map(p => segDistPolyline(p, A)));

// Długość części krzywej zamkniętej spełniającej warunek ok(p) (przecięcia dokładnie przez bisekcję)
function validLength(curve, ok) {
  let L = 0;
  for (let i = 0; i < curve.length; i++) {
    const a = curve[i], b = curve[(i + 1) % curve.length], la = ok(a), lb = ok(b), s = dist(a, b);
    if (la && lb) { L += s; continue; }
    if (!la && !lb) continue;
    let lo = 0, hi = 1; // szukamy granicy między punktem ważnym a nieważnym
    for (let k = 0; k < 40; k++) {
      const t = (lo + hi) / 2, p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
      if (ok(p) === la) lo = t; else hi = t;
    }
    L += la ? lo * s : (1 - lo) * s;
  }
  return L;
}

// Obwód kontrolny słupa w odległości r (= 2d). geo: { outline, holes }, column: { pts, c }.
export function controlPerimeter(column, geo, d, r = 2 * d) {
  const c = column.c ?? centroid(column.pts);
  const hull = convexHull(column.pts);
  // krawędzie swobodne płyty w zasięgu obwodu (otwory traktowane regułą 6d, nie jako krawędź)
  const segs = geo.outline.map((a, i) => [a, geo.outline[(i + 1) % geo.outline.length]]);
  const near = segs.filter(([a, b]) => Math.min(...hull.map(p => distPointSeg(p, a, b))) < r - 1e-9);
  // otwory bliżej niż 6d od lica słupa: sektor kątowy (styczne ze środka słupa)
  const shadows = (geo.holes ?? []).filter(h => polyDist(hull, h.pts) <= 6 * d).map(h => {
    const hc = centroid(h.pts), ref = Math.atan2(hc[1] - c[1], hc[0] - c[0]);
    const ang = h.pts.map(p => { let a = Math.atan2(p[1] - c[1], p[0] - c[0]) - ref; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; });
    return { label: h.label, ref, lo: Math.min(...ang), hi: Math.max(...ang) };
  });
  const inShadow = p => shadows.some(s => {
    let a = Math.atan2(p[1] - c[1], p[0] - c[0]) - s.ref;
    while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
    return a >= s.lo && a <= s.hi;
  });
  const ok = p => pointInPolygon(p, geo.outline) && !(geo.holes ?? []).some(h => pointInPolygon(p, h.pts)) && !inShadow(p);

  const full = validLength(offsetCurve(hull, r), p => !inShadow(p)); // bez krawędzi (do porównań)
  let u1 = validLength(offsetCurve(hull, r), ok);
  if (near.length) {
    // rys. 6.15: słup „przedłużony” do krawędzi (rzuty wierzchołków na bliskie krawędzie)
    const proj = [];
    for (const [a, b] of near) {
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      for (const p of hull) {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L2));
        proj.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
      }
    }
    u1 = Math.min(u1, validLength(offsetCurve(convexHull([...hull, ...proj]), r), ok));
  }

  // typ słupa: grupy kierunków bliskich krawędzi (odcinki łuku o zbliżonych normalnych = jedna krawędź)
  const dirs = [];
  for (const [a, b] of near) {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (!dirs.some(x => Math.abs(Math.sin(x - ang)) < Math.sin(Math.PI / 6) && Math.cos(x - ang) > 0)) dirs.push(ang);
  }
  // naroże wklęsłe obrysu (kąt wewnętrzny > 180°) w zasięgu obwodu: norma go nie opisuje (rys. 6.15
  // pokazuje tylko naroże wypukłe) — traktujemy jak słup krawędziowy (β = 1,4) i ostrzegamy
  const O = geo.outline, nO = O.length;
  const reentrant = O.some((v, i) => {
    const a = O[(i - 1 + nO) % nO], b = O[(i + 1) % nO];
    const turn = (v[0] - a[0]) * (b[1] - v[1]) - (v[1] - a[1]) * (b[0] - v[0]); // < 0 przy obrysie CCW = wklęsłe
    return turn < -1e-12 && segDistPolyline(v, hull) < r;
  });
  const type = dirs.length === 0 ? 'wewnetrzny' : dirs.length === 1 || reentrant ? 'krawedziowy' : 'narozny';

  // u0 (6.4.5(3)): wewnętrzny — obwód słupa; krawędziowy c2 + 3d ≤ c2 + 2c1; narożny 3d ≤ c1 + c2
  const hullPerim = hull.reduce((s, p, i) => s + dist(p, hull[(i + 1) % hull.length]), 0);
  const extent = ang => { const t = [Math.cos(ang), Math.sin(ang)], n = [-t[1], t[0]];
    const pt = hull.map(p => p[0] * t[0] + p[1] * t[1]), pn = hull.map(p => p[0] * n[0] + p[1] * n[1]);
    return { c2: Math.max(...pt) - Math.min(...pt), c1: Math.max(...pn) - Math.min(...pn) }; };
  let u0 = hullPerim;
  if (reentrant) u0 = validLength(offsetCurve(hull, 1e-4), p => pointInPolygon(p, geo.outline)); // obwód słupa w płycie
  else if (type === 'krawedziowy') { const { c1, c2 } = extent(dirs[0]); u0 = Math.min(c2 + 3 * d, c2 + 2 * c1); }
  if (type === 'narozny') { const e1 = extent(dirs[0]); u0 = Math.min(3 * d, e1.c1 + e1.c2); }
  // odcinki krzywej obwodu leżące w płycie (do rysunku): ciągi kolejnych punktów spełniających ok(p)
  const curvePts = offsetCurve(hull, r), runs = [];
  let run = [];
  for (const q of curvePts) { if (ok(q)) run.push(q); else if (run.length) { runs.push(run); run = []; } }
  if (run.length) { if (runs.length && ok(curvePts[0]) && run.length + runs[0].length <= curvePts.length) runs[0] = [...run, ...runs[0]]; else runs.push(run); }
  const closedLoop = runs.length === 1 && runs[0].length === curvePts.length;
  return { u1, u0, type, reentrant, full, shadows: shadows.map(s => s.label), nearEdges: near.length, runs, closedLoop };
}

// Nośność na przebicie przy danym obwodzie. VEd [kN], d [m], rhoX/rhoY — stopnie zbrojenia górą.
export function punchingCheck({ VEd, beta, u1, u0, d, rhoX, rhoY, mat }) {
  const n = mat.norm, dmm = d * 1000, u1mm = u1 * 1000, u0mm = u0 * 1000, V = VEd * 1000;
  const k = Math.min(2, 1 + Math.sqrt(200 / dmm));
  const rho = Math.min(n.rhoMax, Math.sqrt(rhoX * rhoY));
  const CRdc = n.CRdc(n.gammaC);
  const vmin = 0.035 * k ** 1.5 * Math.sqrt(mat.fck);
  const vRdc = Math.max(CRdc * k * Math.cbrt(100 * rho * mat.fck), vmin);     // (6.47), σcp = 0
  const vEd = beta * V / (u1mm * dmm);                                       // (6.38)
  const nu = 0.6 * (1 - mat.fck / 250);                                       // (6.6N)
  const vRdMax = n.vRdMaxCoef * nu * mat.fcd, vEd0 = beta * V / (u0mm * dmm); // 6.4.5(3), (6.53)
  const res = { VEd, beta, u1, u0, d, k, rho, CRdc, vmin, vRdc, vEd, nu, vRdMax, vEd0, util: vEd / vRdc, utilMax: vEd0 / vRdMax };
  res.ok = vEd <= vRdc && vEd0 <= vRdMax;
  if (vEd > vRdc && vEd0 <= vRdMax) {
    // (6.52), strzemiona pionowe, sr = 0,75d: vRd,cs = 0,75·vRd,c + 2·Asw·fywd,ef/(u1·d)
    const fywdEf = Math.min(250 + 0.25 * dmm, mat.fyd);                        // (6.52)
    res.shearReinforcement = {
      fywdEf, sr: 0.75 * d,
      AswPerPerimeter: (vEd - 0.75 * vRdc) * u1mm * dmm / (2 * fywdEf),       // mm² na jeden obwód
      uOutEf: beta * V / (vRdc * dmm) / 1000,                                  // (6.54), m
    };
  }
  return res;
}

// Wartości uproszczone β, 6.4.3(6) — stosowanie wymaga spełnienia warunków tego punktu (ocenia projektant)
export const BETA_SIMPLIFIED = { wewnetrzny: 1.15, krawedziowy: 1.4, narozny: 1.5 };
