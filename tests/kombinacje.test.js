// Kombinacje i obwiednie wg PN-EN 1990 (etap 4). Wartości oczekiwane liczone ręcznie
// (komentarze krok po kroku) — niezależnie od kodu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSchemes, envelope, coefficientsAt, combine, enumerate, slabEnvelopes } from '../src/combinations.js';
import { parallelogramMesh } from '../src/mesh.js';
import { buildModel } from '../src/model.js';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';
import { analyzeSlab } from '../src/analysis/build.js';

const close = (v, ref, msg, tol = 1e-12) => assert.ok(Math.abs(v - ref) <= tol * (1 + Math.abs(ref)), `${msg}: ${v} vs ${ref}`);
const at = (fieldsPerCase, i) => fieldsPerCase.map(f => [f[i]]); // jeden punkt jako osobne „pole”

test('SGN 6.10a/6.10b, jedno oddziaływanie zmienne kat. B — przykłady ręczne', () => {
  const names = ['G0', 'Q1'], actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' } };
  const s = buildSchemes(names, actions);
  // punkty: [G, Q]
  const fields = [Float64Array.of(10, 10, -2), Float64Array.of(4, 10, 5)];
  const e = envelope(fields, s.ULS);
  // p0: (6.10a) 1,35·10 + 1,5·0,7·4 = 13,5 + 4,2 = 17,7;  (6.10b) 0,85·1,35·10 + 1,5·4 = 11,475 + 6 = 17,475
  close(e.max[0], 17.7, 'p0 max'); assert.equal(s.ULS[e.govMax[0]].name, '(6.10a)');
  // p0 min: G korzystne → γG,inf = 1,0; Q korzystne → 0:  10
  close(e.min[0], 10, 'p0 min');
  // p1: (6.10a) 13,5 + 10,5 = 24;  (6.10b) 11,475 + 15 = 26,475
  close(e.max[1], 26.475, 'p1 max'); assert.equal(s.ULS[e.govMax[1]].name, '(6.10b), wiodące: B');
  // p2: G = −2 (korzystne dla max): max: −2 + max(5,25; 7,5) = 5,5;  min: 1,35·(−2) = −2,7 (6.10a)
  close(e.max[2], 5.5, 'p2 max');
  close(e.min[2], -2.7, 'p2 min'); assert.equal(s.ULS[e.govMin[2]].name, '(6.10a)');
});

test('dwie strefy tej samej kategorii = jedno oddziaływanie (bez ψ0 między nimi); różne kategorie z ψ0', () => {
  const names = ['G0', 'Q1', 'Q2', 'Q3'];
  const actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' }, Q2: { type: 'Q', category: 'B' }, Q3: { type: 'Q', category: 'E' } };
  const s = buildSchemes(names, actions);
  const f = [[10], [3], [2], [4]].map(a => Float64Array.from(a));
  const one = sch => envelope(f, s[sch]);
  // (6.10a) 13,5 + 1,5·0,7·(3+2) + 1,5·1,0·4 = 24,75
  // (6.10b) wiodące B: 11,475 + 1,5·5 + 1,5·1,0·4 = 24,975;  wiodące E: 11,475 + 1,5·0,7·5 + 1,5·4 = 22,725
  const u = one('ULS');
  close(u.max[0], 24.975, 'SGN max'); assert.equal(s.ULS[u.govMax[0]].name, '(6.10b), wiodące: B');
  // charakterystyczna: wiodące B: 10 + 5 + 1,0·4 = 19;  wiodące E: 10 + 0,7·5 + 4 = 17,5
  close(one('CHAR').max[0], 19, 'charakterystyczna');
  // częsta: wiodące B: 10 + 0,5·5 + 0,8·4 = 15,7;  wiodące E: 10 + 0,3·5 + 0,9·4 = 15,1
  close(one('FREQ').max[0], 15.7, 'częsta');
  // quasi-stała: 10 + 0,3·5 + 0,8·4 = 14,7
  close(one('QP').max[0], 14.7, 'quasi-stała');
  // wzór (6.10) jako opcja: 13,5 + 1,5·5 + 1,5·1,0·4 = 27,0
  close(envelope(f, buildSchemes(names, actions, { formulas: ['6.10'] }).ULS).max[0], 27, '(6.10)');
});

