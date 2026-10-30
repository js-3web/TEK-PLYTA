// Generator siatki trójkątów dla płyty o dowolnym obrysie.
//
// Jak to działa (dla nauki):
//  1. PSLG — „szkielet” z odcinków, które MUSZĄ być krawędziami siatki: obrys, otwory, obrysy słupów,
//     osie ścian, krawędzie podparte, granice stref obciążeń, linie obciążeń. Odcinki przecinające się
//     dzielimy w punktach przecięcia, żeby siatka miała tam węzeł.
//  2. Pole rozmiaru h(x, y) — docelowa długość boku elementu: małe przy słupach, w narożach wklęsłych
//     i przy siłach skupionych, rosnące liniowo z odległością do h0 w polach.
//  3. Odcinki szkieletu dzielimy według h; to węzły stałe.
//  4. Triangulacja Delaunaya z wymuszonymi krawędziami (delaunator + constrainautor, licencje ISC).
//  5. Uszlachetnianie: do trójkątów za dużych lub zbyt „płaskich” dodajemy punkt (środek okręgu
//     opisanego albo środek ciężkości) i triangulujemy ponownie — aż wszystkie spełniają h.
//  6. Wygładzanie Laplace'a węzłów swobodnych (przesunięcie do średniej sąsiadów) i końcowa triangulacja.
//
// Wynik: { nodes, elems, tags, quality }
//   tags.segments: Map(tag -> [[n1, n2], ...])  odcinki siatki leżące na obiekcie (K1, W1, L1, obrys…)
//   tags.points:   Map(tag -> węzeł)             siły skupione
//   tags.regions:  Map(tag -> [indeksy elementów]) elementy wewnątrz słupów i stref obciążeń

import Delaunator from 'delaunator';
import Constrainautor from '@kninnug/constrainautor';
import { pointInPolygon, distPointSeg, distPointPolyline, dist, cross, sub } from '../geometry/polygon.js';

const TOL = 0.001;

