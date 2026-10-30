// Import geometrii płyty z odczytanego DXF + walidacja (specyfikacja, sekcja 3).
//
// importGeometry(dxf, { scale? }) ->
//   { scale, outline, holes, columns, walls, edges, areaLoads, lineLoads, pointLoads,
//     errors, warnings, info }
// Wszystkie współrzędne w metrach. Lokalizacja błędów (loc) — w jednostkach RYSUNKU,
// żeby dało się ją od razu odnaleźć w CAD.
//
// Błąd (errors) blokuje obliczenia; ostrzeżenie (warnings) nie.

import {
  ccw, signedArea, centroid, inertia, distPointPolyline, classify, selfIntersection,
  boundariesCross, bulgePoints, circlePoints, arcPoints, dist, bbox,
} from './polygon.js';

export const LAYERS = {
  TP_OBRYS: 'obrys', TP_OTWOR: 'otwor', TP_SLUP: 'slup', TP_SCIANA: 'sciana', TP_KRAWEDZ: 'krawedz',
  TP_OBC_POW: 'obcPow', TP_OBC_LIN: 'obcLin', TP_OBC_SKUP: 'obcSkup', TP_INFO: 'info',
};
const PREFIX = { O: 'otwor', S: 'slup', W: 'sciana', K: 'krawedz', Q: 'obcPow', L: 'obcLin', P: 'obcSkup' };
const NAMES = { otwor: 'otwór', slup: 'słup', sciana: 'ściana', krawedz: 'krawędź', obcPow: 'strefa obciążenia', obcLin: 'obciążenie liniowe', obcSkup: 'siła skupiona' };

const TOL = 0.001;        // m — tolerancja geometryczna (zamknięcie, styk, położenie na brzegu)
const ARC_TOL = 0.005;    // m — strzałka cięciwy przy zamianie łuków na odcinki
const LABEL_DIST = 1.5;   // m — maksymalna odległość etykiety od obiektu
const SHORT_SEG = 0.005;  // m — ostrzeżenie o bardzo krótkich odcinkach

