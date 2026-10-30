// TEK-PŁYTA — aplikacja (wątek główny). Szata linii TEKTORIA wg TEK-AUDYTOR v0.7.
// Zakładki: Start · 1. Geometria · 2. Dane · 3. Obliczenia · 4. Wyniki · 5. Zbrojenie · 6. Rysunek ·
// 7. Raport · 8. AI · Podstawy · O programie. Obliczenia w Web Workerze (worker.js).

import { defaultProject, loadGeometry, VERSION, meshArea } from '../../src/app/pipeline.js';
import { CONCRETE, STEEL, NORM as EC2 } from '../../src/norms/en1992-pl.js';
import { PSI, NORM as EC0 } from '../../src/norms/en1990-pl.js';
import { WMAX } from '../../src/design/sls.js';
import { resolveParams, defaultParams, diffParams, PARAM_INFO } from '../../src/norms/params.js';
import { buildReport, renderHTML, renderDOCX, LIMITS } from '../../src/report/report.js';
import { ProjectDB, exportProjectFile, importProjectFile } from '../../src/app/db.js';
import { buildAIPackage, parseAIReview } from '../../src/app/ai.js';
import { rebarDrawing } from '../../src/cad/drawing.js';
import { readDxf } from '../../src/dxf/read.js';
import { View, bboxOf, clear, drawGeometry, drawMesh, drawMap, nearestNode, drawDxf, drawIsolines, drawExtrema, drawSection, robotLegend } from './render.js';
import { makeScale, isolines, extrema, sectionProfile, locator } from '../../src/viz/maps.js';
import { envelope, combine } from '../../src/combinations.js';
import { isNative, saveFile, openFile, loadDbBytes, saveDbBytes } from './storage.js';
import { checkLicense } from './license.js';
import { produkt, ikona, tektoriaCiemne } from './logos.js';
import initSqlJs from 'sql.js/dist/sql-wasm.js';

const $ = s => document.querySelector(s);
const S = {
  project: defaultProject(), geo: null, dxfName: null, res: null, stale: true, tab: 'start', mapKey: 'q:mx', rebarLayer: 'topY',
  // opcje mapy (jak w Robocie): źródło, skala automatyczna/ręczna, pasma, izolinie, ekstrema, siatka
  vopt: { src: 'env:ULS:max', auto: true, min: null, max: null, bands: 16, sym: false, smooth: false, iso: true, ext: true, mesh: false }, secSel: 0,
  db: null, dbWhere: '', ids: { projectId: null, variantId: null, variantName: 'wariant 1' }, review: [], pick: null, hl: null,
  license: { ok: false, msg: '' }, drawing: null, hiddenLayers: new Set(),
};
const fmt = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).replace('.', ',') : '—');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = `toast show${bad ? ' zly' : ''}`; clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2600); }

