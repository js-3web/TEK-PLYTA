// Rysunek zbrojenia DXF: odczyt zwrotny własnym czytnikiem i (jeśli dostępny) audyt ezdxf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DxfWriter, encodeCp1250 } from '../src/cad/dxf-write.js';
import { clipLine, rebarDrawing } from '../src/cad/drawing.js';
import { readDxf } from '../src/dxf/read.js';
import { defaultProject, runProject } from '../src/app/pipeline.js';

const latin1 = b => new TextDecoder('iso-8859-1').decode(b);

test('zapis R12: warstwy, linia i polilinia w mm, CP1250 dla polskich liter', () => {
  const w = new DxfWriter().layer('ZB_DOL_X', 1);
  w.line('ZB_DOL_X', [0, 0], [1.5, 0]); w.poly('ZB_DOL_X', [[0, 0], [1, 0], [1, 1]], true); w.text('ZB_DOL_X', [0, 0], 0.1, 'dół #12 co 150');
  const d = readDxf(latin1(w.toBytes()));
  assert.equal(d.scaleToMeters, 0.001, '$INSUNITS = mm');
  const line = d.entities.find(e => e.type === 'LINE');
  assert.deepEqual([line.a, line.b], [[0, 0], [1500, 0]]);
  assert.equal(d.entities.find(e => e.type === 'POLY').closed, true);
  assert.deepEqual([...encodeCp1250('ółŁ—')], [0xF3, 0xB3, 0xA3, 0x97]);
});

test('przycinanie pręta do płyty L z otworem: odcinki tylko w płycie', () => {
  const geo = { outline: [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]], holes: [{ pts: [[1, 1], [2, 1], [2, 2], [1, 2]] }] };
  // y = 1,5: płyta 0–10, otwór 1–2 → odcinki [0;1] i [2;10];  y = 6: tylko 0–4
  assert.deepEqual(clipLine(geo, [0, 1.5], [1, 0]).map(s => s.map(v => +v.toFixed(9))), [[0, 1], [2, 10]]);
  assert.deepEqual(clipLine(geo, [0, 6], [1, 0]).map(s => s.map(v => +v.toFixed(9))), [[0, 4]]);
});

test('wzorzec: rysunek z dwoma rzutami — każdy pręt narysowany, warstwy kompletne, odczyt zwrotny, audyt ezdxf', () => {
  const p = { ...defaultProject(), dxf: readFileSync(new URL('../assets/TEK-PLYTA_wzorzec.dxf', import.meta.url), 'latin1'),
    loads: { Q1: { value: 3, type: 'Q', category: 'B' }, Q2: { value: 7.5, type: 'Q', category: 'E' }, L1: { value: 6.2, type: 'G' }, P1: { value: 25, type: 'Q', category: 'E' } } };
  const r = runProject(p);
  const dr = rebarDrawing({ geo: r.geo, rebar: r.rebar, design: { h: p.slab.h, ...p.reinf } });
  assert.deepEqual(dr.bars.filter(b => !b.drawn), [], 'każda siatka i strefa ma pręt reprezentatywny');
  const bytes = dr.dxf.toBytes(), d = readDxf(latin1(bytes));
  const layers = new Set(d.entities.map(e => e.layer));
  for (const l of ['TP_OBRYS', 'ZB_DOL_X', 'ZB_DOL_Y', 'ZB_GORA_X', 'ZB_GORA_Y', 'ZB_STREFY', 'ZB_PRZEBICIE', 'ZB_OPIS']) assert.ok(layers.has(l), l);
  // obrys rzutu dolnego = obrys płyty (mm), rzut górny przesunięty w x
  const outl = d.entities.filter(e => e.layer === 'TP_OBRYS');
  assert.equal(outl.length, 2);
  assert.ok(Math.abs(outl[0].pts[0][0] - r.geo.outline[0][0] * 1000) < 1e-3);
  const texts = d.entities.filter(e => e.type === 'TEXT').map(e => e.text);
  assert.ok(texts.some(t => /#12 co 150/.test(t)) && texts.some(t => /^\+#\d+ co \d+/.test(t)), 'opisy siatek i dodatków');
  // audyt niezależną biblioteką (ezdxf) — gdy zainstalowana
  let hasEzdxf = true;
  try { execFileSync('python3', ['-I', '-c', 'import ezdxf'], { stdio: 'ignore' }); } catch { hasEzdxf = false; }
  if (hasEzdxf) {
    const f = join(mkdtempSync(join(tmpdir(), 'dxf-')), 'z.dxf'); writeFileSync(f, bytes);
    const out = execFileSync('python3', ['-I', '-c', 'import ezdxf,sys;d=ezdxf.readfile(sys.argv[1]);a=d.audit();print(len(a.errors))', f]).toString().trim();
    assert.equal(out, '0', 'ezdxf audit');
  }
});
