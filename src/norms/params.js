// Współczynniki normowe — domyślnie wartości normowe (moduły en1990-pl.js, en1992-pl.js), edytowalne przez
// projektanta (decyzja z 30.10.2026). Projekt przechowuje tylko nadpisania (project.norms); raport wymienia
// każdą zmianę: wartość normowa → przyjęta.

import { NORM as EC0, PSI } from './en1990-pl.js';
import { NORM as EC2 } from './en1992-pl.js';

// Opis parametrów (formularz, raport): ścieżka → [oznaczenie, punkt normy]
export const PARAM_INFO = {
  'ec0.gammaGsup': ['γG,sup', 'PN-EN 1990, tabl. A1.2(B)'], 'ec0.gammaGinf': ['γG,inf', 'PN-EN 1990, tabl. A1.2(B)'],
  'ec0.gammaQ': ['γQ', 'PN-EN 1990, tabl. A1.2(B)'], 'ec0.xi': ['ξ', 'PN-EN 1990, (6.10b)'],
  'ec2.gammaC': ['γc', 'PN-EN 1992-1-1, 2.4.2.4, NA'], 'ec2.gammaS': ['γs', 'PN-EN 1992-1-1, 2.4.2.4, NA'],
  'ec2.alphaCC': ['αcc', 'PN-EN 1992-1-1, 3.1.6(1), NA'], 'ec2.alphaCT': ['αct', 'PN-EN 1992-1-1, 3.1.6(2), NA'],
  'ec2.Es': ['Es [MPa]', 'PN-EN 1992-1-1, 3.2.7(4)'],
  'ec2.CRdcNum': ['CRd,c·γc', 'PN-EN 1992-1-1, 6.2.2(1), 6.4.4(1), NA'], 'ec2.vminCoef': ['vmin: 0,035', 'PN-EN 1992-1-1, (6.3N), NA'],
  'ec2.k1': ['k1 (przebicie)', 'PN-EN 1992-1-1, 6.4.4(1), NA'], 'ec2.vRdMaxCoef': ['vRd,max: ·ν·fcd', 'PN-EN 1992-1-1, 6.4.5(3), AC:2010'],
  'ec2.rhoMax': ['ρl,max', 'PN-EN 1992-1-1, 6.4.4(1)'],
  'ec2.betaPunch.wewnetrzny': ['β słup wewnętrzny', 'PN-EN 1992-1-1, 6.4.3(6), NA'], 'ec2.betaPunch.krawedziowy': ['β słup krawędziowy', 'PN-EN 1992-1-1, 6.4.3(6), NA'],
  'ec2.betaPunch.narozny': ['β słup narożny', 'PN-EN 1992-1-1, 6.4.3(6), NA'],
  'ec2.crack.k1': ['k1 (rysy)', 'PN-EN 1992-1-1, 7.3.4(3)'], 'ec2.crack.k2': ['k2 (rysy, zginanie)', 'PN-EN 1992-1-1, 7.3.4(3)'],
  'ec2.crack.k3': ['k3', 'PN-EN 1992-1-1, 7.3.4(3), NA'], 'ec2.crack.k4': ['k4', 'PN-EN 1992-1-1, 7.3.4(3), NA'],
  'ec2.crack.kt': ['kt (długotrwałe)', 'PN-EN 1992-1-1, 7.3.4(2)'],
  'ec2.stress.k1': ['k1 (σc char.)', 'PN-EN 1992-1-1, 7.2(2), NA'], 'ec2.stress.k2': ['k2 (σc quasi-st.)', 'PN-EN 1992-1-1, 7.2(3), NA'],
  'ec2.stress.k3': ['k3 (σs)', 'PN-EN 1992-1-1, 7.2(5), NA'],
  'ec2.defl.betaLong': ['β ugięcia długotrwałe', 'PN-EN 1992-1-1, 7.4.3(3)'], 'ec2.defl.betaShort': ['β ugięcia krótkotrwałe', 'PN-EN 1992-1-1, 7.4.3(3)'],
};
for (const k of Object.keys(PSI)) for (const j of ['psi0', 'psi1', 'psi2'])
  PARAM_INFO[`ec0.psi.${k}.${j}`] = [`${j.replace('psi', 'ψ')} — ${PSI[k].opis}`, 'PN-EN 1990, tabl. A1.1, NA'];
