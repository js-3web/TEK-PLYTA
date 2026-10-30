// Ścinanie 6.2.2 i naprężenia 7.2 — wartości liczone ręcznie.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vRdc } from '../src/design/shear.js';
import { crackedSection } from '../src/design/sls.js';
import { designMaterials } from '../src/norms/en1992-pl.js';
import { defaultProject, runProject } from '../src/app/pipeline.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v} vs ${ref}`);
const mat = designMaterials('C30/37');

test('vRd,c (6.2a/b): d = 200 mm, ρl = 0,5 %, C30/37, γc = 1,4 → 0,1286·2·(15)^(1/3) = 0,6342 MPa → 126,8 kN/m', () => {
  // k = 1 + √(200/200) = 2; (100·0,005·30)^(1/3) = 15^(1/3) = 2,4662; 0,12857·2·2,4662 = 0,63417 MPa
  // vmin = 0,035·2^1,5·√30 = 0,5422 < 0,6342 → vRd,c = 0,63417·200 = 126,83 kN/m
  const r = vRdc({ d: 0.2, rho: 0.005, mat });
  close(r.v, 0.63417, 'vRd,c'); close(r.vRd, 126.83, 'vRd,c·d');
  // małe ρ: rządzi vmin — ρ = 0,1 %: 0,12857·2·3^(1/3) = 0,3709 < vmin 0,5422
  close(vRdc({ d: 0.2, rho: 0.001, mat }).v, 0.54222, 'vmin');
});

test('naprężenia 7.2: M = 40 kNm/m, d = 210, As = 754 mm², αe = 6,061 → σs = 269,5 MPa, σc = 10,3 MPa', () => {
  // x = 39,478 mm, I_II = 153,39e6 mm⁴ (jak w teście rys); σc = 40e6·39,478/153,39e6 = 10,295 MPa
  const { x, III } = crackedSection({ h: 250, d: 210, As: 754, alphaE: 200 / 33 });
  close(40e6 * x / III, 10.295, 'σc', 2e-3);
  close(200 / 33 * 40e6 * (210 - x) / III, 269.51, 'σs', 2e-3);
});

test('wzorzec: ścinanie poza słupami i naprężenia policzone na zbrojeniu dobranym; mapy w węzłach', () => {
  const p = { ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
    loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } } };
  const r = runProject(p);
  assert.ok(r.shear.maxUtil > 0 && Number.isFinite(r.shear.maxUtil));
  assert.ok(r.stress.max.sigS > 0 && r.stress.limits.sigS === 400);
  for (const k of ['vEd', 'shearUtil', 'vx_max', 'sigS_topY', 'mx_char_max', 'mx_qp_min']) assert.equal(r.maps[k].length, r.mesh.nodes.length, k);
  // węzły przy słupach (< 2d) pominięte w kontroli 6.2.2 (strefa przebicia)
  const c = r.geo.columns[0].c, near = r.mesh.nodes.findIndex(q => Math.hypot(q[0] - c[0], q[1] - c[1]) < 0.25);
  assert.ok(Number.isNaN(r.maps.shearUtil[near]));
});
