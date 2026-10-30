// Analiza płyty z geometrii DXF: podpory, przypadki obciążeń, reakcje podpór.
//
// analyzeSlab(geo, mesh, data) -> { model, cases: Map(nazwa -> wynik), supports, warnings }
//
// data = {
//   slab:    { E [kPa], nu, t [m], gamma = 25 [kN/m3], element = 'DKT' },
//   columns: { domyślne: { E, H, bottom: 'fixed'|'pinned', Habove?, rigid? }, S1: { … nadpisania } },
//   walls:   { domyślne: { E, t, H, bottom: 'free'|'pinned'|'fixed', rigid? }, W1: { … } },
//   edges:   { domyślne: { type: 'pinned'|'fixed' }, K1: { … } },
//   loads:   { Q1: kN/m2, L1: kN/m, P1: kN },
//   selfWeight: true
// }
//
// Model słupa (granica modelu — opis w raporcie):
//   • sprężyny pionowe rozłożone na węzły w obrysie słupa proporcjonalnie do pola: Σk = E·A/H;
//   • obrót: sprężyny pionowe dają już parę sił o sztywności ≈ E·I/H; dokładamy sprężyny obrotowe,
//     żeby suma = c·E·I/H (+ 4·E·I/H_powyżej), c = 4 (dół utwierdzony) lub 3 (przegub).
// Ściana: sprężyny pionowe E·t/H na metr, obrót wokół osi ściany c·E·(t³/12)/H na metr.
// Krawędź K: przegub (w = 0) albo utwierdzenie (w = 0, oba obroty = 0).

import { buildModel } from '../model.js';
import { dist } from '../geometry/polygon.js';

const pick = (group, label) => ({ ...(group?.['domyślne'] ?? {}), ...(group?.[label] ?? {}) });
const triArea = (n, e) => { const [a, b, c] = e.map(i => n[i]); return ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; };

