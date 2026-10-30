// Test „od DXF do wyniku”: import -> siatka -> podpory -> MES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';
import { dist } from '../src/geometry/polygon.js';

const geoOf = f => importGeometry(readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1')));
const near = (v, ref, tol, msg) => assert.ok(Math.abs(v / ref - 1) <= tol, `${msg}: ${v.toPrecision(6)} vs ${ref} (${((v / ref - 1) * 100).toFixed(2)} %)`);
const E = 30e6, nu = 0.3, t = 0.2;

test('kwadrat 6 × 6 m z DXF, krawędzie K1 przegubowe, siatka nieregularna: Timoshenko (tabl. 8) w 2 %', () => {
  const geo = geoOf('tests/fixtures/kwadrat-6x6.dxf');
  geo.pointLoads.push({ label: 'C', p: [3, 3] }); // wymuszony węzeł w środku (bez obciążenia)
  const mesh = generateMesh(geo, { h0: 0.25 });
  const { cases } = analyzeSlab(geo, mesh, {
    slab: { E, nu, t }, edges: { 'domyślne': { type: 'pinned' } }, loads: { Q1: 10, C: 0 }, selfWeight: false,
  });
  const r = cases.get('Q1'), c = mesh.tags.points.get('C');
  const D = E * t ** 3 / (12 * (1 - nu * nu)), q = 10, a = 6;
  near(r.w(c) * D / (q * a ** 4), 0.00406, 0.02, 'ugięcie środka');
  near(r.m[c][0] / (q * a * a), 0.0479, 0.03, 'moment mx w środku');
  near(r.m[c][1] / (q * a * a), 0.0479, 0.03, 'moment my w środku');
  near(r.supportReactions.find(s => s.label === 'K1').V, q * a * a, 1e-9, 'reakcja K1 = obciążenie');
});

test('płyta na 4 słupach (3 prostokątne, 1 okrągły) + łuk: suma reakcji słupów = obciążenie, każdy przypadek', () => {
  const geo = geoOf('tests/fixtures/slupy-luk.dxf');
  const mesh = generateMesh(geo, { h0: 0.5 });
  for (const rigid of [false, true]) {
    const { cases, warnings } = analyzeSlab(geo, mesh, {
      slab: { E, nu: 0.2, t: 0.25 },
      columns: { 'domyślne': { E: 33e6, H: 3.5, bottom: 'fixed', rigid } },
      loads: { Q1: 5, P1: 40 },
    });
    assert.ok(!warnings.some(w => w.code === 'slup-sztywnosc-obrotowa'), JSON.stringify(warnings));
    // strefa Q1 to prostokąt 8 × 8 m — wybrzuszenie łuku poza nią nie jest obciążone
    const load = { G0: 25 * 0.25 * geo.info.area, Q1: 5 * 64, P1: 40 };
    for (const [name, r] of cases) {
      const sumV = r.supportReactions.reduce((s, x) => s + x.V, 0);
      near(sumV, load[name], 1e-6, `${rigid ? 'sztywne' : 'sprężyste'} ${name}: suma reakcji`);
      near(r.totalLoad, load[name], 1e-9, `${name}: obciążenie przyłożone`);
    }
  }
});

test('słup sprężysty: Σ sprężyn pionowych = E·A/H, sztywność obrotowa = c·E·I/H (c = 4 lub 3)', () => {
  const geo = geoOf('tests/fixtures/slupy-luk.dxf');
  const mesh = generateMesh(geo, { h0: 0.4 });
  const Ec = 33e6, H = 3.5;
  for (const [bottom, cc] of [['fixed', 4], ['pinned', 3]]) {
    const { supports } = analyzeSlab(geo, mesh, {
      slab: { E, nu: 0.2, t: 0.25 }, columns: { 'domyślne': { E: Ec, H, bottom } }, loads: {}, selfWeight: false,
    });
    for (const c of geo.columns) {
      const st = supports.find(s => s.label === c.label).stiffness;
      near(st.kw, Ec * c.A / H, 1e-12, `${c.label} k pionowa`);
      near(st.kRotX, cc * Ec * c.Ix / H, 1e-9, `${c.label} k obrotowa x (${bottom})`);
      near(st.kRotY, cc * Ec * c.Iy / H, 1e-9, `${c.label} k obrotowa y (${bottom})`);
    }
  }
});

test('ściana ukośna: obrót wokół osi ściany niezależny od orientacji (płyta obrócona o 30° daje ten sam wynik)', () => {
  const run = ang => {
    const c = Math.cos(ang), s = Math.sin(ang), R = ([x, y]) => [c * x - s * y, s * x + c * y];
    const sq = [[0, 0], [5, 0], [5, 4], [0, 4]].map(R);
    const geo = {
      outline: sq, holes: [], columns: [],
      walls: [{ label: 'W1', pts: [R([0, 0]), R([0, 4])] }, { label: 'W2', pts: [R([5, 0]), R([5, 4])] }],
      edges: [], areaLoads: [{ label: 'Q1', pts: sq }], lineLoads: [], pointLoads: [{ label: 'C', p: R([2.5, 2]) }],
    };
    const mesh = generateMesh(geo, { h0: 0.3 });
    const { cases } = analyzeSlab(geo, mesh, {
      slab: { E, nu: 0.2, t: 0.2 },
      walls: { 'domyślne': { E: 10e6, t: 0.25, H: 3, bottom: 'fixed' } },
      loads: { Q1: 10, C: 0 }, selfWeight: false,
    });
    const r = cases.get('Q1');
    return { w: r.w(mesh.tags.points.get('C')), V: r.supportReactions.map(x => x.V) };
  };
  const a = run(0), b = run(30 * Math.PI / 180);
  near(b.w, a.w, 0.02, 'ugięcie środka (różne siatki, tolerancja 2 %)');
  near(a.V[0] + a.V[1], 10 * 20, 1e-9, 'suma reakcji ścian');
  near(a.V[0], a.V[1], 1e-3, 'symetria reakcji ścian');
});

test('wzorzec: wszystkie przypadki — równowaga (słupy + ściana + krawędź = obciążenie)', () => {
  const geo = geoOf('assets/TEK-PLYTA_wzorzec.dxf');
  const mesh = generateMesh(geo, { h0: 0.5 });
  const { cases, warnings } = analyzeSlab(geo, mesh, {
    slab: { E: 33e6, nu: 0.2, t: 0.25 },
    columns: { 'domyślne': { E: 33e6, H: 3.6, bottom: 'fixed' } },
    walls: { 'domyślne': { E: 8e6, t: 0.25, H: 3.6, bottom: 'pinned' } },
    edges: { 'domyślne': { type: 'pinned' } },
    loads: { Q1: 3, Q2: 7.5, L1: 6.2, P1: 25 },
  });
  assert.deepEqual(warnings, []);
  assert.deepEqual([...cases.keys()], ['G0', 'Q1', 'Q2', 'L1', 'P1']);
  const expected = { G0: 25 * 0.25 * geo.info.area, Q1: 3 * geo.info.area, Q2: 7.5 * 4.5 * 4.5, L1: 6.2 * 5.2, P1: 25 };
  for (const [name, r] of cases) {
    near(r.totalLoad, expected[name], 1e-9, `${name}: obciążenie`);
    near(r.supportReactions.reduce((s, x) => s + x.V, 0), expected[name], 1e-6, `${name}: suma reakcji`);
  }
});
