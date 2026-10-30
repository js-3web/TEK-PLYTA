// Mapy wyników w stylu programów MES (Robot: „Mapy” i „Przekroje przez panele”) — część obliczeniowa,
// niezależna od przeglądarki: skala barw, izolinie, ekstrema, wartości wzdłuż przekroju.
// Wartości w węzłach siatki; w trójkącie interpolacja liniowa (ta sama co przy rysowaniu mapy).

// Paleta tęczowa: granat → niebieski → cyjan → zielony → żółty → pomarańcz → czerwony
const RAINBOW = [[20, 20, 140], [0, 60, 230], [0, 150, 255], [0, 220, 230], [0, 200, 120], [90, 220, 40], [200, 235, 0], [255, 220, 0], [255, 150, 0], [240, 70, 0], [190, 0, 0]];
const lerp = (stops, t) => {
  t = Math.max(0, Math.min(1, t)); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * u));
};

// Skala: auto (min/max z danych, opcjonalnie symetryczna) albo ręczna; bands — liczba pasm (warstwice) albo
// smooth — barwa ciągła. Zwraca też granice pasm (do legendy i izolinii).
export function makeScale(values, { min = null, max = null, bands = 16, symmetric = false, smooth = false } = {}) {
  let lo = Infinity, hi = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  const dataMin = lo, dataMax = hi;
  if (symmetric) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; lo = -m; hi = m; }
  if (Number.isFinite(min)) lo = min;
  if (Number.isFinite(max)) hi = max;
  if (hi - lo < 1e-12) hi = lo + 1;
  const n = Math.max(2, Math.round(bands));
  const levels = Array.from({ length: n + 1 }, (_, i) => lo + (hi - lo) * i / n);
  const color = v => {
    if (!Number.isFinite(v)) return [232, 230, 222];
    const t = (v - lo) / (hi - lo);
    if (smooth) return lerp(RAINBOW, t);
    const b = Math.max(0, Math.min(n - 1, Math.floor(t * n)));
    return lerp(RAINBOW, (b + 0.5) / n);
  };
  return { min: lo, max: hi, dataMin, dataMax, bands: n, levels, color, smooth };
}

// Izolinie (marching triangles): dla każdego poziomu odcinki w trójkątach, przez które przechodzi.
export function isolines(nodes, elems, values, levels) {
  return levels.map(level => {
    const segs = [];
    for (const [a, b, c] of elems) {
      const pts = [];
      for (const [i, j] of [[a, b], [b, c], [c, a]]) {
        const vi = values[i] - level, vj = values[j] - level;
        if (!Number.isFinite(vi) || !Number.isFinite(vj)) continue;
        if ((vi < 0 && vj >= 0) || (vi >= 0 && vj < 0)) {
          const t = vi / (vi - vj);
          pts.push([nodes[i][0] + t * (nodes[j][0] - nodes[i][0]), nodes[i][1] + t * (nodes[j][1] - nodes[i][1])]);
        }
      }
      if (pts.length === 2) segs.push(pts);
    }
    return { level, segs };
  });
}

export function extrema(values) {
  let iMax = -1, iMin = -1;
  values.forEach((v, i) => { if (!Number.isFinite(v)) return; if (iMax < 0 || v > values[iMax]) iMax = i; if (iMin < 0 || v < values[iMin]) iMin = i; });
  return { iMax, iMin, max: values[iMax], min: values[iMin] };
}

// Wartość w punkcie p (interpolacja w trójkącie, który go zawiera; null poza płytą)
export function locator(nodes, elems) {
  // siatka kubełków przyspiesza szukanie trójkąta
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of nodes) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const nb = Math.max(1, Math.round(Math.sqrt(elems.length / 4))), cw = (x1 - x0) / nb || 1, ch = (y1 - y0) / nb || 1;
  const grid = Array.from({ length: nb * nb }, () => []);
  elems.forEach((e, ie) => {
    const xs = e.map(i => nodes[i][0]), ys = e.map(i => nodes[i][1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - x0) / cw)), i1 = Math.min(nb - 1, Math.floor((Math.max(...xs) - x0) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - y0) / ch)), j1 = Math.min(nb - 1, Math.floor((Math.max(...ys) - y0) / ch));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) grid[j * nb + i].push(ie);
  });
  return (p, values) => {
    const i = Math.floor((p[0] - x0) / cw), j = Math.floor((p[1] - y0) / ch);
    if (i < 0 || j < 0 || i >= nb || j >= nb) return null;
    for (const ie of grid[j * nb + i]) {
      const [a, b, c] = elems[ie], A = nodes[a], B = nodes[b], C = nodes[c];
      const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
      const l1 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / den;
      const l2 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / den, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * values[a] + l2 * values[b] + l3 * values[c];
    }
    return null;
  };
}

// Przekrój: n punktów na odcinku a–b; s — odległość od a [m]; v — wartość albo null (poza płytą, otwór)
export function sectionProfile(nodes, elems, values, a, b, n = 200, loc = locator(nodes, elems)) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
    out.push({ s: t * L, p, v: loc(p, values) });
  }
  const vals = out.filter(o => o.v != null);
  const ex = vals.length ? { max: vals.reduce((m, o) => (o.v > m.v ? o : m)), min: vals.reduce((m, o) => (o.v < m.v ? o : m)) } : null;
  return { L, samples: out, extrema: ex };
}
