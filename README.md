# TEK-PLYTA

MES płyt żelbetowych wg PN-EN 1992-1-1:2008 + NA. Linia programów obliczeniowych TEKTORIA.
Specyfikacja v1: dokument „TEK-PLYTA v1 — specyfikacja” (Claude Docs — wersja aktualna), kopia z 27.10 w `docs/specyfikacja-v1.docx`;
zapis rozmowy z etapów 1–3 w `docs/chat-cowork.docx`.

## Uruchomienie testów

Wymaga Node.js 22+. W folderze projektu:

```
npm test
```

## Struktura

| Plik | Co robi |
| --- | --- |
| `src/dkt.js` | element DKT (Batoz, Bathe, Ho 1980) — główny: macierz sztywności, momenty |
| `src/mitc3.js` | element MITC3 (Lee, Bathe 2004), Mindlin — kontrolny, płyty grube |
| `src/supports.js` | sztywności sprężyn słupów i ścian |
| `src/model.js` | składanie modelu, warunki brzegowe, reakcje, momenty w węzłach |
| `src/solver.js` | rozkład Cholesky'ego w zapisie profilowym (skyline) |
| `src/ordering.js` | numeracja węzłów RCM (mały profil macierzy) |
| `bench/` | pomiary wydajności (`node bench/strop-30x60.mjs`) |
| `src/mesh.js` | siatki strukturalne do testów wzorcowych |
| `src/sparse.js` | rzadki rozkład Cholesky'ego (domyślny solver) |
| `src/dxf/read.js` | czytnik DXF (ASCII, R12–2018) |
| `src/geometry/` | import geometrii z DXF, walidacja, geometria płaska |
| `src/mesh/mesher.js` | generator siatki dla dowolnego obrysu |
| `src/analysis/build.js` | słupy, ściany, krawędzie, przypadki obciążeń, reakcje podpór |
| `src/combinations.js` | kombinacje PN-EN 1990 i obwiednie (SGN 6.10a/b lub 6.10, SGU char./częsta/quasi-stała) |
| `src/norms/en1990-pl.js` | wymienny zestaw normowy: γ, ξ, ψ (tabl. A1.1) |
| `assets/TEK-PLYTA_wzorzec.dxf` | wzorzec DXF dla użytkownika |
| `tools/make-dxf.py` | generator wzorca i plików testowych (ezdxf, tylko dla dewelopera) |
| `tests/` | 54 testy: wzorcowe T1–T6, elementy, sprężyny, DXF, siatka, analiza end-to-end, solvery |

## Stan (2026-10-27)

| Test | Wynik |
| --- | --- |
| Konwencja znaków, ruchy sztywne, symetria K | zaliczone |
| T1 równowaga | suma reakcji = suma obciążeń (błąd < 1e-9) |
| T2 zbieżność i symetria | zaliczone |
| T3 płyta swobodnie podparta, siatka 32×32 | w = 0,00406, M = 0,0479 (Timoshenko: 0,00406 / 0,0479) |
| T4 płyta utwierdzona, siatka 32×32 | w = 0,00127, M = 0,0230, Mkr = −0,0513 (0,00126 / 0,0231 / −0,0513) |
| T5 NAFEMS LE6, siatka 64×64 | σ1 = 0,809 MPa (cel 0,802; +0,9 %) |
| MITC3 płyta cienka t/a = 0,001 | w = Kirchhoff (brak blokady ścinania) |
| MITC3 płyta gruba t/a = 0,1 | w = 0,004265 (Wang: 0,004273) |
| Sprężyny: 4 narożniki, przypadki graniczne k → 0 i k → ∞ | zgodne z wynikami ścisłymi |
| T6 Morley 30°, L/h = 1000, siatka 64×64 | w = 0,4146, M1 = 1,927, M2 = 1,111 (wzorzec 0,4134 / 1,922 / 1,106) |
| T6 Razzaque 60°, siatka 32×32 | w = 0,7907, My = 0,9597 (wzorzec 0,7912 / 0,9601) |

Obserwacja z T5: przy podparciu „twardym” (w = 0 i dw/dt = 0) zbieżność w narożach
rozwartych jest wolna (−6 % przy 64×64) — osobliwość narożna. Wniosek: zagęszczanie
siatki w narożach rozwartych i przy słupach.

## Do zrobienia w etapie 2

- [x] Element Mindlina — MITC3 jako kontrolny (DKMT odrzucony, patrz specyfikacja sekcja 4)
- [x] Sprężyny podporowe (węzłowe) — słupy w jednym węźle; rozłożenie na obrys słupa w etapie 3
- [x] T6: płyty skośne Morleya i Razzaque'a — zgodność ≤ 0,1 % przy 96×96 (Grbac, Ribarić 2022)
- [x] Numeracja RCM; model dwufazowy: jeden rozkład K, wiele przypadków obciążeń
- [x] Solver rzadki (nested dissection) — zrobiony w etapie 3, bo pomiar na stropie z 66 słupami dał 60 s
- [ ] Web Worker

