// Wymiarowanie całej płyty SGN: obwiednie → Wood–Armer → zbrojenie w węzłach, przebicie przy słupach.
//
// designSlab({ geo, mesh, env, design }) — env z slabEnvelopes(), design:
//   { concrete: 'C30/37', steel: 'B500SP', h [m],
//     cover: { bottom, top } [m],
//     bottom: { phiX, phiY, outer: 'x'|'y' }, top: { … } [m],
//     base: { bottom: { x, y }, top: { x, y } }   zbrojenie podstawowe (siatki) [mm²/m],
//     punching: { beta?: 'uproszczone' | liczba, extraTop?: { S1: { x, y } } [mm²/m] } }
//
// Nad słupami momenty górne uśredniane na szerokości słup + 2·h (specyfikacja, sekcja 4):
// dla prętów x — węzły w pasie |x − xc| ≤ c_x/2, |y − yc| ≤ c_y/2 + h (dla y analogicznie).
// Wynik ma obie mapy: wartości szczytowe i uśrednione; zbrojenie liczone z uśrednionych.

import { designMaterials } from '../norms/en1992-pl.js';
import { designMomentEnvelope, designSection, effectiveDepths } from './bending.js';
import { controlPerimeter, punchingCheck, BETA_SIMPLIFIED } from './punching.js';

const LAYERS = [['bottomX', 'bottom', 'x'], ['bottomY', 'bottom', 'y'], ['topX', 'top', 'x'], ['topY', 'top', 'y']];

export function designSlab({ geo, mesh, env, design }) {
  const mat = designMaterials(design.concrete, design.steel);
  const dd = effectiveDepths(design);
  const peak = designMomentEnvelope(env.fields.nodes, env.schemes.ULS);
  const N = mesh.nodes.length, warnings = [];

  // --- uśrednianie nad słupami (tylko momenty górne) ---
  const avg = { ...peak, topX: Float64Array.from(peak.topX), topY: Float64Array.from(peak.topY) };
  for (const col of geo.columns) {
    const xs = col.pts.map(p => p[0]), ys = col.pts.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (const [key, alongX] of [['topX', true], ['topY', false]]) {
      const band = [];
      for (let i = 0; i < N; i++) {
        const [x, y] = mesh.nodes[i];
        const inBand = alongX ? x >= x0 - 1e-9 && x <= x1 + 1e-9 && y >= y0 - design.h && y <= y1 + design.h
          : y >= y0 - 1e-9 && y <= y1 + 1e-9 && x >= x0 - design.h && x <= x1 + design.h;
        if (inBand) band.push(i);
      }
      if (band.length < 3) { warnings.push({ code: 'usrednianie-za-malo-wezlow', msg: `Słup ${col.label}: za mało węzłów do uśrednienia momentów (${key}) — zagęść siatkę.` }); continue; }
      const mean = band.reduce((s, i) => s + peak[key][i], 0) / band.length;
      for (const i of band) avg[key][i] = Math.max(peak[key][i], mean); // moment ujemny: średnia jest mniejsza co do modułu
    }
  }

  // --- zbrojenie w węzłach ---
  const nodes = {};
  let failures = 0;
  for (const [key, face, dir] of LAYERS) {
    const d = dd[face][dir], base = design.base?.[face]?.[dir] ?? 0;
    const AsReq = new Float64Array(N), AsExtra = new Float64Array(N), fail = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const M = Math.abs(avg[key][i]);
      if (M < 1e-9) continue;
      const r = designSection(M, design.h, d, mat);
      if (!r.ok) { fail[i] = 1; failures++; AsReq[i] = NaN; continue; }
      AsReq[i] = r.AsReq;
      AsExtra[i] = Math.max(0, r.AsReq - base);
    }
    nodes[key] = { peak: peak[key], design: avg[key], d, base, AsReq, AsExtra, fail };
  }
  if (failures) warnings.push({ code: 'przekroj-za-maly', msg: `${failures} węzłów: przekroczone ξeff,lim lub As,max — zwiększ grubość lub klasę betonu.` });

  // --- przebicie ---
  const dTop = (dd.top.x + dd.top.y) / 2;
  const punching = [];
  for (const col of geo.columns) {
    const sup = env.supports.ULS.find(s => s.label === col.label);
    if (!sup) continue;
    const cp = controlPerimeter(col, geo, dTop);
    if (cp.reentrant) warnings.push({ code: 'przebicie-naroze-wklesle', msg: `Słup ${col.label}: przy narożu wklęsłym płyty — norma go nie opisuje; przyjęto β i u0 jak dla słupa krawędziowego. Sprawdź.` });
    const beta = typeof design.punching?.beta === 'number' ? design.punching.beta : BETA_SIMPLIFIED[cp.type];
    const extra = design.punching?.extraTop?.[col.label] ?? { x: 0, y: 0 };
    const rhoX = ((design.base?.top?.x ?? 0) + extra.x) / (1000 * dd.top.x * 1000);
    const rhoY = ((design.base?.top?.y ?? 0) + extra.y) / (1000 * dd.top.y * 1000);
    const chk = punchingCheck({ VEd: Math.max(0, sup.V.max), beta, u1: cp.u1, u0: cp.u0, d: dTop, rhoX, rhoY, mat });
    if (chk.shearReinforcement && design.h < 0.2)
      warnings.push({ code: 'przebicie-grubosc', msg: `Słup ${col.label}: potrzebne zbrojenie na przebicie, a płyta ma h < 200 mm (9.3.2(1)).` });
    if (chk.vEd0 > chk.vRdMax)
      warnings.push({ code: 'przebicie-vRdmax', msg: `Słup ${col.label}: vEd,0 > vRd,max przy licu słupa — zwiększ grubość, beton lub wymiary słupa.` });
    punching.push({ label: col.label, type: cp.type, shadows: cp.shadows, combination: sup.V.govMax, ...chk });
  }
  return { mat, depths: dd, nodes, punching, warnings };
}
