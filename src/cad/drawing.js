// Rysunek zbrojenia płyty (DXF): obrys, otwory, słupy, ściany + pręty reprezentatywne z liniami rozkładu
// i opisami (wersja 1: bez pozycji i zestawienia stali — decyzja projektanta z 30.10.2026).
// Warstwy: ZB_DOL_X, ZB_DOL_Y (pręty dolne), ZB_GORA_X, ZB_GORA_Y (górne), ZB_STREFY (granice stref
// dozbrojenia), ZB_PRZEBICIE (obwody zbrojenia na przebicie), ZB_OPIS (opisy). Pręty przycięte do obrysu
// i otworów, z otuliną na końcach.

import { DxfWriter } from './dxf-write.js';
import { pointInPolygon } from '../geometry/polygon.js';
import { controlPerimeter } from '../design/punching.js';

const LAYER = {
  bottomX: ['ZB_DOL_X', 1], bottomY: ['ZB_DOL_Y', 3], topX: ['ZB_GORA_X', 5], topY: ['ZB_GORA_Y', 6],
};
const NAME = { bottomX: 'dół, kier. x', bottomY: 'dół, kier. y', topX: 'góra, kier. x', topY: 'góra, kier. y' };

// Odcinki prostej p0 + t·dir leżące w płycie (wewnątrz obrysu, poza otworami)
export function clipLine(geo, p0, dir) {
  const ts = [];
  const cut = pts => pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length], ex = b[0] - a[0], ey = b[1] - a[1];
    const den = dir[0] * ey - dir[1] * ex;
    if (Math.abs(den) < 1e-12) return;
    const wx = a[0] - p0[0], wy = a[1] - p0[1];
    const t = (wx * ey - wy * ex) / den, s = (wx * dir[1] - wy * dir[0]) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  });
  cut(geo.outline); for (const h of geo.holes ?? []) cut(h.pts);
  ts.sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i + 1] - ts[i] < 1e-6) continue;
    const tm = (ts[i] + ts[i + 1]) / 2, m = [p0[0] + tm * dir[0], p0[1] + tm * dir[1]];
    if (pointInPolygon(m, geo.outline) && !(geo.holes ?? []).some(h => pointInPolygon(m, h.pts))) segs.push([ts[i], ts[i + 1]]);
  }
  return segs;
}

const at = (p0, dir, t) => [p0[0] + t * dir[0], p0[1] + t * dir[1]];
const fmtBar = b => (b.perSpacing === 2 ? `2×#${b.phi} co ${b.s * 2}` : `#${b.phi} co ${b.s}`);