Obserwacje z MITC3: moment utwierdzenia niedoszacowany o 7 % przy 64×64 (moment stały
w elemencie); siły poprzeczne przy podporach niezbieżne (warstwa brzegowa Mindlina).
Stąd decyzje: DKT głównym elementem, VEd do przebicia z reakcji podpór.

## Wydajność (strop 30 × 60 m, węzły w losowej kolejności, Node 22)

| Oczko | Niewiadome | Budowa + rozkład | Przypadek obciążenia | Pamięć |
| --- | --- | --- | --- | --- |
| 0,5 m | 22 tys. | 1,0 s | 0,17 s | 84 MB |
| 0,35 m | 44 tys. | 3,7 s | 0,39 s | 143 MB |
| 0,25 m | 87 tys. | 13,5 s | 0,84 s | 341 MB |

Bez RCM siatka 1 m: 87 MB i 25 s; z RCM: 5 MB i 0,3 s. Wniosek: siatka zagęszczana
(gęsto przy słupach i w narożach, oczko ~0,5 m w polach) zamiast jednolitej 0,25 m.

## Etap 3 (2026-10-28): DXF → siatka → MES

- Czytnik DXF własny; wzorzec i pliki testowe z ezdxf (audyt: 0 błędów).
- Walidacja: obrys, otwory, słupy, krawędzie, etykiety, jednostki, „prawie-styki” — z lokalizacją w jednostkach rysunku.
- Siatka: pole siatki = pole płyty, zgodność (brak wiszących węzłów), min. kąt > 10°.
- Test end-to-end: kwadrat 6 × 6 m z DXF, siatka nieregularna — Timoshenko w 2 %.
- Równowaga: suma reakcji słupów, ścian i krawędzi = obciążenie (1e-6) dla wszystkich przypadków wzorca.

| Pomiar (Node 22) | Siatka | MES |
| --- | --- | --- |
| strop 60 × 30 m, 66 słupów, oczko 0,5 m (82 tys. niewiadomych) | 1,6 s | 4,6 s (rozkład + 2 przypadki) |
| siatka jednolita 0,25 m (87 tys.) — solver rzadki / profilowy | — | 4,4 s / 16,9 s; 77 MB / 291 MB |

Do sprawdzenia przez użytkownika: otwarcie `assets/TEK-PLYTA_wzorzec.dxf` w ZWCAD 2022 i zapis jako DXF 2010.

## Etap 4 (2026-10-30): kombinacje i obwiednie wg PN-EN 1990

- Domyślnie SGN = mniej korzystne z (6.10a) i (6.10b), ξ = 0,85 — zgodnie z PN-EN 1990/NA (źródła wtórne);
  (6.10) jako opcja. SGU: charakterystyczna, częsta, quasi-stała.
- Każda strefa Q to osobny przypadek; strefy tej samej kategorii = jedno oddziaływanie swobodne
  (EN 1991-1-1, 6.2.1(1)) — włączane/wyłączane niezależnie, bez ψ0 między sobą. Różne kategorie:
  jedna wiodąca, pozostałe z ψ0. Stałe G: γG,sup albo γG,inf dla całego przypadku (EN 1990, A1.3.1 uw. 3).
- Obwiednia liczona „składnik po składniku” (koszt liniowy, nie 2^n) — test: identyczna z pełnym
  wyliczeniem wszystkich układów. Dla każdego punktu zapamiętana kombinacja rządząca (do Wood–Armera).
- Pomiar: 30 tys. węzłów, 12 przypadków (10 stref Q), 4 wielkości × 4 schematy — 0,15 s (`bench/obwiednie.mjs`).
- Testy: przykłady liczone ręcznie (komentarze w teście), belka ciągła dwuprzęsłowa wg tablic
  (0,0957·qL², −0,125·gL²), równowaga reakcji w kombinacji rządzącej, błędy danych.

ψ0/ψ1/ψ2: wartości zalecane CEN (tabl. A1.1) — decyzja projektanta z 30.10.2026, bez porównania z tekstem
PN-EN 1990/NA (`src/norms/en1990-pl.js`, `verified: false`).

Wzorzec po zapisie w ZWCAD 2022 jako DXF 2010 (`tests/fixtures/wzorzec-zwcad2022-r2010.dxf`, plik od użytkownika):
geometria identyczna z oryginałem co do bitu, 0 błędów i ostrzeżeń, łańcuch do obwiedni SGN przechodzi.

T8 (decyzja 30.10.2026): brak komercyjnego MES — porównanie z xdfem2d (niezależny MES) i pasmami w RM-Win
(kontrola wiarygodności; metoda pasm jest przybliżona, więc bez tolerancji liczbowej).

Znalezione przy okazji (do etapu 5): momenty w węzłach to średnia z elementów — nad linią podpory
przy elementach wydłużonych (0,25 × 0,5 m) odchyłka +5 % względem belki ciągłej, przy kwadratowych < 1 %.
Wygładzanie SPR (specyfikacja, sekcja 4) przed wymiarowaniem.
