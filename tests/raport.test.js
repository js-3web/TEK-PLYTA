// Raport: treść wg sekcji 8 specyfikacji; DOCX poprawny (ZIP + każdy XML dobrze zbudowany — python).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultProject, runProject } from '../src/app/pipeline.js';
import { buildReport, renderHTML, renderDOCX } from '../src/report/report.js';

const project = {
  ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
  meta: { name: 'Wzorzec', object: 'Budynek testowy', investor: '', author: 'J. S.' },
  loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } },
  sls: { RH: 50, cement: 'N', t0: 28, exposure: 'XC1', fields: [{ label: 'P1', pts: [[7.2, 3.8], [13.3, 3.8], [13.3, 6.6], [7.2, 6.6]], L: 6.7 }] },
};
const res = runProject(project);
// rysunek 1×1 px (PNG) — sprawdza osadzanie obrazów
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const doc = buildReport(project, res, { mesh: { src: png, w: 1, h: 1 } }, { date: '2026-10-30' });

test('raport: wszystkie sekcje, tabela przebicia dla 7 słupów, przykład krok po kroku, granice modelu, art. 20', () => {
  const html = renderHTML(doc);
  for (const s of ['1. Założenia', '2. Model obliczeniowy', '3. Kontrola modelu', '4. Zginanie', '5. Przebicie', '6. Ugięcia i rysy', '7. Wnioski', '8. Granice modelu', 'art. 20', 'Przykład krok po kroku', '(6.47)', 'Status wartości krajowych'])
    assert.ok(html.includes(s), s);
  const pt = doc.blocks.find(b => b.type === 'table' && b.head[0] === 'Słup');
  assert.equal(pt.rows.length, 7);
  assert.ok(!html.includes('NaN') && !html.includes('undefined'), 'brak NaN/undefined w raporcie');
});

test('DOCX: ZIP poprawny, każdy plik XML dobrze zbudowany, obraz osadzony, tekst polski', () => {
  const dir = mkdtempSync(join(tmpdir(), 'docx-')), f = join(dir, 'r.docx');
  writeFileSync(f, renderDOCX(doc));
  const out = execFileSync('python3', ['-I', '-c', `
import zipfile, sys, json, xml.dom.minidom as m
z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
for n in z.namelist():
    if n.endswith('.xml') or n.endswith('.rels'): m.parseString(z.read(n))
d = z.read('word/document.xml').decode()
print(json.dumps({'names': z.namelist(), 'pl': 'Założenia' in d, 'pages': d.count('w:type="page"')}))`, f]).toString();
  const r = JSON.parse(out);
  assert.ok(r.names.includes('word/media/image1.png'));
  assert.equal(r.pl, true);
  assert.ok(r.pages >= 3);
});