test('obwiednia „składnik po składniku” = pełne wyliczenie wszystkich układów (losowe dane)', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const names = ['G0', 'G1', 'Q1', 'Q2', 'Q3', 'Q4', 'S1'];
  const actions = {
    G0: { type: 'G' }, G1: { type: 'G' }, Q1: { type: 'Q', category: 'A' }, Q2: { type: 'Q', category: 'A' },
    Q3: { type: 'Q', category: 'C' }, Q4: { type: 'Q', category: 'E' }, S1: { type: 'Q', category: 'S' },
  };
  const N = 300, fields = names.map(() => Float64Array.from({ length: N }, rnd));
  for (const formulas of [['6.10a', '6.10b'], ['6.10']]) {
    const s = buildSchemes(names, actions, { formulas });
    for (const key of ['ULS', 'CHAR', 'FREQ', 'QP']) {
      const e = envelope(fields, s[key]);
      const bfMax = new Float64Array(N).fill(-Infinity), bfMin = new Float64Array(N).fill(Infinity);
      for (const { coef } of enumerate(s[key])) {
        const r = combine(fields, coef);
        for (let i = 0; i < N; i++) { bfMax[i] = Math.max(bfMax[i], r[i]); bfMin[i] = Math.min(bfMin[i], r[i]); }
      }
      for (let i = 0; i < N; i++) {
        close(e.max[i], bfMax[i], `${formulas} ${key} max p${i}`, 1e-12);
        close(e.min[i], bfMin[i], `${formulas} ${key} min p${i}`, 1e-12);
        // kombinacja rządząca odtworzona z gov daje dokładnie wartość obwiedni
        close(combine(at(fields, i), coefficientsAt(fields, s[key], e.govMax, i, +1))[0], e.max[i], 'gov max');
        close(combine(at(fields, i), coefficientsAt(fields, s[key], e.govMin, i, -1))[0], e.min[i], 'gov min');
      }
    }
  }
});

test('belka ciągła dwuprzęsłowa (pasmo płyty): superpozycja = obliczenie bezpośrednie; szachownica wg tablic', () => {
  // pasmo 12 × 1 m: podparte krawędzie krótkie (x = 0, x = 12) i linia x = 6, krawędzie długie swobodne
  // → praca jednokierunkowa jak belka ciągła 2 × 6 m. Wartości tablicowe belki dwuprzęsłowej:
  //   q na jednym przęśle: M_przęsło,max = 0,0957·qL² (x ≈ 0,4375·L); g na obu: M_podpora = −0,125·gL²
  // Elementy kwadratowe 0,25 m: przy wydłużonych (0,25 × 0,5) średnia węzłowa nad podporą
  // odchyla się o +5 % (nierówna liczba elementów po obu stronach załamania momentu) — SPR w etapie 5.
  const n = 24, ny = 4, L = 6, mesh = parallelogramMesh({ a: [2 * L, 0], b: [0, 1], nx: 2 * n, ny });
  const fix = new Map();
  for (const k of [...mesh.edge.left, ...mesh.edge.right]) fix.set(k, { w: true });
  for (let j = 0; j <= ny; j++) fix.set(mesh.id(n, j), { w: true });
  const model = buildModel({ nodes: mesh.nodes, elems: mesh.elems, mat: { E: 30e6, nu: 0, t: 0.2 }, fix });
  const cx = ie => mesh.elems[ie].reduce((s, i) => s + mesh.nodes[i][0], 0) / 3;
  const g = 5, q = 4;
  const cases = new Map([
    ['G0', model.solveCase({ q: g })],
    ['Q1', model.solveCase({ q: ie => (cx(ie) < L ? q : 0) })],
    ['Q2', model.solveCase({ q: ie => (cx(ie) >= L ? q : 0) })],
  ]);
  const actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' }, Q2: { type: 'Q', category: 'B' } };
  const env = slabEnvelopes(cases, actions), s = env.schemes, mx = env.fields.nodes.mx;
  const mid = i => mesh.id(i, ny / 2); // węzły na osi pasma

  // 0) kontrola modelu wg tablic belkowych (3 %)
  const q1max = Math.max(...Array.from({ length: n + 1 }, (_, i) => mx[1][mid(i)]));
  close(q1max, 0.0957 * q * L * L, 'Q1: moment przęsłowy 0,0957·qL²', 0.03);
  close(mx[0][mid(n)], -0.125 * g * L * L, 'G: moment podporowy −0,125·gL²', 0.03);

  // 1) superpozycja: 1,35·G + 1,5·Q1 policzone bezpośrednio = kombinacja wyników
  const direct = model.solveCase({ q: ie => 1.35 * g + (cx(ie) < L ? 1.5 * q : 0) });
  combine(mx, [1.35, 1.5, 0]).forEach((v, i) => close(v, direct.m[i][0], `mx węzeł ${i}`, 1e-9));

  // 2) przęsło lewe, x = 0,4375·L: obwiednia wyraźnie > „obie strefy obciążone”, Q2 wyłączona
  const p = mid(Math.round(0.4375 * n)), e = env.nodes.ULS.mx;
  const allOn = Math.max(combine(mx, [0.85 * 1.35, 1.5, 1.5])[p], combine(mx, [1.35, 1.05, 1.05])[p]);
  assert.ok(e.max[p] > allOn * 1.1, `szachownica: ${e.max[p]} vs ${allOn}`);
  const coef = coefficientsAt(mx, s.ULS, e.govMax, p, +1);
  assert.equal(coef[1], 1.5, 'Q1 włączona');
  assert.equal(coef[2], 0, 'Q2 wyłączona');
  // 3) nad podporą pośrednią: minimum (moment ujemny) z obiema strefami włączonymi
  const cs = coefficientsAt(mx, s.ULS, e.govMin, mid(n), -1);
  assert.ok(cs[1] > 0 && cs[2] > 0, 'nad podporą obie strefy włączone');
});