// ---------- dane projektu: ścieżki „a.b.c” ----------
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; }
const UNIT = { mm: [v => v * 1000, v => v / 1000], num: [v => v, v => v] };
function inp(path, unit = 'num', attrs = '') { const v = getPath(S.project, path), [show] = UNIT[unit]; return `<input type="number" step="any" data-path="${path}" data-unit="${unit}" value="${v == null ? '' : +show(v).toPrecision(6)}" ${attrs}>`; }
function sel(path, options, attrs = '') { const v = getPath(S.project, path); return `<select data-path="${path}" data-unit="str" ${attrs}>${options.map(([val, t]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(t ?? val)}</option>`).join('')}</select>`; }
const txt = (path, attrs = '') => `<input type="text" data-path="${path}" data-unit="str" value="${esc(getPath(S.project, path))}" ${attrs}>`;
const chk = path => `<input type="checkbox" data-path="${path}" data-unit="bool" ${getPath(S.project, path) ? 'checked' : ''}>`;

document.addEventListener('change', e => {
  const el = e.target, path = el.dataset?.path;
  if (!path) return;
  let v;
  if (el.dataset.unit === 'bool') v = el.checked;
  else if (el.dataset.unit === 'str') v = el.value;
  else { const n = parseFloat(String(el.value).replace(',', '.')); v = Number.isFinite(n) ? UNIT[el.dataset.unit][1](n) : null; }
  setPath(S.project, path, v);
  if (!path.startsWith('meta.')) markStale(); // dane opisowe nie zmieniają wyników
  if (el.dataset.rerender || path.startsWith('norms.')) { render({ bar: false }); updateName(); } // bez paska: kliknięcie zakładki po zmianie pola nie ginie
  else updateName(); // nie przebudowujemy paska: zmiana (blur) przy kliknięciu zakładki podmieniałaby przycisk pod kursorem
});
function markStale() { if (S.res) { S.stale = true; S.drawing = null; } }

// ---------- pasek aplikacji ----------
const TABS = [['start', 'START', 'home'], ['geo', '1. Geometria'], ['data', '2. Dane'], ['calc', '3. Obliczenia'], ['res', '4. Wyniki'],
  ['rebar', '5. Zbrojenie'], ['draw', '6. Rysunek'], ['report', '7. Raport'], ['ai', '8. AI'], ['podstawy', 'Podstawy'], ['info', 'O programie']];
const needs = { data: () => S.geo, calc: () => S.geo, res: () => S.res?.ok, rebar: () => S.res?.ok, draw: () => S.res?.ok, report: () => S.res?.ok, ai: () => S.res?.ok };
const nameHTML = () => (S.geo ? `<b>${esc(S.project.meta.name || 'projekt')}</b> · ${S.res ? (S.stale ? 'do przeliczenia' : 'policzony') : 'niepoliczony'}${S.license.ok ? '' : ' · bez licencji'}` : '');
function renderBar() {
  $('#brand').innerHTML = ikona();
  $('#tabs').innerHTML = TABS.map(([id, label, cls]) => `<button class="tab ${cls ?? ''} ${S.tab === id ? 'on' : ''}" data-tab="${id}" ${needs[id] && !needs[id]() ? 'disabled' : ''}>${label}</button>`).join('')
    + `<span class="pnazwa" title="Projekt">${nameHTML()}</span>`;
  $('#marka').innerHTML = tektoriaCiemne;
}
function updateName() { const n = $('.pnazwa'); if (n) n.innerHTML = nameHTML(); }
document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]'); if (!t || t.disabled) return;
  S.tab = t.dataset.tab; render();
});

// ---------- widoki ----------
const work = (side, stage = true) => `<div class="work"><div class="side">${side}</div>${stage ? '<div class="card stage"><canvas id="cv"></canvas><div id="legend" class="legend"></div><div id="readout" class="readout"></div></div>' : ''}</div>`;
const card = (title, body, cls = '') => `<div class="card ${cls}"><h2>${title}</h2>${body}</div>`;
const stat = (ok, okT = 'OK', badT = 'przekroczone') => `<span class="stat ${ok ? 'ok' : 'uw'}">${ok ? okT : badT}</span>`;

const VIEWS = {
  start() {
    const list = S.db ? S.db.list(VERSION) : [];
    const projects = list.length ? list.map(p => `<div class="proj"><div><div class="pt">${esc(p.nazwa)}</div><div class="pd">${esc(p.obiekt)}${p.inwestor ? ` · ${esc(p.inwestor)}` : ''}</div></div>
      <div class="pd">${p.warianty.map(w => `${esc(w.nazwa)} <span class="stat ${w.status === 'aktualne' ? 'ok' : w.status === 'do przeliczenia' ? 'cz' : ''}">${w.status}</span>`).join('<br>')}</div>
      <div class="pa">${p.warianty.map(w => `<button class="btn sm" data-act="loadVariant" data-id="${w.id}">otwórz: ${esc(w.nazwa)}</button><button class="btn sm danger" data-act="delVariant" data-id="${w.id}" title="usuń wariant">×</button>`).join('')}
      <button class="btn sm danger" data-act="delProject" data-id="${p.id}">usuń projekt</button></div></div>`).join('')
      : '<div class="pusto"><b>Brak zapisanych projektów</b>Zacznij od nowego projektu — wczytaj rysunek płyty w DXF.</div>';
    return `<div class="home"><section class="hero"><div class="hl">${produkt()}</div>
      <div class="tag">MES płyt żelbetowych · PN-EN 1992-1-1 + NA</div>
      <div class="meta"><span class="hv">v${VERSION}</span><span class="dot">•</span><span>DKT · Wood–Armer · przebicie · ugięcia 7.4.3 · dobór prętów · DXF</span></div>
      <div class="hm">${tektoriaCiemne}</div></section>
      <div class="sec-h"><span>Projekty</span><div class="btns"><button class="btn primary" data-act="newProject">Nowy projekt</button><button class="btn" data-act="importFile">Import .tekplyta</button></div></div>
      <div class="plist">${projects}</div>
      <p class="hint">Baza projektów: ${esc(S.dbWhere || 'niedostępna')}</p>
      <div class="sec-h"><span>Moduły</span></div>
      <div class="tiles">${[['1. Geometria', 'Wzorzec DXF, kontrola rysunku z lokalizacją błędów', 'sekcja 3'], ['2. Dane', 'Beton, stal, siatki, obciążenia z kategoriami, podpory sprężyste', 'PN-EN 1990, 1991-1-1'],
        ['3. Obliczenia', 'Siatka zagęszczana, MES DKT, kombinacje i obwiednie', 'Web Worker'], ['4. Wyniki', 'Ugięcia, momenty, siły poprzeczne, SGU, naprężenia', 'mapy'],
        ['5. Zbrojenie', 'Dobór prętów #ϕ co s, strefy, przebicie 9.4.3, ścinanie 6.2.2', 'PN-EN 1992-1-1'], ['6. Rysunek', 'DXF dla ZWCAD: rzut dolny i górny, opisy prętów', 'R12'],
        ['7. Raport', 'PDF i DOCX z punktami normy', 'załącznik obliczeniowy'], ['8. AI', 'Paczka do sprawdzenia, import uwag', 'offline']].map(([b, s, i]) => `<div class="tile"><b>${b}</b><span>${s}</span><br><i>${i}</i></div>`).join('')}</div>
      <div class="legal">Program wspomaga projektanta. Za założenia, dane i wykorzystanie wyników odpowiada projektant z uprawnieniami budowlanymi (art. 20 ustawy Prawo budowlane). Opinia narzędzia AI nie jest sprawdzeniem projektu.</div></div>`;
  },

  geo() {
    const g = S.geo;
    let h = card('Rysunek DXF', `<p class="hint">Narysuj płytę w ZWCAD na warstwach wzorca (jednostki mm), zapisz jako DXF 2010 i wczytaj.</p>
      <div class="btns"><button class="btn" data-act="template">Pobierz wzorzec DXF</button><button class="btn primary" data-act="openDxf">Wczytaj DXF</button></div>
      ${S.dxfName ? `<p class="sm muted">Plik: <code>${esc(S.dxfName)}</code></p>` : ''}`);
    if (!g) return work(h);
    h += card('Zawartość', `<table class="mini"><tr><td>Pole płyty</td><td class="num">${fmt(g.info?.area)} m²</td></tr>
      <tr><td>Otwory / słupy / ściany / krawędzie</td><td class="num">${g.holes.length} / ${g.columns.length} / ${g.walls.length} / ${g.edges.length}</td></tr>
      <tr><td>Obciążenia: strefy / liniowe / skupione</td><td class="num">${g.areaLoads.length} / ${g.lineLoads.length} / ${g.pointLoads.length}</td></tr></table>`);
    let m = '';
    if (!g.errors.length && !g.warnings.length) m += '<div class="msg ok">Bez błędów i ostrzeżeń.</div>';
    g.errors.forEach((e, i) => { m += `<div class="msg err" data-act="hl" data-i="e${i}">${esc(e.msg)}${e.loc ? ` <span class="muted">(X=${fmt(e.loc[0], 1)} Y=${fmt(e.loc[1], 1)})</span>` : ''}</div>`; });
    g.warnings.forEach((e, i) => { m += `<div class="msg warn" data-act="hl" data-i="w${i}">${esc(e.msg)}${e.loc ? ` <span class="muted">(X=${fmt(e.loc[0], 1)} Y=${fmt(e.loc[1], 1)})</span>` : ''}</div>`; });
    if (g.errors.length) m += '<p class="sm" style="color:var(--danger)">Błędy krytyczne blokują obliczenia — popraw rysunek i wczytaj ponownie.</p>';
    return work(h + card('Kontrola rysunku', m));
  },

  data() {
    const g = S.geo, P = S.project;
    const concrete = Object.keys(CONCRETE).map(k => [k]), steel = Object.keys(STEEL).map(k => [k]);
    let h = card('Płyta', `<div class="form"><span>Grubość h [mm]</span>${inp('slab.h', 'mm')}<span>Beton</span>${sel('slab.concrete', concrete)}<span>Stal</span>${sel('slab.steel', steel)}<span>Ciężar betonu [kN/m³]</span>${inp('slab.gamma')}</div>`);
    let r = `<div class="form"><span>Otulina dół / góra [mm]</span><span>${inp('reinf.cover.bottom', 'mm')} ${inp('reinf.cover.top', 'mm')}</span>`;
    for (const [face, name] of [['bottom', 'Dół'], ['top', 'Góra']]) {
      const x = P.reinf[face];
      r += `<span>${name} x: # / co [mm]</span><span>${inp(`reinf.${face}.phiX`, 'mm')} ${inp(`reinf.${face}.sX`, 'mm')} <span class="sm muted">${fmt(meshArea(x.phiX, x.sX), 0)} mm²/m</span></span>
        <span>${name} y: # / co [mm]</span><span>${inp(`reinf.${face}.phiY`, 'mm')} ${inp(`reinf.${face}.sY`, 'mm')} <span class="sm muted">${fmt(meshArea(x.phiY, x.sY), 0)} mm²/m</span></span>
        <span>${name}: warstwa zewnętrzna</span>${sel(`reinf.${face}.outer`, [['x', 'pręty x'], ['y', 'pręty y']])}`;
    }
    h += card('Zbrojenie podstawowe (siatki)', r + '</div><p class="hint">Program dobiera pręty dodatkowe w rozstawie siatki (zakładka 5. Zbrojenie).</p>');
    const labels = [...g.areaLoads.map(o => [o.label, 'kN/m²']), ...g.lineLoads.map(o => [o.label, 'kN/m']), ...g.pointLoads.map(o => [o.label, 'kN'])];
    const cats = Object.entries(PSI).map(([k, v]) => [k, `${k} — ${v.opis.replace(/^kat\. \w — /, '')}`]);
    let l = '<table class="mini"><tr><th>Etykieta</th><th>Wartość</th><th>Typ</th><th>Kategoria</th></tr>';
    for (const [lb, unit] of labels) {
      P.loads[lb] ??= { value: null, type: lb.startsWith('L') ? 'G' : 'Q', category: 'B' };
      l += `<tr><td><code>${lb}</code></td><td>${inp(`loads.${lb}.value`)} <span class="sm muted">${unit}</span></td>
        <td>${sel(`loads.${lb}.type`, [['G', 'stałe G'], ['Q', 'zmienne Q']], 'data-rerender="1"')}</td><td>${P.loads[lb].type === 'Q' ? sel(`loads.${lb}.category`, cats) : '—'}</td></tr>`;
    }
    h += card('Obciążenia <small>wartości charakterystyczne</small>', l + '</table><p class="hint">Ciężar własny G0 liczony automatycznie. Strefy jednej kategorii — jedno oddziaływanie swobodne (szachownica).</p>');
    const mat = [['zelbet', 'żelbet'], ['mur', 'mur'], ['stal', 'stal']];
    if (g.columns.length) {
      let c = '<table class="mini"><tr><th></th><th>Materiał</th><th>Beton / E [MPa]</th><th>H [m]</th><th>Dół</th><th>Sztywna</th></tr>';
      for (const lb of ['domyślne', ...g.columns.map(x => x.label)]) {
        if (lb !== 'domyślne') { P.columns[lb] ??= {}; for (const k of ['material', 'concrete', 'E', 'H', 'bottom', 'rigid']) if (P.columns[lb][k] === undefined) P.columns[lb][k] = P.columns['domyślne'][k]; }
        const m = { ...P.columns['domyślne'], ...P.columns[lb] }, base = `columns.${lb}`;
        c += `<tr><td>${lb === 'domyślne' ? '<b>wszystkie</b>' : `<code>${lb}</code>`}</td><td>${sel(`${base}.material`, mat, 'data-rerender="1"')}</td>
          <td>${m.material === 'zelbet' ? sel(`${base}.concrete`, concrete) : m.material === 'mur' ? inp(`${base}.E`) : '210 000'}</td>
          <td>${inp(`${base}.H`)}</td><td>${sel(`${base}.bottom`, [['fixed', 'utwierdz.'], ['pinned', 'przegub']])}</td><td>${chk(`${base}.rigid`)}</td></tr>`;
      }
      h += card('Słupy', c + '</table>');
    }
    if (g.walls.length) {
      let c = '<table class="mini"><tr><th></th><th>Materiał</th><th>Beton / E</th><th>t [mm]</th><th>H [m]</th><th>Dół</th><th>Szt.</th></tr>';
      for (const lb of ['domyślne', ...g.walls.map(x => x.label)]) {
        if (lb !== 'domyślne') { P.walls[lb] ??= {}; for (const k of ['material', 'concrete', 'E', 't', 'H', 'bottom', 'rigid']) if (P.walls[lb][k] === undefined) P.walls[lb][k] = P.walls['domyślne'][k]; }
        const m = { ...P.walls['domyślne'], ...P.walls[lb] }, base = `walls.${lb}`;
        c += `<tr><td>${lb === 'domyślne' ? '<b>wszystkie</b>' : `<code>${lb}</code>`}</td><td>${sel(`${base}.material`, mat, 'data-rerender="1"')}</td>
          <td>${m.material === 'zelbet' ? sel(`${base}.concrete`, concrete) : m.material === 'mur' ? inp(`${base}.E`) : '210 000'}</td>
          <td>${inp(`${base}.t`, 'mm')}</td><td>${inp(`${base}.H`)}</td><td>${sel(`${base}.bottom`, [['pinned', 'przegub'], ['fixed', 'utwierdz.'], ['free', 'obrót swob.']])}</td><td>${chk(`${base}.rigid`)}</td></tr>`;
      }
      h += card('Ściany', c + '</table>');
    }
    if (g.edges.length) {
      let c = '<table class="mini">';
      for (const lb of g.edges.map(e => e.label)) { P.edges[lb] ??= { type: P.edges['domyślne'].type }; c += `<tr><td><code>${lb}</code></td><td>${sel(`edges.${lb}.type`, [['pinned', 'przegubowa'], ['fixed', 'utwierdzona']])}</td></tr>`; }
      h += card('Krawędzie podparte', c + '</table>');
    }
    h += card('Kombinacje i SGU', `<div class="form"><span>SGN (PN-EN 1990)</span><select id="formulas"><option value="ab" ${P.combination.formulas.length === 2 ? 'selected' : ''}>6.10a / 6.10b</option><option value="10" ${P.combination.formulas.length === 1 ? 'selected' : ''}>6.10</option></select>
      <span>β przy przebiciu</span>${sel('punching.beta', [['uproszczone', 'uproszczone 6.4.3(6)']])}
      <span>Wilgotność RH [%]</span>${inp('sls.RH')}<span>Cement</span>${sel('sls.cement', [['S', 'S'], ['N', 'N'], ['R', 'R']])}
      <span>Wiek przy obciążeniu t0 [dni]</span>${inp('sls.t0')}<span>Klasa ekspozycji</span>${sel('sls.exposure', Object.keys(WMAX).map(k => [k, `${k} (wmax ${resolveParams(P.norms).ec2.wmax[k]} mm)`]))}</div>`);
    h += normsCard();
    h += card('Pola do oceny ugięć <small>L/250, L/500</small>', `<p class="hint">Rozpiętość L zadaje projektant (podpowiedź: krótszy bok zaznaczenia).</p>
      <table class="mini"><tr><th>Pole</th><th>L [m]</th><th></th></tr>${P.sls.fields.map((f, i) => `<tr><td>${esc(f.label)}</td><td>${inp(`sls.fields.${i}.L`)}</td><td><button class="btn sm danger" data-act="delField" data-i="${i}">usuń</button></td></tr>`).join('')}</table>
      <button class="btn" data-act="addField">${S.pick ? 'Kliknij 2 narożniki pola na rzucie…' : 'Dodaj pole (zaznacz na rzucie)'}</button>`);
    return work(h);
  },

  calc() {
    const r = S.res;
    let h = card('Siatka i obliczenia', `<div class="form"><span>Oczko podstawowe h0 [m]</span>${inp('mesh.h0')}</div>
      <p class="hint">Zagęszczenie automatyczne przy słupach (h0/4), w narożach wklęsłych i przy siłach skupionych. Zalecane h0 ≈ 0,5 m (0,25 m — dokładniej przy ścianach).</p>
      <div class="btns"><button class="btn primary lg" data-act="run" ${S.geo && !S.geo.errors.length ? '' : 'disabled'}>Licz</button></div>`);
    if (r?.ok) h += card('Ostatnie obliczenia', `<table class="mini"><tr><td>Węzły / elementy / niewiadome</td><td class="num">${r.summary.nodes} / ${r.summary.elements} / ${r.summary.unknowns}</td></tr>
      <tr><td>Najmniejszy kąt trójkąta</td><td class="num">${fmt(r.summary.minAngle, 1)}°</td></tr>
      <tr><td>Czas: siatka / MES / SGN / SGU</td><td class="num">${Object.values(r.summary.times).map(t => fmt(t / 1000, 1)).join(' / ')} s</td></tr></table>`)
      + card('Kontrola modelu <small>suma reakcji = obciążenie</small>', `<table class="mini"><tr><th>Przypadek</th><th>Obciążenie [kN]</th><th>Reakcje [kN]</th><th>Błąd</th></tr>
      ${r.equilibrium.map(e => `<tr><td><code>${e.case}</code></td><td class="num">${fmt(e.load)}</td><td class="num">${fmt(e.reactions)}</td><td>${stat(e.error < 1e-6, e.error.toExponential(1), e.error.toExponential(1))}</td></tr>`).join('')}</table>`);
    if (r && !r.ok) h += card('Błędy danych', r.errors.map(e => `<div class="msg err">${esc(e.msg)}</div>`).join(''), 'warn');
    return work(h);
  },

  res() {
    const r = S.res, o = S.vopt, cm = currentMap(), isBase = S.mapKey.startsWith('q:');
    const groups = { 'Siły i przemieszczenia': Object.entries(BASE).map(([k, b]) => [`q:${k}`, b[0]]) };
    for (const m of MAPS) if (!HIDDEN_GROUPS.has(m.group)) (groups[m.group] ??= []).push([m.key, m.name]);
    let h = card('Mapa', `<div class="form"><span>Wielkość</span><select id="mapSel">${Object.entries(groups).map(([g, ms]) => `<optgroup label="${g}">${ms.map(([k, n]) => `<option value="${k}" ${k === S.mapKey ? 'selected' : ''}>${esc(n)}</option>`).join('')}</optgroup>`).join('')}</select>
      ${isBase ? `<span>Przypadek / kombinacja</span><select id="srcSel">${sourceOptions().map(([k, n]) => `<option value="${k}" ${k === o.src ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>` : ''}</div>
      <p class="hint">Najedź na rzut: wartość pod kursorem (interpolacja w elemencie). Kółko — powiększenie, przeciąganie — przesuw, dwuklik — cały rzut.</p>`);
    h += card('Skala i widok', `<div class="form">
      <span>Skala automatyczna</span><input type="checkbox" data-vopt="auto" ${o.auto ? 'checked' : ''}>
      <span>min / max [${esc(cm.unit)}]</span><span><input type="number" step="any" data-vopt="min" value="${o.auto ? '' : o.min ?? ''}" ${o.auto ? 'disabled' : ''}> <input type="number" step="any" data-vopt="max" value="${o.auto ? '' : o.max ?? ''}" ${o.auto ? 'disabled' : ''}></span>
      <span>Liczba kolorów</span><input type="number" min="4" max="24" step="1" data-vopt="bands" value="${o.bands}">
      <span>Skala symetryczna (momenty, siły)</span><input type="checkbox" data-vopt="sym" ${o.sym ? 'checked' : ''}>
      <span>Barwy ciągłe (bez warstwic)</span><input type="checkbox" data-vopt="smooth" ${o.smooth ? 'checked' : ''}>
      <span>Izolinie z wartościami</span><input type="checkbox" data-vopt="iso" ${o.iso ? 'checked' : ''}>
      <span>Ekstrema (max, min)</span><input type="checkbox" data-vopt="ext" ${o.ext ? 'checked' : ''}>
      <span>Siatka MES</span><input type="checkbox" data-vopt="mesh" ${o.mesh ? 'checked' : ''}></div>`);
    const secs = S.project.sections ?? [];
    let sh = `<div class="btns"><button class="btn" data-act="addSection">${S.pick?.kind === 'section' ? 'Kliknij 2 punkty przekroju na rzucie…' : 'Dodaj przekrój (2 punkty)'}</button></div>`;
    if (secs.length) {
      sh += `<table class="mini"><tr><th>Przekrój</th><th>L [m]</th><th>max</th><th>min</th><th></th></tr>${secs.map((sc, i) => {
        const pr = sectionProfile(r.mesh.nodes, r.mesh.elems, cm.values, sc.a, sc.b, 200, loc());
        return `<tr><td><button class="btn sm ${i === S.secSel ? 'primary' : ''}" data-act="selSection" data-i="${i}">${esc(sc.label)}</button></td><td class="num">${fmt(pr.L)}</td><td class="num">${fmt(pr.extrema?.max.v, cm.d)}</td><td class="num">${fmt(pr.extrema?.min.v, cm.d)}</td><td><button class="btn sm danger" data-act="delSection" data-i="${i}">×</button></td></tr>`;
      }).join('')}</table>`;
      const sel = secs[Math.min(S.secSel, secs.length - 1)];
      sh += sectionChart(sel, sectionProfile(r.mesh.nodes, r.mesh.elems, cm.values, sel.a, sel.b, 200, loc()), cm);
    } else sh += '<p class="hint">Przekrój pokazuje wykres wybranej wielkości wzdłuż odcinka (jak „Przekroje przez panele” w Robocie).</p>';
    h += card('Przekroje', sh);
    h += card('Reakcje podpór <small>obwiednia SGN</small>', `<table class="mini"><tr><th>Podpora</th><th>V max [kN]</th><th>V min [kN]</th><th>Kombinacja</th></tr>
      ${r.supports.map(x => `<tr><td><code>${x.label}</code></td><td class="num">${fmt(x.Vmax, 1)}</td><td class="num">${fmt(x.Vmin, 1)}</td><td class="sm">${esc(x.gov)}</td></tr>`).join('')}</table>`);
    if (r.warnings.length) h += card('Ostrzeżenia', r.warnings.map(w => `<div class="msg warn">${esc(w.msg)}</div>`).join(''), 'warn');
    return work(h);
  },

  rebar() {
    const r = S.res, rb = r.rebar, L = rb.layers[S.rebarLayer];
    const NAMES = { bottomX: 'dół x', bottomY: 'dół y', topX: 'góra x', topY: 'góra y' };
    const fb = b => (!b || b.fail ? '<span class="stat uw">brak</span>' : b.perSpacing === 2 ? `2×#${b.phi} co ${b.s * 2}` : `#${b.phi} co ${b.s}`);
    let h = card('Zbrojenie dobrane', `<table class="mini"><tr><th>Warstwa</th><th>Siatka</th><th>Strefy</th><th>As,req max</th><th></th></tr>
      ${Object.entries(rb.layers).map(([k, l]) => `<tr><td><button class="btn sm ${k === S.rebarLayer ? 'primary' : ''}" data-act="rebarLayer" data-k="${k}">${NAMES[k]}</button></td><td>#${l.base.phi} co ${l.base.s}</td><td class="num">${l.zones.length}</td><td class="num">${fmt(r.summary.AsMax[k], 0)}</td><td>${stat(!l.zones.length, 'siatka wystarcza', 'dozbrojenie')}</td></tr>`).join('')}</table>`);
    h += card(`Strefy dozbrojenia — ${NAMES[S.rebarLayer]}`, L.zones.length ? `<table class="mini"><tr><th>Strefa</th><th>Pręty dodatkowe</th><th>x [m]</th><th>y [m]</th><th>L [mm]</th><th>lbd</th></tr>
      ${L.zones.map(z => `<tr><td><code>${z.id.split('-')[1]}</code> <span class="sm muted">st. ${z.tier}</span></td><td>+${fb(z.bar)}</td><td class="num">${fmt(z.rect.x0)}–${fmt(z.rect.x1)}</td><td class="num">${fmt(z.rect.y0)}–${fmt(z.rect.y1)}</td><td class="num">${Math.round(z.length * 1000)}</td><td class="num">${z.lbd ? Math.round(z.lbd) : '—'}</td></tr>`).join('')}</table>
      <p class="hint">Dodatki w rozstawie siatki, między jej prętami. Strefy zagnieżdżone: mocniejszy pręt zastępuje słabszy. Długość z al = d i lbd (8.4).</p>` : '<p class="muted">Siatka podstawowa wystarcza.</p>');
    h += card('Przebicie — zbrojenie 9.4.3', rb.punching.length ? `<table class="mini"><tr><th>Słup</th><th>Strzemiona</th><th>Obwody</th><th>Gałęzie</th><th>s0 / sr</th></tr>
      ${rb.punching.map(p => `<tr><td><code>${p.label}</code></td><td>${p.fail ? '<span class="stat uw">brak</span>' : `#${p.phi}`}</td><td class="num">${p.nPerimeters ?? '—'}</td><td class="num">${p.perimeters?.map(x => x.legs).join('/') ?? esc(p.msg ?? '')}</td><td class="num">${p.s0 ? `${Math.round(p.s0 * 1000)} / ${Math.round(p.sr * 1000)}` : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Zbrojenie na przebicie niepotrzebne.</p>');
    const T = { wewnetrzny: 'wewn.', krawedziowy: 'kraw.', narozny: 'naroż.' };
    h += card('Przebicie — nośność 6.4', `<table class="mini"><tr><th>Słup</th><th>Typ</th><th>VEd</th><th>β</th><th>vEd/vRd,c</th><th>vEd,0/vRd,max</th></tr>
      ${r.punching.map(p => `<tr><td><code>${p.label}</code></td><td>${T[p.type]}</td><td class="num">${fmt(p.VEd, 0)}</td><td class="num">${fmt(p.beta)}</td><td>${stat(p.util <= 1, fmt(p.util), fmt(p.util))}</td><td>${stat(p.utilMax <= 1, fmt(p.utilMax), fmt(p.utilMax))}</td></tr>`).join('')}</table>`);
    h += card('Pozostałe sprawdzenia', `<table class="mini">
      <tr><td>Ścinanie poza słupami 6.2.2</td><td>${stat(r.shear.maxUtil <= 1, `vEd/vRd,c = ${fmt(r.shear.maxUtil)}`, `vEd/vRd,c = ${fmt(r.shear.maxUtil)}`)}</td></tr>
      <tr><td>Naprężenia w stali 7.2(5)</td><td>${stat(r.stress.max.sigS <= r.stress.limits.sigS, `σs = ${fmt(r.stress.max.sigS, 0)} MPa`, `σs = ${fmt(r.stress.max.sigS, 0)} MPa`)} <span class="sm muted">≤ ${fmt(r.stress.limits.sigS, 0)}</span></td></tr>
      <tr><td>Naprężenia w betonie 7.2</td><td>${stat(!r.stress.aggressive || r.stress.max.sigC <= r.stress.limits.sigCchar, `σc = ${fmt(r.stress.max.sigC, 1)} MPa`, `σc = ${fmt(r.stress.max.sigC, 1)} MPa`)} <span class="sm muted">${r.stress.aggressive ? `≤ ${fmt(r.stress.limits.sigCchar, 1)}` : 'kontrola 0,6 fck wymagana przy XD/XF/XS'}</span></td></tr>
      <tr><td>Rysy 7.3.4 (na zbrojeniu dobranym)</td><td>${stat(r.sls.wkMax <= r.sls.wmax, `wk = ${fmt(r.sls.wkMax)} mm`, `wk = ${fmt(r.sls.wkMax)} mm`)} <span class="sm muted">≤ ${fmt(r.sls.wmax, 1)}</span></td></tr>
      <tr><td>Ugięcie długotrwałe max</td><td class="num">${fmt(r.summary.wLtMax * 1000, 1)} mm</td></tr>
      ${r.sls.fields.map(f => `<tr><td>Pole ${esc(f.label)} (L = ${fmt(f.L)} m)</td><td>${stat(f.ok, `w ${fmt(f.w * 1000, 1)} / Δw ${fmt(f.dw * 1000, 1)} mm`, `w ${fmt(f.w * 1000, 1)} / Δw ${fmt(f.dw * 1000, 1)} mm`)}</td></tr>`).join('')}</table>`);
    return work(h);
  },

  draw() {
    const layers = ['TP_OBRYS', 'ZB_DOL_X', 'ZB_DOL_Y', 'ZB_GORA_X', 'ZB_GORA_Y', 'ZB_STREFY', 'ZB_PRZEBICIE', 'ZB_OPIS'];
    return work(card('Rysunek zbrojenia DXF', `<p class="hint">Rzut dolny i górny obok siebie: obrys, pręty reprezentatywne z liniami rozkładu i opisami (#ϕ co s, L). Wersja bez pozycji i zestawienia stali. Format DXF R12 — otwiera się w ZWCAD.</p>
      <div class="btns"><button class="btn primary" data-act="saveDxf">Zapisz DXF</button></div>
      <h3>Warstwy w podglądzie</h3>${layers.map(l => `<label class="sm" style="display:block"><input type="checkbox" data-act-layer="${l}" ${S.hiddenLayers.has(l) ? '' : 'checked'}> <code>${l}</code></label>`).join('')}`));
  },

  report() {
    return work(card('Raport z obliczeń', `<p class="hint">Raport z punktami normy, mapami, doborem prętów i przykładem krok po kroku dla najbardziej wytężonego słupa.</p>
      <div class="btns"><button class="btn primary" data-act="reportPdf">Podgląd i PDF</button><button class="btn" data-act="reportDocx">Pobierz DOCX</button></div>
      ${S.stale ? '<div class="note">Wyniki nieaktualne — przelicz przed raportem.</div>' : ''}<p class="hint">PDF: w oknie podglądu „Drukuj → Zapisz jako PDF”.</p>`)
      + card('Projekt', `<div class="form"><span>Nazwa</span>${txt('meta.name')}<span>Inwestor</span>${txt('meta.investor')}<span>Obiekt</span>${txt('meta.object')}<span>Autor</span>${txt('meta.author')}
        <span>Wariant</span><input type="text" id="variantName" value="${esc(S.ids.variantName)}"></div>
        <div class="btns"><button class="btn primary" data-act="saveVariant" ${S.db ? '' : 'disabled'}>Zapisz w bazie</button><button class="btn" data-act="saveNewVariant" ${S.db && S.ids.projectId ? '' : 'disabled'}>Zapisz jako nowy wariant</button><button class="btn" data-act="exportFile">Eksport .tekplyta</button></div>`), false);
  },

  ai() {
    let h = card('Paczka do sprawdzenia', `<p>Aplikacja nie łączy się z AI. Tworzy paczkę (prompt, dane i wyniki, raport), którą wklejasz do własnego narzędzia AI.</p>
      <div class="note">Opinia AI nie jest sprawdzeniem projektu w rozumieniu Prawa budowlanego.</div>
      <label class="sm"><input type="checkbox" id="anon" checked> anonimizacja (dane inwestora i obiektu zastąpione znacznikami)</label>
      <div class="btns"><button class="btn primary" data-act="aiPackage">Utwórz paczkę</button></div>`)
      + card('Odpowiedź AI', `<textarea id="aiText" placeholder="Wklej odpowiedź z blokiem json…"></textarea><div class="btns"><button class="btn" data-act="aiImport">Wczytaj uwagi</button></div>
      ${S.review.length ? `<table class="mini"><tr><th>Waga</th><th>Miejsce</th><th>Uwaga</th><th>Sprawdzenie</th></tr>${S.review.map(u => `<tr><td>${stat(u.waga < 4, String(u.waga), String(u.waga))}</td><td>${esc(u.miejsce)}</td><td>${esc(u.uwaga)}<br><span class="sm muted">${esc(u.uzasadnienie)}</span></td><td>${esc(u.sprawdzenie)}</td></tr>`).join('')}</table>` : ''}`);
    return work(h, false);
  },

  podstawy() {
    return `<div class="grid2">${card('Normy i status wartości krajowych', `<ul class="tight"><li>PN-EN 1990:2004 + NA — kombinacje (6.10a/b, ψ wg tabl. A1.1)</li><li>PN-EN 1991-1-1 — kategorie obciążeń użytkowych</li><li>PN-EN 1992-1-1:2008 + NA — wymiarowanie (6.1, 6.2.2, 6.4, 7.2, 7.3, 7.4, 8.4, 9.3, 9.4.3)</li></ul>
      <div class="note">${EC0.verified && EC2.verified ? 'Wartości krajowe potwierdzone.' : 'Część wartości krajowych (γc = 1,4; αcc = 1,0; ψ; 0,4 w vRd,max; zał. B; tabl. 7.1N) nie została porównana z tekstem NA — raport to pokazuje.'}</div>`)}
      ${card('Źródła', `<ul class="tight"><li>Batoz, Bathe, Ho (1980) — DKT; Lee, Bathe (2004) — MITC3</li><li>Wood (1968), Armer (1968) — momenty wymiarujące</li><li>Timoshenko, Woinowsky-Krieger; NAFEMS LE6; Grbac, Ribarić (2022) — testy</li><li>xdfem2d (P. Cachim) — niezależny MES do porównań (zgodność DKT 0,00 %)</li><li>Davis — CSparse; delaunator, constrainautor (ISC); sql.js, Neutralinojs (MIT); IBM Plex (OFL) — <a href="dist/THIRD_PARTY_LICENSES.txt" target="_blank">licencje</a></li></ul>`)}</div>
      ${card('Granice modelu', `<ul class="tight">${LIMITS.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`)}`;
  },

  info() {
    return `<div class="grid2">${card('O programie', `<div style="background:var(--navy);padding:14px;border-radius:6px">${produkt()}</div>
      <p>TEK-PŁYTA v${VERSION} — MES płyt żelbetowych wg PN-EN 1992-1-1 + NA. Linia programów TEKTORIA.</p>
      <p class="hint">Działa offline. Baza: ${esc(S.dbWhere)}.</p>`)}
      ${card('Licencja', `<p>${stat(S.license.ok, S.license.msg, S.license.msg || 'brak licencji')}</p>
      <input type="text" id="licKey" placeholder="wklej klucz licencji"><div class="btns"><button class="btn" data-act="license">Zapisz klucz</button></div>
      <p class="hint">Bez licencji program działa, a raport ma dopisek „wersja bez licencji”.</p>`)}</div>
      <div class="legal">Program wspomaga projektanta. Za założenia, dane wejściowe i wykorzystanie wyników odpowiada projektant posiadający uprawnienia budowlane (art. 20 ustawy Prawo budowlane).</div>`;
  },
};

// Przebudowa widoku: zatwierdzenie aktywnego pola przed podmianą HTML (blur → change → render) i blokada
// zagnieżdżenia — inaczej podmiana treści w trakcie podmiany (błąd przeglądarki „node to be removed…”).
let rendering = false, renderAgain = null;
function render(opts = {}) {
  if (rendering) { renderAgain = { bar: (renderAgain?.bar ?? false) || opts.bar !== false }; return; }
  rendering = true;
  try {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    renderNow(opts);
  } finally { rendering = false; }
  if (renderAgain) { const o = renderAgain; renderAgain = null; render(o); }
}
function renderNow({ bar = true } = {}) {
  if (bar) renderBar();
  document.body.dataset.view = S.tab;
  $('#view').innerHTML = VIEWS[S.tab]();
  const f = $('#formulas'); if (f) f.onchange = () => { S.project.combination.formulas = f.value === 'ab' ? ['6.10a', '6.10b'] : ['6.10']; markStale(); };
  const m = $('#mapSel'); if (m) m.onchange = () => { S.mapKey = m.value; render({ bar: false }); };
  const sr = $('#srcSel'); if (sr) sr.onchange = () => { S.vopt.src = sr.value; render({ bar: false }); };
  document.querySelectorAll('[data-vopt]').forEach(c => { c.onchange = () => {
    const k = c.dataset.vopt;
    if (c.type === 'checkbox') S.vopt[k] = c.checked; else { const n = parseFloat(String(c.value).replace(',', '.')); S.vopt[k] = Number.isFinite(n) ? (k === 'bands' ? Math.max(4, Math.min(24, Math.round(n))) : n) : null; }
    if (k === 'auto' && !c.checked) { const sc = makeScale(currentMap().values); S.vopt.min = +sc.min.toPrecision(4); S.vopt.max = +sc.max.toPrecision(4); }
    render({ bar: false });
  }; });
  const vn = $('#variantName'); if (vn) vn.onchange = () => { S.ids.variantName = vn.value; };
  document.querySelectorAll('[data-act-layer]').forEach(c => { c.onchange = () => { c.checked ? S.hiddenLayers.delete(c.dataset.actLayer) : S.hiddenLayers.add(c.dataset.actLayer); draw(); }; });
  mountCanvas();
}

// ---------- współczynniki normowe (domyślnie normowe, edytowalne) ----------
const getAt = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
function pinp(path) {
  const cur = getAt(resolveParams(S.project.norms), path), def = getAt(defaultParams(), path), changed = Math.abs(cur - def) > 1e-12;
  return `<input type="number" step="any" data-path="norms.${path}" data-unit="num" value="${+cur.toPrecision(6)}" class="${changed ? 'changed' : ''}" title="${esc(PARAM_INFO[path]?.[1] ?? '')}">`
    + (changed ? ` <span class="sm muted">norma: ${def}</span>` : '');
}
function normsCard() {
  const rows = (paths) => paths.map(p => `<tr><td>${esc(PARAM_INFO[p]?.[0] ?? p)}</td><td class="sm muted">${esc(PARAM_INFO[p]?.[1] ?? '')}</td><td>${pinp(p)}</td></tr>`).join('');
  const n = diffParams(resolveParams(S.project.norms)).length;
  const D = defaultParams();
  return card(`Współczynniki normowe <small>${n ? `${n} zmienionych` : 'wartości normowe'}</small>`, `<details ${n ? 'open' : ''}><summary>Pokaż i edytuj</summary>
    <p class="hint">Domyślnie wartości normowe. Zmiana jest wyróżniona, a raport wymienia ją z wartością normową.</p>
    <h3>PN-EN 1990 — kombinacje</h3><table class="mini">${rows(['ec0.gammaGsup', 'ec0.gammaGinf', 'ec0.gammaQ', 'ec0.xi'])}</table>
    <h3>ψ0 / ψ1 / ψ2 (tabl. A1.1)</h3><table class="mini"><tr><th>Kat.</th><th>ψ0</th><th>ψ1</th><th>ψ2</th></tr>${Object.keys(D.ec0.psi).map(k => `<tr><td><code>${k}</code></td>${['psi0', 'psi1', 'psi2'].map(j => `<td>${pinp(`ec0.psi.${k}.${j}`)}</td>`).join('')}</tr>`).join('')}</table>
    <h3>PN-EN 1992-1-1 — materiały i nośność</h3><table class="mini">${rows(['ec2.gammaC', 'ec2.gammaS', 'ec2.alphaCC', 'ec2.alphaCT', 'ec2.Es', 'ec2.CRdcNum', 'ec2.vminCoef', 'ec2.k1', 'ec2.vRdMaxCoef', 'ec2.rhoMax'])}</table>
    <h3>Przebicie — β uproszczone</h3><table class="mini">${rows(['ec2.betaPunch.wewnetrzny', 'ec2.betaPunch.krawedziowy', 'ec2.betaPunch.narozny'])}</table>
    <h3>Rysy, naprężenia, ugięcia</h3><table class="mini">${rows(['ec2.crack.k1', 'ec2.crack.k2', 'ec2.crack.k3', 'ec2.crack.k4', 'ec2.crack.kt', 'ec2.stress.k1', 'ec2.stress.k2', 'ec2.stress.k3', 'ec2.defl.betaLong', 'ec2.defl.betaShort'])}</table>
    <h3>wmax (tabl. 7.1N) [mm]</h3><table class="mini">${rows(Object.keys(D.ec2.wmax).map(k => `ec2.wmax.${k}`))}</table>
    <div class="btns"><button class="btn" data-act="resetNorms" ${n ? '' : 'disabled'}>Przywróć wartości normowe</button></div></details>`);
}

// ---------- mapy ----------
const LAY = [['bottomX', 'dół x'], ['bottomY', 'dół y'], ['topX', 'góra x'], ['topY', 'góra y']];
const MAPS = [
  { key: 'w_lt', name: 'Ugięcie długotrwałe (rysy, pełzanie, skurcz)', unit: 'mm', k: 1000, group: 'Ugięcia' },
  { key: 'w_el', name: 'Ugięcie sprężyste — quasi-stała', unit: 'mm', k: 1000, group: 'Ugięcia' },
  { key: 'w_char', name: 'Ugięcie sprężyste — charakterystyczna', unit: 'mm', k: 1000, group: 'Ugięcia' },
  ...['mx', 'my', 'mxy'].flatMap(c => [{ key: `${c}_max`, name: `${c} max`, unit: 'kNm/m', div: true, group: 'Momenty SGN (obwiednia)' }, { key: `${c}_min`, name: `${c} min`, unit: 'kNm/m', div: true, group: 'Momenty SGN (obwiednia)' }]),
  ...['vx', 'vy'].flatMap(c => [{ key: `${c}_max`, name: `${c} max`, unit: 'kN/m', div: true, group: 'Siły poprzeczne SGN' }, { key: `${c}_min`, name: `${c} min`, unit: 'kN/m', div: true, group: 'Siły poprzeczne SGN' }]),
  { key: 'vEd', name: 'vEd = √(vx² + vy²) do 6.2.2', unit: 'kN/m', group: 'Siły poprzeczne SGN' },
  { key: 'shearUtil', name: 'Ścinanie 6.2.2: vEd / vRd,c', unit: '—', group: 'Siły poprzeczne SGN' },
  ...[['mx_char', 'charakterystyczna'], ['my_char', 'charakterystyczna'], ['mx_qp', 'quasi-stała'], ['my_qp', 'quasi-stała']].flatMap(([k, n]) => [{ key: `${k}_max`, name: `${k.split('_')[0]} max — ${n}`, unit: 'kNm/m', div: true, group: 'Momenty SGU' }, { key: `${k}_min`, name: `${k.split('_')[0]} min — ${n}`, unit: 'kNm/m', div: true, group: 'Momenty SGU' }]),
  ...LAY.flatMap(([k, n]) => [{ key: `Md_${k}`, name: `Moment wymiarujący ${n} (Wood–Armer)`, unit: 'kNm/m', div: true, group: 'Wymiarowanie' },
    { key: `As_${k}`, name: `As wymagane ${n}`, unit: 'mm²/m', d: 0, group: 'Wymiarowanie' }, { key: `dAs_${k}`, name: `Dozbrojenie ponad siatkę ${n}`, unit: 'mm²/m', d: 0, zero: true, group: 'Wymiarowanie' },
    { key: `Asp_${k}`, name: `As zapewnione (dobrane) ${n}`, unit: 'mm²/m', d: 0, group: 'Wymiarowanie' }]),
  ...LAY.flatMap(([k, n]) => [{ key: `wk_${k}`, name: `Szerokość rys ${n}`, unit: 'mm', zero: true, group: 'Rysy i naprężenia' }, { key: `sigS_${k}`, name: `σs ${n} — charakterystyczna`, unit: 'MPa', d: 0, group: 'Rysy i naprężenia' }, { key: `sigC_${k}`, name: `σc ${n} — charakterystyczna`, unit: 'MPa', d: 1, group: 'Rysy i naprężenia' }]),
];
const mapDef = key => MAPS.find(m => m.key === key);
// Wielkości podstawowe z wyborem przypadku / kombinacji (pola węzłowe na przypadek z obliczeń)
const BASE = { w: ['Ugięcie sprężyste w', 'mm', 1000, false], mx: ['Moment mx', 'kNm/m', 1, true], my: ['Moment my', 'kNm/m', 1, true], mxy: ['Moment mxy', 'kNm/m', 1, true],
  vx: ['Siła poprzeczna vx', 'kN/m', 1, true], vy: ['Siła poprzeczna vy', 'kN/m', 1, true] };
const HIDDEN_GROUPS = new Set(['Momenty SGN (obwiednia)', 'Momenty SGU']); // zastąpione wyborem źródła
const SCH = { ULS: 'SGN', CHAR: 'charakterystyczna', QP: 'quasi-stała' };
function sourceOptions() {
  const r = S.res, o = [];
  for (const k of ['ULS', 'CHAR', 'QP']) o.push([`env:${k}:max`, `Obwiednia ${SCH[k]} — max`], [`env:${k}:min`, `Obwiednia ${SCH[k]} — min`]);
  r.cases.forEach((n, i) => o.push([`case:${i}`, `Przypadek ${n} (wartości charakterystyczne)`]));
  for (const k of ['ULS', 'CHAR', 'QP']) r.schemesView[k].forEach((v, j) => o.push([`combo:${k}:${j}`, `Kombinacja ${SCH[k]} ${v.name.startsWith(SCH[k]) ? '' : v.name} — wszystkie obciążenia`]));
  return o;
}
const srcLabel = src => sourceOptions().find(([k]) => k === src)?.[1] ?? '';
const mapCache = new Map();
let locCache = null;
const loc = () => (locCache ??= locator(S.res.mesh.nodes, S.res.mesh.elems));
function currentMap(key = S.mapKey, src = S.vopt.src) {
  if (key.startsWith('q:')) {
    const q = key.slice(2), [name, unit, k, div] = BASE[q], ck = `${q}|${src}`;
    if (!mapCache.has(ck)) {
      const F = S.res.caseFields[q], [kind, a, b] = src.split(':');
      const v = kind === 'case' ? F[+a] : kind === 'env' ? envelope(F, S.res.schemesView[a])[b] : combine(F, S.res.schemesView[a][+b].hi);
      mapCache.set(ck, Float32Array.from(v, x => x * k));
    }
    return { name, unit, div, d: 2, values: mapCache.get(ck), src: srcLabel(src) };
  }
  const d = mapDef(key);
  return { name: d.name, unit: d.unit, div: !!d.div, d: d.d ?? 2, values: mapValues(key), src: '' };
}
const scaleFor = cm => makeScale(cm.values, { min: S.vopt.auto ? null : S.vopt.min, max: S.vopt.auto ? null : S.vopt.max, bands: S.vopt.bands, symmetric: cm.div && S.vopt.sym, smooth: S.vopt.smooth });
// Mapa z izoliniami, ekstremami i przekrojami (na ekranie i do raportu)
function paintMap(c, v, cm, { legendEl = null, sections = true, zones = null } = {}) {
  const sc = scaleFor(cm), r = S.res, f = x => fmt(x, cm.d);
  drawMap(c, v, r.mesh, cm.values, sc);
  if (S.vopt.mesh) drawMesh(c, v, r.mesh, 'rgba(0,0,0,0.18)');
  if (S.vopt.iso) drawIsolines(c, v, isolines(r.mesh.nodes, r.mesh.elems, cm.values, sc.levels.slice(1, -1)), f);
  const ex = extrema(cm.values);
  for (const z of zones ?? []) {
    const a = v.toScreen([z.rect.x0, z.rect.y0]), b = v.toScreen([z.rect.x1, z.rect.y1]);
    c.setLineDash([6, 4]); c.strokeStyle = '#1d1d1b'; c.lineWidth = 1.2; c.strokeRect(a[0], b[1], b[0] - a[0], a[1] - b[1]); c.setLineDash([]);
    c.fillStyle = '#1d1d1b'; c.font = '11px IBM Plex Mono, monospace'; c.fillText(z.bar && !z.bar.fail ? `+#${z.bar.phi} co ${z.bar.perSpacing === 2 ? z.bar.s * 2 : z.bar.s}` : '?', a[0] + 3, b[1] + 12);
  }
  drawGeometry(c, v, S.geo, { light: true, fields: S.project.sls.fields });
  if (sections) (S.project.sections ?? []).forEach((sec, i) => drawSection(c, v, sec, sectionProfile(r.mesh.nodes, r.mesh.elems, cm.values, sec.a, sec.b, 200, loc()), f, i === S.secSel));
  if (S.vopt.ext) drawExtrema(c, v, r.mesh.nodes, ex, f, cm.unit);
  if (legendEl) legendEl.innerHTML = robotLegend(sc, cm, f, ex);
  return { sc, ex };
}
// Wykres przekroju (SVG): wartości wzdłuż odcinka, oś zera, ekstrema i wartości na końcach
function sectionChart(sec, pr, cm) {
  const W = 400, H = 170, pad = 34, pts = pr.samples.filter(o => o.v != null);
  if (!pts.length) return '<p class="muted">Przekrój poza płytą.</p>';
  let lo = Math.min(0, ...pts.map(o => o.v)), hi = Math.max(0, ...pts.map(o => o.v)); if (hi - lo < 1e-12) hi = lo + 1;
  const X = s => pad + (W - 2 * pad) * s / pr.L, Y = v => H - pad + (pad * 2 - H) * (v - lo) / (hi - lo);
  let path = '', open = false;
  for (const o of pr.samples) { if (o.v == null) { open = false; continue; } path += `${open ? 'L' : 'M'}${X(o.s).toFixed(1)},${Y(o.v).toFixed(1)}`; open = true; }
  const lab = (o, anchor) => `<text x="${X(o.s).toFixed(1)}" y="${(Y(o.v) + (o.v >= 0 ? -5 : 13)).toFixed(1)}" text-anchor="${anchor}" font-size="11" font-family="IBM Plex Mono">${fmt(o.v, cm.d)}</text>`;
  return `<h3>${esc(sec.label)}: ${esc(cm.name)} [${esc(cm.unit)}]</h3><svg viewBox="0 0 ${W} ${H}" style="width:100%;background:#fff;border:1px solid var(--border)">
    <line x1="${pad}" x2="${W - pad}" y1="${Y(0)}" y2="${Y(0)}" stroke="#888"/><path d="${path}" fill="none" stroke="#1a4d5c" stroke-width="1.8"/>
    ${[[pr.extrema.max, 'middle'], [pr.extrema.min, 'middle'], [pts[0], 'start'], [pts.at(-1), 'end']].filter(([o], i, all) => all.findIndex(([q]) => Math.abs(X(q.s) - X(o.s)) < 30 && Math.abs(Y(q.v) - Y(o.v)) < 14) === i).map(([o, an]) => lab(o, an)).join('')}
    <text x="${pad}" y="${H - 6}" font-size="10" fill="#6f6e64">0</text><text x="${W - pad}" y="${H - 6}" font-size="10" fill="#6f6e64" text-anchor="end">${fmt(pr.L)} m</text></svg>`;
}
function mapValues(key) { const d = mapDef(key), a = S.res.maps[key]; return d.k ? Float32Array.from(a, v => v * d.k) : a; }

let cv = null, ctx = null, view = null, fittedFor = null;
function mountCanvas() {
  cv = $('#cv'); if (!cv) return;
  ctx = cv.getContext('2d');
  const r = cv.getBoundingClientRect(); cv.width = Math.max(200, Math.floor(r.width)); cv.height = Math.max(200, Math.floor(r.height));
  const prev = view; view = new View(cv);
  if (prev && fittedFor === S.tab) Object.assign(view, { scale: prev.scale, ox: prev.ox, oy: prev.oy }); else { fitView(); fittedFor = S.tab; }
  bindCanvas(); draw();
}
function fitView() {
  if (!S.geo?.outline?.length) return;
  const bb = bboxOf(S.geo.outline);
  if (S.tab === 'draw' && S.drawing) { const dx = S.drawing.sheets[1].dx; bb.maxX += dx; bb.maxY += (bb.maxY - bb.minY) * 0.08; }
  view.fit(bb, 30, ['res', 'rebar'].includes(S.tab) ? 250 : 0);
}
function ensureDrawing() {
  if (S.drawing || !S.res?.ok) return S.drawing;
  const dr = rebarDrawing({ geo: S.res.geo, rebar: S.res.rebar, design: { h: S.project.slab.h, ...S.project.reinf }, title: `TEK-PŁYTA — ${S.project.meta.name || 'zbrojenie płyty'}` });
  const bytes = dr.dxf.toBytes();
  S.drawing = { bytes, ents: readDxf(new TextDecoder('iso-8859-1').decode(bytes)).entities, sheets: dr.sheets, colors: Object.fromEntries([...dr.dxf.layers].map(([n, l]) => [n, l.color])) };
  return S.drawing;
}
function draw() {
  if (!ctx) return;
  clear(ctx); const lg = $('#legend'); if (lg) lg.innerHTML = '';
  const g = S.geo; if (!g?.outline?.length) return;
  if (S.tab === 'draw') { const d = ensureDrawing(); if (d) { if (fittedFor !== 'draw-fit') { fitView(); fittedFor = 'draw-fit'; } drawDxf(ctx, view, d.ents, d.colors, S.hiddenLayers); } return; }
  const errors = [...g.errors, ...g.warnings].map(e => ({ ...e, locM: e.loc ? [e.loc[0] * g.scale, e.loc[1] * g.scale] : null }));
  const hl = S.hl ? errors[S.hl.startsWith('e') ? +S.hl.slice(1) : g.errors.length + +S.hl.slice(1)] : null;
  if (['res', 'rebar'].includes(S.tab) && S.res?.ok) {
    const cm = S.tab === 'rebar' ? currentMap(`Asp_${S.rebarLayer}`) : currentMap();
    paintMap(ctx, view, cm, { legendEl: lg, sections: S.tab === 'res', zones: S.tab === 'rebar' ? S.res.rebar.layers[S.rebarLayer].zones : null });
    if (S.pick?.pts?.length === 1) { const [x, y] = view.toScreen(S.pick.pts[0]); ctx.fillStyle = '#7b3fb0'; ctx.fillRect(x - 3, y - 3, 6, 6); }
    return;
  } else if (S.tab === 'calc' && S.res?.ok) drawMesh(ctx, view, S.res.mesh);
  drawGeometry(ctx, view, g, { errors: S.tab === 'geo' ? errors : [], highlight: hl, fields: S.project.sls.fields, light: true });
  if (S.pick?.pts?.length === 1) { const [x, y] = view.toScreen(S.pick.pts[0]); ctx.fillStyle = '#7b3fb0'; ctx.fillRect(x - 3, y - 3, 6, 6); }
}

function bindCanvas() {
  let drag = null;
  cv.onwheel = e => { e.preventDefault(); view.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15); draw(); };
  cv.onmousedown = e => { drag = { x: e.offsetX, y: e.offsetY, moved: false }; };
  cv.onmousemove = e => {
    if (drag && (Math.abs(e.offsetX - drag.x) + Math.abs(e.offsetY - drag.y) > 3)) { view.pan(e.offsetX - drag.x, e.offsetY - drag.y); drag = { x: e.offsetX, y: e.offsetY, moved: true }; draw(); return; }
    const w = view.toWorld(e.offsetX, e.offsetY); let t = `X = ${fmt(w[0])} m, Y = ${fmt(w[1])} m`;
    if (S.res?.ok && ['res', 'rebar'].includes(S.tab)) {
      const cm = S.tab === 'rebar' ? currentMap(`Asp_${S.rebarLayer}`) : currentMap(), v = loc()(w, cm.values);
      if (v != null) t += ` · ${cm.name}: <b>${fmt(v, cm.d)} ${cm.unit}</b>`;
    }
    const ro = $('#readout'); if (ro) ro.innerHTML = t;
  };
  cv.onmouseup = e => {
    const moved = drag?.moved; drag = null;
    if (moved || !S.pick) return;
    S.pick.pts.push(view.toWorld(e.offsetX, e.offsetY));
    if (S.pick.kind === 'section' && S.pick.pts.length === 2) {
      S.project.sections ??= [];
      S.project.sections.push({ label: `X${S.project.sections.length + 1}`, a: S.pick.pts[0], b: S.pick.pts[1] });
      S.secSel = S.project.sections.length - 1; S.pick = null; render({ bar: false }); return;
    }
    if (S.pick.pts.length === 2) {
      const [[x0, y0], [x1, y1]] = S.pick.pts, n = S.project.sls.fields.length + 1, Ls = +Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)).toFixed(2);
      const L = parseFloat(String(prompt(`Rozpiętość odniesienia L [m] dla pola P${n} (podpowiedź: krótszy bok ${Ls} m):`, Ls)).replace(',', '.'));
      if (L > 0) S.project.sls.fields.push({ label: `P${n}`, L, pts: [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]] });
      S.pick = null; markStale(); render(); return;
    }
    draw();
  };
  cv.ondblclick = () => { fitView(); draw(); };
}
window.addEventListener('resize', () => mountCanvas());

