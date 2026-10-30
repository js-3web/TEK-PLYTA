# TEK-PŁYTA — weryfikacja zgodności wyników

Stan: 2026-10-30, wersja 0.6. Każdy test działa automatycznie (`npm test`, GitHub Actions).
Wartości oczekiwane pochodzą ze źródła niezależnego od kodu: rozwiązań analitycznych, benchmarków,
obliczeń ręcznych zapisanych krok po kroku w komentarzach testów albo z innego programu MES.

## 1. MES płyty — rozwiązania analityczne i benchmarki

| Test | Wartość referencyjna | Źródło | TEK-PŁYTA | Plik testu |
|---|---|---|---|---|
| T1 równowaga | Σ reakcji = Σ obciążeń | warunek mechaniczny | błąd < 1e-9 | `plyty-wzorcowe`, `analiza-dxf` |
| T3 płyta kwadratowa przegubowa | w = 0,00406 qa⁴/D, M = 0,0479 qa² | Timoshenko, Woinowsky-Krieger, tabl. 8 | 0,00406 / 0,0479 (32×32) | `plyty-wzorcowe` |
| T4 płyta utwierdzona | w = 0,00126, Mśr = 0,0231, Mkr = −0,0513 | Timoshenko, Woinowsky-Krieger | 0,00127 / 0,0230 / −0,0513 | `plyty-wzorcowe` |
| T5 NAFEMS LE6 | σ1 = 0,802 MPa | NAFEMS TNSB Rev. 3 | 0,809 (+0,9 %) | `plyty-wzorcowe` |
| T6 Morley 30°, Razzaque 60° | wartości z artykułu | Grbac, Ribarić 2022 | ≤ 0,3 % | `t6-plyty-skosne` |
| Siły poprzeczne | Qx z szeregu Naviera | liczone w teście | ≤ 0,5 % wewnątrz płyty | `sily-poprzeczne` |
| Belka ciągła 2 przęsła (pasmo) | 0,0957 qL², −0,125 gL², v(x) | tablice belek | ≤ 2–3 % | `kombinacje`, `momenty-wezlowe`, `sily-poprzeczne` |
| MITC3 płyta cienka / gruba | Kirchhoff / Wang | literatura | brak blokady / 0,2 % | `mitc3` |

## 2. Niezależny program MES — xdfem2d (T8)

xdfem2d 2026.10.29 (P. Cachim, LGPL-3.0, PyPI) — ta sama siatka, podpory i obciążenia, własna implementacja
elementów DKT i MITC3. Narzędzie tylko do kontroli (nie jest częścią programu).
Uruchomienie: `node tools/export-case.mjs cc.json && python3 tools/cross-check.py cc.json`.

**Wynik: z elementem DKT zgodność 0,00 % (ugięcia i momenty) we wszystkich przypadkach** — potwierdza składanie
macierzy, sprężyny słupów i ścian, więzy krawędzi, obciążenia powierzchniowe, liniowe i skupione.
MITC3 (teoria Mindlina — inna teoria) służy jako kontrola rzędu wielkości: ugięcia +0,7…+6 % (odkształcalność
postaciowa), momenty w pojedynczych elementach przy podporach do ±20 % (stały moment w elemencie MITC3).

Tabela: [weryfikacja-xdfem2d.md](weryfikacja-xdfem2d.md).

## 3. Wymiarowanie EC2 — obliczenia ręczne krok po kroku

| Zakres | Przykład | Plik testu |
|---|---|---|
| Kombinacje 6.10a/b, ψ | G = 10, Q = 4: 17,7 (6.10a) | `kombinacje` |
| Zginanie przekroju | MEd = 50 kNm/m, d = 170, C30/37 → As = 706 mm²/m | `zginanie` |
| Wood–Armer z korektami | 4 przypadki | `zginanie` |
| Przebicie u1, vRd,c, vRd,max, Asw, uout | słup 400×400, VEd = 600 kN | `przebicie` |
| Obwód u1 przy krawędzi, narożu, otworze, naroże wklęsłe | geometria | `przebicie` |
| Ścinanie 6.2.2 | ρ = 0,5 %, d = 200 → 126,8 kN/m | `scinanie` |
| Rysy 7.3.4, naprężenia 7.2 | M = 40 kNm/m → wk = 0,247 mm, σs = 269,5 MPa | `sgu`, `scinanie` |
| Pełzanie, skurcz (zał. B) | φ = 2,291; εcs = 0,436 ‰ (zgodne z rys. 3.1, tabl. 3.2) | `sgu` |
| Ugięcie z zarysowaniem 7.4.3 | MES vs całkowanie krzywizn belki: 0,16 % | `sgu` |
| Dobór prętów, lbd 8.4, przebicie 9.4.3 | ΔAs = 600 → #12; lbd ϕ16 = 541 mm; 2 obwody 8/11 ϕ8 | `zbrojenie` |

## 4. Do potwierdzenia (otwarte)

- **Przykłady książkowe EC2 (T7)** z opublikowanych źródeł (Concrete Centre Worked Examples, przykłady PL) —
  wymagają dostępu sieci do stron źródłowych (zablokowany w środowisku budowy; odblokowanie zgłoszone).
- **Wartości krajowe** (`verified: false` w `src/norms/*.js`): γc = 1,4 i αcc = 1,0 (PN-EN 1992-1-1/NA),
  współczynnik 0,4 w vRd,max (AC:2010), stosowanie zał. B, k1–k4 i wmax (tabl. 7.1N), ψ (PN-EN 1990/NA).
- **T8 na realnych stropach** projektanta (RM-Win na pasmach — kontrola wiarygodności).