// Pręt reprezentatywny (wszystkie odcinki w płycie na danej linii, skrócone o otulinę) + linia rozkładu
// + opis. range — [t0, t1] zakres pręta wzdłuż jego osi (strefa) albo null (cała płyta).
function drawBar(w, geo, layer, { p0, dir, range, distFrom, distTo, cover, label, textH, textAt = 0.55 }) {
  const perp = [-dir[1], dir[0]];
  let segs = clipLine(geo, p0, dir);
  if (range) segs = segs.map(([a, b]) => [Math.max(a, range[0]), Math.min(b, range[1])]).filter(([a, b]) => b - a > 1e-6);
  let longest = null;
  for (const [a, b] of segs) {
    const s0 = a + cover, s1 = b - cover; if (s1 <= s0) continue;
    w.line(layer, at(p0, dir, s0), at(p0, dir, s1));
    // znaczniki końców pręta (krótkie kreski poprzeczne)
    for (const s of [s0, s1]) { const q = at(p0, dir, s); w.line(layer, [q[0] - perp[0] * 0.05, q[1] - perp[1] * 0.05], [q[0] + perp[0] * 0.05, q[1] + perp[1] * 0.05]); }
    if (!longest || s1 - s0 > longest[1] - longest[0]) longest = [s0, s1];
  }
  if (!longest) return null;
  // linia rozkładu: prostopadła, w 1/3 długości pręta, przez zakres [distFrom, distTo] (współrzędna poprzeczna)
  const tm = longest[0] + (longest[1] - longest[0]) / 3, base = at(p0, dir, tm);
  const offs = base[0] * perp[0] + base[1] * perp[1];
  // linia rozkładu przycięta do płyty (w płycie L nie przecina pustego naroża), kreski na końcach
  const dBase = at(base, perp, -offs);
  for (const [a, b] of clipLine(geo, dBase, perp)) {
    const lo = Math.max(a, distFrom), hi = Math.min(b, distTo); if (hi - lo < 1e-6) continue;
    const q0 = at(dBase, perp, lo), q1 = at(dBase, perp, hi);
    w.line(layer, q0, q1);
    for (const q of [q0, q1]) w.line(layer, [q[0] - dir[0] * 0.08 - perp[0] * 0.08, q[1] - dir[1] * 0.08 - perp[1] * 0.08], [q[0] + dir[0] * 0.08 + perp[0] * 0.08, q[1] + dir[1] * 0.08 + perp[1] * 0.08]);
  }
  const len = longest[1] - longest[0], mid = at(p0, dir, longest[0] + len * textAt);
  const rot = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  w.text('ZB_OPIS', [mid[0] + perp[0] * textH * 0.4, mid[1] + perp[1] * textH * 0.4], textH, `${label}, L=${Math.round(len * 1000)}`, rot);
  return { length: len };
}

