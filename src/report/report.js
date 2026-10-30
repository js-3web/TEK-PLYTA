// Raport z obliczeń (specyfikacja, sekcja 8). Jeden model dokumentu → dwa formaty:
//   renderHTML(doc) — podgląd w aplikacji i PDF przez „Drukuj → Zapisz jako PDF” (WebView2 / Chromium);
//   renderDOCX(doc) — plik Word (Office Open XML, ZIP z plikami XML).
// doc = { title, meta, blocks: [{ type: 'h1'|'h2'|'p'|'note'|'table'|'img'|'formula'|'pagebreak', … }] }

import { zip } from './zip.js';
import { NORM as EC0 } from '../norms/en1990-pl.js';
import { NORM as EC2 } from '../norms/en1992-pl.js';
import { PSI } from '../norms/en1990-pl.js';

const f = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n).replace('.', ',') : '—');
const TYPE = { wewnetrzny: 'wewnętrzny', krawedziowy: 'krawędziowy', narozny: 'narożny' };
const LAYER = { bottomX: 'dół, kierunek x', bottomY: 'dół, kierunek y', topX: 'góra, kierunek x', topY: 'góra, kierunek y' };

// images: { mesh, w_lt, As_bottomX, … } → { src: dataURL PNG, w, h } (rysunki z aplikacji; opcjonalne)
export function buildReport(project, res, images = {}, { date = new Date().toISOString().slice(0, 10), build = '', unlicensed = false } = {}) {
  const B = [], h1 = t => B.push({ type: 'h1', text: t }), h2 = t => B.push({ type: 'h2', text: t });
  const p = t => B.push({ type: 'p', text: t }), note = t => B.push({ type: 'note', text: t });
  const table = (head, rows) => B.push({ type: 'table', head, rows });
  const img = (key, caption) => { if (images[key]) B.push({ type: 'img', ...images[key], caption }); };
  const m = res.materials, s = project.slab, r = project.reinf, meta = project.meta ?? {};

  // --- strona tytułowa ---
  B.push({ type: 'title', lines: [
    'TEK-PŁYTA — obliczenia statyczne płyty żelbetowej',
    meta.object ? `Obiekt: ${meta.object}` : null, meta.investor ? `Inwestor: ${meta.investor}` : null,
    meta.name ? `Projekt: ${meta.name}` : null, meta.author ? `Autor: ${meta.author}` : null,
    `Data: ${date}`, `Program: TEK-PŁYTA ${res.version}${build ? ` (kompilacja ${build})` : ''}`,
  ].filter(Boolean) });
  if (unlicensed) note('WERSJA BEZ LICENCJI — raport wyłącznie do celów testowych.');
  B.push({ type: 'pagebreak' });

  // --- 1. Założenia ---
  h1('1. Założenia');
  p('Normy: PN-EN 1990:2004 + NA (kombinacje), PN-EN 1991-1-1 (kategorie obciążeń użytkowych), PN-EN 1992-1-1:2008 + NA (wymiarowanie).');
  if (!EC0.verified || !EC2.verified)
    note('Status wartości krajowych: część parametrów (γc = 1,4; αcc = 1,0; ψ0/ψ1/ψ2 — wartości zalecane EN 1990 tabl. A1.1; współczynnik 0,4 w vRd,max; zał. B; tabl. 7.1N) nie została porównana z tekstem Załączników Krajowych. Projektant potwierdza je przed wykorzystaniem obliczeń.');
  h2('Materiały');
  table(['Parametr', 'Wartość', 'Źródło'], [
    ['Beton', s.concrete, 'tabl. 3.1'], ['fck / fcd', `${f(m.fck, 0)} / ${f(m.fcd)} MPa`, `3.1.6(1), αcc = ${f(EC2.alphaCC, 1)}, γc = ${f(EC2.gammaC, 1)}`],
    ['fctm / Ecm', `${f(m.fctm, 1)} MPa / ${f(m.Ecm, 0)} GPa`, 'tabl. 3.1'],
    ['Stal', s.steel, ''], ['fyk / fyd', `${f(m.fyk, 0)} / ${f(m.fyd, 1)} MPa`, `γs = ${f(EC2.gammaS, 2)}`],
  ]);
  h2('Płyta i zbrojenie podstawowe');
  const mm = v => f(v * 1000, 0);
  table(['Parametr', 'Wartość'], [
    ['Grubość h', `${mm(s.h)} mm`], ['Ciężar własny', `${f((s.gamma ?? 25) * s.h)} kN/m² (γ = ${f(s.gamma ?? 25, 0)} kN/m³)`],
    ['Otulina dół / góra', `${mm(r.cover.bottom)} / ${mm(r.cover.top)} mm`],
    ['Siatka dolna', `x: ϕ${mm(r.bottom.phiX)} co ${mm(r.bottom.sX)} (${f(res.design.base.bottom.x, 0)} mm²/m), y: ϕ${mm(r.bottom.phiY)} co ${mm(r.bottom.sY)} (${f(res.design.base.bottom.y, 0)} mm²/m), zewnętrzna: ${r.bottom.outer}`],
    ['Siatka górna', `x: ϕ${mm(r.top.phiX)} co ${mm(r.top.sX)} (${f(res.design.base.top.x, 0)} mm²/m), y: ϕ${mm(r.top.phiY)} co ${mm(r.top.sY)} (${f(res.design.base.top.y, 0)} mm²/m), zewnętrzna: ${r.top.outer}`],
    ['Wysokości użyteczne', `dół x/y ${mm(res.depths.bottom.x)}/${mm(res.depths.bottom.y)} mm, góra x/y ${mm(res.depths.top.x)}/${mm(res.depths.top.y)} mm`],
    ['Klasa ekspozycji', `${project.sls.exposure} (wmax = ${f(res.sls.wmax, 1)} mm, tabl. 7.1N)`],
  ]);
  h2('Obciążenia (wartości charakterystyczne) i kombinacje');
  const loadRows = [['G0', 'ciężar własny', 'G', '—']];
  for (const [k, L] of Object.entries(project.loads)) if (res.cases.includes(k))
    loadRows.push([k, `${f(L.value)} ${k[0] === 'Q' ? 'kN/m²' : k[0] === 'L' ? 'kN/m' : 'kN'}`, L.type, L.type === 'Q' ? `${L.category} (ψ0 = ${f(PSI[L.category].psi0, 1)}, ψ1 = ${f(PSI[L.category].psi1, 1)}, ψ2 = ${f(PSI[L.category].psi2, 1)})` : '—']);
  table(['Przypadek', 'Wartość', 'Typ', 'Kategoria (tabl. A1.1)'], loadRows);
  p(`SGN (STR): ${(project.combination?.formulas ?? ['6.10a', '6.10b']).join(' i ')}; γG,sup = ${f(EC0.gammaGsup)}, γG,inf = ${f(EC0.gammaGinf)}, γQ = ${f(EC0.gammaQ)}, ξ = ${f(EC0.xi)}. Każda strefa obciążenia zmiennego włączana lub wyłączana niezależnie (obwiednia układów szachownicowych). SGU: kombinacja quasi-stała (ugięcia, rysy).`);

  // --- 2. Model ---
  B.push({ type: 'pagebreak' });
  h1('2. Model obliczeniowy');
  p(`MES, element płytowy DKT (Batoz, Bathe, Ho 1980), analiza liniowo-sprężysta w SGN. Siatka: ${res.summary.nodes} węzłów, ${res.summary.elements} elementów, ${res.summary.unknowns} niewiadomych, oczko podstawowe ${f(project.mesh.h0)} m, najmniejszy kąt ${f(res.summary.minAngle, 1)}°.`);
  img('mesh', 'Rys. 1. Rzut płyty z siatką, podporami i strefami obciążeń');
  h2('Podpory — reakcje (obwiednia SGN)');
  table(['Podpora', 'Rodzaj', 'V max [kN]', 'V min [kN]', 'Kombinacja rządząca'],
    res.supports.map(x => [x.label, { slup: 'słup', sciana: 'ściana', krawedz: 'krawędź' }[x.kind] ?? x.kind, f(x.Vmax, 1), f(x.Vmin, 1), x.gov]));

  h1('3. Kontrola modelu');
  table(['Przypadek', 'Obciążenie [kN]', 'Suma reakcji [kN]', 'Błąd względny'],
    res.equilibrium.map(e => [e.case, f(e.load, 2), f(e.reactions, 2), e.error.toExponential(1)]));
  if (res.warnings.length) { h2('Ostrzeżenia'); for (const w of res.warnings) p(`• ${w.msg}`); }

  // --- 4. Wyniki SGN ---
  B.push({ type: 'pagebreak' });
  h1('4. Zginanie (SGN)');
  p('Momenty wymiarujące metodą Wood–Armera (Wood 1968, Armer 1968) z obwiedni kombinacji; przekrój 1 m z prostokątnym rozkładem naprężeń (3.1.7(3)), ξeff ≤ ξeff,lim; As,min wg 9.2.1.1(1) przez 9.3.1.1(1). Nad słupami momenty górne uśrednione na szerokości słup + 2h.');
  table(['Warstwa', 'As,req max [mm²/m]', 'Siatka [mm²/m]', 'Dozbrojenie potrzebne'],
    Object.entries(res.summary.AsMax).map(([k, v]) => {
      const base = res.design.base[k.startsWith('bottom') ? 'bottom' : 'top'][k.endsWith('X') ? 'x' : 'y'];
      return [LAYER[k], f(v, 0), f(base, 0), v > base + 0.5 ? 'tak' : 'nie'];
    }));
  for (const k of ['bottomX', 'bottomY', 'topX', 'topY']) img(`dAs_${k}`, `Dozbrojenie ponad siatkę — ${LAYER[k]} [mm²/m]`);

  h1('5. Przebicie (6.4)');
  p('VEd z obwiedni SGN reakcji słupów (bez redukcji o obciążenie wewnątrz obwodu). Obwód u1 w odległości 2d, z uwzględnieniem krawędzi (rys. 6.13–6.15) i otworów ≤ 6d (rys. 6.14). β — wartości uproszczone 6.4.3(6); projektant potwierdza spełnienie warunków ich stosowania.');
  table(['Słup', 'Typ', 'VEd [kN]', 'β', 'u1 [m]', 'd [mm]', 'vEd [MPa]', 'vRd,c [MPa]', 'Wykorzystanie', 'vEd,0/vRd,max', 'Asw'],
    res.punching.map(x => [x.label, TYPE[x.type], f(x.VEd, 1), f(x.beta), f(x.u1, 3), f(x.d * 1000, 0), f(x.vEd, 3), f(x.vRdc, 3), f(x.util), f(x.utilMax),
      x.shearReinforcement ? `${f(x.shearReinforcement.AswPerPerimeter, 0)} mm²/obw.` : (x.ok ? '—' : 'vEd,0 > vRd,max')]));
  p('Zbrojenie na przebicie: Asw na jeden obwód strzemion przy rozstawie sr = 0,75d (6.52); zasięg strefy uout,ef — w przykładzie krok po kroku i w aplikacji.');
  const worst = [...res.punching].sort((a, b) => b.util - a.util)[0];
  if (worst) {
    h2(`Przykład krok po kroku — słup ${worst.label} (najbardziej wytężony)`);
    const lines = [
      `d = (dx + dy)/2 = ${f(worst.d * 1000, 0)} mm;  u1 = ${f(worst.u1 * 1000, 0)} mm (słup ${TYPE[worst.type]})`,
      `vEd = β·VEd/(u1·d) = ${f(worst.beta)}·${f(worst.VEd * 1000, 0)}/(${f(worst.u1 * 1000, 0)}·${f(worst.d * 1000, 0)}) = ${f(worst.vEd, 3)} MPa   (6.38)`,
      `k = 1 + √(200/d) = ${f(worst.k, 3)} ≤ 2,0;  ρl = √(ρlx·ρly) = ${f(worst.rho * 100, 3)} % ≤ 2 %`,
      `vRd,c = CRd,c·k·(100·ρl·fck)^(1/3) = ${f(worst.CRdc, 4)}·${f(worst.k, 3)}·(100·${f(worst.rho, 5)}·${f(m.fck, 0)})^(1/3) ≥ vmin = ${f(worst.vmin, 3)} → vRd,c = ${f(worst.vRdc, 3)} MPa   (6.47)`,
      `ν = 0,6·(1 − fck/250) = ${f(worst.nu, 3)};  vRd,max = ${f(EC2.vRdMaxCoef, 1)}·ν·fcd = ${f(worst.vRdMax, 3)} MPa;  vEd,0 = β·VEd/(u0·d) = ${f(worst.vEd0, 3)} MPa   (6.4.5(3))`,
      `Wykorzystanie: vEd/vRd,c = ${f(worst.util)}`,
    ];
    if (worst.shearReinforcement) lines.push(`Zbrojenie (6.52), strzemiona pionowe, sr = 0,75d: fywd,ef = 250 + 0,25·d = ${f(worst.shearReinforcement.fywdEf, 0)} MPa; Asw = (vEd − 0,75·vRd,c)·u1·d/(1,5·(d/sr)·fywd,ef) = ${f(worst.shearReinforcement.AswPerPerimeter, 0)} mm² na obwód; uout,ef = β·VEd/(vRd,c·d) = ${f(worst.shearReinforcement.uOutEf, 2)} m (6.54). Konstrukcja wg 9.4.3.`);
    for (const l of lines) B.push({ type: 'formula', text: l });
  }

  // --- 6. SGU ---
  B.push({ type: 'pagebreak' });
  h1('6. Ugięcia i rysy (SGU)');
  p(`Ugięcia metodą 7.4.3 w MES: kombinacja quasi-stała, Ec,eff = Ecm/(1 + φ), φ(∞,t0) = ${f(res.sls.phi)} (zał. B; RH = ${project.sls.RH} %, t0 = ${project.sls.t0} dni, cement ${project.sls.cement}), w każdym elemencie sztywność interpolowana między fazą I i II (ζ = 1 − β(Mcr/M)², β = 0,5) przy zbrojeniu zapewnionym; skurcz εcs = ${f(res.sls.ecs * 1000, 3)} ‰ jako krzywizna (7.21). Iteracja: ${res.sls.iterations} kroków${res.sls.converged ? '' : ' (BRAK ZBIEŻNOŚCI)'}.`);
  img('w_lt', 'Ugięcie długotrwałe [mm]');
  if (res.sls.fields.length) table(['Pole', 'L [m]', 'w [mm]', 'L/250 [mm]', 'Δw [mm]', 'L/500 [mm]', 'Wynik'],
    res.sls.fields.map(x => [x.label, f(x.L), f(x.w * 1000, 1), f(x.wLim * 1000, 1), f(x.dw * 1000, 1), f(x.dwLim * 1000, 1), x.error ?? (x.ok ? 'spełnia' : 'NIE SPEŁNIA')]));
  else note('Nie wskazano pól do oceny ugięć (L zadaje projektant) — ocena L/250 i L/500 niewykonana.');
  p(`Rysy (7.3.4), kombinacja quasi-stała: wk,max = ${f(res.sls.wkMax)} mm, wmax = ${f(res.sls.wmax, 1)} mm → ${res.sls.wkMax <= res.sls.wmax ? 'spełnia' : 'NIE SPEŁNIA'}.`);

  // --- 7. Wnioski ---
  h1('7. Wnioski');
  const pm = res.summary.punchingMaxUtil;
  p(`Największe wykorzystanie na przebicie bez zbrojenia: ${f(pm)}${worst ? ` (słup ${worst.label})` : ''}${pm > 1 ? ' — wymagane zbrojenie na przebicie lub zmiana przekroju.' : '.'}`);
  const extra = Object.entries(res.summary.AsMax).filter(([k, v]) => v > res.design.base[k.startsWith('bottom') ? 'bottom' : 'top'][k.endsWith('X') ? 'x' : 'y'] + 0.5).map(([k]) => LAYER[k]);
  p(extra.length ? `Dozbrojenie ponad siatkę podstawową potrzebne w warstwach: ${extra.join('; ')} — miejsca na mapach dozbrojenia.` : 'Siatki podstawowe wystarczają na zginanie.');
  const badFields = res.sls.fields.filter(x => x.ok === false).map(x => x.label);
  if (badFields.length) p(`Ugięcia przekroczone w polach: ${badFields.join(', ')}.`);

  // --- 8. Granice modelu ---
  h1('8. Granice modelu i odpowiedzialność');
  for (const t of LIMITS) p(`• ${t}`);
  note('Program jest narzędziem wspomagającym. Za przyjęte założenia, dane wejściowe i wykorzystanie wyników odpowiada projektant posiadający uprawnienia budowlane (art. 20 ustawy Prawo budowlane). Opinia narzędzia AI nie jest sprawdzeniem projektu w rozumieniu Prawa budowlanego.');
  return { title: meta.name || 'TEK-PŁYTA', meta, blocks: B };
}

