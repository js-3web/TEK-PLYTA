// Edytowalne współczynniki normowe: domyślne = normowe; zmiana działa w obliczeniach i jest raportowana.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultParams, resolveParams, diffParams, ec2Norm, ec0Norm, psiTable } from '../src/norms/params.js';
import { NORM as EC2 } from '../src/norms/en1992-pl.js';
import { NORM as EC0, PSI } from '../src/norms/en1990-pl.js';
import { designMaterials } from '../src/norms/en1992-pl.js';
import { designSection } from '../src/design/bending.js';
import { buildSchemes, envelope } from '../src/combinations.js';
import { defaultProject, runProject } from '../src/app/pipeline.js';
import { buildReport, renderHTML } from '../src/report/report.js';
import { exportProjectFile, importProjectFile } from '../src/app/db.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v} vs ${ref}`);

test('wartości domyślne = moduły normowe; brak zmian w diffParams', () => {
  const p = defaultParams();
  assert.equal(p.ec2.gammaC, EC2.gammaC); assert.equal(p.ec2.vRdMaxCoef, EC2.vRdMaxCoef);
  assert.equal(p.ec0.gammaQ, EC0.gammaQ); assert.equal(p.ec0.psi.B.psi2, PSI.B.psi2);
  assert.deepEqual(diffParams(resolveParams({})), []);
  assert.deepEqual(diffParams(resolveParams(undefined)), []);
});

test('nadpisania: nieznane klucze i wartości niedodatnie pomijane; zmiany wymienione z wartością normową', () => {
  const p = resolveParams({ ec2: { gammaC: 1.5, foo: 3, alphaCC: -1, crack: { k3: 'x' } }, bar: 1 });
  assert.equal(p.ec2.gammaC, 1.5); assert.equal(p.ec2.alphaCC, EC2.alphaCC); assert.equal(p.ec2.crack.k3, 3.4);
  assert.equal(p.ec2.foo, undefined);
  assert.deepEqual(diffParams(p).map(c => [c.path, c.normative, c.adopted]), [['ec2.gammaC', EC2.gammaC, 1.5]]);
});

test('γc = 1,5: fcd = 30/1,5 = 20,0 MPa; MEd = 50 kNm/m, d = 170 → As = 708,6 mm²/m (ręcznie)', () => {
  const mat = designMaterials('C30/37', 'B500SP', ec2Norm(resolveParams({ ec2: { gammaC: 1.5 } })));
  close(mat.fcd, 20.0, 'fcd');
  // μ = 50e6/(20·1000·170²) = 0,086505; ξ = 1 − √(1 − 2μ) = 0,090610; z = 170·(1 − ξ/2) = 162,298 mm
  // As = 50e6/(434,78·162,298) = 708,58 mm²/m   (przy γc = 1,4: 706,2 — test zginania)
  close(designSection(50, 0.2, 0.17, mat).As, 708.58, 'As');
});

test('ψ2 kat. B = 0,5 zamiast 0,3: kombinacja quasi-stała G = 10, Q = 4 → 12,0 (norma: 11,2)', () => {
  const names = ['G0', 'Q1'], actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' } };
  const f = [Float64Array.of(10), Float64Array.of(4)];
  const p = resolveParams({ ec0: { psi: { B: { psi2: 0.5 } } } });
  const qp = s => envelope(f, buildSchemes(names, actions, { norm: ec0Norm(p), psiTable: s }).QP).max[0];
  close(qp(psiTable(p)), 12.0, 'zmienione');
  close(qp(psiTable(resolveParams({}))), 11.2, 'normowe');
  // γQ = 1,6: (6.10b) 0,85·1,35·10 + 1,6·4 = 11,475 + 6,4 = 17,875 < (6.10a) 13,5 + 1,6·0,7·4 = 17,98
  const p2 = resolveParams({ ec0: { gammaQ: 1.6 } });
  close(envelope(f, buildSchemes(names, actions, { norm: ec0Norm(p2), psiTable: psiTable(p2) }).ULS).max[0], 17.98, 'γQ = 1,6');
});

test('projekt: zmiana wmax i k1–k3 działa w obliczeniach, raport wymienia zmiany, plik .tekplyta je przechowuje', () => {
  const base = { ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
    loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } } };
  const p = { ...base, norms: { ec2: { wmax: { XC1: 0.2 }, stress: { k3: 0.7 } } } };
  const r = runProject(p);
  assert.equal(r.sls.wmax, 0.2);
  assert.equal(r.stress.limits.sigS, 0.7 * 500);
  assert.deepEqual(r.paramChanges.map(c => c.path).sort(), ['ec2.stress.k3', 'ec2.wmax.XC1']);
  const html = renderHTML(buildReport(p, r));
  assert.ok(html.includes('wmax XC1 [mm]') && html.includes('Wartość normowa'), 'tabela zmian w raporcie');
  assert.ok(renderHTML(buildReport(base, runProject(base))).includes('Przyjęto wartości normowe'));
  assert.deepEqual(importProjectFile(exportProjectFile(p, '0.7.0')).norms, p.norms);
});
