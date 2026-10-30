// Czytnik DXF na plikach wygenerowanych niezależną biblioteką (ezdxf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readDxf, cleanText } from '../src/dxf/read.js';

const load = f => readDxf(readFileSync(new URL(`../${f}`, import.meta.url), 'latin1'));
const count = (ents, layer, type) => ents.filter(e => e.layer === layer && (!type || e.type === type)).length;

test('wzorzec: jednostki mm i liczba obiektów na warstwach', () => {
  const d = load('assets/TEK-PLYTA_wzorzec.dxf');
  assert.equal(d.insunits, 4);
  assert.equal(d.scaleToMeters, 0.001);
  assert.equal(count(d.entities, 'TP_OBRYS', 'POLY'), 1);
  assert.equal(count(d.entities, 'TP_SLUP'), 7);
  assert.equal(count(d.entities, 'TP_SLUP', 'CIRCLE'), 1);
  assert.equal(count(d.entities, 'TP_OBC_POW'), 2);
  assert.equal(count(d.entities, 'TP_OBC_SKUP', 'POINT'), 1);
  const ob = d.entities.find(e => e.layer === 'TP_OBRYS');
  assert.equal(ob.closed, true);
  assert.deepEqual(ob.pts[0], [0, 0, 0.1], 'pierwszy wierzchołek z wybrzuszeniem 0,1');
  assert.ok(d.entities.some(e => e.type === 'TEXT' && e.text === 'S5'));
});

test('R12: stara POLYLINE/VERTEX, brak $INSUNITS', () => {
  const d = load('tests/fixtures/kwadrat-r12-metry.dxf');
  assert.equal(d.insunits, null);
  assert.equal(d.scaleToMeters, null);
  const ob = d.entities.find(e => e.layer === 'TP_OBRYS');
  assert.equal(ob.type, 'POLY');
  assert.equal(ob.closed, true);
  assert.equal(ob.pts.length, 4);
  assert.deepEqual(ob.pts[2].slice(0, 2), [6, 6]);
});

test('MTEXT z formatowaniem daje czystą etykietę; bloki zgłaszane jako ostrzeżenie', () => {
  const d = load('tests/fixtures/slupy-luk.dxf');
  const texts = d.entities.filter(e => e.type === 'TEXT').map(e => e.text);
  for (const s of ['S1', 'S2', 'S3', 'S4', 'Q1', 'P1']) assert.ok(texts.includes(s), `brak ${s} w ${texts}`);
  const b = load('tests/fixtures/bledy.dxf');
  assert.ok(b.warnings.some(w => /INSERT/.test(w.msg)));
});

test('cleanText: kody formatowania MTEXT', () => {
  assert.equal(cleanText('{\\fArial|b1;\\LS1\\l}'), 'S1');
  assert.equal(cleanText('\\A1;Q2'), 'Q2');
  assert.equal(cleanText('Linia 1\\PLinia 2'), 'Linia 1 Linia 2');
  assert.equal(cleanText('{\\H0.7x;\\C1;W3}'), 'W3');
});

test('plik binarny i uszkodzony: czytelny komunikat', () => {
  assert.throws(() => readDxf('AutoCAD Binary DXF\r\n...'), /binarny/);
  assert.throws(() => readDxf('  0\nSECTION\nabc\nENTITIES\n'), /kodu grupy/);
});