export function generateMesh(geo, opts = {}) {
  const h0 = opts.h0 ?? 0.5;
  const hNear = Math.min(opts.hNear ?? h0 / 4, h0);
  const zone = opts.zone ?? 0.5;       // m — strefa stałego zagęszczenia wokół słupów, naroży, sił
  const grade = opts.grade ?? 0.3;     // przyrost h na metr odległości od strefy
  const maxIter = opts.maxIter ?? 60;

  const inDomain = p => pointInPolygon(p, geo.outline) && !geo.holes.some(h => pointInPolygon(p, h.pts));

  // --- 1. PSLG ---
  const feats = [
    { tag: 'obrys', pts: geo.outline, closed: true },
    ...geo.holes.map(h => ({ tag: h.label, pts: h.pts, closed: true })),
    ...geo.columns.map(c => ({ tag: c.label, pts: c.pts, closed: true })),
    ...geo.walls.map(w => ({ tag: w.label, pts: w.pts, closed: false })),
    ...geo.edges.map(e => ({ tag: e.label, pts: e.pts, closed: false })),
    ...geo.areaLoads.map(q => ({ tag: q.label, pts: q.pts, closed: true })),
    ...geo.lineLoads.map(l => ({ tag: l.label, pts: l.pts, closed: false })),
  ];
  const pslg = buildPslg(feats, geo.pointLoads.map(p => ({ tag: p.label, p: p.p })));

  // --- 2. Pole rozmiaru ---
  // Każde źródło (słup, naroże wklęsłe, siła) zmniejsza h w promieniu, w którym jego „stożek”
  // h_s + grade·(d − zone) jest mniejszy od h0. Wartości liczymy raz na siatce tła (krok ~hNear/2),
  // potem tylko odczytujemy z interpolacją — zamiast liczyć odległości od wszystkich źródeł za każdym razem.
  const sources = [];
  for (const c of geo.columns) sources.push({ d: p => (pointInPolygon(p, c.pts) ? 0 : distPointPolyline(p, c.pts, true)), h: hNear, box: bboxOf(c.pts) });
  for (const q of reentrantCorners(geo)) sources.push({ d: p => dist(p, q), h: hNear, box: bboxOf([q]) });
  for (const p of geo.pointLoads) sources.push({ d: x => dist(x, p.p), h: hNear, box: bboxOf([p.p]) });
  const size = backgroundSize(geo.outline, sources, { h0, hNear, zone, grade });
  // --- 3. Podział odcinków szkieletu ---
  const P = pslg.points.map(p => [...p]);
  const segs = []; // [i, j, tags]
  for (const [a, b, tags] of pslg.segments) {
    const pa = P[a], pb = P[b];
    const ts = subdivide(pa, pb, size);
    let prev = a;
    for (const t of ts) {
      P.push([pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]);
      segs.push([prev, P.length - 1, tags]);
      prev = P.length - 1;
    }
    segs.push([prev, b, tags]);
  }
  const nFixed = P.length;
  const segGrid = new SegmentGrid(segs.map(([i, j]) => [P[i], P[j]]), hNear);
  const distToSegs = (p, r) => segGrid.nearest(p, r);

  // --- 4–5. Triangulacja i uszlachetnianie ---
  const ptGrid = new PointGrid(hNear);
  P.forEach((p, i) => ptGrid.add(p, i));
  let tri = null, iter = 0;
  for (; iter < maxIter; iter++) {
    tri = triangulate(P, segs, inDomain);
    const accepted = [];
    for (const t of tri.kept) {
      const [a, b, c] = t.map(i => P[i]);
      const g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const hg = size(g);
      const L = Math.max(dist(a, b), dist(b, c), dist(c, a));
      const bad = L > 1.35 * hg || (minAngle(a, b, c) < 25 && L > 0.6 * hg);
      if (!bad) continue;
      let cand = circumcenter(a, b, c);
      if (!cand || !inDomain(cand) || distToSegs(cand, 0.45 * size(cand)) < 0.45 * size(cand)) cand = g;
      const hc = size(cand);
      if (distToSegs(cand, 0.3 * hc) < 0.3 * hc) continue;
      if (ptGrid.anyWithin(cand, 0.55 * hc)) continue;
      P.push(cand); ptGrid.add(cand, P.length - 1); // od razu widoczny dla kolejnych kandydatów
      accepted.push(cand);
    }
    if (!accepted.length) break;
  }

  // --- 6. Wygładzanie ---
  for (let pass = 0; pass < 3; pass++) {
    const nbr = Array.from({ length: P.length }, () => new Set());
    for (const [a, b, c] of tri.kept) { nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b); }
    for (let i = nFixed; i < P.length; i++) {
      if (!nbr[i].size) continue;
      let sx = 0, sy = 0;
      for (const j of nbr[i]) { sx += P[j][0]; sy += P[j][1]; }
      const q = [sx / nbr[i].size, sy / nbr[i].size], hq = size(q);
      if (inDomain(q) && distToSegs(q, 0.3 * hq) >= 0.3 * hq) P[i] = q;
    }
    tri = triangulate(P, segs, inDomain);
  }

  // --- Wynik: tylko używane węzły, nowa numeracja ---
  const map = new Int32Array(P.length).fill(-1);
  const nodes = [];
  const use = i => (map[i] < 0 ? (map[i] = nodes.push(P[i]) - 1) : map[i]);
  const elems = tri.kept.map(t => t.map(use));
  const tags = { segments: new Map(), points: new Map(), regions: new Map() };
  for (const [i, j, tg] of segs) {
    if (map[i] < 0 || map[j] < 0) continue; // odcinek poza płytą
    for (const t of tg) { if (!tags.segments.has(t)) tags.segments.set(t, []); tags.segments.get(t).push([map[i], map[j]]); }
  }
  for (const [tag, i] of pslg.pointTags) if (map[i] >= 0) tags.points.set(tag, map[i]);
  const regionFeats = [...geo.columns, ...geo.areaLoads];
  elems.forEach((e, ie) => {
    const g = [(nodes[e[0]][0] + nodes[e[1]][0] + nodes[e[2]][0]) / 3, (nodes[e[0]][1] + nodes[e[1]][1] + nodes[e[2]][1]) / 3];
    for (const f of regionFeats) if (pointInPolygon(g, f.pts)) {
      if (!tags.regions.has(f.label)) tags.regions.set(f.label, []);
      tags.regions.get(f.label).push(ie);
    }
  });

  return { nodes, elems, tags, quality: quality(nodes, elems, iter), size };
}