// ---------- obliczenia w wątku ----------
let worker = null;
function run() {
  if (S.project.sls.fields.some(f => !(f.L > 0))) return toast('Uzupełnij rozpiętości L pól ugięć.', true);
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pr = $('#progress'); pr.classList.remove('hidden'); pr.querySelector('span').textContent = 'start…'; pr.querySelector('.bar').style.width = '2%';
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { pr.querySelector('.bar').style.width = `${Math.round(data.frac * 100)}%`; pr.querySelector('span').textContent = data.stage; return; }
    pr.classList.add('hidden');
    if (data.type === 'error') { toast(`Błąd obliczeń: ${data.message}`, true); console.error(data.stack); return; }
    S.res = data.res; S.stale = !data.res.ok; S.drawing = null; mapCache.clear(); locCache = null;
    if (data.res.ok) { S.tab = 'res'; toast('Obliczenia zakończone.'); } else toast('Popraw dane — szczegóły w zakładce Obliczenia.', true);
    render();
  };
  worker.postMessage({ type: 'run', project: structuredClone(S.project) });
}

// ---------- rysunki do raportu (białe tło) ----------
function renderImage(key, { zones = null, src = 'env:ULS:max', sections = false } = {}) {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 900;
  const x = c.getContext('2d'), v = new View(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  v.fit(bboxOf(S.geo.outline), 40);
  if (key === 'mesh') { drawMesh(x, v, S.res.mesh, 'rgba(26,77,92,0.45)'); drawGeometry(x, v, S.geo, { light: true, fields: S.project.sls.fields }); }
  else {
    const cm = currentMap(key, src);
    v.fit(bboxOf(S.geo.outline), 40, 250);
    const { sc, ex } = paintMap(x, v, cm, { zones, sections });
    // legenda jak w Robocie: nagłówek, pasma od max do min z granicami, ekstrema
    x.fillStyle = '#111'; x.font = 'bold 18px Arial'; x.fillText(`${cm.name} [${cm.unit}]`, 1150, 36);
    x.font = '14px Arial'; x.fillStyle = '#555'; if (cm.src) x.fillText(cm.src.slice(0, 34), 1150, 56);
    const hB = Math.min(44, 700 / sc.bands);
    for (let i = sc.bands - 1, k = 0; i >= 0; i--, k++) {
      const [r, g, b] = sc.color((sc.levels[i] + sc.levels[i + 1]) / 2), y = 72 + k * hB;
      x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(1150, y, 26, hB - 2); x.fillStyle = '#111'; x.font = '15px Arial'; x.fillText(fmt(sc.levels[i + 1], cm.d), 1184, y + 6);
    }
    x.fillText(fmt(sc.levels[0], cm.d), 1184, 72 + sc.bands * hB + 4);
    x.font = 'bold 15px Arial'; x.fillText(`max = ${fmt(ex.max, cm.d)}`, 1150, 72 + sc.bands * hB + 32); x.fillText(`min = ${fmt(ex.min, cm.d)}`, 1150, 72 + sc.bands * hB + 52);
  }
  return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
}
// Wykres przekroju do raportu (canvas)
function sectionImage(sec, pr, cm) {
  const W = 1200, H = 420, pad = 70, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d'), pts = pr.samples.filter(o => o.v != null);
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  let lo = Math.min(0, ...pts.map(o => o.v)), hi = Math.max(0, ...pts.map(o => o.v)); if (hi - lo < 1e-12) hi = lo + 1;
  const X = s => pad + (W - 2 * pad) * s / pr.L, Y = v => H - pad + (2 * pad - H) * (v - lo) / (hi - lo);
  x.strokeStyle = '#888'; x.beginPath(); x.moveTo(pad, Y(0)); x.lineTo(W - pad, Y(0)); x.stroke();
  x.strokeStyle = '#1a4d5c'; x.lineWidth = 3; x.beginPath(); let open = false;
  for (const o of pr.samples) { if (o.v == null) { open = false; continue; } open ? x.lineTo(X(o.s), Y(o.v)) : x.moveTo(X(o.s), Y(o.v)); open = true; }
  x.stroke(); x.fillStyle = '#111'; x.font = '20px Arial';
  for (const o of [pr.extrema.max, pr.extrema.min, pts[0], pts.at(-1)]) x.fillText(fmt(o.v, cm.d), Math.min(W - 120, X(o.s) + 4), Y(o.v) + (o.v >= 0 ? -8 : 22));
  x.font = 'bold 22px Arial'; x.fillText(`${sec.label}: ${cm.name} [${cm.unit}] — ${cm.src}`.slice(0, 90), pad, 34);
  x.font = '18px Arial'; x.fillStyle = '#555'; x.fillText('0', pad, H - 24); x.fillText(`${fmt(pr.L)} m`, W - pad - 50, H - 24);
  return { src: c.toDataURL('image/png'), w: W, h: H };
}
function reportImages() {
  const out = { mesh: renderImage('mesh'), w_lt: renderImage('w_lt') };
  for (const [k] of LAY) out[`Asp_${k}`] = renderImage(`Asp_${k}`, { zones: S.res.rebar.layers[k].zones });
  out.shearUtil = renderImage('shearUtil');
  out.mx_uls = renderImage('q:mx', { src: 'env:ULS:max' }); out.my_uls = renderImage('q:my', { src: 'env:ULS:max' });
  // przekroje zdefiniowane przez projektanta — dla wielkości aktualnie wybranej na mapie
  const secs = S.project.sections ?? [];
  if (secs.length) {
    const cm = currentMap();
    out.mapSections = renderImage(S.mapKey, { src: S.vopt.src, sections: true });
    out.sections = secs.map(sec => { const pr = sectionProfile(S.res.mesh.nodes, S.res.mesh.elems, cm.values, sec.a, sec.b, 200, loc()); return { label: sec.label, name: cm.name, unit: cm.unit, src: cm.src, L: pr.L, max: pr.extrema?.max.v, min: pr.extrema?.min.v, img: sectionImage(sec, pr, cm) }; });
  }
  return out;
}
const today = () => new Date().toISOString().slice(0, 10);
// Nazwa pobieranego pliku: przeglądarka odrzuca polskie litery i „—” (zapisuje jako „download”)
const PL = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };
const fileBase = () => (S.project.meta.name || 'projekt').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, c => PL[c]).replace(/[^\w\- ]+/g, '_');