export const LIMITS = [
  'SGN liniowo-sprężysta, bez redystrybucji momentów — zbrojenie nad podporami może być większe niż po redystrybucji.',
  'Słup modelowany sprężynami (pionowa E·A/H, obrotowa c·E·I/H), nie elementem 3D — moment przekazywany na słup przybliżony; słupy wymiarowane osobno.',
  'Momenty nad słupami uśredniane na szerokości słup + 2h — raport pokazuje mapy wartości uśrednionych; szczytowe w aplikacji.',
  'Momenty w węzłach: średnia ważona kątem naroży elementów (bez wygładzania SPR, które zaniża szczyty nad podporami).',
  'Ugięcia: model 7.4.3 (interpolacja ζ), zarysowanie nieodwracalne w iteracji, podpory pełzają jak płyta; faza I bez zbrojenia; ugięcia bezwzględne (z osiadaniem podpór sprężystych). Wynik szacunkowy — dla płyt krytycznych kontrola innym programem.',
  'Δw po wykonaniu wykończeń przybliżone jako w całkowite − w natychmiastowe od G.',
  'Rozpiętość L w L/250 i L/500 zadaje projektant — błędna rozpiętość odniesienia = błędna ocena.',
  'Przebicie: VEd bez redukcji o obciążenie wewnątrz obwodu; otwory bez złagodzenia √(l1·l2); słup przy narożu wklęsłym traktowany jak krawędziowy (norma tego przypadku nie opisuje).',
  'Stała grubość, bez belek i głowic; brak pożaru, dynamiki, sprężenia, etapów budowy.',
  'Norma pierwszej generacji (PN-EN 1992-1-1:2008); PN-EN 1992-1-1:2024 w wersji 2.',
];