// ----------------------------------------------------------------------------

const bboxOf = pts => pts.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);

function backgroundSize(outline, sources, { h0, hNear, zone, grade }) {
  const [x0, y0, x1, y1] = bboxOf(outline);
  const cell = Math.max(hNear / 2, Math.max(x1 - x0, y1 - y0) / 2000);
  const nx = Math.ceil((x1 - x0) / cell) + 2, ny = Math.ceil((y1 - y0) / cell) + 2;
  const ox = x0 - cell / 2, oy = y0 - cell / 2;
  const H = new Float32Array(nx * ny).fill(h0);
  for (const s of sources) {
    const R = zone + (h0 - s.h) / grade; // dalej źródło nie zmniejsza h
    const i0 = Math.max(0, Math.floor((s.box[0] - R - ox) / cell)), i1 = Math.min(nx - 1, Math.ceil((s.box[2] + R - ox) / cell));
    const j0 = Math.max(0, Math.floor((s.box[1] - R - oy) / cell)), j1 = Math.min(ny - 1, Math.ceil((s.box[3] + R - oy) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const h = s.h + grade * Math.max(0, s.d([ox + i * cell, oy + j * cell]) - zone);
      if (h < H[j * nx + i]) H[j * nx + i] = h;
    }
  }
  return p => { // interpolacja dwuliniowa
    const fx = Math.min(Math.max((p[0] - ox) / cell, 0), nx - 1.001), fy = Math.min(Math.max((p[1] - oy) / cell, 0), ny - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const k = j * nx + i;
    return (1 - u) * (1 - v) * H[k] + u * (1 - v) * H[k + 1] + (1 - u) * v * H[k + nx] + u * v * H[k + nx + 1];
  };
}

// Ramka: 4 punkty pomocnicze daleko od płyty. Dzięki nim brzeg płyty nie jest otoczką wypukłą
// zbioru punktów — inaczej punkty współliniowe na otoczce dają trójkąty o zerowym polu.
function withFrame(P) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const m = Math.max(x1 - x0, y1 - y0) * 0.5 + 1;
  return [...P, [x0 - m, y0 - m], [x1 + m, y0 - m], [x1 + m, y1 + m], [x0 - m, y1 + m]];
}

function triangulate(P0, segs, inDomain) {
  const P = withFrame(P0), nReal = P0.length;
  const del = Delaunator.from(P);
  const con = new Constrainautor(del);
  for (const [i, j] of segs) con.constrainOne(i, j);
  const T = del.triangles, kept = [];
  for (let k = 0; k < T.length; k += 3) {
    let a = T[k], b = T[k + 1], c = T[k + 2];
    if (a >= nReal || b >= nReal || c >= nReal) continue;
    const ar = cross(sub(P[b], P[a]), sub(P[c], P[a]));
    if (Math.abs(ar) < 1e-12 * (dist(P[a], P[b]) ** 2 + 1e-30)) throw new Error('Generator siatki: trójkąt zdegenerowany (błąd wewnętrzny — zgłoś z plikiem DXF).');
    const g = [(P[a][0] + P[b][0] + P[c][0]) / 3, (P[a][1] + P[b][1] + P[c][1]) / 3];
    if (!inDomain(g)) continue;
    if (ar < 0) [b, c] = [c, b]; // orientacja CCW
    kept.push([a, b, c]);
  }
  return { kept };
}

// Szkielet: scalenie punktów (tolerancja 1 mm), podział odcinków w przecięciach i punktach styku,
// usunięcie duplikatów odcinków z połączeniem etykiet.
export function buildPslg(feats, pointFeats = []) {
  const pts = [], grid = new PointGrid(0.05);
  const addPt = p => {
    const near = grid.firstWithin(p, TOL);
    if (near >= 0) return near;
    pts.push([p[0], p[1]]); grid.add(p, pts.length - 1);
    return pts.length - 1;
  };
  let raw = [];
  for (const f of feats) {
    const n = f.pts.length, m = f.closed ? n : n - 1;
    for (let k = 0; k < m; k++) {
      const a = addPt(f.pts[k]), b = addPt(f.pts[(k + 1) % n]);
      if (a !== b) raw.push([a, b, f.tag]);
    }
  }
  const pointTags = new Map();
  for (const pf of pointFeats) pointTags.set(pf.tag, addPt(pf.p));

  // Punkty podziału na każdym odcinku: przecięcia właściwe + punkty leżące na odcinku
  const splits = raw.map(() => []);
  const box = s => { const a = pts[s[0]], b = pts[s[1]]; return [Math.min(a[0], b[0]) - TOL, Math.min(a[1], b[1]) - TOL, Math.max(a[0], b[0]) + TOL, Math.max(a[1], b[1]) + TOL]; };
  const boxes = raw.map(box);
  const order = raw.map((_, i) => i).sort((i, j) => boxes[i][0] - boxes[j][0]);
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      if (boxes[j][0] > boxes[i][2]) break;
      if (boxes[j][1] > boxes[i][3] || boxes[j][3] < boxes[i][1]) continue;
      const [a, b] = raw[i], [c, d] = raw[j];
      const A = pts[a], B = pts[b], C = pts[c], D = pts[d];
      const r = sub(B, A), s = sub(D, C), den = cross(r, s);
      if (Math.abs(den) > 1e-12) {
        const t = cross(sub(C, A), s) / den, u = cross(sub(C, A), r) / den;
        if (t > -1e-9 && t < 1 + 1e-9 && u > -1e-9 && u < 1 + 1e-9) {
          const x = addPt([A[0] + t * r[0], A[1] + t * r[1]]);
          splits[i].push(x); splits[j].push(x);
        }
      }
      for (const [p, seg] of [[c, i], [d, i], [a, j], [b, j]]) {
        const [s0, s1] = raw[seg];
        if (p !== s0 && p !== s1 && distPointSeg(pts[p], pts[s0], pts[s1]) <= TOL) splits[seg].push(p);
      }
    }
  }
  const segMap = new Map();
  raw.forEach(([a, b, tag], k) => {
    const A = pts[a], dir = sub(pts[b], A), L2 = dir[0] ** 2 + dir[1] ** 2;
    const along = [...new Set([a, b, ...splits[k]])]
      .map(p => [p, ((pts[p][0] - A[0]) * dir[0] + (pts[p][1] - A[1]) * dir[1]) / L2])
      .sort((x, y) => x[1] - y[1]).map(x => x[0]);
    for (let q = 0; q + 1 < along.length; q++) {
      const u = along[q], v = along[q + 1];
      if (u === v) continue;
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      if (!segMap.has(key)) segMap.set(key, [Math.min(u, v), Math.max(u, v), new Set()]);
      segMap.get(key)[2].add(tag);
    }
  });
  return { points: pts, segments: [...segMap.values()].map(([a, b, t]) => [a, b, [...t]]), pointTags };
}