export const WMAX_DEFAULT = { X0: 0.4, XC1: 0.4, XC2: 0.3, XC3: 0.3, XC4: 0.3, XD1: 0.3, XD2: 0.3, XD3: 0.3, XS1: 0.3, XS2: 0.3, XS3: 0.3 };
for (const k of Object.keys(WMAX_DEFAULT)) PARAM_INFO[`ec2.wmax.${k}`] = [`wmax ${k} [mm]`, 'PN-EN 1992-1-1, tabl. 7.1N, NA'];

export function defaultParams() {
  return {
    ec0: {
      gammaGsup: EC0.gammaGsup, gammaGinf: EC0.gammaGinf, gammaQ: EC0.gammaQ, xi: EC0.xi,
      psi: Object.fromEntries(Object.entries(PSI).map(([k, v]) => [k, { psi0: v.psi0, psi1: v.psi1, psi2: v.psi2 }])),
    },
    ec2: {
      gammaC: EC2.gammaC, gammaS: EC2.gammaS, alphaCC: EC2.alphaCC, alphaCT: EC2.alphaCT, Es: EC2.Es,
      CRdcNum: 0.18, vminCoef: 0.035, k1: EC2.k1, vRdMaxCoef: EC2.vRdMaxCoef, rhoMax: EC2.rhoMax,
      betaPunch: { wewnetrzny: 1.15, krawedziowy: 1.4, narozny: 1.5 },
      crack: { k1: 0.8, k2: 0.5, k3: 3.4, k4: 0.425, kt: 0.4 },
      wmax: { ...WMAX_DEFAULT },
      stress: { k1: 0.6, k2: 0.45, k3: 0.8 },
      defl: { betaLong: 0.5, betaShort: 1.0 },
    },
  };
}

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(base, over) {
  if (!isObj(over)) return base;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) continue;                                      // nieznane klucze pomijamy (stary/obcy plik)
    if (isObj(base[k])) out[k] = merge(base[k], v);
    else if (Number.isFinite(v) && v > 0) out[k] = v;                // tylko dodatnie liczby
  }
  return out;
}
export const resolveParams = overrides => merge(defaultParams(), overrides);

// Lista zmian względem wartości normowych (do formularza i raportu)
export function diffParams(params) {
  const def = defaultParams(), out = [];
  const walk = (a, b, path) => {
    for (const k of Object.keys(a)) {
      const p = path ? `${path}.${k}` : k;
      if (isObj(a[k])) walk(a[k], b[k], p);
      else if (Math.abs(a[k] - b[k]) > 1e-12) out.push({ path: p, symbol: PARAM_INFO[p]?.[0] ?? p, clause: PARAM_INFO[p]?.[1] ?? '', normative: a[k], adopted: b[k] });
    }
  };
  walk(def, params, '');
  return out;
}

// Obiekty dla modułów obliczeniowych: norma EN 1990 (kombinacje), tablica ψ, norma EN 1992 (mat.norm)
export function ec0Norm(params, formulas = EC0.formulas) {
  const { gammaGsup, gammaGinf, gammaQ, xi } = params.ec0;
  return { ...EC0, gammaGsup, gammaGinf, gammaQ, xi, formulas };
}
export function psiTable(params) {
  return Object.fromEntries(Object.entries(PSI).map(([k, v]) => [k, { ...v, ...params.ec0.psi[k] }]));
}
export function ec2Norm(params) {
  const e = params.ec2;
  return { ...EC2, gammaC: e.gammaC, gammaS: e.gammaS, alphaCC: e.alphaCC, alphaCT: e.alphaCT, Es: e.Es, k1: e.k1,
    vRdMaxCoef: e.vRdMaxCoef, rhoMax: e.rhoMax, CRdc: g => e.CRdcNum / g, vminCoef: e.vminCoef,
    betaPunch: e.betaPunch, crack: e.crack, wmax: e.wmax, stress: e.stress, defl: e.defl };
}
