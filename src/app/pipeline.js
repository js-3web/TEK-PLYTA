// Łańcuch obliczeń całego projektu: DXF → walidacja → siatka → MES → kombinacje → SGN → SGU.
// Jedno wejście (projekt JSON, zapisywany w bazie i w pliku .tekplyta), jedno wyjście (wyniki do map,
// tabel i raportu). Używany przez Web Worker w aplikacji i przez testy w Node.
//
// project = {
//   meta:  { name, investor, object, author },
//   dxf:   tekst pliku DXF,
//   slab:  { h [m], concrete: 'C30/37', steel: 'B500SP', nu: 0.2, gamma: 25 },
//   reinf: { cover: { bottom, top } [m], bottom: { phiX, phiY, sX, sY, outer }, top: { … } } [m],
//   columns: { 'domyślne': { material: 'zelbet'|'mur'|'stal', concrete?, E? [MPa], H [m], bottom, rigid }, S1: {…} },
//   walls:   { 'domyślne': { material, concrete?, E?, t [m], H [m], bottom, rigid }, W1: {…} },
//   edges:   { 'domyślne': { type: 'pinned'|'fixed' }, K1: {…} },
//   loads:   { Q1: { value, type: 'G'|'Q', category }, L1: {…}, P1: {…} },  wartości charakterystyczne
//   mesh:  { h0 [m] },
//   combination: { formulas: ['6.10a', '6.10b'] },
//   punching: { beta: 'uproszczone' | liczba },
//   sls:   { RH, cement, t0, exposure, fields: [{ label, pts, L }] }
// }

import { readDxf } from '../dxf/read.js';
import { importGeometry } from '../geometry/import.js';
import { generateMesh } from '../mesh/mesher.js';
import { analyzeSlab } from '../analysis/build.js';
import { slabEnvelopes } from '../combinations.js';
import { designSlab } from '../design/slab.js';
import { checkSlabSLS } from '../design/sls.js';
import { CONCRETE } from '../norms/en1992-pl.js';

export const VERSION = '0.5.0';

// Domyślny projekt — wartości startowe formularzy (projektant zmienia)
export function defaultProject() {
  return {
    meta: { name: 'Nowy projekt', investor: '', object: '', author: '' },
    dxf: null,
    slab: { h: 0.25, concrete: 'C30/37', steel: 'B500SP', nu: 0.2, gamma: 25 },
    reinf: {
      cover: { bottom: 0.025, top: 0.025 },
      bottom: { phiX: 0.012, phiY: 0.012, sX: 0.15, sY: 0.15, outer: 'x' },
      top: { phiX: 0.012, phiY: 0.012, sX: 0.15, sY: 0.15, outer: 'x' },
    },
    columns: { 'domyślne': { material: 'zelbet', concrete: 'C30/37', H: 3.0, bottom: 'fixed', rigid: false } },
    walls: { 'domyślne': { material: 'zelbet', concrete: 'C30/37', t: 0.2, H: 3.0, bottom: 'pinned', rigid: false } },
    edges: { 'domyślne': { type: 'pinned' } },
    loads: {},
    mesh: { h0: 0.5 },
    combination: { formulas: ['6.10a', '6.10b'] },
    punching: { beta: 'uproszczone' },
    sls: { RH: 50, cement: 'N', t0: 28, exposure: 'XC1', fields: [] },
  };
}

// Moduł sprężystości podpory [kPa] z materiału
export function supportE(d) {
  if (d.material === 'stal') return 210e6;
  if (d.material === 'mur') {
    if (!(d.E > 0)) throw new Error('Podpora murowana: podaj moduł E muru [MPa].');
    return d.E * 1000;
  }
  const c = CONCRETE[d.concrete ?? 'C30/37'];
  if (!c) throw new Error(`Nieznana klasa betonu podpory: ${d.concrete}`);
  return c.Ecm * 1e6;
}

const withE = group => Object.fromEntries(Object.entries(group ?? {}).map(([k, v]) => [k, { ...v, E: v.rigid ? undefined : supportE({ ...group['domyślne'], ...v }) }]));

// As siatki z średnicy i rozstawu [mm²/m]
export const meshArea = (phi, s) => Math.PI * (phi * 1000) ** 2 / 4 / (s * 1000) * 1000;

// Krok 1: wczytanie i walidacja geometrii (szybkie — do podglądu)
export function loadGeometry(dxfText) {
  const dxf = readDxf(dxfText);
  return importGeometry(dxf);
}

