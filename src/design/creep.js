// Pełzanie i skurcz betonu — PN-EN 1992-1-1, 3.1.4 i Załącznik B (wartości końcowe, t → ∞).
// Wejście: fck [MPa], RH [%], h0 = 2·Ac/u [mm] (płyta wysychająca obustronnie: h0 = h,
// jednostronnie: h0 = 2h), t0 [dni] — wiek przy obciążeniu, cement 'S' | 'N' | 'R'.
// Załącznik B jest informacyjny; jego stosowanie w PL — do potwierdzenia z NA (verified: false).

const CEMENT = { S: { alpha: -1, ads1: 3, ads2: 0.13 }, N: { alpha: 0, ads1: 4, ads2: 0.12 }, R: { alpha: 1, ads1: 6, ads2: 0.11 } };

// Współczynnik pełzania φ(∞, t0), (B.1)–(B.9)
export function creepCoefficient({ fck, RH, h0, t0, cement = 'N' }) {
  const cem = CEMENT[cement];
  if (!cem) throw new Error(`Klasa cementu: S, N albo R (podano ${cement})`);
  const fcm = fck + 8;
  const a1 = (35 / fcm) ** 0.7, a2 = (35 / fcm) ** 0.2;
  const base = (1 - RH / 100) / (0.1 * Math.cbrt(h0));
  const phiRH = fcm <= 35 ? 1 + base : (1 + base * a1) * a2;            // (B.3a/b)
  const betaFcm = 16.8 / Math.sqrt(fcm);                                // (B.4)
  const t0adj = Math.max(0.5, t0 * (9 / (2 + t0 ** 1.2) + 1) ** cem.alpha); // (B.9), temperatura 20 °C
  const betaT0 = 1 / (0.1 + t0adj ** 0.2);                              // (B.5)
  return { phi: phiRH * betaFcm * betaT0, phiRH, betaFcm, betaT0, t0adj }; // βc(∞, t0) = 1
}

// Odkształcenie skurczu końcowe εcs = εcd,∞ + εca,∞, (3.8)–(3.12), (B.11)–(B.12)
export function shrinkageStrain({ fck, RH, h0, cement = 'N' }) {
  const cem = CEMENT[cement];
  const fcm = fck + 8;
  const betaRH = 1.55 * (1 - (RH / 100) ** 3);                          // (B.12), RH ≥ 40 %
  const ecd0 = 0.85 * ((220 + 110 * cem.ads1) * Math.exp(-cem.ads2 * fcm / 10)) * 1e-6 * betaRH; // (B.11)
  // kh — tabl. 3.3: h0 = 100 → 1,0; 200 → 0,85; 300 → 0,75; ≥ 500 → 0,70 (interpolacja liniowa)
  const T = [[100, 1.0], [200, 0.85], [300, 0.75], [500, 0.70]];
  let kh = h0 <= 100 ? 1.0 : 0.70;
  for (let i = 0; i < T.length - 1; i++) if (h0 > T[i][0] && h0 <= T[i + 1][0])
    kh = T[i][1] + (T[i + 1][1] - T[i][1]) * (h0 - T[i][0]) / (T[i + 1][0] - T[i][0]);
  const ecd = kh * ecd0;                                                // (3.9), βds(∞) = 1
  const eca = 2.5 * (fck - 10) * 1e-6;                                  // (3.12), βas(∞) = 1
  return { ecs: ecd + eca, ecd, eca, ecd0, kh, betaRH };
}
