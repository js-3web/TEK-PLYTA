// TEK-PŁYTA — aplikacja (wątek główny): moduły Geometria · Dane · Siatka · Wyniki · Wymiarowanie ·
// Raport · Projekty · AI. Obliczenia w Web Workerze (worker.js), stan projektu w obiekcie S.project.

import { defaultProject, loadGeometry, VERSION, meshArea } from '../../src/app/pipeline.js';
import { CONCRETE, STEEL, NORM as EC2 } from '../../src/norms/en1992-pl.js';
import { PSI, NORM as EC0 } from '../../src/norms/en1990-pl.js';
import { WMAX } from '../../src/design/sls.js';
import { buildReport, renderHTML, renderDOCX, LIMITS } from '../../src/report/report.js';
import { ProjectDB, exportProjectFile, importProjectFile } from '../../src/app/db.js';
import { buildAIPackage, parseAIReview } from '../../src/app/ai.js';
import { View, bboxOf, clear, drawGeometry, drawMesh, drawMap, colorScale, legendHTML, nearestNode } from './render.js';
import { isNative, saveFile, openFile, loadDbBytes, saveDbBytes } from './storage.js';
import { checkLicense } from './license.js';
import initSqlJs from 'sql.js/dist/sql-wasm.js';

const $ = s => document.querySelector(s);
const S = {
  project: defaultProject(), geo: null, dxfName: null, res: null, stale: true, mod: 'geo', mapKey: 'w_lt',
  db: null, dbWhere: '', ids: { projectId: null, variantId: null, variantName: 'wariant 1' }, review: [], pick: null, hl: null,
  license: { ok: false, msg: '' },
};
const cv = $('#cv'), ctx = cv.getContext('2d'), view = new View(cv);
const fmt = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).replace('.', ',') : '—');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- dane projektu: ścieżki „a.b.c” ----------
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.'); let a = o;
  for (const k of ks.slice(0, -1)) a = a[k] ??= {};
  a[ks.at(-1)] = v;
}
const UNIT = { mm: [v => v * 1000, v => v / 1000], m: [v => v, v => v], num: [v => v, v => v] };
function inp(path, unit = 'num', attrs = '') {
  const v = getPath(S.project, path), [show] = UNIT[unit];
  return `<input type="number" step="any" data-path="${path}" data-unit="${unit}" value="${v == null ? '' : +show(v).toPrecision(6)}" ${attrs}>`;
}
function sel(path, options, attrs = '') {
  const v = getPath(S.project, path);
  return `<select data-path="${path}" data-unit="str" ${attrs}>${options.map(([val, txt]) => `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(txt ?? val)}</option>`).join('')}</select>`;
}
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
  if (el.dataset.rerender) renderPanel();
});

function markStale() { if (S.res) { S.stale = true; status(); } }
function status(msg) {
  $('#status').innerHTML = msg ?? [
    S.dxfName ? `DXF: ${esc(S.dxfName)}` : 'brak DXF',
    S.res ? (S.stale ? '<span class="bad">wyniki nieaktualne — przelicz</span>' : '<span class="good">wyniki aktualne</span>') : '',
    S.license.ok ? '' : '<span class="bad">wersja bez licencji</span>',
  ].filter(Boolean).join(' · ');
}

// ---------- moduły ----------
document.querySelectorAll('#nav button').forEach(b => b.onclick = () => {
  S.mod = b.dataset.mod;
  document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x === b));
  renderPanel(); draw();
});