// Pełne obliczenia. progress(etap, ułamek) — opcjonalnie (pasek postępu w aplikacji).
export function runProject(project, progress = () => {}) {
  const t = { start: Date.now() };
  const geo = loadGeometry(project.dxf);
  if (geo.errors.length) return { ok: false, stage: 'geometria', geo, errors: geo.errors, warnings: geo.warnings };
  const hasSupport = geo.columns.length + geo.walls.length + geo.edges.length > 0;
  if (!hasSupport) return { ok: false, stage: 'geometria', geo, errors: [{ code: 'brak-podpor', msg: 'Brak podpór — płyta niestateczna.' }], warnings: geo.warnings };

  // obciążenia: wartości i opis oddziaływań (G/Q + kategoria); brak opisu = błąd, nie domysł
  const labels = [...geo.areaLoads, ...geo.lineLoads, ...geo.pointLoads].map(o => o.label);
  const errors = [];
  for (const l of labels) {
    const L = project.loads?.[l];
    if (!L || !Number.isFinite(L.value)) errors.push({ code: 'brak-obciazenia', msg: `${l}: podaj wartość charakterystyczną obciążenia.` });
    else if (L.type === 'Q' && !L.category) errors.push({ code: 'brak-kategorii', msg: `${l}: podaj kategorię oddziaływania zmiennego.` });
  }
  if (errors.length) return { ok: false, stage: 'dane', geo, errors, warnings: geo.warnings };

  progress('siatka', 0.05);
  const mesh = generateMesh(geo, { h0: project.mesh?.h0 ?? 0.5 });
  t.mesh = Date.now();

  progress('MES', 0.2);
  const s = project.slab;
  const analysis = analyzeSlab(geo, mesh, {
    slab: { E: CONCRETE[s.concrete].Ecm * 1e6, nu: s.nu ?? 0.2, t: s.h, gamma: s.gamma ?? 25 },
    columns: withE(project.columns), walls: withE(project.walls), edges: project.edges,
    loads: Object.fromEntries(labels.map(l => [l, project.loads[l].value])),
  });
  t.fem = Date.now();

  progress('kombinacje', 0.5);
  const actions = { G0: { type: 'G' } };
  for (const l of labels) actions[l] = project.loads[l].type === 'G' ? { type: 'G' } : { type: 'Q', category: project.loads[l].category, group: project.loads[l].group };
  const env = slabEnvelopes(analysis.cases, actions, { formulas: project.combination?.formulas });

  progress('SGN', 0.6);
  const r = project.reinf;
  const design = {
    concrete: s.concrete, steel: s.steel, h: s.h, cover: r.cover, bottom: r.bottom, top: r.top,
    base: {
      bottom: { x: meshArea(r.bottom.phiX, r.bottom.sX), y: meshArea(r.bottom.phiY, r.bottom.sY) },
      top: { x: meshArea(r.top.phiX, r.top.sX), y: meshArea(r.top.phiY, r.top.sY) },
    },
    punching: project.punching?.beta === 'uproszczone' ? {} : { beta: project.punching?.beta },
  };
  const uls = designSlab({ geo, mesh, env, design });
  t.uls = Date.now();

  progress('SGU', 0.7);
  const sls = checkSlabSLS({ geo, mesh, analysis, env, uls, design, sls: project.sls });
  t.sls = Date.now();
  progress('gotowe', 1);

  // wyniki do map: wartości w węzłach (Float32Array — mniej pamięci, przesyłane do wątku głównego)
  const f32 = a => Float32Array.from(a);
  const caseList = [...analysis.cases.keys()];
  const qp = env.nodes.QP, ulsEnv = env.nodes.ULS;
  const maps = {
    w_el: f32(qp.w.max),                       // ugięcie sprężyste, kombinacja quasi-stała (Ecm)
    w_lt: f32(sls.deflection.w),               // ugięcie długotrwałe (zarysowanie, pełzanie, skurcz)
    mx_max: f32(ulsEnv.mx.max), mx_min: f32(ulsEnv.mx.min),
    my_max: f32(ulsEnv.my.max), my_min: f32(ulsEnv.my.min),
    mxy_max: f32(ulsEnv.mxy.max), mxy_min: f32(ulsEnv.mxy.min),
  };
  for (const k of ['bottomX', 'bottomY', 'topX', 'topY']) {
    maps[`Md_${k}`] = f32(uls.nodes[k].design);
    maps[`As_${k}`] = f32(uls.nodes[k].AsReq);
    maps[`dAs_${k}`] = f32(uls.nodes[k].AsExtra);
    maps[`wk_${k}`] = f32(sls.cracks[k]);
  }

  // kontrola modelu: suma reakcji vs obciążenie dla każdego przypadku
  const equilibrium = caseList.map(n => {
    const c = analysis.cases.get(n), sumV = c.supportReactions.reduce((a, x) => a + x.V, 0);
    return { case: n, load: c.totalLoad, reactions: sumV, error: Math.abs(sumV - c.totalLoad) / Math.max(1e-9, Math.abs(c.totalLoad)) };
  });

  const maxOf = a => a.reduce((m, v) => (Number.isFinite(v) && v > m ? v : m), -Infinity);
  const summary = {
    nodes: mesh.nodes.length, elements: mesh.elems.length, unknowns: analysis.model.neq, minAngle: mesh.quality.minAngle,
    wLtMax: maxOf(sls.deflection.w), wkMax: sls.wkMax, wmax: sls.wmax,
    AsMax: Object.fromEntries(['bottomX', 'bottomY', 'topX', 'topY'].map(k => [k, maxOf(uls.nodes[k].AsReq)])),
    punchingMaxUtil: Math.max(0, ...uls.punching.map(p => p.util)),
    phi: sls.phi, ecs: sls.ecs, iterations: sls.deflection.iterations,
    times: { siatka: t.mesh - t.start, MES: t.fem - t.mesh, SGN: t.uls - t.fem, SGU: t.sls - t.uls },
  };

  return {
    ok: true, version: VERSION, geo, errors: [],
    warnings: [...geo.warnings, ...mesh.warnings ?? [], ...analysis.warnings, ...uls.warnings, ...sls.warnings],
    mesh: { nodes: mesh.nodes, elems: mesh.elems, quality: mesh.quality },
    cases: caseList, equilibrium,
    combinations: { ULS: env.schemes.ULS.map(v => v.name), QP: env.schemes.QP.map(v => v.name) },
    supports: env.supports.ULS.map(s => ({ label: s.label, kind: s.kind, Vmax: s.V.max, Vmin: s.V.min, gov: s.V.govMax })),
    punching: uls.punching.map(p => ({ ...p })),
    sls: { phi: sls.phi, ecs: sls.ecs, creep: sls.creep, shrinkage: sls.shrinkage, wmax: sls.wmax, wkMax: sls.wkMax,
      fields: sls.fields, iterations: sls.deflection.iterations, converged: sls.deflection.converged },
    materials: { ...uls.mat, norm: undefined }, depths: uls.depths, design: { base: design.base },
    maps, summary,
  };
}