// ---------- akcje ----------
async function persistDb() { S.dbWhere = await saveDbBytes(S.db.export()); }
function openGeometry(text, name) {
  S.geo = loadGeometry(text); S.project.dxf = text; S.dxfName = name; S.res = null; S.stale = true; S.drawing = null; fittedFor = null; S.hl = null;
}
const ACTIONS = {
  async template() { const r = await fetch('dist/TEK-PLYTA_wzorzec.dxf'); await saveFile('TEK-PLYTA_wzorzec.dxf', new Uint8Array(await r.arrayBuffer()), 'application/dxf'); },
  async openDxf() {
    const f = await openFile('.dxf'); if (!f) return;
    try { openGeometry(f.text, f.name); } catch (e) { return toast(`Nie udało się odczytać DXF: ${e.message}`, true); }
    S.tab = 'geo'; render();
  },
  hl(el) { S.hl = el.dataset.i; draw(); },
  addField() { S.pick = { pts: [] }; render(); },
  delField(el) { S.project.sls.fields.splice(+el.dataset.i, 1); S.project.sls.fields.forEach((f, i) => { f.label = `P${i + 1}`; }); markStale(); render(); },
  run,
  addSection() { S.pick = { kind: 'section', pts: [] }; render({ bar: false }); },
  selSection(el) { S.secSel = +el.dataset.i; render({ bar: false }); },
  delSection(el) { S.project.sections.splice(+el.dataset.i, 1); S.project.sections.forEach((x, i) => { x.label = `X${i + 1}`; }); S.secSel = 0; render({ bar: false }); },
  rebarLayer(el) { S.rebarLayer = el.dataset.k; render(); },
  async saveDxf() { const d = ensureDrawing(); await saveFile(`${fileBase()} - zbrojenie.dxf`, d.bytes, 'application/dxf'); toast('Zapisano rysunek DXF.'); },
  reportPdf() {
    const doc = buildReport(S.project, S.res, reportImages(), { date: today(), unlicensed: !S.license.ok });
    const w = window.open('', '_blank'); if (!w) return toast('Przeglądarka zablokowała okno podglądu.', true);
    w.document.write(renderHTML(doc).replace('</body>', '<script>setTimeout(()=>print(),400)<\/script></body>')); w.document.close();
  },
  async reportDocx() {
    const doc = buildReport(S.project, S.res, reportImages(), { date: today(), unlicensed: !S.license.ok });
    await saveFile(`${fileBase()} - raport.docx`, renderDOCX(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  },
  async saveVariant(_, asNew = false) {
    const ok = S.res?.ok && !S.stale;
    const r = S.db.saveVariant({ projectId: S.ids.projectId, variantId: asNew ? null : S.ids.variantId, project: S.project, variantName: S.ids.variantName,
      geometryCheck: S.geo ? { errors: S.geo.errors, warnings: S.geo.warnings } : null,
      resultSummary: ok ? { ...S.res.summary, punching: S.res.punching.map(p => ({ label: p.label, util: p.util })) } : null, version: VERSION });
    Object.assign(S.ids, r); await persistDb(); toast('Zapisano w bazie.'); render();
  },
  saveNewVariant(el) { const n = prompt('Nazwa nowego wariantu:', `${S.ids.variantName} (2)`); if (!n) return; S.ids.variantName = n; return ACTIONS.saveVariant(el, true); },
  resetNorms() { if (!confirm('Przywrócić wszystkie wartości normowe?')) return; S.project.norms = {}; markStale(); render(); },
  newProject() {
    if (S.geo && !confirm('Nowy projekt? Niezapisane zmiany zostaną utracone.')) return;
    S.project = defaultProject(); S.geo = null; S.res = null; S.dxfName = null; S.drawing = null; S.ids = { projectId: null, variantId: null, variantName: 'wariant 1' }; fittedFor = null; S.tab = 'geo'; render();
  },
  loadVariant(el) {
    const v = S.db.loadVariant(+el.dataset.id);
    S.project = { ...defaultProject(), ...v.project }; S.ids = { projectId: v.projectId, variantId: v.variantId, variantName: v.variantName };
    S.geo = S.project.dxf ? loadGeometry(S.project.dxf) : null; S.dxfName = S.geo ? '(z bazy)' : null; S.res = null; S.stale = true; S.drawing = null; fittedFor = null; S.tab = 'geo'; render();
  },
  async delProject(el) { if (!confirm('Usunąć projekt ze wszystkimi wariantami?')) return; S.db.deleteProject(+el.dataset.id); await persistDb(); render(); },
  async delVariant(el) { if (!confirm('Usunąć wariant?')) return; S.db.deleteVariant(+el.dataset.id); await persistDb(); render(); },
  async exportFile() { await saveFile(`${fileBase()}.tekplyta`, exportProjectFile(S.project, VERSION), 'application/json'); },
  async importFile() {
    const f = await openFile('.tekplyta', 'utf-8'); if (!f) return;
    try { S.project = { ...defaultProject(), ...importProjectFile(f.text) }; } catch (e) { return toast(e.message, true); }
    S.geo = S.project.dxf ? loadGeometry(S.project.dxf) : null; S.dxfName = f.name; S.res = null; S.drawing = null; S.ids = { projectId: null, variantId: null, variantName: 'wariant 1' }; fittedFor = null; S.tab = 'geo'; render();
  },
  async aiPackage() { await saveFile(`${fileBase()} - paczka AI.zip`, buildAIPackage(S.project, S.res, { anonymized: $('#anon').checked, images: reportImages() }), 'application/zip'); },
  aiImport() { try { S.review = parseAIReview($('#aiText').value); } catch (e) { return toast(e.message, true); } render(); },
  async license() { S.license = await checkLicense($('#licKey').value.trim()); toast(S.license.msg, !S.license.ok); render(); },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = ACTIONS[el.dataset.act]; if (a) Promise.resolve(a(el)).catch(err => { console.error(err); toast(err.message, true); });
});

// ---------- start ----------
async function start() {
  if (isNative()) { try { Neutralino.init(); } catch { /* wersja przeglądarkowa */ } }
  S.license = await checkLicense();
  try {
    const SQL = await initSqlJs({ locateFile: f => `dist/${f}` });
    S.db = new ProjectDB(SQL, await loadDbBytes());
    S.dbWhere = isNative() ? 'plik w Dokumenty/TEK-PLYTA/tekplyta.db' : 'IndexedDB przeglądarki';
  } catch (e) { console.error(e); S.dbWhere = `błąd bazy: ${e.message}`; }
  render();
}
start();
window.__TEK = S; // do testów automatycznych interfejsu