// Parametry t ∈ (0,1) punktów podziału odcinka a–b tak, by lokalny bok ≈ h(x) (rozkład wg ∫ds/h)
function subdivide(a, b, size) {
  const L = dist(a, b), m = 24;
  const F = [0];
  for (let k = 1; k <= m; k++) {
    const t = (k - 0.5) / m;
    F.push(F[k - 1] + (L / m) / size([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  }
  const n = Math.max(1, Math.round(F[m]));
  const out = [];
  for (let q = 1; q < n; q++) {
    const target = F[m] * q / n;
    let k = 1; while (F[k] < target) k++;
    out.push((k - 1 + (target - F[k - 1]) / (F[k] - F[k - 1])) / m);
  }
  return out;
}

// Naroża wklęsłe płyty (kąt wewnętrzny > 200°): obrys CCW skręca w prawo; otwór (CCW) skręca w lewo
function reentrantCorners(geo) {
  const out = [];
  const scan = (pts, sign) => {
    const n = pts.length;
    for (let k = 0; k < n; k++) {
      const p = pts[(k - 1 + n) % n], q = pts[k], r = pts[(k + 1) % n];
      const u = sub(q, p), v = sub(r, q);
      const turn = Math.atan2(cross(u, v), u[0] * v[0] + u[1] * v[1]); // > 0 w lewo
      if (sign * turn < -20 * Math.PI / 180) out.push(q);
    }
  };
  scan(geo.outline, 1);
  for (const h of geo.holes) scan(h.pts, -1);
  return out;
}

function circumcenter(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-14) return null;
  const a2 = a[0] ** 2 + a[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2, c2 = c[0] ** 2 + c[1] ** 2;
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d, (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

export function minAngle(a, b, c) {
  const ang = (p, q, r) => { const u = sub(q, p), v = sub(r, p); return Math.abs(Math.atan2(cross(u, v), u[0] * v[0] + u[1] * v[1])); };
  return Math.min(ang(a, b, c), ang(b, c, a), ang(c, a, b)) * 180 / Math.PI;
}

function quality(nodes, elems, iterations) {
  let minA = 180, below20 = 0, area = 0;
  for (const [i, j, k] of elems) {
    const m = minAngle(nodes[i], nodes[j], nodes[k]);
    minA = Math.min(minA, m); if (m < 20) below20++;
    area += cross(sub(nodes[j], nodes[i]), sub(nodes[k], nodes[i])) / 2;
  }
  return { nNodes: nodes.length, nElems: elems.length, minAngle: minA, below20, area, iterations };
}

// Siatki pomocnicze do szybkiego wyszukiwania sąsiadów
class PointGrid {
  constructor(cell) { this.c = cell; this.m = new Map(); }
  key(ix, iy) { return `${ix},${iy}`; }
  add(p, i) {
    const k = this.key(Math.floor(p[0] / this.c), Math.floor(p[1] / this.c));
    if (!this.m.has(k)) this.m.set(k, []);
    this.m.get(k).push([p, i]);
  }
  *within(p, r) {
    const x0 = Math.floor((p[0] - r) / this.c), x1 = Math.floor((p[0] + r) / this.c);
    const y0 = Math.floor((p[1] - r) / this.c), y1 = Math.floor((p[1] + r) / this.c);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
      for (const [q, i] of this.m.get(this.key(x, y)) || []) if (dist(p, q) <= r) yield i;
  }
  anyWithin(p, r) { for (const _ of this.within(p, r)) return true; return false; }
  firstWithin(p, r) { for (const i of this.within(p, r)) return i; return -1; }
}

class SegmentGrid {
  constructor(segs, cell) {
    this.c = Math.max(cell, 0.05); this.segs = segs; this.m = new Map();
    segs.forEach(([a, b], i) => {
      const x0 = Math.floor(Math.min(a[0], b[0]) / this.c), x1 = Math.floor(Math.max(a[0], b[0]) / this.c);
      const y0 = Math.floor(Math.min(a[1], b[1]) / this.c), y1 = Math.floor(Math.max(a[1], b[1]) / this.c);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push(i);
      }
    });
  }
  // najmniejsza odległość do odcinka w promieniu r (Infinity, gdy brak)
  nearest(p, r) {
    let best = Infinity;
    const x0 = Math.floor((p[0] - r) / this.c), x1 = Math.floor((p[0] + r) / this.c);
    const y0 = Math.floor((p[1] - r) / this.c), y1 = Math.floor((p[1] + r) / this.c);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++)
      for (const i of this.m.get(`${x},${y}`) || []) best = Math.min(best, distPointSeg(p, ...this.segs[i]));
    return best;
  }
}