export function importGeometry(dxf, opts = {}) {
  const errors = [], warnings = [...dxf.warnings];
  let scale = opts.scale ?? dxf.scaleToMeters;
  if (scale == null) {
    scale = 0.001;
    warnings.push({ code: 'jednostki-zalozone', msg: 'Plik nie zawiera jednostek ($INSUNITS) — przyjęto milimetry. Sprawdź wymiary płyty.' });
  }
  const back = p => [+(p[0] / scale).toFixed(1), +(p[1] / scale).toFixed(1)]; // m -> jednostki rysunku
  const err = (code, msg, loc) => errors.push({ code, msg, loc: loc && back(loc) });
  const warn = (code, msg, loc) => warnings.push({ code, msg, loc: loc && back(loc) });
  const S = p => [p[0] * scale, p[1] * scale];

  // --- 1. Obiekty geometryczne z warstw ---
  const feats = { obrys: [], otwor: [], slup: [], sciana: [], krawedz: [], obcPow: [], obcLin: [], obcSkup: [] };
  const labels = [];
  const unknown = new Map();

  for (const e of dxf.entities) {
    if (e.type === 'TEXT') { labels.push({ text: e.text, p: S(e.p) }); continue; }
    const kind = LAYERS[e.layer.toUpperCase()];
    if (!kind) { unknown.set(e.layer, (unknown.get(e.layer) || 0) + 1); continue; }
    if (kind === 'info') continue;

    const closedKind = ['obrys', 'otwor', 'slup', 'obcPow'].includes(kind);
    if (kind === 'obcSkup') {
      if (e.type === 'POINT') feats.obcSkup.push({ p: S(e.p) });
      else if (e.type === 'CIRCLE') feats.obcSkup.push({ p: S(e.c) });
      else warn('obiekt-pominiety', `${e.type} na warstwie ${e.layer} pominięty — siłę skupioną rysuj jako punkt.`);
      continue;
    }
    if (e.type === 'CIRCLE') {
      const c = S(e.c), r = e.r * scale;
      if (closedKind) feats[kind].push({ pts: circlePoints(c, r, ARC_TOL), circle: { c, r }, closed: true });
      else warn('obiekt-pominiety', `Okrąg na warstwie ${e.layer} pominięty.`, c);
      continue;
    }
    if (e.type === 'POLY') {
      const raw = e.pts.map(([x, y, b]) => [x * scale, y * scale, b]);
      let closed = e.closed;
      if (!closed && raw.length > 2 && dist(raw[0], raw.at(-1)) <= TOL) {
        closed = true; raw.pop();
        if (closedKind) warn('domknieto', `Polilinia na warstwie ${e.layer} nie miała flagi „zamknięta”, ale jej końce się pokrywają — przyjęto jako zamkniętą.`, raw[0]);
      }
      const pts = [];
      const n = raw.length;
      for (let k = 0; k < n; k++) {
        pts.push([raw[k][0], raw[k][1]]);
        if (k < n - 1 || closed) pts.push(...bulgePoints(raw[k], raw[(k + 1) % n], raw[k][2], ARC_TOL));
      }
      if (closedKind && !closed) {
        err(kind === 'obrys' ? 'obrys-niezamkniety' : 'niezamkniety',
          `${kind === 'obrys' ? 'Obrys płyty' : `Obiekt na warstwie ${e.layer}`} nie jest zamknięty (przerwa między punktami początku i końca).`, pts.at(-1));
        continue;
      }
      if (!closedKind && closed) pts.push(pts[0]);
      feats[kind].push({ pts, closed: closedKind });
      continue;
    }
    if (e.type === 'LINE' || e.type === 'ARC') {
      if (closedKind) {
        err(kind === 'obrys' ? 'obrys-z-odcinkow' : 'niezamkniety',
          `${e.type} na warstwie ${e.layer}: ten obiekt musi być jedną zamkniętą polilinią (połącz odcinki poleceniem ŁĄCZ/PEDIT).`, S(e.type === 'LINE' ? e.a : e.c));
        continue;
      }
      const pts = e.type === 'LINE' ? [S(e.a), S(e.b)] : arcPoints(S(e.c), e.r * scale, e.a0, e.a1, ARC_TOL);
      feats[kind].push({ pts, closed: false });
    }
  }
  for (const [layer, n] of unknown)
    warn('nieznana-warstwa', `Warstwa „${layer}” (${n} obiektów) nie jest warstwą TEK-PLYTA — pominięta.`);

  // Orientacja CCW i bardzo krótkie odcinki
  for (const kind of ['obrys', 'otwor', 'slup', 'obcPow']) for (const f of feats[kind]) f.pts = ccw(f.pts);
  for (const [kind, list] of Object.entries(feats)) for (const f of list) if (f.pts) {
    const n = f.pts.length, m = f.closed ? n : n - 1;
    for (let k = 0; k < m; k++) if (dist(f.pts[k], f.pts[(k + 1) % n]) < SHORT_SEG && !f.circle) {
      warn('krotki-odcinek', `Bardzo krótki odcinek (< ${SHORT_SEG * 1000} mm) — ${NAMES[kind] ?? kind}. Sprawdź, czy to nie pomyłka rysunkowa.`, f.pts[k]);
      break;
    }
  }

  // --- 2. Obrys ---
  if (feats.obrys.length === 0 && !errors.some(e => e.code.startsWith('obrys'))) err('brak-obrysu', 'Brak obrysu płyty (warstwa TP_OBRYS).');
  if (feats.obrys.length > 1) err('wiele-obrysow', `Na warstwie TP_OBRYS jest ${feats.obrys.length} zamkniętych polilinii — dozwolona jedna.`, feats.obrys[1].pts[0]);
  const outline = feats.obrys[0]?.pts;
  if (outline) {
    const x = selfIntersection(outline, TOL);
    if (x) err('obrys-samoprzeciecie', 'Obrys płyty przecina sam siebie.', x);
  }

  // --- 3. Etykiety ---
  assignLabels(feats, labels, err, warn);

  // --- 4. Położenie obiektów względem płyty ---
  if (outline) validatePlacement(feats, outline, err, warn);
  if (!feats.slup.length && !feats.sciana.length && !feats.krawedz.length)
    err('brak-podpor', 'Płyta nie ma żadnej podpory (słupy TP_SLUP, ściany TP_SCIANA lub krawędzie TP_KRAWEDZ).');

  // --- 5. Wynik ---
  const holes = feats.otwor.map(f => ({ label: f.label, pts: f.pts }));
  const columns = feats.slup.map(f => columnProps(f));
  const areaSlab = outline ? signedArea(outline) - holes.reduce((s, h) => s + signedArea(h.pts), 0) : 0;
  const bb = outline ? bbox(outline) : null;
  if (bb) {
    const maxDim = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    const dims = `${(bb.maxX - bb.minX).toFixed(2)} × ${(bb.maxY - bb.minY).toFixed(2)} m`;
    if (maxDim < 1 || maxDim > 500)
      err('jednostki-podejrzane', `Płyta ma wymiary ${dims} — to wygląda na złe jednostki rysunku (przyjęto: ${unitLabel(scale)}). Wybierz właściwe jednostki i wczytaj ponownie.`);
  }
  return {
    scale,
    outline,
    holes,
    columns,
    walls: feats.sciana.map(f => ({ label: f.label, pts: f.pts })),
    edges: feats.krawedz.map(f => ({ label: f.label, pts: f.pts })),
    areaLoads: feats.obcPow.map(f => ({ label: f.label, pts: f.pts })),
    lineLoads: feats.obcLin.map(f => ({ label: f.label, pts: f.pts })),
    pointLoads: feats.obcSkup.map(f => ({ label: f.label, p: f.p })),
    errors, warnings,
    info: bb && { width: bb.maxX - bb.minX, height: bb.maxY - bb.minY, area: areaSlab, bbox: bb },
  };
}

