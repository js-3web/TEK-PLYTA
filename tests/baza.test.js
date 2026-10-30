// Baza projektów (sql.js): zapis, warianty, status „do przeliczenia” po zmianie wersji, eksport/odczyt bajtów.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { ProjectDB, exportProjectFile, importProjectFile } from '../src/app/db.js';
import { defaultProject } from '../src/app/pipeline.js';

test('projekt z dwoma wariantami (h = 22 i 25 cm), wyniki, status wersji, kasowanie kaskadowe', async () => {
  const SQL = await initSqlJs();
  const db = new ProjectDB(SQL);
  const p = { ...defaultProject(), meta: { name: 'Strop A', investor: 'X', object: 'Biuro', author: 'JS' }, dxf: '0\nEOF\n' };
  const a = db.saveVariant({ project: { ...p, slab: { ...p.slab, h: 0.22 } }, variantName: 'h = 22 cm', resultSummary: { wLtMax: 0.02 }, version: '0.5.0' });
  db.saveVariant({ projectId: a.projectId, project: { ...p, slab: { ...p.slab, h: 0.25 } }, variantName: 'h = 25 cm', version: '0.5.0' });
  let list = db.list('0.5.0');
  assert.equal(list.length, 1); assert.equal(list[0].warianty.length, 2);
  assert.deepEqual(list[0].warianty.map(w => w.status), ['aktualne', 'brak']);
  assert.equal(db.list('0.6.0')[0].warianty[0].status, 'do przeliczenia');
  // bajty bazy → nowa instancja (zapis do pliku i odczyt)
  const db2 = new ProjectDB(SQL, db.export());
  const v = db2.loadVariant(a.variantId);
  assert.equal(v.project.slab.h, 0.22); assert.equal(v.project.dxf, '0\nEOF\n'); assert.equal(v.variantName, 'h = 22 cm');
  // zapis zmienionych danych bez wyników kasuje stare wyniki
  db2.saveVariant({ projectId: v.projectId, variantId: v.variantId, project: v.project, variantName: v.variantName, version: '0.5.0' });
  assert.equal(db2.list('0.5.0')[0].warianty[0].status, 'brak');
  db2.deleteProject(v.projectId);
  assert.equal(db2.list('0.5.0').length, 0);
  assert.equal(db2.rows('SELECT COUNT(*) AS n FROM dane')[0].n, 0, 'kasowanie kaskadowe');
});

test('plik .tekplyta: zapis i odczyt; obcy plik odrzucony', () => {
  const p = defaultProject();
  assert.deepEqual(importProjectFile(exportProjectFile(p, '0.5.0')), p);
  assert.throws(() => importProjectFile('{"a":1}'), /nie jest plik projektu/);
});
