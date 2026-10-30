// Rysuje siatkę do pliku SVG (narzędzie do kontroli wizualnej).
// node tools/plot-mesh.mjs plik.dxf wynik.svg [h0]
import { readFileSync, writeFileSync } from 'node:fs';
import { readDxf } from '../src/dxf/read.js';
import { importGeometry } from '../src/geometry/import.js';
import { generateMesh } from '../src/mesh/mesher.js';

const [, , inp, out, h0arg] = process.argv;
const geo = importGeometry(readDxf(readFileSync(inp, 'latin1')));
if (geo.errors.length) { console.error(geo.errors); process.exit(1); }
const t0 = performance.now();
const m = generateMesh(geo, { h0: Number(h0arg || 0.5) });
const dt = performance.now() - t0;
console.log({ ...m.quality, czas_ms: Math.round(dt), poleGeometrii: geo.info.area });
const { minX, minY, maxX, maxY } = geo.info.bbox, W = 1400, s = W / (maxX - minX + 2), H = (maxY - minY + 2) * s;
const X = x => (x - minX + 1) * s, Y = y => H - (y - minY + 1) * s;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H.toFixed(0)}" style="background:#fff">`;
for (const [i, j, k] of m.elems) svg += `<path d="M${X(m.nodes[i][0])} ${Y(m.nodes[i][1])}L${X(m.nodes[j][0])} ${Y(m.nodes[j][1])}L${X(m.nodes[k][0])} ${Y(m.nodes[k][1])}Z" fill="none" stroke="#99a" stroke-width="0.5"/>`;
const colors = { obrys: '#000', S: '#d00', W: '#080', K: '#0aa', Q: '#00c', L: '#e80', O: '#a0a' };
for (const [tag, segs] of m.tags.segments) for (const [i, j] of segs)
  svg += `<line x1="${X(m.nodes[i][0])}" y1="${Y(m.nodes[i][1])}" x2="${X(m.nodes[j][0])}" y2="${Y(m.nodes[j][1])}" stroke="${colors[tag] ?? colors[tag[0]] ?? '#888'}" stroke-width="1.6"/>`;
for (const [tag, n] of m.tags.points) svg += `<circle cx="${X(m.nodes[n][0])}" cy="${Y(m.nodes[n][1])}" r="4" fill="#e80"/>`;
writeFileSync(out, svg + '</svg>');