function columnProps(f) {
  if (f.circle) {
    const D = 2 * f.circle.r, A = Math.PI * D * D / 4, I = Math.PI * D ** 4 / 64;
    return { label: f.label, pts: f.pts, shape: 'circle', D, A, Ix: I, Iy: I, c: f.circle.c };
  }
  const A = signedArea(f.pts), { Ix, Iy } = inertia(f.pts), c = centroid(f.pts);
  const bb = bbox(f.pts);
  const isRect = f.pts.length === 4 && Math.abs(A - (bb.maxX - bb.minX) * (bb.maxY - bb.minY)) < 1e-9;
  return { label: f.label, pts: f.pts, shape: isRect ? 'rect' : 'poly', bx: bb.maxX - bb.minX, by: bb.maxY - bb.minY, A, Ix, Iy, c };
}

// Etykieta: tekst „S1”, „Q2”… Obiekty zamknięte: etykieta wewnątrz (najmniejszy zawierający)
// albo najbliższy obiekt w odległości ≤ LABEL_DIST. Pozostałe: najbliższy w tej odległości.
function assignLabels(feats, labels, err, warn) {
  const owners = new Map(); // obiekt -> lista etykiet
  for (const lb of labels) {
    const m = /^([OSWKQLP])\s*(\d+)$/i.exec(lb.text.replace(/\s+/g, ''));
    if (!m) continue;
    const kind = PREFIX[m[1].toUpperCase()], text = m[1].toUpperCase() + Number(m[2]);
    const list = feats[kind];
    let best = null, bestD = Infinity;
    for (const f of list) {
      let d;
      if (f.p) d = dist(lb.p, f.p);
      else if (f.closed && classify(lb.p, f.pts, 0) === 'in') d = -1 / Math.abs(signedArea(f.pts)); // wewnątrz: mniejszy wygrywa
      else d = distPointPolyline(lb.p, f.pts, f.closed);
      if (d < bestD) { bestD = d; best = f; }
    }
    if (!best || bestD > LABEL_DIST) { warn('etykieta-bez-obiektu', `Etykieta ${text} nie leży przy żadnym obiekcie typu „${NAMES[kind]}” (≤ ${LABEL_DIST} m).`, lb.p); continue; }
    if (!owners.has(best)) owners.set(best, []);
    owners.get(best).push({ text, p: lb.p });
  }
  const used = new Map();
  for (const kind of Object.values(PREFIX)) {
    const list = feats[kind];
    let auto = 0;
    list.forEach((f, i) => {
      const own = owners.get(f) || [];
      const loc = f.p ?? f.pts[0];
      const distinct = [...new Set(own.map(o => o.text))];
      if (distinct.length > 1) err('wiele-etykiet', `${cap(NAMES[kind])} ma kilka etykiet: ${distinct.join(', ')}.`, loc);
      if (distinct.length === 0) {
        if (kind === 'otwor') { f.label = `O_${++auto}`; return; } // otwory nie niosą danych
        err('brak-etykiety', `${cap(NAMES[kind])} bez etykiety (np. ${Object.keys(PREFIX).find(k => PREFIX[k] === kind)}${i + 1}) — program nie przypisze mu danych.`, loc);
        f.label = null;
        return;
      }
      f.label = distinct[0];
      if (used.has(f.label)) err('zdublowana-etykieta', `Etykieta ${f.label} użyta dla dwóch obiektów.`, loc);
      used.set(f.label, f);
    });
  }
}

