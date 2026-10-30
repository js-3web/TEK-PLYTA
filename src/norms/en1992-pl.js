// Zestaw normowy: PN-EN 1992-1-1:2008 + NA — wartości do wymiarowania płyt.
// Wymienny moduł (specyfikacja, sekcja 11): v2 doda PN-EN 1992-1-1:2024 bez zmian w kodzie wymiarowania.
//
// STATUS ŹRÓDEŁ: verified = false, dopóki wartości krajowe (γc, αcc, współczynnik vRd,max)
// nie zostaną porównane z tekstem PN-EN 1992-1-1:2008/NA:2010 i poprawką AC.

export const NORM = {
  id: 'PN-EN 1992-1-1:2008+NA',
  verified: false,
  gammaC: 1.4,      // spec. sekcja 6: γc = 1,4 (źródło wtórne GEO5 — do potwierdzenia)
  gammaS: 1.15,
  alphaCC: 1.0,
  alphaCT: 1.0,
  Es: 200000,       // MPa, 3.2.7(4)
  CRdc: gammaC => 0.18 / gammaC, // 6.4.4(1), wartość zalecana
  k1: 0.1,          // 6.4.4(1)
  vRdMaxCoef: 0.4,  // 6.4.5(3) po EN 1992-1-1:2004/AC:2010: 0,4·ν·fcd (przed poprawką 0,5) — do potwierdzenia
  rhoMax: 0.02,     // 6.4.4(1)
};

// Tablica 3.1 — fck, fctm, fctk,0.05 [MPa], Ecm [GPa]
export const CONCRETE = {
  'C12/15': { fck: 12, fctm: 1.6, fctk005: 1.1, Ecm: 27 },
  'C16/20': { fck: 16, fctm: 1.9, fctk005: 1.3, Ecm: 29 },
  'C20/25': { fck: 20, fctm: 2.2, fctk005: 1.5, Ecm: 30 },
  'C25/30': { fck: 25, fctm: 2.6, fctk005: 1.8, Ecm: 31 },
  'C30/37': { fck: 30, fctm: 2.9, fctk005: 2.0, Ecm: 33 },
  'C35/45': { fck: 35, fctm: 3.2, fctk005: 2.2, Ecm: 34 },
  'C40/50': { fck: 40, fctm: 3.5, fctk005: 2.5, Ecm: 35 },
  'C45/55': { fck: 45, fctm: 3.8, fctk005: 2.7, Ecm: 36 },
  'C50/60': { fck: 50, fctm: 4.1, fctk005: 2.9, Ecm: 37 },
};

export const STEEL = {
  B500SP: { fyk: 500 }, B500B: { fyk: 500 }, B500A: { fyk: 500 },
};

// Wartości obliczeniowe materiałów (v1: beton do C50/60 — λ = 0,8, η = 1,0, εcu3 = 3,5 ‰, 3.1.7(3))
export function designMaterials(concreteClass, steelGrade = 'B500SP', norm = NORM) {
  const c = CONCRETE[concreteClass];
  if (!c) throw new Error(`Nieznana klasa betonu: ${concreteClass} (v1: ${Object.keys(CONCRETE).join(', ')})`);
  const s = STEEL[steelGrade];
  if (!s) throw new Error(`Nieznany gatunek stali: ${steelGrade}`);
  const fcd = norm.alphaCC * c.fck / norm.gammaC, fyd = s.fyk / norm.gammaS;
  return {
    concreteClass, steelGrade, ...c, fyk: s.fyk, fcd, fyd, Es: norm.Es,
    lambda: 0.8, eta: 1.0, ecu3: 0.0035, gammaC: norm.gammaC, gammaS: norm.gammaS, norm,
  };
}