// geo — geometria z importu; rebar — selectRebar(); design — { h, cover, bottom, top }
export function rebarDrawing({ geo, rebar, design, title = 'TEK-PŁYTA — zbrojenie płyty' }) {
  const w = new DxfWriter();
  w.layer('TP_OBRYS', 7).layer('TP_OTWOR', 8).layer('TP_SLUP', 1).layer('TP_SCIANA', 3)
    .layer('ZB_DOL_X', 1).layer('ZB_DOL_Y', 3).layer('ZB_GORA_X', 5).layer('ZB_GORA_Y', 6)
    .layer('ZB_STREFY', 2, 'DASHED').layer('ZB_PRZEBICIE', 4).layer('ZB_OPIS', 7);
  const xs = geo.outline.map(p => p[0]), ys = geo.outline.map(p => p[1]);
  const bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const textH = Math.max(0.1, Math.min(bb.x1 - bb.x0, bb.y1 - bb.y0) / 120);
  const out = { bars: [], sheets: [] };
  // dwa rzuty obok siebie: zbrojenie dolne i górne (osobno — czytelność, jak na rysunkach wykonawczych)
  const gap = Math.max(2, 0.25 * (bb.x1 - bb.x0));
  [['bottom', 'ZBROJENIE DOLNE', 0], ['top', 'ZBROJENIE GÓRNE', bb.x1 - bb.x0 + gap]].forEach(([face, name, dx]) => {
    w.offset = [dx, 0];
    out.sheets.push({ face, dx });
    w.poly('TP_OBRYS', geo.outline, true);
    for (const h of geo.holes ?? []) w.poly('TP_OTWOR', h.pts, true);
    for (const c of geo.columns ?? []) w.poly('TP_SLUP', c.pts, true);
    for (const s of geo.walls ?? []) w.poly('TP_SCIANA', s.pts, false);
    w.text('ZB_OPIS', [bb.x0, bb.y1 + textH * 3], textH * 1.6, `${title} — ${name}`);
    w.text('ZB_OPIS', [bb.x0, bb.y1 + textH * 1.2], textH, `Otulina ${face === 'bottom' ? 'dolna' : 'górna'} ${Math.round(design.cover[face] * 1000)} mm. Wymiary w mm. Rysunek bez pozycji i zestawienia stali.`);
    // siatki: pręt reprezentatywny w różnych miejscach dla kierunków x i y (czytelność)
    const FR = { bottomX: 0.30, topX: 0.70, bottomY: 0.35, topY: 0.65 };
    for (const [key, L] of Object.entries(rebar.layers)) {
      if (!key.startsWith(face)) continue;
      const alongX = key.endsWith('X');
      const cover = design.cover[face] + (design[face][alongX ? 'phiX' : 'phiY'] ?? 0) / 2;
      const [layer] = LAYER[key], dir = alongX ? [1, 0] : [0, 1];
      const p0 = alongX ? [bb.x0, bb.y0 + FR[key] * (bb.y1 - bb.y0)] : [bb.x0 + FR[key] * (bb.x1 - bb.x0), bb.y0];
      const r = drawBar(w, geo, layer, { p0, dir, range: null, distFrom: alongX ? bb.y0 : -bb.x1, distTo: alongX ? bb.y1 : -bb.x0, cover, label: `#${L.base.phi} co ${L.base.s} (${NAME[key]})`, textH });
      out.bars.push({ key, kind: 'siatka', drawn: !!r });
      // strefy dozbrojenia: granica (przerywana) + pręt reprezentatywny + rozkład na szerokość strefy
      for (const z of L.zones) {
        if (!z.bar || z.bar.fail) continue;
        const R = z.rect;
        w.poly('ZB_STREFY', [[R.x0, R.y0], [R.x1, R.y0], [R.x1, R.y1], [R.x0, R.y1]], true);
        const nested = L.zones.find(o => o !== z && o.tier < z.tier && o.bar && !o.bar.fail && R.x0 >= o.rect.x0 - 1e-9 && R.x1 <= o.rect.x1 + 1e-9 && R.y0 >= o.rect.y0 - 1e-9 && R.y1 <= o.rect.y1 + 1e-9);
        const label = `+${fmtBar(z.bar)} (${NAME[key]})${nested ? ` zamiast ${fmtBar(nested.bar)}` : ''}`;
        // strefy zagnieżdżone mają wspólny środek — pręt reprezentatywny i opis przesunięte wg stopnia
        const width = alongX ? R.y1 - R.y0 : R.x1 - R.x0, shift = (z.tier - 1) * Math.min(width / 4, 3 * textH);
        const zp0 = alongX ? [0, (R.y0 + R.y1) / 2 + shift] : [(R.x0 + R.x1) / 2 + shift, 0];
        const range = alongX ? [R.x0, R.x1] : [R.y0, R.y1];
        const rz = drawBar(w, geo, layer, { p0: zp0, dir, range, distFrom: alongX ? R.y0 : -R.x1, distTo: alongX ? R.y1 : -R.x0, cover: 0, label, textH: textH * 0.8, textAt: [0.15, 0.4, 0.65][(z.tier - 1) % 3] });
        out.bars.push({ key, kind: 'strefa', id: z.id, drawn: !!rz });
      }
    }
    if (face !== 'top') return;
    // przebicie (rzut górny): obwody zbrojenia (krzywe w odległości r od lica słupa) + opis
    for (const p of rebar.punching ?? []) {
      if (p.fail || !p.perimeters) continue;
      const col = geo.columns.find(c => c.label === p.label); if (!col) continue;
      for (const per of p.perimeters) {
        const cp = controlPerimeter(col, geo, p.d, per.r);
        for (const run of cp.runs) w.poly('ZB_PRZEBICIE', run, cp.closedLoop);
      }
      const c = col.c ?? col.pts[0];
      w.text('ZB_OPIS', [c[0] + p.rOut * 0.7, c[1] + p.rOut * 0.7], textH * 0.8,
        `${p.label}: strzemiona #${p.phi}, ${p.nPerimeters} obw. (${p.perimeters.map(x => x.legs).join('/')} szt.), s0=${Math.round(p.s0 * 1000)}, sr=${Math.round(p.sr * 1000)}`);
    }
  });
  w.offset = [0, 0];
  return { dxf: w, ...out };
}
