// Wymiarowanie płyty na zginanie (specyfikacja, sekcja 6): momenty Wood–Armera i przekrój 1 m.
// Jednostki: momenty kNm/m, wymiary m, wyniki zbrojenia mm²/m. Konwencja znaków programu:
// m > 0 rozciąga spód płyty.

import { envelope } from '../combinations.js';

// Momenty wymiarujące Wood–Armera (Wood 1968, Armer 1968) dla jednego stanu (mx, my, mxy).
// Zwraca { bottom: [mx*, my*] ≥ 0, top: [mx*, my*] ≤ 0 }; 0 = zbrojenie w tym kierunku niepotrzebne.
export function woodArmer(mx, my, mxy) {
  const t = Math.abs(mxy);
  // dół (wariant podstawowy, potem korekty gdy jeden moment wychodzi ujemny)
  let bx = mx + t, by = my + t;
  if (bx < 0) { bx = 0; by = mx !== 0 ? my + Math.abs(mxy * mxy / mx) : my; }
  else if (by < 0) { by = 0; bx = my !== 0 ? mx + Math.abs(mxy * mxy / my) : mx; }
  if (bx < 0 || by < 0) { bx = Math.max(bx, 0); by = Math.max(by, 0); }
  // góra (lustrzanie)
  let tx = mx - t, ty = my - t;
  if (tx > 0) { tx = 0; ty = mx !== 0 ? my - Math.abs(mxy * mxy / mx) : my; }
  else if (ty > 0) { ty = 0; tx = my !== 0 ? mx - Math.abs(mxy * mxy / my) : mx; }
  if (tx > 0 || ty > 0) { tx = Math.min(tx, 0); ty = Math.min(ty, 0); }
  return { bottom: [bx, by], top: [tx, ty] };
}

// Obwiednia momentów wymiarujących z kombinacji (bezpieczne oszacowanie z góry):
// mx + |mxy| = max(mx + mxy, mx − mxy) — obie wielkości są liniowe, więc ich obwiednie liczymy ściśle.
// Korekty Wood–Armera tylko zmniejszają moment, więc wariant podstawowy jest górnym ograniczeniem
// maksimum po wszystkich kombinacjach (test: tests/zginanie.test.js porównuje z pełnym wyliczeniem).
export function designMomentEnvelope(fields, variants) {
  const lin = (a, s, b) => a.map((f, c) => f.map((v, i) => v + s * b[c][i]));
  const env = f => envelope(f, variants);
  const xp = env(lin(fields.mx, 1, fields.mxy)), xm = env(lin(fields.mx, -1, fields.mxy));
  const yp = env(lin(fields.my, 1, fields.mxy)), ym = env(lin(fields.my, -1, fields.mxy));
  const N = fields.mx[0].length, out = { bottomX: new Float64Array(N), bottomY: new Float64Array(N), topX: new Float64Array(N), topY: new Float64Array(N) };
  for (let i = 0; i < N; i++) {
    out.bottomX[i] = Math.max(0, xp.max[i], xm.max[i]);
    out.bottomY[i] = Math.max(0, yp.max[i], ym.max[i]);
    out.topX[i] = Math.min(0, xp.min[i], xm.min[i]);
    out.topY[i] = Math.min(0, yp.min[i], ym.min[i]);
  }
  return out;
}

// Wysokości użyteczne warstw: layout = { h, cover: { bottom, top }, bottom: { phiX, phiY, outer: 'x'|'y' }, top: {…} }
// (średnice i otuliny w m). Warstwa zewnętrzna: d = h − c − φ/2; wewnętrzna: d = h − c − φ_zewn − φ/2.
export function effectiveDepths({ h, cover, bottom, top }) {
  const layer = (c, L) => {
    const dOuter = phi => h - c - phi / 2, dInner = phi => h - c - (L.outer === 'x' ? L.phiX : L.phiY) - phi / 2;
    return L.outer === 'x' ? { x: dOuter(L.phiX), y: dInner(L.phiY) } : { x: dInner(L.phiX), y: dOuter(L.phiY) };
  };
  return { bottom: layer(cover.bottom, bottom), top: layer(cover.top, top) };
}

// Przekrój prostokątny b = 1 m, prostokątny rozkład naprężeń (3.1.7(3)), zbrojenie pojedyncze.
// MEd [kNm/m] ≥ 0, h i d [m]. Zwraca wynik z krokami do raportu.
export function designSection(MEd, h, d, mat) {
  const b = 1000, dmm = d * 1000, M = Math.abs(MEd) * 1e6; // N·mm na 1 m
  const mu = M / (mat.eta * mat.fcd * b * dmm * dmm);
  const xiLim = mat.lambda * mat.ecu3 / (mat.ecu3 + mat.fyd / mat.Es); // ξeff,lim = λ·xlim/d, stal uplastyczniona
  const muLim = xiLim * (1 - xiLim / 2);
  const AsMin = Math.max(0.26 * mat.fctm / mat.fyk, 0.0013) * b * dmm; // 9.2.1.1(1) przez 9.3.1.1(1)
  const AsMax = 0.04 * b * h * 1000;                                   // 9.2.1.1(3)
  if (mu > muLim) return { ok: false, reason: 'przekroczone ξeff,lim — zwiększ grubość lub klasę betonu', mu, muLim, xiLim, AsMin, AsMax, As: NaN };
  const xi = 1 - Math.sqrt(1 - 2 * mu);  // ξeff = λx/d z równowagi: μ = ξ(1 − ξ/2)
  const z = dmm * (1 - xi / 2);
  const As = M / (mat.fyd * z);
  return { ok: As <= AsMax, reason: As > AsMax ? 'As > As,max' : null, mu, muLim, xi, xiLim, z, As, AsMin, AsMax, AsReq: Math.max(As, AsMin) };
}
