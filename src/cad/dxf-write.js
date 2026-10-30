// Zapis DXF R12 (AC1009, ASCII) — format czytany przez każdy CAD, w tym ZWCAD 2022.
// Obiekty: LINE, POLYLINE/VERTEX/SEQEND, CIRCLE, TEXT; tabele: LTYPE (CONTINUOUS, DASHED), LAYER.
// Współrzędne podawane w metrach, zapisywane w milimetrach ($INSUNITS = 4). Teksty w CP1250
// ($DWGCODEPAGE ANSI_1250) — polskie litery w opisach; średnica zapisywana jako „#” (konwencja projektanta).

const CP1250 = { ą: 0xB9, ć: 0xE6, ę: 0xEA, ł: 0xB3, ń: 0xF1, ó: 0xF3, ś: 0x9C, ź: 0x9F, ż: 0xBF, Ą: 0xA5, Ć: 0xC6, Ę: 0xCA, Ł: 0xA3, Ń: 0xD1, Ó: 0xD3, Ś: 0x8C, Ź: 0x8F, Ż: 0xAF, '·': 0xB7, '×': 0xD7, '°': 0xB0, '—': 0x97, '–': 0x96, '„': 0x84, '”': 0x94 };
export function encodeCp1250(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) { const c = str[i], k = str.charCodeAt(i); out[i] = k < 128 ? k : (CP1250[c] ?? 0x3F); }
  return out;
}

const n = v => (Math.round(v * 1e6) / 1e6).toString(); // bez wykładników i zbędnych cyfr

export class DxfWriter {
  constructor() { this.layers = new Map([['0', { color: 7, ltype: 'CONTINUOUS' }]]); this.ents = []; this.offset = [0, 0]; }
  layer(name, color = 7, ltype = 'CONTINUOUS') { this.layers.set(name, { color, ltype }); return this; }
  // offset [m] — przesunięcie kolejnych obiektów (np. drugi rzut obok pierwszego)
  #mm(p) { return [(p[0] + this.offset[0]) * 1000, (p[1] + this.offset[1]) * 1000]; }
  line(layer, a, b) { const [x1, y1] = this.#mm(a), [x2, y2] = this.#mm(b); this.ents.push(`0\nLINE\n8\n${layer}\n10\n${n(x1)}\n20\n${n(y1)}\n30\n0\n11\n${n(x2)}\n21\n${n(y2)}\n31\n0`); }
  poly(layer, pts, closed = false) {
    const v = pts.map(p => { const [x, y] = this.#mm(p); return `0\nVERTEX\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0`; });
    this.ents.push(`0\nPOLYLINE\n8\n${layer}\n66\n1\n10\n0\n20\n0\n30\n0\n70\n${closed ? 1 : 0}\n${v.join('\n')}\n0\nSEQEND\n8\n${layer}`);
  }
  circle(layer, c, r) { const [x, y] = this.#mm(c); this.ents.push(`0\nCIRCLE\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0\n40\n${n(r * 1000)}`); }
  // h — wysokość tekstu [m]; rot — kąt [°]; align: 'left' | 'center'
  text(layer, p, h, str, rot = 0, align = 'left') {
    const [x, y] = this.#mm(p), al = align === 'center' ? `\n72\n1\n11\n${n(x)}\n21\n${n(y)}\n31\n0` : '';
    this.ents.push(`0\nTEXT\n8\n${layer}\n10\n${n(x)}\n20\n${n(y)}\n30\n0\n40\n${n(h * 1000)}\n1\n${str.replace(/\n/g, ' ')}\n50\n${n(rot)}${al}`);
  }
  toString() {
    const lt = `0\nTABLE\n2\nLTYPE\n70\n2\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n`
      + `0\nLTYPE\n2\nDASHED\n70\n0\n3\n__ __ __\n72\n65\n73\n2\n40\n150.0\n49\n100.0\n49\n-50.0\n0\nENDTAB`;
    const la = `0\nTABLE\n2\nLAYER\n70\n${this.layers.size}\n` + [...this.layers].map(([name, l]) => `0\nLAYER\n2\n${name}\n70\n0\n62\n${l.color}\n6\n${l.ltype}`).join('\n') + '\n0\nENDTAB';
    return ['0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n9\n$DWGCODEPAGE\n3\nANSI_1250\n0\nENDSEC',
      `0\nSECTION\n2\nTABLES\n${lt}\n${la}\n0\nENDSEC`,
      `0\nSECTION\n2\nENTITIES\n${this.ents.join('\n')}\n0\nENDSEC`, '0\nEOF\n'].join('\n');
  }
  toBytes() { return encodeCp1250(this.toString()); }
}