export function analyzeSlab(geo, mesh, data) {
  const { nodes, elems, tags } = mesh;
  const warnings = [];
  const fix = new Map();
  const springAcc = new Map(); // węzeł -> { kw, ktx, kty, ktxy }
  const spring = n => { if (!springAcc.has(n)) springAcc.set(n, { node: n, kw: 0, ktx: 0, kty: 0, ktxy: 0 }); return springAcc.get(n); };
  const supports = []; // { label, kind, nodes }
  // Udział podpór w węźle (do podziału reakcji, gdy węzeł należy do kilku podpór)
  const share = new Map(); // węzeł -> Map(etykieta -> { kw, fixed })
  const note = (n, label, kw, fixed) => {
    if (!share.has(n)) share.set(n, new Map());
    const m = share.get(n), o = m.get(label) ?? { kw: 0, fixed: false };
    o.kw += kw; o.fixed ||= fixed; m.set(label, o);
  };
  const fixNode = (n, f, label) => { fix.set(n, { ...(fix.get(n) ?? {}), ...f }); note(n, label, 0, true); };

  // --- Słupy ---
  for (const c of geo.columns) {
    const d = pick(data.columns, c.label);
    const els = tags.regions.get(c.label) ?? [];
    if (!els.length) throw new Error(`Słup ${c.label}: brak elementów siatki w obrysie słupa.`);
    const Ai = new Map();
    for (const ie of els) { const a = triArea(nodes, elems[ie]) / 3; for (const n of elems[ie]) Ai.set(n, (Ai.get(n) ?? 0) + a); }
    supports.push({ label: c.label, kind: 'slup', nodes: [...Ai.keys()], c: c.c });
    if (d.rigid) { for (const n of Ai.keys()) fixNode(n, { w: true }, c.label); continue; }
    if (!(d.E > 0 && d.H > 0)) throw new Error(`Słup ${c.label}: podaj E i H (albo „podpora sztywna”).`);
    const cBot = d.bottom === 'pinned' ? 3 : 4;
    const Amesh = [...Ai.values()].reduce((s, v) => s + v, 0);
    let kvx = 0, kvy = 0;
    for (const [n, a] of Ai) {
      const kw = d.E / d.H * a * (c.A / Amesh);
      spring(n).kw += kw; note(n, c.label, kw, false);
      kvx += kw * (nodes[n][1] - c.c[1]) ** 2;
      kvy += kw * (nodes[n][0] - c.c[0]) ** 2;
    }
    const target = I => cBot * d.E * I / d.H + (d.Habove ? 4 * d.E * I / d.Habove : 0);
    const exX = target(c.Ix) - kvx, exY = target(c.Iy) - kvy;
    if (exX < 0 || exY < 0)
      warnings.push({ code: 'slup-sztywnosc-obrotowa', msg: `Słup ${c.label}: siatka w obrysie słupa za rzadka — sztywność obrotowa zawyżona o ${(100 * Math.max(-exX / target(c.Ix), -exY / target(c.Iy))).toFixed(0)} %. Zagęść siatkę przy słupach.` });
    for (const [n, a] of Ai) {
      spring(n).ktx += Math.max(0, exX) * a / Amesh;
      spring(n).kty += Math.max(0, exY) * a / Amesh;
    }
    // podsumowanie sztywności słupa (do raportu i testów)
    supports.at(-1).stiffness = { kw: d.E * c.A / d.H, kRotX: kvx + Math.max(0, exX), kRotY: kvy + Math.max(0, exY) };
  }

  // --- Ściany ---
  for (const w of geo.walls) {
    const d = pick(data.walls, w.label);
    const segs = tags.segments.get(w.label) ?? [];
    const nset = new Set();
    for (const [i, j] of segs) {
      const L = dist(nodes[i], nodes[j]);
      const dx = (nodes[j][0] - nodes[i][0]) / L, dy = (nodes[j][1] - nodes[i][1]) / L;
      for (const n of [i, j]) {
        nset.add(n);
        if (d.rigid) continue;
        if (!(d.E > 0 && d.H > 0 && d.t > 0)) throw new Error(`Ściana ${w.label}: podaj E, t, H (albo „podpora sztywna”).`);
        const c = d.bottom === 'fixed' ? 4 : d.bottom === 'pinned' ? 3 : 0;
        const kRot = c * d.E * d.t ** 3 / 12 / d.H * L / 2;
        const sp = spring(n);
        sp.kw += d.E * d.t / d.H * L / 2; note(n, w.label, d.E * d.t / d.H * L / 2, false);
        // obrót wokół osi ściany: macierz kRot · g gᵀ, g = kierunek ściany (dx, dy)
        sp.ktx += kRot * dx * dx; sp.kty += kRot * dy * dy; sp.ktxy += kRot * dx * dy;
      }
    }
    if (d.rigid) for (const n of nset) fixNode(n, { w: true }, w.label);
    supports.push({ label: w.label, kind: 'sciana', nodes: [...nset] });
  }

  // --- Krawędzie podparte ---
  for (const k of geo.edges) {
    const d = pick(data.edges, k.label);
    const nset = new Set((tags.segments.get(k.label) ?? []).flat());
    for (const n of nset) fixNode(n, d.type === 'fixed' ? { w: true, tx: true, ty: true } : { w: true }, k.label);
    supports.push({ label: k.label, kind: 'krawedz', nodes: [...nset] });
  }

  const s = data.slab;
  const model = buildModel({ nodes, elems, mat: { E: s.E, nu: s.nu, t: s.t }, fix, springs: [...springAcc.values()], element: s.element ?? 'DKT' });

  // --- Przypadki obciążeń: ciężar własny + każda etykieta Q/L/P osobno ---
  const caseDefs = [];
  if (data.selfWeight !== false) caseDefs.push({ name: 'G0', q: (s.gamma ?? 25) * s.t, point: [] });
  for (const q of geo.areaLoads) {
    const v = data.loads?.[q.label];
    if (v == null) { warnings.push({ code: 'brak-wartosci', msg: `Strefa ${q.label} bez wartości obciążenia — pominięta.` }); continue; }
    const inZone = new Uint8Array(elems.length);
    for (const ie of tags.regions.get(q.label) ?? []) inZone[ie] = 1;
    caseDefs.push({ name: q.label, q: ie => (inZone[ie] ? v : 0), point: [] });
  }
  for (const l of geo.lineLoads) {
    const v = data.loads?.[l.label];
    if (v == null) { warnings.push({ code: 'brak-wartosci', msg: `Obciążenie ${l.label} bez wartości — pominięte.` }); continue; }
    const P = new Map();
    for (const [i, j] of tags.segments.get(l.label) ?? []) {
      const half = v * dist(nodes[i], nodes[j]) / 2;
      P.set(i, (P.get(i) ?? 0) + half); P.set(j, (P.get(j) ?? 0) + half);
    }
    caseDefs.push({ name: l.label, q: 0, point: [...P].map(([node, p]) => ({ node, P: p })) });
  }
  for (const p of geo.pointLoads) {
    const v = data.loads?.[p.label];
    if (v == null) { warnings.push({ code: 'brak-wartosci', msg: `Siła ${p.label} bez wartości — pominięta.` }); continue; }
    caseDefs.push({ name: p.label, q: 0, point: [{ node: tags.points.get(p.label), P: v }] });
  }

  const cases = new Map();
  for (const cd of caseDefs) {
    const r = model.solveCase({ q: cd.q, point: cd.point });
    r.supportReactions = supports.map(sup => supportReaction(sup, r, nodes, share));
    cases.set(cd.name, r);
  }
  return { model, cases, supports, warnings };
}

// Udział podpory w reakcji węzła: węzeł zablokowany należy do podpór blokujących (po równo),
// węzeł na sprężynach — proporcjonalnie do ich sztywności (to samo ugięcie => siła ~ k).
function weight(share, n, label) {
  const m = share.get(n);
  if (!m || !m.has(label)) return 0;
  const fixed = [...m.values()].filter(o => o.fixed).length;
  if (fixed) return m.get(label).fixed ? 1 / fixed : 0;
  const sum = [...m.values()].reduce((s, o) => s + o.kw, 0);
  return sum > 0 ? m.get(label).kw / sum : 0;
}

// Reakcja podpory: siła pionowa V (dodatnia = ściskanie podpory) i moment z pary sił względem środka
function supportReaction(sup, r, nodes, share) {
  let V = 0, Mx = 0, My = 0;
  const c = sup.c ?? sup.nodes.reduce((a, n) => [a[0] + nodes[n][0] / sup.nodes.length, a[1] + nodes[n][1] / sup.nodes.length], [0, 0]);
  for (const n of sup.nodes) {
    const Rw = -r.R[3 * n] * weight(share, n, sup.label);
    V += Rw;
    Mx += Rw * (nodes[n][1] - c[1]);
    My += -Rw * (nodes[n][0] - c[0]);
  }
  return { label: sup.label, kind: sup.kind, V, Mx, My };
}
