// ZIP (stored): CRC32 wg wartości wzorcowej i odczyt archiwum niezależnym narzędziem (python zipfile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zip, crc32 } from '../src/report/zip.js';

test('CRC32("123456789") = 0xCBF43926 (wartość kontrolna standardu)', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('archiwum czytane przez python zipfile: nazwy z polskimi znakami, zawartość, testzip bez błędów', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-')), f = join(dir, 'a.zip');
  writeFileSync(f, zip([{ name: 'prompt.md', data: 'Zażółć gęślą jaźń' }, { name: 'dane/model.json', data: new Uint8Array([1, 2, 3]) }]));
  const out = execFileSync('python3', ['-I', '-c',
    'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([z.testzip(),z.namelist(),z.read("prompt.md").decode(),list(z.read("dane/model.json"))]))', f]).toString();
  assert.deepEqual(JSON.parse(out), [null, ['prompt.md', 'dane/model.json'], 'Zażółć gęślą jaźń', [1, 2, 3]]);
});
