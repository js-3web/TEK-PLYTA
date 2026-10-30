// Zestaw normowy: PN-EN 1990:2004 + NA — współczynniki kombinacji oddziaływań dla budynków.
// Wymienny moduł (specyfikacja, sekcja 11): silnik kombinacji w src/combinations.js nie zna
// żadnych liczb normowych, dostaje je stąd.
//
// STATUS ŹRÓDEŁ (zasada projektu: wartość normową wpisujemy dopiero po sprawdzeniu u źródła):
//   • 6.10a/6.10b jako domyślne dla STR/GEO — PN-EN 1990:2004/NA:2010 (potwierdzone w źródłach
//     wtórnych: materiały dydaktyczne PWr, Graitec; tekst NA do sprawdzenia przez projektanta).
//   • γG,sup = 1,35, γG,inf = 1,00, γQ = 1,50, ξ = 0,85 — EN 1990 tabl. A1.2(B), wartości zalecane
//     (źródła wtórne zgodne co do przyjęcia w PL).
//   • ψ0, ψ1, ψ2 — EN 1990 tabl. A1.1, wartości ZALECANE CEN. Decyzja projektanta (30.10.2026):
//     przyjęte wartości zalecane; porównania z tekstem PN-EN 1990/NA nie wykonano — stąd verified: false.

export const NORM = {
  id: 'PN-EN 1990:2004+NA',
  verified: false, // true dopiero po porównaniu z tekstem PN-EN 1990:2004/NA:2010
  formulas: ['6.10a', '6.10b'], // domyślnie: mniej korzystne z (6.10a) i (6.10b); alternatywa: ['6.10']
  gammaGsup: 1.35,
  gammaGinf: 1.0,
  gammaQ: 1.5,
  xi: 0.85,
};

// Tablica A1.1 — kategorie oddziaływań zmiennych w budynkach (EN 1991-1-1, tabl. 6.1 i 6.8).
export const PSI = {
  A: { psi0: 0.7, psi1: 0.5, psi2: 0.3, opis: 'kat. A — powierzchnie mieszkalne' },
  B: { psi0: 0.7, psi1: 0.5, psi2: 0.3, opis: 'kat. B — powierzchnie biurowe' },
  C: { psi0: 0.7, psi1: 0.7, psi2: 0.6, opis: 'kat. C — miejsca zebrań' },
  D: { psi0: 0.7, psi1: 0.7, psi2: 0.6, opis: 'kat. D — powierzchnie handlowe' },
  E: { psi0: 1.0, psi1: 0.9, psi2: 0.8, opis: 'kat. E — powierzchnie magazynowe' },
  F: { psi0: 0.7, psi1: 0.7, psi2: 0.6, opis: 'kat. F — ruch pojazdów ≤ 30 kN' },
  G: { psi0: 0.7, psi1: 0.5, psi2: 0.3, opis: 'kat. G — ruch pojazdów 30–160 kN' },
  H: { psi0: 0.0, psi1: 0.0, psi2: 0.0, opis: 'kat. H — dachy' },
  S: { psi0: 0.5, psi1: 0.2, psi2: 0.0, opis: 'śnieg (H ≤ 1000 m n.p.m.)' },
};
