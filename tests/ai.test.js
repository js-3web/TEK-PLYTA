// Paczka AI: zawartość, anonimizacja (brak danych inwestora w żadnym pliku), import odpowiedzi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultProject, runProject } from '../src/app/pipeline.js';
import { buildAIPackage, parseAIReview } from '../src/app/ai.js';

const project = {
  ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
  meta: { name: 'Biurowiec Kowalski', investor: 'Jan Kowalski Sp. z o.o.', object: 'ul. Tajna 7', author: 'J. S.' },
  loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } },
};
const res = runProject(project);

test('paczka: prompt.md, model.json, raport.html, raport.docx; anonimizacja we wszystkich plikach', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-')), f = join(dir, 'p.zip');
  writeFileSync(f, buildAIPackage(project, res));
  const out = JSON.parse(execFileSync('python3', ['-I', '-c', `
import zipfile,sys,json
z=zipfile.ZipFile(sys.argv[1]); docx=zipfile.ZipFile(z.open('raport.docx'))
txt=''.join(z.read(n).decode('utf-8','ignore') for n in z.namelist() if n!='raport.docx')+docx.read('word/document.xml').decode()
m=json.loads(z.read('model.json'))
print(json.dumps({'names':z.namelist(),'leak':any(s in txt for s in ['Kowalski','Tajna']),'inv':m['dane']['meta']['investor'],'n':len(m['przebicie'])}))`, f]).toString());
  assert.deepEqual(out.names, ['prompt.md', 'model.json', 'raport.html', 'raport.docx']);
  assert.equal(out.leak, false, 'dane inwestora nie mogą trafić do paczki');
  assert.equal(out.inv, '[INWESTOR]'); assert.equal(out.n, 7);
});

test('import odpowiedzi AI: blok json, sortowanie po wadze, walidacja', () => {
  const u = parseAIReview('Uwagi:\n```json\n[{"waga":2,"miejsce":"Q1","uwaga":"a"},{"waga":5,"miejsce":"S3","uwaga":"b"}]\n```');
  assert.deepEqual(u.map(x => x.waga), [5, 2]);
  assert.throws(() => parseAIReview('```json\n[{"waga":9}]\n```'), /waga musi być 1–5/);
  assert.throws(() => parseAIReview('brak'), /Nie znaleziono/);
});
