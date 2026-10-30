// Geometria płaska: wielokąty, odcinki, łuki. Współrzędne [x, y].

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Pole ze znakiem (wzór Gaussa): > 0 dla obiegu przeciwnego do ruchu wskazówek zegara (CCW)
export function signedArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const ccw = pts => (signedArea(pts) < 0 ? [...pts].reverse() : pts);

export function centroid(pts) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  return [cx / (3 * A), cy / (3 * A)];
}

// Momenty bezwładności względem osi przez środek ciężkości (x — oś pozioma)
export function inertia(pts) {
  const [gx, gy] = centroid(pts);
  let Ixx = 0, Iyy = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = sub(pts[i], [gx, gy]), [x2, y2] = sub(pts[(i + 1) % n], [gx, gy]);
    const c = x1 * y2 - x2 * y1;
    Ixx += (y1 * y1 + y1 * y2 + y2 * y2) * c;
    Iyy += (x1 * x1 + x1 * x2 + x2 * x2) * c;
  }
  const s = Math.sign(signedArea(pts));
  return { Ix: s * Ixx / 12, Iy: s * Iyy / 12 };
}

// Odległość punktu od odcinka ab
export function distPointSeg(p, a, b) {
  const ab = sub(b, a), L2 = ab[0] * ab[0] + ab[1] * ab[1];
  let t = L2 ? ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return dist(p, [a[0] + t * ab[0], a[1] + t * ab[1]]);
}

export function distPointPolyline(p, pts, closed) {
  let d = Infinity;
  const n = pts.length, m = closed ? n : n - 1;
  for (let i = 0; i < m; i++) d = Math.min(d, distPointSeg(p, pts[i], pts[(i + 1) % n]));
  if (n === 1) d = dist(p, pts[0]);
  return d;
}

// Punkt w wielokącie (promień w prawo). Na brzegu wynik nieokreślony — sprawdzaj osobno.
export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Położenie punktu względem wielokąta z tolerancją: 'in' | 'out' | 'on'
export function classify(p, pts, tol) {
  if (distPointPolyline(p, pts, true) <= tol) return 'on';
  return pointInPolygon(p, pts) ? 'in' : 'out';
}

// Przecięcie właściwe dwóch odcinków (z pominięciem styku w końcach i nakładania współliniowego)
export function properIntersection(a, b, c, d, tol) {
  const r = sub(b, a), s = sub(d, c), den = cross(r, s);
  if (Math.abs(den) < 1e-15) return null;
  const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
  const Lr = Math.hypot(...r), Ls = Math.hypot(...s);
  if (t * Lr > tol && (1 - t) * Lr > tol && u * Ls > tol && (1 - u) * Ls > tol) return [a[0] + t * r[0], a[1] + t * r[1]];
  return null;
}

// Pierwsze znalezione samoprzecięcie wielokąta (null = brak)
export function selfIntersection(pts, tol) {
  const n = pts.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue; // sąsiednie przez zamknięcie
    const x = properIntersection(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n], tol);
    if (x) return x;
  }
  return null;
}

// Pierwsze przecięcie brzegów dwóch łamanych (null = brak)
export function boundariesCross(A, closedA, B, closedB, tol) {
  const na = A.length, nb = B.length;
  for (let i = 0; i < (closedA ? na : na - 1); i++)
    for (let j = 0; j < (closedB ? nb : nb - 1); j++) {
      const x = properIntersection(A[i], A[(i + 1) % na], B[j], B[(j + 1) % nb], tol);
      if (x) return x;
    }
  return null;
}

// Krok kątowy łuku: strzałka cięciwy ≤ tol, nie więcej niż 10°
function arcStep(r, tol) {
  const byTol = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
  return Math.min(byTol, 10 * Math.PI / 180);
}

// Punkty pośrednie łuku polilinii z wybrzuszeniem b = tg(kąt/4) między p1 i p2 (bez końców).
// b > 0: łuk w lewo (CCW); na wielokącie CCW wybrzuszenie dodatnie wypycha krawędź na zewnątrz.
export function bulgePoints(p1, p2, b, tol) {
  if (!b) return [];
  const L = dist(p1, p2);
  if (L === 0) return [];
  const theta = 4 * Math.atan(b);
  const r = L * (1 + b * b) / (4 * Math.abs(b));
  const s = Math.abs(b) * L / 2; // strzałka
  const u = [(p2[0] - p1[0]) / L, (p2[1] - p1[1]) / L], nrm = [-u[1], u[0]];
  const m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const h = Math.sign(b) * (r - s);
  const c = [m[0] + nrm[0] * h, m[1] + nrm[1] * h];
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  const n = Math.max(1, Math.ceil(Math.abs(theta) / arcStep(r, tol)));
  const out = [];
  for (let k = 1; k < n; k++) {
    const a = a1 + theta * k / n;
    out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return out;
}

export function circlePoints(c, r, tol) {
  const n = Math.max(12, Math.ceil(2 * Math.PI / arcStep(r, tol)));
  return Array.from({ length: n }, (_, k) => [c[0] + r * Math.cos(2 * Math.PI * k / n), c[1] + r * Math.sin(2 * Math.PI * k / n)]);
}

export function arcPoints(c, r, a0deg, a1deg, tol) {
  let a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
  while (a1 <= a0) a1 += 2 * Math.PI; // łuk DXF zawsze CCW od a0 do a1
  const n = Math.max(1, Math.ceil((a1 - a0) / arcStep(r, tol)));
  return Array.from({ length: n + 1 }, (_, k) => [c[0] + r * Math.cos(a0 + (a1 - a0) * k / n), c[1] + r * Math.sin(a0 + (a1 - a0) * k / n)]);
}

export function bbox(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}
