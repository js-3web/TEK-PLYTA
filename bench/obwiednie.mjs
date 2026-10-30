// Pomiar: obwiednie dla stropu rzędu 30 tys. węzłów, 2 przypadki G + 10 stref Q w 3 kategoriach.
import { buildSchemes, envelope } from '../src/combinations.js';

const N = 30000, names = ['G0', 'G1', ...Array.from({ length: 10 }, (_, i) => `Q${i + 1}`)];
const cats = ['B', 'B', 'B', 'B', 'C', 'C', 'C', 'E', 'E', 'E'];
const actions = { G0: { type: 'G' }, G1: { type: 'G' } };
cats.forEach((c, i) => { actions[`Q${i + 1}`] = { type: 'Q', category: c }; });
const fields = names.map(() => Float64Array.from({ length: N }, () => Math.random() * 2 - 1));
const s = buildSchemes(names, actions);
const t0 = performance.now();
for (const key of ['ULS', 'CHAR', 'FREQ', 'QP']) for (let q = 0; q < 4; q++) envelope(fields, s[key]); // w, mx, my, mxy
console.log(`${N} węzłów × 4 wielkości × 4 schematy, ${names.length} przypadków (2^10 układów stref): ${(performance.now() - t0).toFixed(0)} ms`);
