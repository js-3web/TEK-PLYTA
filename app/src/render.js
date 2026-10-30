// Rysunki na kanwie: rzut płyty z warstwami DXF, siatka MES, mapy wyników (interpolacja w trójkątach).

export class View {
  constructor(canvas) { this.canvas = canvas; this.scale = 1; this.ox = 0; this.oy = 0; }
  fit(bb, pad = 30, right = 0) {
    const W = this.canvas.width - right, H = this.canvas.height;
    this.scale = Math.min((W - 2 * pad) / (bb.maxX - bb.minX || 1), (H - 2 * pad) / (bb.maxY - bb.minY || 1));
    this.ox = pad - bb.minX * this.scale + (W - 2 * pad - (bb.maxX - bb.minX) * this.scale) / 2;
    this.oy = H - pad + bb.minY * this.scale - (H - 2 * pad - (bb.maxY - bb.minY) * this.scale) / 2;
  }
  toScreen([x, y]) { return [this.ox + x * this.scale, this.oy - y * this.scale]; }
  toWorld(px, py) { return [(px - this.ox) / this.scale, (this.oy - py) / this.scale]; }
  zoomAt(px, py, f) { const [x, y] = this.toWorld(px, py); this.scale *= f; this.ox = px - x * this.scale; this.oy = py + y * this.scale; }
  pan(dx, dy) { this.ox += dx; this.oy += dy; }
}

export function bboxOf(pts) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of pts) { b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x); b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y); }
  return b;
}

const C = { bg: '#0b1622', outline: '#e6edf5', hole: '#9fb3c8', column: '#e5484d', wall: '#46a758', edge: '#3fb6d9', area: 'rgba(80,140,255,0.16)', areaLine: '#5b8cff', line: '#f5a524', point: '#ffd43b', text: '#c9d6e3', err: '#ff4d4f', field: '#c084fc' };

function poly(ctx, view, pts, closed = true) {
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = view.toScreen(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  if (closed) ctx.closePath();
}
function label(ctx, view, p, t, color = C.text) {
  const [x, y] = view.toScreen(p); ctx.fillStyle = color; ctx.font = '12px Segoe UI, sans-serif'; ctx.fillText(t, x + 4, y - 4);
}
const centroid = pts => pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);

export function clear(ctx) { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); }

// Rzut płyty: obrys, otwory, strefy i linie obciążeń, podpory, etykiety, błędy, pola ugięć
export function drawGeometry(ctx, view, geo, { errors = [], fields = [], light = false, highlight = null } = {}) {
  if (!geo?.outline?.length) return;
  ctx.lineWidth = 1;
  for (const q of geo.areaLoads ?? []) { poly(ctx, view, q.pts); ctx.fillStyle = C.area; ctx.fill(); ctx.strokeStyle = C.areaLine; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); label(ctx, view, centroid(q.pts), q.label, C.areaLine); }
  poly(ctx, view, geo.outline); ctx.strokeStyle = light ? '#222' : C.outline; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
  for (const h of geo.holes ?? []) { poly(ctx, view, h.pts); ctx.fillStyle = light ? '#fff' : C.bg; ctx.fill(); ctx.strokeStyle = C.hole; ctx.stroke(); label(ctx, view, centroid(h.pts), h.label, C.hole); }
  for (const l of geo.lineLoads ?? []) { poly(ctx, view, l.pts, false); ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1; label(ctx, view, l.pts[0], l.label, C.line); }
  for (const w of geo.walls ?? []) { poly(ctx, view, w.pts, false); ctx.strokeStyle = C.wall; ctx.lineWidth = 5; ctx.stroke(); ctx.lineWidth = 1; label(ctx, view, w.pts[0], w.label, C.wall); }
  for (const e of geo.edges ?? []) { poly(ctx, view, e.pts, false); ctx.strokeStyle = C.edge; ctx.lineWidth = 4; ctx.stroke(); ctx.lineWidth = 1; label(ctx, view, e.pts[0], e.label, C.edge); }
  for (const c of geo.columns ?? []) { poly(ctx, view, c.pts); ctx.fillStyle = C.column; ctx.fill(); label(ctx, view, c.c ?? centroid(c.pts), c.label, light ? '#a00' : C.column); }
  for (const p of geo.pointLoads ?? []) { const [x, y] = view.toScreen(p.p); ctx.fillStyle = C.point; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); label(ctx, view, p.p, p.label, C.point); }
  for (const f of fields) { poly(ctx, view, f.pts); ctx.strokeStyle = C.field; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); label(ctx, view, centroid(f.pts), `${f.label} (L = ${f.L} m)`, C.field); }
  for (const e of errors) if (e.locM) {
    const [x, y] = view.toScreen(e.locM); ctx.strokeStyle = C.err; ctx.lineWidth = e === highlight ? 3 : 2;
    ctx.beginPath(); ctx.arc(x, y, e === highlight ? 14 : 9, 0, 7); ctx.stroke(); ctx.lineWidth = 1;
  }
}

