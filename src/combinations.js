// Kombinacje oddziaływań i obwiednie wg PN-EN 1990 (specyfikacja, sekcja 5).
//
// Analiza jest liniowa, więc każdy przypadek obciążenia (G0, Q1, L1, P1…) liczymy raz,
// a kombinacja to suma wyników przemnożonych przez współczynniki (superpozycja).
//
// actions = { G0: { type: 'G' }, Q1: { type: 'Q', category: 'B', group? }, Q2: { type: 'G' }, … }
//   type 'G' — stałe (ciężar własny, wykończenie); 'Q' — zmienne, z kategorią z tabl. A1.1.
//   group — jedno oddziaływanie zmienne może mieć kilka stref (domyślnie: grupa = kategoria).
//     Strefy jednej grupy to JEDNO oddziaływanie swobodne (EN 1991-1-1, 6.2.1(1)): każdą strefę
//     wolno włączyć lub wyłączyć (układ szachownicowy), ale wszystkie mają ten sam współczynnik —
//     ψ0 nie redukuje stref tej samej grupy względem siebie. Różne grupy to różne oddziaływania:
//     jedno wiodące, pozostałe towarzyszące z ψ0.
//
// Obwiednia bez wyliczania 2^n układów: w danym punkcie wpływ każdego przypadku jest liniowy
// i niezależny od pozostałych, więc maksimum to suma maksimów składników:
//   G: max(γsup·v, γinf·v);   Q: max(γ·v, 0)  (zmienne korzystne pomijamy).
// Ten sam wynik daje pełne wyliczenie wszystkich układów (test w tests/kombinacje.test.js),
// ale tu koszt rośnie liniowo z liczbą stref, a nie wykładniczo.
//
// Wariant = jeden wzór z jednym oddziaływaniem wiodącym: { name, hi, lo } — dla przypadku c
// wkład do maksimum to max(hi[c]·v, lo[c]·v), do minimum min(hi[c]·v, lo[c]·v).
//
// Uwaga dla wymiarowania (etap 5): obwiednia działa dla wielkości liniowych (w, mx, my, mxy,
// reakcje). Momenty Wood–Armera są nieliniowe względem (mx, my, mxy) — dla nich trzeba liczyć
// je dla konkretnych kombinacji: coefficientsAt() odtwarza kombinację rządzącą w punkcie,
// a enumerate() daje wszystkie układy (kontrola ścisła przy małej liczbie stref).

import { NORM, PSI } from './norms/en1990-pl.js';

export const SCHEMES = {
  ULS: 'SGN — STR',
  CHAR: 'SGU — charakterystyczna',
  FREQ: 'SGU — częsta',
  QP: 'SGU — quasi-stała',
};

// Normalizacja opisu oddziaływań: kolejność przypadków, grupy, współczynniki ψ.
function describe(names, actions, psiTable) {
  const groups = new Map(); // grupa -> { psi, cases: [indeksy] }
  const types = names.map((name, c) => {
    const a = actions[name];
    if (!a) throw new Error(`Przypadek ${name}: brak opisu oddziaływania (stałe G czy zmienne Q z kategorią).`);
    if (a.type === 'G') return 'G';
    if (a.type !== 'Q') throw new Error(`Przypadek ${name}: typ „${a.type}” — dozwolone 'G' albo 'Q'.`);
    const psi = psiTable[a.category];
    if (!psi) throw new Error(`Przypadek ${name}: nieznana kategoria „${a.category}” (dozwolone: ${Object.keys(psiTable).join(', ')}).`);
    const g = a.group ?? a.category;
    if (!groups.has(g)) groups.set(g, { psi, cases: [] });
    else if (groups.get(g).psi !== psi) throw new Error(`Grupa ${g}: strefy o różnych kategoriach — jedna grupa to jedno oddziaływanie.`);
    groups.get(g).cases.push(c);
    return 'Q';
  });
  return { types, groups };
}

// Warianty kombinacji dla każdego schematu (SGN i trzy kombinacje SGU).
export function buildSchemes(names, actions, { norm = NORM, psiTable = PSI, formulas = norm.formulas } = {}) {
  const { types, groups } = describe(names, actions, psiTable);
  const C = names.length, groupList = [...groups.keys()];

  // gSup/gInf — współczynniki dla G; qFactor(grupa, wiodąca) — dla Q
  const variant = (name, gSup, gInf, qFactor) => {
    const hi = new Float64Array(C), lo = new Float64Array(C);
    for (let c = 0; c < C; c++) if (types[c] === 'G') { hi[c] = gSup; lo[c] = gInf; }
    for (const [g, { cases }] of groups) for (const c of cases) hi[c] = qFactor(g);
    return { name, hi, lo };
  };
  // jeden wariant na każdą grupę wiodącą (bez zmiennych: jeden wariant z samymi G)
  const perLeading = (label, gSup, gInf, lead, accomp) =>
    (groupList.length ? groupList : [null]).map(L =>
      variant(L == null ? label : `${label}, wiodące: ${L}`, gSup, gInf, g => (g === L ? lead(groups.get(g).psi) : accomp(groups.get(g).psi))));

  const { gammaGsup: gs, gammaGinf: gi, gammaQ: gq, xi } = norm;
  const ULS = [];
  for (const f of formulas) {
    if (f === '6.10a') ULS.push(variant('(6.10a)', gs, gi, g => gq * groups.get(g).psi.psi0));
    else if (f === '6.10b') ULS.push(...perLeading('(6.10b)', xi * gs, gi, () => gq, p => gq * p.psi0));
    else if (f === '6.10') ULS.push(...perLeading('(6.10)', gs, gi, () => gq, p => gq * p.psi0));
    else throw new Error(`Nieznany wzór kombinacji: ${f}`);
  }
  return {
    names, types, groups,
    ULS,
    CHAR: perLeading('charakterystyczna', 1, 1, () => 1, p => p.psi0),
    FREQ: perLeading('częsta', 1, 1, p => p.psi1, p => p.psi2),
    QP: [variant('quasi-stała', 1, 1, g => groups.get(g).psi.psi2)],
  };
}

