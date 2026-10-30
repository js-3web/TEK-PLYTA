// Czytnik DXF (ASCII) — tylko to, czego potrzebuje TEK-PLYTA.
//
// DXF to ciąg par linii: KOD GRUPY (liczba) i WARTOŚĆ. Przykład fragmentu:
//     0          <- kod 0: początek obiektu
//   LINE         <- typ obiektu
//     8          <- kod 8: warstwa
//   TP_SCIANA
//    10          <- kod 10/20: X/Y pierwszego punktu
//   0.0
//    20
//   0.0
// Kody (AutoCAD DXF Reference): 0 typ, 8 warstwa, 10/20 X/Y, 11/21 drugi punkt,
// 40 promień, 42 wybrzuszenie (bulge) wierzchołka polilinii, 50/51 kąty łuku,
// 70 flagi (bit 1 = polilinia zamknięta), 1 i 3 tekst, 67 = 1 obiekt w obszarze papieru.
//
// Zwraca: { entities, insunits, scaleToMeters, warnings }
//   entities: LINE {a,b} | POLY {pts:[[x,y,bulge]], closed} | CIRCLE {c,r} | ARC {c,r,a0,a1}
//             | POINT {p} | TEXT {p, text}; każdy z polem layer.

const UNITS = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1 };
const UNIT_NAMES = { 0: 'brak', 1: 'cale', 2: 'stopy', 4: 'mm', 5: 'cm', 6: 'm' };

export function readDxf(text) {
  if (text.startsWith('AutoCAD Binary DXF')) throw new Error('Plik DXF binarny — zapisz rysunek jako DXF tekstowy (ASCII).');
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error(`Uszkodzony plik DXF: w linii ${i + 1} oczekiwano kodu grupy, jest "${lines[i].slice(0, 30)}".`);
    pairs.push([code, lines[i + 1]]);
  }

  const warnings = [];
  let insunits = null;
  const entities = [];
  const skipped = new Map(); // typ -> liczba

  // Sekcje: SECTION / 2 nazwa / ... / ENDSEC
  let i = 0;
  while (i < pairs.length) {
    const [c, v] = pairs[i];
    if (c === 0 && v.trim() === 'SECTION') {
      const name = pairs[i + 1]?.[1].trim();
      const end = findEndsec(pairs, i + 2);
      if (name === 'HEADER') insunits = readInsunits(pairs, i + 2, end);
      if (name === 'ENTITIES') readEntities(pairs.slice(i + 2, end), entities, skipped, warnings);
      i = end + 1;
    } else i++;
  }

  for (const [type, n] of skipped)
    warnings.push({ code: 'dxf-nieobslugiwany', msg: `Pominięto ${n} × ${type} (typ nieobsługiwany${type === 'INSERT' ? ' — rozbij bloki poleceniem ROZBIJ/EXPLODE' : ''}).` });

  const scaleToMeters = insunits != null && UNITS[insunits] ? UNITS[insunits] : null;
  return { entities, insunits, unitName: UNIT_NAMES[insunits] ?? (insunits == null ? 'brak' : `kod ${insunits}`), scaleToMeters, warnings };
}

function findEndsec(pairs, from) {
  for (let k = from; k < pairs.length; k++) if (pairs[k][0] === 0 && pairs[k][1].trim() === 'ENDSEC') return k;
  throw new Error('Uszkodzony plik DXF: brak ENDSEC.');
}

function readInsunits(pairs, from, to) {
  for (let k = from; k < to - 1; k++)
    if (pairs[k][0] === 9 && pairs[k][1].trim() === '$INSUNITS') return parseInt(pairs[k + 1][1], 10);
  return null;
}

// Podział na obiekty: każdy zaczyna się od kodu 0
function readEntities(pairs, out, skipped, warnings) {
  const groups = [];
  for (const p of pairs) {
    if (p[0] === 0) groups.push({ type: p[1].trim(), codes: [] });
    else if (groups.length) groups.at(-1).codes.push([p[0], p[1]]);
  }
  let poly = null; // stara POLYLINE zbierana z kolejnych VERTEX
  for (const g of groups) {
    const get = (code, def) => { const f = g.codes.find(x => x[0] === code); return f ? f[1].trim() : def; };
    const num = (code, def = 0) => parseFloat(get(code, def));
    const layer = get(8, '0');
    if (get(67, '0') === '1') continue; // obszar papieru

    if (poly) {
      if (g.type === 'VERTEX') { poly.pts.push([num(10), num(20), num(42, 0)]); continue; }
      if (g.type === 'SEQEND') { out.push(poly); poly = null; continue; }
      out.push(poly); poly = null; // brak SEQEND — tolerujemy
    }

    switch (g.type) {
      case 'LINE':
        out.push({ type: 'LINE', layer, a: [num(10), num(20)], b: [num(11), num(21)] });
        break;
      case 'LWPOLYLINE': {
        const pts = [];
        for (const [code, val] of g.codes) {
          if (code === 10) pts.push([parseFloat(val), 0, 0]);
          else if (code === 20 && pts.length) pts.at(-1)[1] = parseFloat(val);
          else if (code === 42 && pts.length) pts.at(-1)[2] = parseFloat(val);
        }
        out.push({ type: 'POLY', layer, pts, closed: (parseInt(get(70, '0'), 10) & 1) === 1 });
        break;
      }
      case 'POLYLINE': {
        const flags = parseInt(get(70, '0'), 10);
        if (flags & (8 | 16 | 64)) { warnings.push({ code: 'dxf-polilinia-3d', msg: `Polilinia 3D/siatka na warstwie ${layer} pominięta.` }); poly = null; break; }
        poly = { type: 'POLY', layer, pts: [], closed: (flags & 1) === 1 };
        break;
      }
      case 'CIRCLE':
        out.push({ type: 'CIRCLE', layer, c: [num(10), num(20)], r: num(40) });
        break;
      case 'ARC':
        out.push({ type: 'ARC', layer, c: [num(10), num(20)], r: num(40), a0: num(50), a1: num(51) });
        break;
      case 'POINT':
        out.push({ type: 'POINT', layer, p: [num(10), num(20)] });
        break;
      case 'TEXT': {
        // przy wyrównaniu innym niż domyślne (72/73 != 0) obowiązuje punkt 11/21
        const aligned = (get(72, '0') !== '0' || get(73, '0') !== '0') && get(11) != null;
        out.push({ type: 'TEXT', layer, p: aligned ? [num(11), num(21)] : [num(10), num(20)], text: cleanText(get(1, '')) });
        break;
      }
      case 'MTEXT': {
        const raw = g.codes.filter(x => x[0] === 3).map(x => x[1]).join('') + (get(1, '') ?? '');
        out.push({ type: 'TEXT', layer, p: [num(10), num(20)], text: cleanText(raw) });
        break;
      }
      case 'EOF': case 'SEQEND': case 'VERTEX':
        break;
      default:
        skipped.set(g.type, (skipped.get(g.type) || 0) + 1);
    }
  }
  if (poly) out.push(poly);
}

// Usuwa kody formatowania MTEXT ({\fArial;...}, \P, \A1; itp.) i kody %% tekstu
export function cleanText(s) {
  return s
    .replace(/\\[PpNn~]/g, ' ')
    .replace(/\\[ACcFfHhQqTtWw][^;\\{}]*;/g, '') // kody z parametrem, zakończone średnikiem
    .replace(/\\[LlOoKk]/g, '')                  // przełączniki podkreślenia/nadkreślenia
    .replace(/\\S([^;]*);/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/%%[a-zA-Z0-9]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
