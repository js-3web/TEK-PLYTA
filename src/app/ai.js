// Asystent AI (specyfikacja, sekcja 10): aplikacja NIE łączy się z AI. Tworzy paczkę, którą użytkownik
// wkleja do własnego narzędzia AI, a odpowiedź (tabelę uwag) może wczytać z powrotem.
// Anonimizacja domyślnie włączona: dane inwestora i obiektu zastąpione znacznikami.

import { zip } from '../report/zip.js';
import { buildReport, renderHTML, renderDOCX } from '../report/report.js';

export function anonymize(project) {
  return { ...project, meta: { name: '[PROJEKT]', investor: '[INWESTOR]', object: '[OBIEKT]', author: '[AUTOR]' } };
}

export const PROMPT = `# Sprawdzenie obliczeń płyty żelbetowej — TEK-PŁYTA

## Rola
Jesteś sprawdzającym konstruktorem z doświadczeniem w projektowaniu płyt żelbetowych wg Eurokodów
(PN-EN 1990, PN-EN 1991-1-1, PN-EN 1992-1-1 z Załącznikami Krajowymi).

## Materiał
- \`model.json\` — dane wejściowe, kombinacje, wyniki kluczowe, ostrzeżenia, wersja programu;
- \`raport.html\` / \`raport.docx\` — raport z obliczeń.

## Zadanie — oceń wiarygodność
1. **Dane:** obciążenia vs kategoria użytkowania (EN 1991-1-1, tabl. 6.1–6.2), jednostki, ciężar własny, grubość vs rozpiętości.
2. **Model:** podpory i ich sztywności, czy płyta nie jest „zawieszona” na zbyt podatnych podporach, gęstość siatki przy słupach.
3. **Wyniki:** równowaga (suma reakcji = obciążenie), rzędy wielkości (np. moment przęsłowy ≈ qL²/10…qL²/20, ugięcie vs L/h), znaki momentów.
4. **Wymiarowanie:** przebicie (wykorzystanie, typ słupa, β), strefy dozbrojenia, zbrojenie minimalne, ugięcia L/250 i L/500, rysy.

## Zasady
- Nie wymyślaj punktów normy ani wartości. Gdy nie masz pewności — napisz to wprost.
- Oznaczaj niepewność. Nie „zatwierdzaj” obliczeń: Twoja opinia nie jest sprawdzeniem projektu
  w rozumieniu Prawa budowlanego.
- Odnoś się do konkretnych liczb z \`model.json\`.

## Wynik
Zwróć WYŁĄCZNIE blok \`\`\`json z tablicą uwag (do importu z powrotem do aplikacji):
\`\`\`json
[{ "waga": 1-5, "miejsce": "np. słup S3 / pole P1 / dane: Q2", "uwaga": "…", "uzasadnienie": "…", "sprawdzenie": "co zrobić, żeby to rozstrzygnąć" }]
\`\`\`
Waga: 5 — może prowadzić do niebezpiecznego wymiarowania; 1 — kosmetyka.
`;

// model.json: dane + wyniki kluczowe (bez map węzłowych — za duże dla okna kontekstu AI)
export function modelSummary(project, res) {
  const { dxf, ...data } = project;
  const r1 = v => (Number.isFinite(v) ? +v.toPrecision(4) : v);
  return {
    program: { nazwa: 'TEK-PŁYTA', wersja: res.version },
    dane: data,
    geometria: {
      pole_m2: r1(res.geo.info?.area), slupy: res.geo.columns.map(c => ({ etykieta: c.label, ksztalt: c.shape, srodek_m: c.c.map(r1), A_m2: r1(c.A) })),
      sciany: res.geo.walls.map(w => w.label), krawedzie: res.geo.edges.map(e => e.label), otwory: res.geo.holes.map(h => h.label),
    },
    siatka: { wezly: res.summary.nodes, elementy: res.summary.elements, min_kat: r1(res.summary.minAngle) },
    przypadki: res.cases, kombinacje_SGN: res.combinations.ULS,
    rownowaga: res.equilibrium.map(e => ({ przypadek: e.case, obciazenie_kN: r1(e.load), reakcje_kN: r1(e.reactions) })),
    reakcje_podpor: res.supports.map(s => ({ podpora: s.label, Vmax_kN: r1(s.Vmax), Vmin_kN: r1(s.Vmin), kombinacja: s.gov })),
    zginanie: { As_max_mm2_m: Object.fromEntries(Object.entries(res.summary.AsMax).map(([k, v]) => [k, r1(v)])), siatka_mm2_m: res.design.base },
    przebicie: res.punching.map(p => ({ slup: p.label, typ: p.type, VEd_kN: r1(p.VEd), beta: p.beta, u1_m: r1(p.u1), d_m: r1(p.d), vEd_MPa: r1(p.vEd), vRdc_MPa: r1(p.vRdc), wykorzystanie: r1(p.util), vEd0_do_vRdmax: r1(p.utilMax) })),
    sgu: { phi: r1(res.sls.phi), eps_cs: r1(res.sls.ecs), w_max_dlugotrwale_m: r1(res.summary.wLtMax), wk_max_mm: r1(res.sls.wkMax), wmax_mm: res.sls.wmax,
      pola: res.sls.fields.map(f => ({ pole: f.label, L_m: f.L, w_mm: r1(f.w * 1000), dw_mm: r1(f.dw * 1000), spelnia: f.ok })) },
    zmienione_wspolczynniki: (res.paramChanges ?? []).map(c => ({ wspolczynnik: c.symbol, punkt: c.clause, normowa: c.normative, przyjeta: c.adopted })),
    ostrzezenia: res.warnings.map(w => w.msg),
  };
}

export function buildAIPackage(project, res, { anonymized = true, images = {} } = {}) {
  const p = anonymized ? anonymize(project) : project;
  const doc = buildReport(p, res, images);
  return zip([
    { name: 'prompt.md', data: PROMPT },
    { name: 'model.json', data: JSON.stringify(modelSummary(p, res), null, 1) },
    { name: 'raport.html', data: renderHTML(doc) },
    { name: 'raport.docx', data: renderDOCX(doc) },
  ]);
}

// Odpowiedź AI → tablica uwag (walidacja; błędny format = czytelny błąd, nie cichy import)
export function parseAIReview(text) {
  const m = text.match(/```json\s*([\s\S]*?)```/) ?? [null, text];
  let arr;
  try { arr = JSON.parse(m[1]); } catch { throw new Error('Nie znaleziono poprawnego bloku JSON z uwagami.'); }
  if (!Array.isArray(arr)) throw new Error('Oczekiwana tablica uwag.');
  return arr.map((u, i) => {
    const waga = Number(u.waga);
    if (!(waga >= 1 && waga <= 5)) throw new Error(`Uwaga ${i + 1}: waga musi być 1–5.`);
    return { waga, miejsce: String(u.miejsce ?? ''), uwaga: String(u.uwaga ?? ''), uzasadnienie: String(u.uzasadnienie ?? ''), sprawdzenie: String(u.sprawdzenie ?? '') };
  }).sort((a, b) => b.waga - a.waga);
}