test('reakcje podpór z DXF: obwiednia SGN każdego słupa; kombinacja rządząca spełnia równowagę', () => {
  const geo = importGeometry(readDxf(readFileSync(new URL('../tests/fixtures/slupy-luk.dxf', import.meta.url), 'latin1')));
  const mesh = generateMesh(geo, { h0: 0.5 });
  const { cases } = analyzeSlab(geo, mesh, {
    slab: { E: 30e6, nu: 0.2, t: 0.25 }, columns: { 'domyślne': { E: 33e6, H: 3.5, bottom: 'fixed' } },
    loads: { Q1: 5, P1: 40 },
  });
  const actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' }, P1: { type: 'Q', category: 'E' } };
  const env = slabEnvelopes(cases, actions);
  const V = env.fields.supports.V, names = [...cases.keys()];
  const load = names.map(n => cases.get(n).totalLoad);
  const e = envelope(V, env.schemes.ULS);
  env.supports.ULS.forEach((s, j) => {
    close(s.V.max, e.max[j], `${s.label} V max`);
    assert.ok(s.V.max > 0, `${s.label}: słup ściskany`);
    const coef = coefficientsAt(V, env.schemes.ULS, e.govMax, j, +1);
    const sumV = combine(V, coef).reduce((a, b) => a + b, 0);
    const sumLoad = load.reduce((a, l, c) => a + coef[c] * l, 0);
    close(sumV, sumLoad, `${s.label}: Σ reakcji = Σ obciążeń w kombinacji rządzącej`, 1e-6);
  });
});

test('błędy danych: brak opisu przypadku, nieznana kategoria, różne kategorie w jednej grupie', () => {
  assert.throws(() => buildSchemes(['G0', 'Q1'], { G0: { type: 'G' } }), /Q1: brak opisu/);
  assert.throws(() => buildSchemes(['Q1'], { Q1: { type: 'Q', category: 'X' } }), /nieznana kategoria/);
  assert.throws(() => buildSchemes(['Q1', 'Q2'], {
    Q1: { type: 'Q', category: 'A', group: 'strop' }, Q2: { type: 'Q', category: 'E', group: 'strop' },
  }), /różnych kategoriach/);
});