// Obwiednia wielkości liniowej. fields[c] — wartości przypadku c w N punktach.
// Zwraca max/min oraz numer wariantu rządzącego (gov) w każdym punkcie.
export function envelope(fields, variants) {
  const C = fields.length, N = C ? fields[0].length : 0;
  const max = new Float64Array(N).fill(-Infinity), min = new Float64Array(N).fill(Infinity);
  const govMax = new Int16Array(N), govMin = new Int16Array(N);
  variants.forEach(({ hi, lo }, k) => {
    for (let i = 0; i < N; i++) {
      let sMax = 0, sMin = 0;
      for (let c = 0; c < C; c++) {
        const v = fields[c][i], a = hi[c] * v, b = lo[c] * v;
        if (a > b) { sMax += a; sMin += b; } else { sMax += b; sMin += a; }
      }
      if (sMax > max[i]) { max[i] = sMax; govMax[i] = k; }
      if (sMin < min[i]) { min[i] = sMin; govMin[i] = k; }
    }
  });
  return { max, min, govMax, govMin };
}

// Współczynniki kombinacji rządzącej w punkcie i (sense = +1 maksimum, -1 minimum).
// Wynik można podać do combine() albo do wymiarowania (Wood–Armer w etapie 5).
export function coefficientsAt(fields, variants, gov, i, sense) {
  const { hi, lo } = variants[gov[i]];
  return Float64Array.from(fields, (f, c) => {
    const v = sense * f[i];
    return hi[c] * v >= lo[c] * v ? hi[c] : lo[c];
  });
}

// Kombinacja liniowa przypadków: Σ coef[c] · fields[c]
export function combine(fields, coef) {
  const out = new Float64Array(fields[0].length);
  fields.forEach((f, c) => { if (coef[c]) for (let i = 0; i < out.length; i++) out[i] += coef[c] * f[i]; });
  return out;
}

// Wszystkie układy jawnie: każdy przypadek na „hi” albo „lo” w każdym wariancie.
// Liczba układów rośnie jak 2^n — tylko do kontroli i dla wielkości nieliniowych przy małym n.
export function* enumerate(variants, limit = 1 << 16) {
  let count = 0;
  for (const v of variants) {
    const free = [...v.hi.keys()].filter(c => v.hi[c] !== v.lo[c]);
    if (variants.length * 2 ** free.length > limit) throw new Error(`Za dużo układów (${variants.length}·2^${free.length}) — użyj envelope().`);
    for (let mask = 0; mask < 2 ** free.length; mask++) {
      const coef = Float64Array.from(v.hi);
      free.forEach((c, b) => { if (!(mask >> b & 1)) coef[c] = v.lo[c]; });
      yield { variant: v.name, coef, index: count++ };
    }
  }
}

// Obwiednie wyników płyty dla wszystkich schematów.
//   cases    — Map(nazwa -> wynik solveCase), np. z analyzeSlab()
//   actions  — opis oddziaływań (jak wyżej)
// Zwraca { schemes, nodes: { ULS: { w, mx, my, mxy }, … }, supports: { ULS: [{ label, kind, V, Mx, My }], … } }
// gdzie każda wielkość to { max, min, govMax, govMin }.
export function slabEnvelopes(cases, actions, opts = {}) {
  const names = [...cases.keys()], res = names.map(n => cases.get(n));
  const schemes = buildSchemes(names, actions, opts);
  const N = res[0].m.length;
  const nodeFields = {
    w: res.map(r => Float64Array.from({ length: N }, (_, i) => r.u[3 * i])),
    mx: res.map(r => Float64Array.from(r.m, m => m[0])),
    my: res.map(r => Float64Array.from(r.m, m => m[1])),
    mxy: res.map(r => Float64Array.from(r.m, m => m[2])),
    vx: res.map(r => Float64Array.from(r.v ?? r.m, v => (r.v ? v[0] : 0))),
    vy: res.map(r => Float64Array.from(r.v ?? r.m, v => (r.v ? v[1] : 0))),
  };
  const sup = res[0].supportReactions ?? [];
  const supFields = Object.fromEntries(['V', 'Mx', 'My'].map(q =>
    [q, res.map(r => Float64Array.from(r.supportReactions ?? [], s => s[q]))]));

  const out = { schemes, fields: { nodes: nodeFields, supports: supFields }, nodes: {}, supports: {} };
  for (const key of Object.keys(SCHEMES)) {
    const vars = schemes[key];
    out.nodes[key] = Object.fromEntries(Object.entries(nodeFields).map(([q, f]) => [q, envelope(f, vars)]));
    const env = Object.fromEntries(Object.entries(supFields).map(([q, f]) => [q, envelope(f, vars)]));
    out.supports[key] = sup.map((s, j) => ({
      label: s.label, kind: s.kind,
      ...Object.fromEntries(Object.entries(env).map(([q, e]) => [q, {
        max: e.max[j], min: e.min[j], govMax: vars[e.govMax[j]].name, govMin: vars[e.govMin[j]].name,
      }])),
    }));
  }
  return out;
}
