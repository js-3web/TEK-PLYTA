// Eksport przypadku do porównania z niezależnym programem MES (tools/cross-check.py, xdfem2d):
// siatka, podpory (więzy + sprężyny), obciążenia elementów i węzłów, wyniki TEK-PŁYTA
// (ugięcia w węzłach, momenty w środkach elementów DKT). Użycie: node tools/export-case.mjs <plik.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import * as dkt from '../src/dkt.js';

const geoOf = f => importGeometry(readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1')));
const CASES = [
  { id: 'kwadrat-przegub', file: 'tests/fixtures/kwadrat-6x6.dxf', h0: 0.3, data: { slab: { E: 30e6, nu: 0.2, t: 0.2 }, edges: { 'domyślne': { type: 'pinned' } }, loads: { Q1: 10 }, selfWeight: false }, compare: ['Q1'] },
  { id: 'kwadrat-utwierdzony', file: 'tests/fixtures/kwadrat-6x6.dxf', h0: 0.3, data: { slab: { E: 30e6, nu: 0.2, t: 0.2 }, edges: { 'domyślne': { type: 'fixed' } }, loads: { Q1: 10 }, selfWeight: false }, compare: ['Q1'] },
  { id: 'slupy-luk', file: 'tests/fixtures/slupy-luk.dxf', h0: 0.4, data: { slab: { E: 30e6, nu: 0.2, t: 0.25 }, columns: { 'domyślne': { E: 33e6, H: 3.5, bottom: 'fixed' } }, loads: { Q1: 5, P1: 40 } }, compare: ['G0', 'Q1', 'P1'] },
  { id: 'wzorzec', file: 'assets/TEK-PLYTA_wzorzec.dxf', h0: 0.5, data: { slab: { E: 33e6, nu: 0.2, t: 0.25 }, columns: { 'domyślne': { E: 33e6, H: 3.6, bottom: 'fixed' } }, walls: { 'domyślne': { E: 8e6, t: 0.25, H: 3.6, bottom: 'pinned' } }, edges: { 'domyślne': { type: 'pinned' } }, loads: { Q1: 3, Q2: 7.5, L1: 6.2, P1: 25 } }, compare: ['G0', 'Q2', 'L1', 'P1'] },
];

const out = [];
for (const c of CASES) {
  const geo = geoOf(c.file), mesh = generateMesh(geo, { h0: c.h0 });
  const an = analyzeSlab(geo, mesh, c.data), P = an.modelParams, Dm = dkt.plateD(P.mat.E, P.mat.t, P.mat.nu);
  const cases = c.compare.map(name => {
    const cd = an.caseDefs.find(x => x.name === name), r = an.cases.get(name);
    const qOf = typeof cd.q === 'function' ? cd.q : () => cd.q;
    const elemM = mesh.elems.map(e => {
      const xy = e.map(i => mesh.nodes[i]), ue = e.flatMap(i => [r.u[3 * i], r.u[3 * i + 1], r.u[3 * i + 2]]);
      return dkt.moments(xy, Dm, ue, 1 / 3, 1 / 3);
    });
    return { name, q: mesh.elems.map((_, ie) => qOf(ie)), point: cd.point, w: mesh.nodes.map((_, i) => r.u[3 * i]), m: elemM, totalLoad: r.totalLoad };
  });
  out.push({ id: c.id, E: P.mat.E, nu: P.mat.nu, t: P.mat.t, nodes: mesh.nodes, elems: mesh.elems,
    fix: [...P.fix].map(([n, f]) => ({ n, w: !!f.w, tx: !!f.tx, ty: !!f.ty })), springs: P.springs, cases });
}
writeFileSync(process.argv[2] ?? 'cross-check.json', JSON.stringify(out));
console.log(`zapisano ${out.length} przypadków`);
