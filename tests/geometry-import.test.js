// Import geometrii i walidacja (specyfikacja, sekcja 3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';

const fromFile = (f, opts) => importGeometry(readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1')), opts);
// Mały „DXF” zbudowany w kodzie (jednostki: m)
const dxf = entities => ({ entities, warnings: [], scaleToMeters: 1 });
const rect = (layer, x0, y0, x1, y1) => ({ type: 'POLY', layer, closed: true, pts: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]] });
const txt = (text, x, y) => ({ type: 'TEXT', layer: 'TP_INFO', text, p: [x, y] });
const codes = g => g.errors.map(e => e.code);

test('wzorzec: bez błędów i ostrzeżeń; pole i wymiary', () => {
  const g = fromFile('assets/TEK-PLYTA_wzorzec.dxf');
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.warnings, []);
  // L: 13,8 × 6,7 + 24 × 7,5 = 272,46; odcinek koła nad cięciwą 13,8 m o strzałce 0,69 m; otwór 1,2 × 0,9
  const L = 13.8, b = 0.1, th = 4 * Math.atan(b), r = L * (1 + b * b) / (4 * b);
  const segment = r * r / 2 * (th - Math.sin(th));
  assert.ok(Math.abs(g.info.area - (272.46 + segment - 1.08)) < 0.05, `pole ${g.info.area}`);
  assert.ok(Math.abs(g.info.height - (14.2 + 0.69)) <= 0.005);
  assert.deepEqual(g.columns.map(c => c.label), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7']);
  const s5 = g.columns.find(c => c.label === 'S5');
  assert.equal(s5.shape, 'circle');
  assert.ok(Math.abs(s5.D - 0.5) < 1e-12);
  const s1 = g.columns.find(c => c.label === 'S1');
  assert.ok(Math.abs(s1.Ix - 0.4 ** 4 / 12) < 1e-12 && s1.shape === 'rect');
});

test('plik z błędami: obrys niezamknięty, zdublowana etykieta, słup bez etykiety, blok, nieznana warstwa', () => {
  const g = fromFile('tests/fixtures/bledy.dxf');
  for (const c of ['obrys-niezamkniety', 'zdublowana-etykieta', 'brak-etykiety']) assert.ok(codes(g).includes(c), c);
  assert.ok(g.warnings.some(w => w.code === 'dxf-nieobslugiwany'));
  assert.ok(g.warnings.some(w => w.code === 'nieznana-warstwa'));
  const e = g.errors.find(x => x.code === 'obrys-niezamkniety');
  assert.deepEqual(e.loc, [0, 6000], 'lokalizacja w jednostkach rysunku (mm)');
});

test('brak podpór = błąd; brak jednostek przy rysunku w metrach = błąd „jednostki-podejrzane”, po wyborze m — OK', () => {
  assert.ok(codes(fromFile('tests/fixtures/bez-podpor.dxf')).includes('brak-podpor'));
  const g = fromFile('tests/fixtures/kwadrat-r12-metry.dxf');
  assert.ok(codes(g).includes('jednostki-podejrzane'));
  const g2 = fromFile('tests/fixtures/kwadrat-r12-metry.dxf', { scale: 1 });
  assert.deepEqual(g2.errors, []);
  assert.ok(Math.abs(g2.info.area - 36) < 1e-9);
});

test('położenie: otwór przecina obrys, słup poza płytą, słup w otworze, krawędź poza obrysem, siła w otworze', () => {
  const g = importGeometry(dxf([
    rect('TP_OBRYS', 0, 0, 10, 6),
    rect('TP_OTWOR', 9, 1, 11, 2),                      // przecina obrys
    rect('TP_OTWOR', 3, 3, 5, 5),
    rect('TP_SLUP', 12, 1, 12.4, 1.4), txt('S1', 12.2, 1.2),   // poza płytą
    rect('TP_SLUP', 4.8, 3.8, 5.2, 4.2), txt('S2', 5, 4),      // nachodzi na otwór
    { type: 'LINE', layer: 'TP_KRAWEDZ', a: [0, 0], b: [3, 1] }, txt('K1', 1.5, 0.5),  // nie po obrysie
    { type: 'POINT', layer: 'TP_OBC_SKUP', p: [4, 4] }, txt('P1', 4, 4.3),             // w otworze
  ]));
  for (const c of ['otwor-przecina-obrys', 'slup-poza-plyta', 'slup-w-otworze', 'krawedz-poza-obrysem', 'sila-poza-plyta']) assert.ok(codes(g).includes(c), `${c} w ${codes(g)}`);
});

test('etykiety: wewnątrz wygrywa mniejsza strefa; etykieta daleko od obiektu = ostrzeżenie; słup przy krawędzi dozwolony', () => {
  const g = importGeometry(dxf([
    rect('TP_OBRYS', 0, 0, 10, 6),
    rect('TP_SLUP', 0, 0, 0.4, 0.4), txt('S1', 0.6, 0.6),       // narożny, styka się z obrysem
    rect('TP_OBC_POW', 0, 0, 10, 6), txt('Q1', 8, 5),
    rect('TP_OBC_POW', 1, 1, 3, 3), txt('Q2', 2, 2),             // w środku Q1 i Q2 -> Q2
    txt('W7', 50, 50),
  ]));
  assert.deepEqual(g.errors, []);
  assert.deepEqual(g.areaLoads.map(q => q.label), ['Q1', 'Q2']);
  assert.ok(g.warnings.some(w => w.code === 'etykieta-bez-obiektu'));
});

test('łuk z wybrzuszeniem i okrąg: zgodność z geometrią (strzałka, pole koła)', () => {
  const g = fromFile('tests/fixtures/slupy-luk.dxf');
  assert.deepEqual(g.errors, []);
  // prawa krawędź 8 m, bulge 0,2 -> strzałka 0,8 m na zewnątrz
  // łuk zamieniany na cięciwy ze strzałką ≤ 5 mm (ARC_TOL) — wierzchołek łuku nie musi być węzłem
  assert.ok(Math.abs(g.info.width - 8.8) <= 0.005, `szerokość ${g.info.width}`);
  const s4 = g.columns.find(c => c.label === 'S4');
  assert.ok(Math.abs(s4.A - Math.PI * 0.5 ** 2 / 4) < 1e-12); // D = 0,5 m
});