// ---------- HTML ----------
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function renderHTML(doc) {
  const body = doc.blocks.map(b => {
    switch (b.type) {
      case 'title': return `<section class="title">${b.lines.map((l, i) => (i ? `<p>${esc(l)}</p>` : `<h1>${esc(l)}</h1>`)).join('')}</section>`;
      case 'h1': return `<h2>${esc(b.text)}</h2>`;
      case 'h2': return `<h3>${esc(b.text)}</h3>`;
      case 'p': return `<p>${esc(b.text)}</p>`;
      case 'note': return `<p class="note">${esc(b.text)}</p>`;
      case 'formula': return `<p class="formula">${esc(b.text)}</p>`;
      case 'pagebreak': return '<div class="pb"></div>';
      case 'img': return `<figure><img src="${b.src}" alt=""><figcaption>${esc(b.caption)}</figcaption></figure>`;
      case 'table': return `<table><thead><tr>${b.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
      default: return '';
    }
  }).join('\n');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(doc.title)} — raport</title><style>
body{font:10.5pt/1.45 "Segoe UI",Arial,sans-serif;color:#111;max-width:180mm;margin:12mm auto}
h1{font-size:18pt;margin:0 0 6mm} h2{font-size:13pt;border-bottom:1px solid #0b1622;padding-bottom:2px;margin-top:8mm} h3{font-size:11pt;margin-top:5mm}
.title{padding-top:50mm} .title p{margin:1mm 0}
table{border-collapse:collapse;width:100%;margin:2mm 0;font-size:9pt} th,td{border:1px solid #999;padding:2px 4px;text-align:left;vertical-align:top} th{background:#e8edf3}
.note{background:#fff6e0;border-left:3px solid #c80;padding:2mm 3mm} .formula{font-family:Consolas,monospace;font-size:9pt;margin:1mm 0}
figure{margin:3mm 0;text-align:center} figure img{max-width:100%} figcaption{font-size:9pt;color:#444}
.pb{break-after:page} @page{size:A4;margin:15mm}
</style></head><body>${body}</body></html>`;
}

// ---------- DOCX ----------
const x = s => esc(s).replace(/"/g, '&quot;');
const run = (t, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
const para = (t, style, props) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${run(t, props)}</w:p>`;

function dataUrlBytes(src) {
  const b64 = src.split(',')[1];
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64); return Uint8Array.from(bin, c => c.charCodeAt(0));
}

export function renderDOCX(doc) {
  const media = [], body = [];
  for (const b of doc.blocks) {
    switch (b.type) {
      case 'title': b.lines.forEach((l, i) => body.push(para(l, i ? null : 'Title'))); break;
      case 'h1': body.push(para(b.text, 'Heading1')); break;
      case 'h2': body.push(para(b.text, 'Heading2')); break;
      case 'p': body.push(para(b.text)); break;
      case 'note': body.push(para(b.text, null, '<w:i/>')); break;
      case 'formula': body.push(para(b.text, null, '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>')); break;
      case 'pagebreak': body.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); break;
      case 'table': {
        const cell = (t, head) => `<w:tc><w:p>${run(t, head ? '<w:b/><w:sz w:val="18"/>' : '<w:sz w:val="18"/>')}</w:p></w:tc>`;
        body.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>`
          + `<w:tr>${b.head.map(h => cell(h, true)).join('')}</w:tr>${b.rows.map(r => `<w:tr>${r.map(c => cell(c)).join('')}</w:tr>`).join('')}</w:tbl>`);
        body.push('<w:p/>');
        break;
      }
      case 'img': {
        const id = media.length + 1, rid = `rIdImg${id}`, cx = 16 * 360000, cy = Math.round(cx * (b.h / b.w));
        media.push({ name: `word/media/image${id}.png`, data: dataUrlBytes(b.src), rid });
        body.push(`<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Rys${id}"/>`
          + `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`
          + `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
          + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
          + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`);
        body.push(para(b.caption, null, '<w:i/><w:sz w:val="18"/>'));
        break;
      }
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="2400" w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="0B1622"/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/><w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/><w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((m, i) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join('')}</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: rels },
    ...media.map(m => ({ name: m.name, data: m.data })),
  ]);
}
