// Wymiarowanie na zginanie (etap 5). Oczekiwane wartości liczone ręcznie (komentarze) — niezależnie od kodu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { woodArmer, designSection, effectiveDepths, designMomentEnvelope } from '../src/design/bending.js';
import { designMaterials, CONCRETE } from '../src/norms/en1992-pl.js';
import { buildSchemes, enumerate, combine } from '../src/combinations.js';

const close = (v, ref, msg, tol = 1e-3) => assert.ok(Math.abs(v - ref) <= tol * Math.max(1, Math.abs(ref)), `${msg}: ${v} vs ${ref}`);

test('tabl. 3.1: fctm i Ecm zgodne ze wzorami z tablicy (zaokrąglenia normy)', () => {
  // fctm = 0,30·fck^(2/3); Ecm = 22·(fcm/10)^0,3, fcm = fck + 8 — tablica podaje wartości zaokrąglone
  for (const [cls, c] of Object.entries(CONCRETE)) {
    assert.ok(Math.abs(c.fctm - 0.3 * c.fck ** (2 / 3)) <= 0.051, `${cls} fctm`);
    assert.ok(Math.abs(c.Ecm - 22 * ((c.fck + 8) / 10) ** 0.3) <= 0.51, `${cls} Ecm`);
    assert.ok(Math.abs(c.fctk005 - 0.7 * c.fctm) <= 0.051, `${cls} fctk,0.05 = 0,7·fctm`);
  }
});

test('Wood–Armer: przypadki z korektą i bez — liczone ręcznie', () => {
  // mx=10, my=4, mxy=3: dół 13 / 7; góra: 10−3 = 7 > 0 → mx*=0, my* = 4 − 9/10 = 3,1 > 0 → brak zbrojenia górą
  assert.deepEqual(woodArmer(10, 4, 3), { bottom: [13, 7], top: [0, 0] });
  // mx=10, my=−2, mxy=3: dół 13 / 1;  góra: mx*=0, my* = −2 − 0,9 = −2,9
  let r = woodArmer(10, -2, 3);
  close(r.bottom[0], 13, 'b x'); close(r.bottom[1], 1, 'b y'); close(r.top[0], 0, 't x'); close(r.top[1], -2.9, 't y');
  // mx=10, my=−5, mxy=3: dół my* = −2 < 0 → my*=0, mx* = 10 + 9/5 = 11,8;  góra: my* = −5 − 0,9 = −5,9
  r = woodArmer(10, -5, 3);
  close(r.bottom[0], 11.8, 'b x'); close(r.bottom[1], 0, 'b y'); close(r.top[1], -5.9, 't y');
  // czyste skręcanie mxy = 4: dół 4 / 4, góra −4 / −4 (siatka krzyżowa przenosi skręcanie)
  assert.deepEqual(woodArmer(0, 0, -4), { bottom: [4, 4], top: [-4, -4] });
});

test('przekrój 1 m: MEd = 50 kNm/m, h = 200, d = 170 mm, C30/37, B500, γc = 1,4 — liczone ręcznie', () => {
  const m = designMaterials('C30/37', 'B500SP');
  // fcd = 1,0·30/1,4 = 21,429 MPa; fyd = 500/1,15 = 434,78 MPa
  close(m.fcd, 21.4286, 'fcd'); close(m.fyd, 434.783, 'fyd');
  const r = designSection(50, 0.2, 0.17, m);
  // μ = 50e6 / (21,429·1000·170²) = 0,08073;  ξ = 1 − √(1 − 2·0,08073) = 0,08428
  close(r.mu, 0.08073, 'μ'); close(r.xi, 0.08428, 'ξeff');
  // z = 170·(1 − 0,08428/2) = 162,84 mm;  As = 50e6 / (434,78·162,84) = 706,2 mm²/m
  close(r.z, 162.84, 'z'); close(r.As, 706.2, 'As');
  // ξeff,lim = 0,8·3,5/(3,5 + 434,78/200) = 0,8·0,6169 = 0,4935
  close(r.xiLim, 0.4935, 'ξlim');
  // As,min = max(0,26·2,9/500; 0,0013)·1000·170 = max(0,001508; 0,0013)·170000 = 256,4 mm²/m
  close(r.AsMin, 256.36, 'As,min');
  assert.equal(r.ok, true);
  // za duży moment: μ > μlim → wynik „nie przechodzi”
  assert.equal(designSection(400, 0.2, 0.17, m).ok, false);
});

test('wysokości użyteczne warstw: h = 200, c = 25 mm, #12 x zewnętrzne, #10 y wewnętrzne', () => {
  const d = effectiveDepths({ h: 0.2, cover: { bottom: 0.025, top: 0.03 },
    bottom: { phiX: 0.012, phiY: 0.010, outer: 'x' }, top: { phiX: 0.012, phiY: 0.012, outer: 'y' } });
  close(d.bottom.x, 0.169, 'dół x = 200 − 25 − 6');       // 169 mm
  close(d.bottom.y, 0.158, 'dół y = 200 − 25 − 12 − 5');  // 158 mm
  close(d.top.y, 0.164, 'góra y = 200 − 30 − 6');         // 164 mm
  close(d.top.x, 0.152, 'góra x = 200 − 30 − 12 − 6');   // 152 mm
});

test('obwiednia momentów wymiarujących ≥ Wood–Armer każdej kombinacji i równa mu bez korekt', () => {
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const names = ['G0', 'Q1', 'Q2', 'Q3'];
  const actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B' }, Q2: { type: 'Q', category: 'B' }, Q3: { type: 'Q', category: 'E' } };
  const s = buildSchemes(names, actions), N = 400;
  const f = () => names.map(() => Float64Array.from({ length: N }, () => 10 * rnd()));
  const fields = { mx: f(), my: f(), mxy: f() };
  const env = designMomentEnvelope(fields, s.ULS);
  const exact = { bottomX: new Float64Array(N), bottomY: new Float64Array(N), topX: new Float64Array(N), topY: new Float64Array(N) };
  for (const { coef } of enumerate(s.ULS)) {
    const mx = combine(fields.mx, coef), my = combine(fields.my, coef), mxy = combine(fields.mxy, coef);
    for (let i = 0; i < N; i++) {
      const wa = woodArmer(mx[i], my[i], mxy[i]);
      exact.bottomX[i] = Math.max(exact.bottomX[i], wa.bottom[0]); exact.bottomY[i] = Math.max(exact.bottomY[i], wa.bottom[1]);
      exact.topX[i] = Math.min(exact.topX[i], wa.top[0]); exact.topY[i] = Math.min(exact.topY[i], wa.top[1]);
    }
  }
  let equal = 0;
  for (const k of Object.keys(exact)) for (let i = 0; i < N; i++) {
    const e = Math.abs(env[k][i]), x = Math.abs(exact[k][i]);
    assert.ok(e >= x - 1e-9, `${k} p${i}: obwiednia ${e} < ścisłe ${x} — po stronie niebezpiecznej`);
    if (e - x < 1e-9) equal++;
  }
  assert.ok(equal > 0.8 * 4 * N, `wariant podstawowy rządzi w większości punktów (${equal}/${4 * N})`);
});