export function drawMesh(ctx, view, mesh, color = 'rgba(160,190,220,0.45)') {
  ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.beginPath();
  for (const [a, b, c] of mesh.elems) {
    const A = view.toScreen(mesh.nodes[a]), B = view.toScreen(mesh.nodes[b]), Cc = view.toScreen(mesh.nodes[c]);
    ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(Cc[0], Cc[1]); ctx.closePath();
  }
  ctx.stroke(); ctx.lineWidth = 1;
}

// Skale barw: sekwencyjna (ugięcia, zbrojenie, rysy) i rozbieżna (momenty: niebieski −, czerwony +)
const SEQ = [[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]];
const DIV = [[33, 102, 172], [103, 169, 207], [209, 229, 240], [247, 247, 247], [253, 219, 199], [239, 138, 98], [178, 24, 43]];
const lerp = (stops, t) => {
  t = Math.max(0, Math.min(1, t)); const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), u = x - i;
  return stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * u));
};

export function colorScale(values, { diverging = false, bands = 12, zeroBlank = false } = {}) {
  let min = Infinity, max = -Infinity;
  for (const v of values) if (Number.isFinite(v)) { if (v < min) min = v; if (v > max) max = v; }
  if (!Number.isFinite(min)) { min = 0; max = 1; }
  if (diverging) { const m = Math.max(Math.abs(min), Math.abs(max)) || 1; min = -m; max = m; }
  if (max - min < 1e-12) max = min + 1;
  const band = v => Math.min(bands - 1, Math.floor((v - min) / (max - min) * bands));
  const color = v => {
    if (!Number.isFinite(v)) return [255, 0, 255];
    if (zeroBlank && Math.abs(v) < 1e-9) return [40, 52, 66];
    return lerp(diverging ? DIV : SEQ, (band(v) + 0.5) / bands);
  };
  return { min, max, bands, color, diverging };
}

// Mapa: rasteryzacja trójkątów z interpolacją liniową wartości (współrzędne barycentryczne)
export function drawMap(ctx, view, mesh, values, scale) {
  const W = ctx.canvas.width, H = ctx.canvas.height, img = ctx.getImageData(0, 0, W, H), d = img.data;
  for (const [a, b, c] of mesh.elems) {
    const A = view.toScreen(mesh.nodes[a]), B = view.toScreen(mesh.nodes[b]), P = view.toScreen(mesh.nodes[c]);
    const va = values[a], vb = values[b], vc = values[c];
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], P[0]))), x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], P[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], P[1]))), y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], P[1])));
    const den = (B[1] - P[1]) * (A[0] - P[0]) + (P[0] - B[0]) * (A[1] - P[1]);
    if (Math.abs(den) < 1e-12) continue;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const l1 = ((B[1] - P[1]) * (px - P[0]) + (P[0] - B[0]) * (py - P[1])) / den;
      const l2 = ((P[1] - A[1]) * (px - P[0]) + (A[0] - P[0]) * (py - P[1])) / den;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const v = Number.isFinite(va) && Number.isFinite(vb) && Number.isFinite(vc) ? l1 * va + l2 * vb + l3 * vc : NaN;
      const [r, g, bb] = scale.color(v), o = 4 * (y * W + x);
      d[o] = r; d[o + 1] = g; d[o + 2] = bb; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// Legenda jako HTML (pasma barw z wartościami)
export function legendHTML(scale, unit, fmt = v => v.toFixed(2)) {
  const rows = [];
  for (let i = scale.bands - 1; i >= 0; i--) {
    const lo = scale.min + (scale.max - scale.min) * i / scale.bands, hi = scale.min + (scale.max - scale.min) * (i + 1) / scale.bands;
    const [r, g, b] = scale.color((lo + hi) / 2);
    rows.push(`<div class="lg-row"><span class="lg-sw" style="background:rgb(${r},${g},${b})"></span>${fmt(lo)} … ${fmt(hi)}</div>`);
  }
  return `<div class="lg-unit">${unit}</div>${rows.join('')}`;
}

export function nearestNode(nodes, [x, y]) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) { const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return { index: best, dist: Math.sqrt(bd) };
}