function validatePlacement(feats, outline, err, warn) {
  const inSlab = p => classify(p, outline, TOL) !== 'out';
  const label = f => f.label ?? '(bez etykiety)';

  for (const h of feats.otwor) {
    const x = boundariesCross(h.pts, true, outline, true, TOL);
    if (x) err('otwor-przecina-obrys', `Otwór ${label(h)} przecina obrys płyty — narysuj go jako wcięcie obrysu albo w całości wewnątrz.`, x);
    else if (!h.pts.every(p => classify(p, outline, TOL) === 'in')) err('otwor-poza-plyta', `Otwór ${label(h)} leży poza płytą lub dotyka obrysu.`, h.pts[0]);
  }
  pairwiseOverlap(feats.otwor, (a, b, x) => err('otwory-nachodza', `Otwory ${label(a)} i ${label(b)} nachodzą na siebie.`, x));

  for (const s of feats.slup) {
    const x = boundariesCross(s.pts, true, outline, true, TOL);
    if (x || !s.pts.every(inSlab)) {
      err('slup-poza-plyta', `Słup ${label(s)} leży poza obrysem płyty lub z niego wychodzi (w v1 słup musi leżeć w obrysie; może stykać się z krawędzią).`, x || s.pts[0]);
      continue;
    }
    for (const h of feats.otwor) {
      const y = boundariesCross(s.pts, true, h.pts, true, TOL);
      if (y || s.pts.some(p => classify(p, h.pts, TOL) === 'in')) err('slup-w-otworze', `Słup ${label(s)} nachodzi na otwór ${label(h)}.`, y || s.pts[0]);
    }
  }
  pairwiseOverlap(feats.slup, (a, b, x) => err('slupy-nachodza', `Słupy ${label(a)} i ${label(b)} nachodzą na siebie.`, x));

  for (const k of feats.krawedz) {
    const off = k.pts.find(p => distPointPolyline(p, outline, true) > TOL);
    if (off) err('krawedz-poza-obrysem', `Krawędź ${label(k)} nie leży na obrysie płyty (rysuj ją po krawędzi obrysu).`, off);
  }
  for (const w of feats.sciana) if (!w.pts.every(inSlab)) warn('sciana-poza-plyta', `Ściana ${label(w)} częściowo poza płytą — liczona tylko część pod płytą.`, w.pts.find(p => !inSlab(p)));
  for (const q of feats.obcPow) {
    if (q.pts.every(p => classify(p, outline, TOL) === 'out') && !boundariesCross(q.pts, true, outline, true, TOL))
      err('strefa-poza-plyta', `Strefa obciążenia ${label(q)} leży poza płytą.`, q.pts[0]);
    else if (!q.pts.every(inSlab)) warn('strefa-wychodzi-poza-obrys', `Strefa ${label(q)} wychodzi poza obrys — obciążona tylko część na płycie.`, q.pts.find(p => !inSlab(p)));
  }
  for (const l of feats.obcLin) if (!l.pts.every(inSlab)) warn('obciazenie-poza-plyta', `Obciążenie liniowe ${label(l)} częściowo poza płytą.`, l.pts.find(p => !inSlab(p)));
  // Prawie-styki: koniec ściany / linii obciążenia 1–50 mm od krawędzi płyty lub otworu.
  // Siatka zadziała, ale powstaną bardzo wąskie elementy — lepiej przyciągnąć punkt w CAD.
  const bounds = [outline, ...feats.otwor.map(h => h.pts)];
  for (const f of [...feats.sciana, ...feats.obcLin]) for (const p of [f.pts[0], f.pts.at(-1)]) {
    const d = Math.min(...bounds.map(b => distPointPolyline(p, b, true)));
    if (d > TOL && d < 0.05) warn('prawie-styk', `Koniec obiektu ${label(f)} leży ${(d * 1000).toFixed(0)} mm od krawędzi — przyciągnij go do krawędzi (tryb lokalizacji) albo odsuń wyraźnie.`, p);
  }
  for (const s of feats.slup) {
    const d = Math.min(...s.pts.map(p => Math.min(...bounds.map(b => distPointPolyline(p, b, true)))));
    if (d > TOL && d < 0.05) warn('prawie-styk', `Słup ${label(s)} leży ${(d * 1000).toFixed(0)} mm od krawędzi — przyciągnij go do krawędzi albo odsuń wyraźnie.`, s.pts[0]);
  }
  for (const p of feats.obcSkup) {
    const inHole = feats.otwor.some(h => classify(p.p, h.pts, TOL) === 'in');
    if (!inSlab(p.p) || inHole) err('sila-poza-plyta', `Siła skupiona ${label(p)} poza płytą lub w otworze.`, p.p);
  }
}

function pairwiseOverlap(list, report) {
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    const x = boundariesCross(a.pts, true, b.pts, true, TOL);
    const inside = a.pts.some(p => classify(p, b.pts, TOL) === 'in') || b.pts.some(p => classify(p, a.pts, TOL) === 'in');
    if (x || inside) report(a, b, x || a.pts[0]);
  }
}

const cap = s => s[0].toUpperCase() + s.slice(1);

const unitLabel = s => ({ 0.001: 'mm', 0.01: 'cm', 1: 'm', 0.0254: 'cale', 0.3048: 'stopy' })[s] ?? `skala ${s}`;