const PANELS = {
  geo() {
    const g = S.geo;
    let h = `<h2>Geometria</h2>
      <p class="muted">Narysuj płytę w ZWCAD na warstwach wzorca (jednostki: mm), zapisz jako DXF 2010 i wczytaj.</p>
      <button class="btn" data-act="template">Pobierz wzorzec DXF</button>
      <button class="btn primary" data-act="openDxf">Wczytaj DXF</button>`;
    if (!g) return h + '<p class="muted">Brak wczytanego rysunku.</p>';
    h += `<h3>Zawartość</h3><table>
      <tr><td>Pole płyty</td><td class="num">${fmt(g.info?.area)} m²</td></tr>
      <tr><td>Otwory / słupy / ściany / krawędzie</td><td class="num">${g.holes.length} / ${g.columns.length} / ${g.walls.length} / ${g.edges.length}</td></tr>
      <tr><td>Obciążenia: strefy / liniowe / skupione</td><td class="num">${g.areaLoads.length} / ${g.lineLoads.length} / ${g.pointLoads.length}</td></tr></table>`;
    h += `<h3>Kontrola rysunku</h3>`;
    if (!g.errors.length && !g.warnings.length) h += '<div class="msg ok">Bez błędów i ostrzeżeń.</div>';
    g.errors.forEach((e, i) => { h += `<div class="msg err" data-act="hl" data-i="e${i}">${esc(e.msg)}${e.loc ? ` <span class="muted">(X=${fmt(e.loc[0], 1)} Y=${fmt(e.loc[1], 1)})</span>` : ''}</div>`; });
    g.warnings.forEach((e, i) => { h += `<div class="msg warn" data-act="hl" data-i="w${i}">${esc(e.msg)}${e.loc ? ` <span class="muted">(X=${fmt(e.loc[0], 1)} Y=${fmt(e.loc[1], 1)})</span>` : ''}</div>`; });
    if (g.errors.length) h += '<p class="bad">Błędy krytyczne blokują obliczenia — popraw rysunek i wczytaj ponownie.</p>';
    return h;
  },

  data() {
    const g = S.geo, P = S.project;
    if (!g) return '<h2>Dane</h2><p class="muted">Najpierw wczytaj DXF (moduł Geometria).</p>';
    const concrete = Object.keys(CONCRETE).map(k => [k]), steel = Object.keys(STEEL).map(k => [k]);
    let h = `<h2>Dane</h2>
      <h3>Płyta</h3><div class="grid">
        <span>Grubość h [mm]</span>${inp('slab.h', 'mm')}
        <span>Beton</span>${sel('slab.concrete', concrete)}
        <span>Stal</span>${sel('slab.steel', steel)}
        <span>Ciężar betonu [kN/m³]</span>${inp('slab.gamma')}
      </div>
      <h3>Zbrojenie podstawowe (siatki)</h3><div class="grid">
        <span>Otulina dół / góra [mm]</span><span>${inp('reinf.cover.bottom', 'mm')} ${inp('reinf.cover.top', 'mm')}</span>`;
    for (const [face, name] of [['bottom', 'Dół'], ['top', 'Góra']]) {
      const r = P.reinf[face];
      h += `<span>${name} x: ϕ / s [mm]</span><span>${inp(`reinf.${face}.phiX`, 'mm')} ${inp(`reinf.${face}.sX`, 'mm')} <span class="muted">${fmt(meshArea(r.phiX, r.sX), 0)} mm²/m</span></span>
        <span>${name} y: ϕ / s [mm]</span><span>${inp(`reinf.${face}.phiY`, 'mm')} ${inp(`reinf.${face}.sY`, 'mm')} <span class="muted">${fmt(meshArea(r.phiY, r.sY), 0)} mm²/m</span></span>
        <span>${name}: warstwa zewnętrzna</span>${sel(`reinf.${face}.outer`, [['x', 'pręty x'], ['y', 'pręty y']])}`;
    }
    h += '</div>';

    const labels = [...g.areaLoads.map(o => [o.label, 'kN/m²']), ...g.lineLoads.map(o => [o.label, 'kN/m']), ...g.pointLoads.map(o => [o.label, 'kN'])];
    h += `<h3>Obciążenia (wartości charakterystyczne)</h3><p class="muted">Ciężar własny G0 liczony automatycznie. Kategoria wg PN-EN 1991-1-1 (ψ z tabl. A1.1).</p>
      <table><tr><th>Etykieta</th><th>Wartość</th><th>Typ</th><th>Kategoria</th></tr>`;
    const cats = Object.entries(PSI).map(([k, v]) => [k, `${k} — ${v.opis.replace(/^kat\. \w — /, '')}`]);
    for (const [l, unit] of labels) {
      P.loads[l] ??= { value: null, type: l.startsWith('L') ? 'G' : 'Q', category: 'B' };
      h += `<tr><td>${l}</td><td>${inp(`loads.${l}.value`)} <span class="muted">${unit}</span></td>
        <td>${sel(`loads.${l}.type`, [['G', 'stałe G'], ['Q', 'zmienne Q']], 'data-rerender="1"')}</td>
        <td>${P.loads[l].type === 'Q' ? sel(`loads.${l}.category`, cats) : '—'}</td></tr>`;
    }
    h += '</table>';

    const mat = [['zelbet', 'żelbet'], ['mur', 'mur'], ['stal', 'stal']];
    if (g.columns.length) {
      h += `<h3>Słupy</h3><table><tr><th></th><th>Materiał</th><th>Beton / E [MPa]</th><th>H [m]</th><th>Dół</th><th>Sztywna</th></tr>`;
      for (const l of ['domyślne', ...g.columns.map(c => c.label)]) {
        if (l !== 'domyślne') P.columns[l] ??= {};
        const m = { ...P.columns['domyślne'], ...P.columns[l] };
        const base = `columns.${l}`;
        if (l !== 'domyślne') for (const k of ['material', 'concrete', 'E', 'H', 'bottom', 'rigid']) if (P.columns[l][k] === undefined) P.columns[l][k] = m[k];
        h += `<tr><td>${l === 'domyślne' ? '<b>wszystkie</b>' : l}</td><td>${sel(`${base}.material`, mat, 'data-rerender="1"')}</td>
          <td>${m.material === 'zelbet' ? sel(`${base}.concrete`, concrete) : m.material === 'mur' ? inp(`${base}.E`) : '210 000'}</td>
          <td>${inp(`${base}.H`)}</td><td>${sel(`${base}.bottom`, [['fixed', 'utwierdzony'], ['pinned', 'przegub']])}</td><td>${chk(`${base}.rigid`)}</td></tr>`;
      }
      h += '</table><p class="muted">Wiersz „wszystkie” ustawia wartości domyślne; zmiana w wierszu słupa nadpisuje je dla tego słupa.</p>';
    }
    if (g.walls.length) {
      h += `<h3>Ściany</h3><table><tr><th></th><th>Materiał</th><th>Beton / E [MPa]</th><th>t [mm]</th><th>H [m]</th><th>Dół</th><th>Sztywna</th></tr>`;
      for (const l of ['domyślne', ...g.walls.map(c => c.label)]) {
        if (l !== 'domyślne') { P.walls[l] ??= {}; for (const k of ['material', 'concrete', 'E', 't', 'H', 'bottom', 'rigid']) if (P.walls[l][k] === undefined) P.walls[l][k] = P.walls['domyślne'][k]; }
        const m = { ...P.walls['domyślne'], ...P.walls[l] }, base = `walls.${l}`;
        h += `<tr><td>${l === 'domyślne' ? '<b>wszystkie</b>' : l}</td><td>${sel(`${base}.material`, mat, 'data-rerender="1"')}</td>
          <td>${m.material === 'zelbet' ? sel(`${base}.concrete`, concrete) : m.material === 'mur' ? inp(`${base}.E`) : '210 000'}</td>
          <td>${inp(`${base}.t`, 'mm')}</td><td>${inp(`${base}.H`)}</td>
          <td>${sel(`${base}.bottom`, [['pinned', 'przegub'], ['fixed', 'utwierdzona'], ['free', 'obrót swobodny']])}</td><td>${chk(`${base}.rigid`)}</td></tr>`;
      }
      h += '</table>';
    }
    if (g.edges.length) {
      h += `<h3>Krawędzie podparte</h3><table>`;
      for (const l of g.edges.map(e => e.label)) { P.edges[l] ??= { type: P.edges['domyślne'].type }; h += `<tr><td>${l}</td><td>${sel(`edges.${l}.type`, [['pinned', 'przegubowa'], ['fixed', 'utwierdzona']])}</td></tr>`; }
      h += '</table>';
    }
    h += `<h3>Kombinacje i przebicie</h3><div class="grid">
      <span>SGN (PN-EN 1990)</span><select id="formulas"><option value="ab" ${P.combination.formulas.length === 2 ? 'selected' : ''}>6.10a / 6.10b (zalecane NA)</option><option value="10" ${P.combination.formulas.length === 1 ? 'selected' : ''}>6.10</option></select>
      <span>β przy przebiciu</span><span>${sel('punching.beta', [['uproszczone', 'uproszczone 6.4.3(6)']])}</span></div>
      <h3>SGU</h3><div class="grid">
      <span>Wilgotność RH [%]</span>${inp('sls.RH')}
      <span>Cement</span>${sel('sls.cement', [['S', 'S (wolnowiążący)'], ['N', 'N (normalny)'], ['R', 'R (szybkowiążący)']])}
      <span>Wiek przy obciążeniu t0 [dni]</span>${inp('sls.t0')}
      <span>Klasa ekspozycji</span>${sel('sls.exposure', Object.keys(WMAX).map(k => [k, `${k} (wmax ${WMAX[k]} mm)`]))}
      </div>
      <h3>Pola do oceny ugięć (L/250, L/500)</h3>
      <p class="muted">Rozpiętość odniesienia L zadaje projektant (program podpowiada krótszy bok zaznaczenia).</p>
      <table><tr><th>Pole</th><th>L [m]</th><th></th></tr>${P.sls.fields.map((f, i) => `<tr><td>${esc(f.label)}</td><td>${inp(`sls.fields.${i}.L`)}</td><td><button class="btn danger" data-act="delField" data-i="${i}">usuń</button></td></tr>`).join('')}</table>
      <button class="btn" data-act="addField">${S.pick ? 'Kliknij 2 narożniki pola na rzucie…' : 'Dodaj pole (zaznacz na rzucie)'}</button>`;
    return h;
  },

  mesh() {
    const r = S.res;
    let h = `<h2>Siatka i obliczenia</h2><div class="grid"><span>Oczko podstawowe h0 [m]</span>${inp('mesh.h0')}</div>
      <p class="muted">Siatka zagęszcza się automatycznie przy słupach (h0/4), w narożach wklęsłych i przy siłach skupionych. Zalecane h0 ≈ 0,5 m; mniejsze — dokładniej i wolniej.</p>
      <button class="btn primary" data-act="run" ${S.geo && !S.geo.errors.length ? '' : 'disabled'}>Licz</button>`;
    if (r?.ok) h += `<h3>Ostatnie obliczenia</h3><table>
      <tr><td>Węzły / elementy / niewiadome</td><td class="num">${r.summary.nodes} / ${r.summary.elements} / ${r.summary.unknowns}</td></tr>
      <tr><td>Najmniejszy kąt trójkąta</td><td class="num">${fmt(r.summary.minAngle, 1)}°</td></tr>
      <tr><td>Czas: siatka / MES / SGN / SGU</td><td class="num">${Object.values(r.summary.times).map(t => fmt(t / 1000, 1)).join(' / ')} s</td></tr></table>`;
    if (r && !r.ok) h += r.errors.map(e => `<div class="msg err">${esc(e.msg)}</div>`).join('');
    return h;
  },

  res() {
    const r = S.res;
    if (!r?.ok) return '<h2>Wyniki</h2><p class="muted">Brak wyników — policz w module Siatka.</p>';
    let h = `<h2>Wyniki</h2><select id="mapSel" style="width:100%">${MAPS.map(m => `<option value="${m.key}" ${m.key === S.mapKey ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
      <p class="muted">Najedź na rzut: wartość w najbliższym węźle. Kółko myszy — powiększenie, przeciąganie — przesuw.</p>
      <h3>Kontrola modelu: suma reakcji = obciążenie</h3><table><tr><th>Przypadek</th><th>Obciążenie [kN]</th><th>Reakcje [kN]</th><th>Błąd</th></tr>
      ${r.equilibrium.map(e => `<tr><td>${e.case}</td><td class="num">${fmt(e.load)}</td><td class="num">${fmt(e.reactions)}</td><td class="num ${e.error < 1e-6 ? 'good' : 'bad'}">${e.error.toExponential(1)}</td></tr>`).join('')}</table>
      <h3>Reakcje podpór (obwiednia SGN)</h3><table><tr><th>Podpora</th><th>V max [kN]</th><th>V min [kN]</th><th>Kombinacja</th></tr>
      ${r.supports.map(s => `<tr><td>${s.label}</td><td class="num">${fmt(s.Vmax, 1)}</td><td class="num">${fmt(s.Vmin, 1)}</td><td>${esc(s.gov)}</td></tr>`).join('')}</table>`;
    if (r.warnings.length) h += '<h3>Ostrzeżenia</h3>' + r.warnings.map(w => `<div class="msg warn">${esc(w.msg)}</div>`).join('');
    return h;
  },

  design() {
    const r = S.res;
    if (!r?.ok) return '<h2>Wymiarowanie</h2><p class="muted">Brak wyników.</p>';
    const T = { wewnetrzny: 'wewn.', krawedziowy: 'kraw.', narozny: 'naroż.' };
    let h = `<h2>Wymiarowanie</h2><h3>Zginanie — As wymagane max [mm²/m]</h3><table><tr><th>Warstwa</th><th>As,req</th><th>Siatka</th><th></th></tr>`;
    const L = { bottomX: 'dół x', bottomY: 'dół y', topX: 'góra x', topY: 'góra y' };
    for (const [k, v] of Object.entries(r.summary.AsMax)) {
      const base = r.design.base[k.startsWith('bottom') ? 'bottom' : 'top'][k.endsWith('X') ? 'x' : 'y'];
      h += `<tr><td>${L[k]}</td><td class="num">${fmt(v, 0)}</td><td class="num">${fmt(base, 0)}</td><td class="${v > base + 0.5 ? 'bad' : 'good'}">${v > base + 0.5 ? 'dozbroić' : 'OK'}</td></tr>`;
    }
    h += `</table><p class="muted">Gdzie dozbroić — mapy „Dozbrojenie ponad siatkę” w module Wyniki.</p>
      <h3>Przebicie (6.4)</h3><table><tr><th>Słup</th><th>Typ</th><th>VEd</th><th>β</th><th>u1</th><th>vEd/vRd,c</th><th>vEd,0/vRd,max</th><th>Asw/obw.</th></tr>
      ${r.punching.map(p => `<tr><td>${p.label}</td><td>${T[p.type]}</td><td class="num">${fmt(p.VEd, 0)}</td><td class="num">${fmt(p.beta)}</td><td class="num">${fmt(p.u1)}</td>
        <td class="num ${p.util > 1 ? 'bad' : 'good'}">${fmt(p.util)}</td><td class="num ${p.utilMax > 1 ? 'bad' : ''}">${fmt(p.utilMax)}</td>
        <td class="num">${p.shearReinforcement ? `${fmt(p.shearReinforcement.AswPerPerimeter, 0)} mm²` : '—'}</td></tr>`).join('')}</table>
      <p class="muted">VEd [kN], u1 [m]. Asw — zbrojenie na jeden obwód przy sr = 0,75d (6.52).</p>
      <h3>Ugięcia (7.4.3)</h3><p>φ = ${fmt(r.sls.phi)}, εcs = ${fmt(r.sls.ecs * 1000, 3)} ‰, iteracje: ${r.sls.iterations}${r.sls.converged ? '' : ' <span class="bad">(brak zbieżności)</span>'}; w max = ${fmt(r.summary.wLtMax * 1000, 1)} mm</p>`;
    if (r.sls.fields.length) h += `<table><tr><th>Pole</th><th>w [mm]</th><th>L/250</th><th>Δw [mm]</th><th>L/500</th></tr>${r.sls.fields.map(f => `<tr><td>${esc(f.label)}</td><td class="num ${f.w > f.wLim ? 'bad' : ''}">${fmt(f.w * 1000, 1)}</td><td class="num">${fmt(f.wLim * 1000, 1)}</td><td class="num ${f.dw > f.dwLim ? 'bad' : ''}">${fmt(f.dw * 1000, 1)}</td><td class="num">${fmt(f.dwLim * 1000, 1)}</td></tr>`).join('')}</table>`;
    else h += '<p class="muted">Dodaj pola do oceny ugięć w module Dane.</p>';
    h += `<h3>Rysy (7.3.4)</h3><p>wk,max = <span class="${r.sls.wkMax > r.sls.wmax ? 'bad' : 'good'}">${fmt(r.sls.wkMax)} mm</span> (wmax = ${fmt(r.sls.wmax, 1)} mm)</p>`;
    return h;
  },

  report() {
    let h = `<h2>Raport</h2><p class="muted">Raport z punktami normy, mapami i przykładem krok po kroku dla najbardziej wytężonego słupa.</p>
      <button class="btn primary" data-act="reportPdf" ${S.res?.ok ? '' : 'disabled'}>Podgląd i PDF</button>
      <button class="btn" data-act="reportDocx" ${S.res?.ok ? '' : 'disabled'}>Pobierz DOCX</button>
      ${S.stale && S.res ? '<p class="bad">Wyniki nieaktualne — przelicz przed raportem.</p>' : ''}
      <p class="muted">PDF: w oknie podglądu wybierz „Drukuj → Zapisz jako PDF”.</p>
      <details open><summary>Granice modelu</summary><ul>${LIMITS.map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>
      <details><summary>Źródła</summary><ul>
        <li>PN-EN 1990:2004 + NA; PN-EN 1991-1-1; PN-EN 1992-1-1:2008 + NA</li>
        <li>Batoz, Bathe, Ho (1980) — element DKT; Lee, Bathe (2004) — MITC3 (kontrolny)</li>
        <li>Wood (1968), Armer (1968) — momenty wymiarujące</li>
        <li>Timoshenko, Woinowsky-Krieger; NAFEMS LE6; Grbac, Ribarić (2022) — testy wzorcowe</li>
        <li>Davis — CSparse (rozkład Cholesky'ego); delaunator, constrainautor (ISC); sql.js, Neutralinojs (MIT) — <a href="dist/THIRD_PARTY_LICENSES.txt" target="_blank" style="color:var(--acc)">teksty licencji</a></li></ul></details>
      <details><summary>Status wartości krajowych</summary><p>${EC0.verified && EC2.verified ? 'Potwierdzone.' : 'Część wartości krajowych (γc, αcc, ψ, vRd,max, zał. B, tabl. 7.1N) nie została porównana z tekstem NA — raport to pokazuje.'}</p></details>`;
    return h;
  },

  projects() {
    let h = `<h2>Projekty</h2><div class="grid">
      <span>Nazwa</span>${txt('meta.name')}<span>Inwestor</span>${txt('meta.investor')}<span>Obiekt</span>${txt('meta.object')}<span>Autor</span>${txt('meta.author')}
      <span>Wariant</span><input type="text" id="variantName" value="${esc(S.ids.variantName)}"></div>
      <button class="btn primary" data-act="saveVariant" ${S.db ? '' : 'disabled'}>Zapisz</button>
      <button class="btn" data-act="saveNewVariant" ${S.db && S.ids.projectId ? '' : 'disabled'}>Zapisz jako nowy wariant</button>
      <button class="btn" data-act="newProject">Nowy projekt</button>
      <p class="muted">Baza: ${esc(S.dbWhere || 'niedostępna')}</p>
      <button class="btn" data-act="exportFile">Eksport .tekplyta</button><button class="btn" data-act="importFile">Import .tekplyta</button>
      <h3>Licencja</h3><p class="${S.license.ok ? 'good' : 'bad'}">${esc(S.license.msg)}</p>
      <input type="text" id="licKey" placeholder="wklej klucz licencji" style="width:70%"> <button class="btn" data-act="license">Zapisz klucz</button>
      <h3>Zapisane projekty</h3>`;
    if (!S.db) return h + '<p class="muted">Baza niedostępna.</p>';
    const list = S.db.list(VERSION);
    if (!list.length) h += '<p class="muted">Brak zapisanych projektów.</p>';
    for (const p of list) {
      h += `<p><b>${esc(p.nazwa)}</b> <span class="muted">${esc(p.obiekt)} · ${esc(p.inwestor)}</span> <button class="btn danger" data-act="delProject" data-id="${p.id}">usuń</button></p><table>
        ${p.warianty.map(w => `<tr><td>${esc(w.nazwa)}</td><td class="${w.status === 'aktualne' ? 'good' : w.status === 'do przeliczenia' ? 'bad' : 'muted'}">${w.status}</td>
          <td class="muted">${esc(w.zmieniono.slice(0, 16).replace('T', ' '))}</td>
          <td><button class="btn" data-act="loadVariant" data-id="${w.id}">wczytaj</button><button class="btn danger" data-act="delVariant" data-id="${w.id}">×</button></td></tr>`).join('')}</table>`;
    }
    return h;
  },

  ai() {
    let h = `<h2>Asystent AI</h2>
      <p>Aplikacja nie łączy się z AI. Tworzy paczkę (prompt, dane i wyniki, raport), którą wklejasz do własnego narzędzia AI.</p>
      <div class="note">Opinia AI nie jest sprawdzeniem projektu w rozumieniu Prawa budowlanego.</div>
      <label><input type="checkbox" id="anon" checked> anonimizacja (dane inwestora i obiektu zastąpione znacznikami)</label><br>
      <button class="btn primary" data-act="aiPackage" ${S.res?.ok ? '' : 'disabled'}>Utwórz paczkę do sprawdzenia</button>
      <h3>Odpowiedź AI</h3><textarea id="aiText" placeholder="Wklej odpowiedź z blokiem json…"></textarea>
      <button class="btn" data-act="aiImport">Wczytaj uwagi</button>`;
    if (S.review.length) h += `<table><tr><th>Waga</th><th>Miejsce</th><th>Uwaga</th><th>Sprawdzenie</th></tr>${S.review.map(u => `<tr><td class="${u.waga >= 4 ? 'bad' : ''}">${u.waga}</td><td>${esc(u.miejsce)}</td><td>${esc(u.uwaga)}<br><span class="muted">${esc(u.uzasadnienie)}</span></td><td>${esc(u.sprawdzenie)}</td></tr>`).join('')}</table>`;
    return h;
  },
};

function renderPanel() {
  $('#panel').innerHTML = PANELS[S.mod]();
  const f = $('#formulas'); if (f) f.onchange = () => { S.project.combination.formulas = f.value === 'ab' ? ['6.10a', '6.10b'] : ['6.10']; markStale(); };
  const m = $('#mapSel'); if (m) m.onchange = () => { S.mapKey = m.value; draw(); };
  const vn = $('#variantName'); if (vn) vn.onchange = () => { S.ids.variantName = vn.value; };
  status();
}

// ---------- mapy ----------
const MAPS = [
  { key: 'w_lt', name: 'Ugięcie długotrwałe (rysy, pełzanie, skurcz)', unit: 'mm', k: 1000 },
  { key: 'w_el', name: 'Ugięcie sprężyste, kombinacja quasi-stała', unit: 'mm', k: 1000 },
  ...['mx', 'my', 'mxy'].flatMap(c => [{ key: `${c}_max`, name: `${c} max (obwiednia SGN)`, unit: 'kNm/m', div: true }, { key: `${c}_min`, name: `${c} min (obwiednia SGN)`, unit: 'kNm/m', div: true }]),
  ...[['bottomX', 'dół x'], ['bottomY', 'dół y'], ['topX', 'góra x'], ['topY', 'góra y']].flatMap(([k, n]) => [
    { key: `Md_${k}`, name: `Moment wymiarujący ${n} (Wood–Armer)`, unit: 'kNm/m', div: true },
    { key: `As_${k}`, name: `As wymagane ${n}`, unit: 'mm²/m', d: 0 },
    { key: `dAs_${k}`, name: `Dozbrojenie ponad siatkę ${n}`, unit: 'mm²/m', d: 0, zero: true },
    { key: `wk_${k}`, name: `Szerokość rys ${n}`, unit: 'mm', zero: true },
  ]),
];
const mapDef = key => MAPS.find(m => m.key === key);
function mapValues(key) { const d = mapDef(key), a = S.res.maps[key]; return d.k ? Float32Array.from(a, v => v * d.k) : a; }

function resize() {
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(200, Math.floor(r.width)); cv.height = Math.max(200, Math.floor(r.height));
}
let fitted = false;
function draw() {
  clear(ctx); $('#legend').innerHTML = '';
  const g = S.geo; if (!g?.outline?.length) return;
  if (!fitted) { view.fit(bboxOf(g.outline), 30, 250); fitted = true; } // 250 px po prawej na legendę
  const errors = [...g.errors, ...g.warnings].map(e => ({ ...e, locM: e.loc ? [e.loc[0] * g.scale, e.loc[1] * g.scale] : null }));
  const hl = S.hl ? errors[S.hl.startsWith('e') ? +S.hl.slice(1) : g.errors.length + +S.hl.slice(1)] : null;
  const showMap = ['res', 'design', 'report'].includes(S.mod) && S.res?.ok;
  if (showMap) {
    const d = mapDef(S.mapKey), vals = mapValues(S.mapKey);
    const sc = colorScale(vals, { diverging: !!d.div, zeroBlank: !!d.zero });
    drawMap(ctx, view, S.res.mesh, vals, sc);
    $('#legend').innerHTML = `<b>${esc(d.name)}</b>` + legendHTML(sc, d.unit, v => fmt(v, d.d ?? 2));
  } else if (S.mod === 'mesh' && S.res?.ok) drawMesh(ctx, view, S.res.mesh);
  drawGeometry(ctx, view, g, { errors: S.mod === 'geo' ? errors : [], highlight: hl, fields: S.project.sls.fields });
  if (S.pick?.pts?.length === 1) { const [x, y] = view.toScreen(S.pick.pts[0]); ctx.fillStyle = '#c084fc'; ctx.fillRect(x - 3, y - 3, 6, 6); }
}

// pan / zoom / odczyt / zaznaczanie pól
let drag = null;
cv.addEventListener('wheel', e => { e.preventDefault(); view.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15); draw(); }, { passive: false });
cv.addEventListener('mousedown', e => { drag = { x: e.offsetX, y: e.offsetY, moved: false }; });
cv.addEventListener('mousemove', e => {
  if (drag && (Math.abs(e.offsetX - drag.x) + Math.abs(e.offsetY - drag.y) > 3)) { view.pan(e.offsetX - drag.x, e.offsetY - drag.y); drag = { x: e.offsetX, y: e.offsetY, moved: true }; draw(); return; }
  const w = view.toWorld(e.offsetX, e.offsetY);
  let t = `X = ${fmt(w[0])} m, Y = ${fmt(w[1])} m`;
  if (S.res?.ok && ['res', 'design', 'report'].includes(S.mod)) {
    const n = nearestNode(S.res.mesh.nodes, w), d = mapDef(S.mapKey);
    if (n.dist * view.scale < 25) t += ` · ${d.name}: <b>${fmt(mapValues(S.mapKey)[n.index], d.d ?? 2)} ${d.unit}</b>`;
  }
  $('#readout').innerHTML = t;
});
cv.addEventListener('mouseup', e => {
  const moved = drag?.moved; drag = null;
  if (moved || !S.pick) return;
  S.pick.pts.push(view.toWorld(e.offsetX, e.offsetY));
  if (S.pick.pts.length === 2) {
    const [[x0, y0], [x1, y1]] = S.pick.pts, w = Math.abs(x1 - x0), hgt = Math.abs(y1 - y0);
    const n = S.project.sls.fields.length + 1, Ls = +Math.min(w, hgt).toFixed(2);
    const L = parseFloat(String(prompt(`Rozpiętość odniesienia L [m] dla pola P${n} (podpowiedź: krótszy bok ${Ls} m):`, Ls)).replace(',', '.'));
    if (L > 0) S.project.sls.fields.push({ label: `P${n}`, L, pts: [[Math.min(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.min(y0, y1)], [Math.max(x0, x1), Math.max(y0, y1)], [Math.min(x0, x1), Math.max(y0, y1)]] });
    S.pick = null; markStale(); renderPanel();
  }
  draw();
});
cv.addEventListener('dblclick', () => { if (S.geo) { view.fit(bboxOf(S.geo.outline), 30, 250); draw(); } });
window.addEventListener('resize', () => { resize(); fitted = false; draw(); });

// ---------- obliczenia w wątku ----------
let worker = null;
function run() {
  const fl = S.project.sls.fields.filter(f => !(f.L > 0));
  if (fl.length) return alert('Uzupełnij rozpiętości L pól ugięć.');
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pr = $('#progress'); pr.classList.remove('hidden'); pr.querySelector('span').textContent = 'start…'; pr.querySelector('.bar').style.width = '2%';
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { pr.querySelector('.bar').style.width = `${Math.round(data.frac * 100)}%`; pr.querySelector('span').textContent = data.stage; return; }
    pr.classList.add('hidden');
    if (data.type === 'error') { alert(`Błąd obliczeń: ${data.message}`); console.error(data.stack); return; }
    S.res = data.res; S.stale = !data.res.ok;
    if (data.res.ok) { S.mod = 'res'; document.querySelectorAll('#nav button').forEach(x => x.classList.toggle('on', x.dataset.mod === 'res')); }
    renderPanel(); draw();
  };
  worker.postMessage({ type: 'run', project: structuredClone(S.project) });
}

// ---------- rysunki do raportu (białe tło) ----------
function renderImage(key) {
  const c = document.createElement('canvas'); c.width = 1400; c.height = 900;
  const x = c.getContext('2d'), v = new View(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  v.fit(bboxOf(S.geo.outline), 40);
  if (key === 'mesh') drawMesh(x, v, S.res.mesh, 'rgba(60,80,110,0.5)');
  else {
    const d = mapDef(key), vals = mapValues(key), sc = colorScale(vals, { diverging: !!d.div, zeroBlank: false });
    v.fit(bboxOf(S.geo.outline), 40); v.ox -= 90; // miejsce na legendę
    drawMap(x, v, S.res.mesh, vals, sc);
    for (let i = 0; i < sc.bands; i++) {
      const lo = sc.min + (sc.max - sc.min) * i / sc.bands, hi = sc.min + (sc.max - sc.min) * (i + 1) / sc.bands, [r, g, b] = sc.color((lo + hi) / 2), y = 820 - i * 52;
      x.fillStyle = `rgb(${r},${g},${b})`; x.fillRect(1180, y, 26, 44); x.fillStyle = '#111'; x.font = '18px Arial';
      x.fillText(`${fmt(lo, d.d ?? 2)} … ${fmt(hi, d.d ?? 2)}`, 1212, y + 28);
    }
    x.fillStyle = '#111'; x.font = 'bold 18px Arial'; x.fillText(d.unit, 1180, 40);
  }
  drawGeometry(x, v, S.geo, { light: true, fields: S.project.sls.fields });
  return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
}
function reportImages() {
  const keys = ['mesh', 'w_lt', 'dAs_bottomX', 'dAs_bottomY', 'dAs_topX', 'dAs_topY'];
  return Object.fromEntries(keys.map(k => [k, renderImage(k)]));
}
const today = () => new Date().toISOString().slice(0, 10);
// Nazwa pliku do pobrania: przeglądarka (Chromium) odrzuca nazwy z polskimi literami i „—” (zapisuje
// jako „download”), więc litery zamieniamy na łacińskie; okno .exe zapisuje przez systemowe „Zapisz jako”.
const PL = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z', Ą: 'A', Ć: 'C', Ę: 'E', Ł: 'L', Ń: 'N', Ó: 'O', Ś: 'S', Ź: 'Z', Ż: 'Z' };
const fileBase = () => (S.project.meta.name || 'projekt').replace(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g, c => PL[c]).replace(/[^\w\- ]+/g, '_');

// ---------- akcje ----------
const ACTIONS = {
  async template() {
    const r = await fetch('dist/TEK-PLYTA_wzorzec.dxf'); await saveFile('TEK-PLYTA_wzorzec.dxf', new Uint8Array(await r.arrayBuffer()), 'application/dxf');
  },
  async openDxf() {
    const f = await openFile('.dxf'); if (!f) return;
    try { S.geo = loadGeometry(f.text); } catch (e) { return alert(`Nie udało się odczytać DXF: ${e.message}`); }
    S.project.dxf = f.text; S.dxfName = f.name; S.res = null; S.stale = true; fitted = false; S.hl = null;
    renderPanel(); draw();
  },
  hl(el) { S.hl = el.dataset.i; draw(); },
  addField() { S.pick = { pts: [] }; renderPanel(); },
  delField(el) { S.project.sls.fields.splice(+el.dataset.i, 1); S.project.sls.fields.forEach((f, i) => { f.label = `P${i + 1}`; }); markStale(); renderPanel(); draw(); },
  run,
  reportPdf() {
    const doc = buildReport(S.project, S.res, reportImages(), { date: today(), unlicensed: !S.license.ok });
    const w = window.open('', '_blank');
    if (!w) return alert('Przeglądarka zablokowała okno podglądu.');
    w.document.write(renderHTML(doc).replace('</body>', '<script>setTimeout(()=>print(),400)<\/script></body>')); w.document.close();
  },
  async reportDocx() {
    const doc = buildReport(S.project, S.res, reportImages(), { date: today(), unlicensed: !S.license.ok });
    await saveFile(`${fileBase()} - raport.docx`, renderDOCX(doc), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  },
  async saveVariant(_, asNew = false) {
    const ok = S.res?.ok && !S.stale;
    const r = S.db.saveVariant({
      projectId: S.ids.projectId, variantId: asNew ? null : S.ids.variantId, project: S.project, variantName: S.ids.variantName,
      geometryCheck: S.geo ? { errors: S.geo.errors, warnings: S.geo.warnings } : null,
      resultSummary: ok ? { ...S.res.summary, punching: S.res.punching.map(p => ({ label: p.label, util: p.util })) } : null, version: VERSION,
    });
    Object.assign(S.ids, r); S.dbWhere = await saveDbBytes(S.db.export()); renderPanel();
  },
  saveNewVariant(el) {
    const n = prompt('Nazwa nowego wariantu:', `${S.ids.variantName} (2)`); if (!n) return;
    S.ids.variantName = n; return ACTIONS.saveVariant(el, true);
  },
  newProject() {
    if (!confirm('Nowy projekt? Niezapisane zmiany zostaną utracone.')) return;
    S.project = defaultProject(); S.geo = null; S.res = null; S.dxfName = null; S.ids = { projectId: null, variantId: null, variantName: 'wariant 1' }; fitted = false; renderPanel(); draw();
  },
  loadVariant(el) {
    const v = S.db.loadVariant(+el.dataset.id);
    S.project = { ...defaultProject(), ...v.project }; S.ids = { projectId: v.projectId, variantId: v.variantId, variantName: v.variantName };
    S.geo = S.project.dxf ? loadGeometry(S.project.dxf) : null; S.dxfName = S.geo ? '(z bazy)' : null; S.res = null; S.stale = true; fitted = false;
    renderPanel(); draw();
  },
  async delProject(el) { if (!confirm('Usunąć projekt ze wszystkimi wariantami?')) return; S.db.deleteProject(+el.dataset.id); S.dbWhere = await saveDbBytes(S.db.export()); renderPanel(); },
  async delVariant(el) { if (!confirm('Usunąć wariant?')) return; S.db.deleteVariant(+el.dataset.id); S.dbWhere = await saveDbBytes(S.db.export()); renderPanel(); },
  async exportFile() { await saveFile(`${fileBase()}.tekplyta`, exportProjectFile(S.project, VERSION), 'application/json'); },
  async importFile() {
    const f = await openFile('.tekplyta', 'utf-8'); if (!f) return;
    try { S.project = { ...defaultProject(), ...importProjectFile(f.text) }; } catch (e) { return alert(e.message); }
    S.geo = S.project.dxf ? loadGeometry(S.project.dxf) : null; S.dxfName = f.name; S.res = null; S.ids = { projectId: null, variantId: null, variantName: 'wariant 1' }; fitted = false;
    renderPanel(); draw();
  },
  async aiPackage() {
    const bytes = buildAIPackage(S.project, S.res, { anonymized: $('#anon').checked, images: reportImages() });
    await saveFile(`${fileBase()} - paczka AI.zip`, bytes, 'application/zip');
  },
  async license() { S.license = await checkLicense($('#licKey').value.trim()); renderPanel(); },
  aiImport() {
    try { S.review = parseAIReview($('#aiText').value); } catch (e) { return alert(e.message); }
    renderPanel();
  },
};
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const a = ACTIONS[el.dataset.act]; if (a) Promise.resolve(a(el)).catch(err => { console.error(err); alert(err.message); });
});

// ---------- start ----------
async function start() {
  $('#version').textContent = `v${VERSION}`;
  resize();
  if (isNative()) { try { Neutralino.init(); } catch { /* wersja przeglądarkowa */ } }
  S.license = await checkLicense();
  try {
    const SQL = await initSqlJs({ locateFile: f => `dist/${f}` });
    S.db = new ProjectDB(SQL, await loadDbBytes());
    S.dbWhere = isNative() ? 'plik w Dokumenty/TEK-PLYTA/tekplyta.db' : 'IndexedDB przeglądarki';
  } catch (e) { console.error(e); S.dbWhere = `błąd bazy: ${e.message}`; }
  renderPanel(); draw();
}
start();
window.__TEK = S; // do testów automatycznych interfejsu
