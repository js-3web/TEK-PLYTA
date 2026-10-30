// TEK-PLYTA-klucze — wydawanie licencji TEK-PŁYTA (offline, jeden plik HTML).
// Para kluczy Ed25519 (WebCrypto). Klucz PRYWATNY zostaje u wydawcy (plik PEM — ten sam format co
// scripts/license.mjs); klucz PUBLICZNY wpisuje się do programu (app/src/license-key.js).
// Format licencji: base64url(JSON) + "." + base64url(podpis) — weryfikacja: src/app/license-core.js.
import { b64u, verifyLicense } from '../../src/app/license-core.js';
import { produkt, tektoriaCiemne } from '../../app/src/logos.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { priv: null, pub: null, fileName: null, issued: [] };
// rejestr: nowy klucz zapisu; odczyt także spod nazwy sprzed zmiany (TEK-KLUCZE, wersja 0.6)
const REG = 'tekplyta-klucze.rejestr', REG_OLD = 'tekklucze.rejestr';
try { S.issued = JSON.parse(localStorage.getItem(REG) ?? localStorage.getItem(REG_OLD) ?? '[]'); } catch { /* brak dostępu */ }
const saveReg = () => { try { localStorage.setItem(REG, JSON.stringify(S.issued)); } catch { /* brak dostępu */ } };
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = `toast show${bad ? ' zly' : ''}`; setTimeout(() => { t.className = 'toast'; }, 2600); }
function download(name, text, mime = 'text/plain') {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name });
  document.body.appendChild(a); a.click(); a.remove();
}
const toPem = der => `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...new Uint8Array(der))).replace(/(.{64})/g, '$1\n').replace(/\n$/, '')}\n-----END PRIVATE KEY-----\n`;
const fromPem = pem => Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), c => c.charCodeAt(0));

async function usePrivate(der, name) {
  const priv = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', priv); // JWK klucza prywatnego zawiera część publiczną (x)
  S.priv = priv; S.pub = jwk.x; S.fileName = name; render();
}

const ACT = {
  async generate() {
    if (S.priv && !confirm('Wygenerować NOWĄ parę kluczy? Licencje wydane starym kluczem przestaną działać w programie z nowym kluczem publicznym.')) return;
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pem = toPem(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    download('tekplyta-private.pem', pem, 'application/x-pem-file');
    await usePrivate(fromPem(pem), 'tekplyta-private.pem (nowy)');
    toast('Zapisano klucz prywatny — zrób kopię zapasową i nie udostępniaj go.');
  },
  async load() {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.pem,.key,.txt' });
    inp.onchange = async () => { const f = inp.files[0]; if (!f) return; try { await usePrivate(fromPem(await f.text()), f.name); toast('Wczytano klucz prywatny.'); } catch (e) { toast(`To nie jest klucz Ed25519 (PKCS8 PEM): ${e.message}`, true); } };
    inp.click();
  },
  async issue() {
    const name = $('#lName').value.trim(); if (!name) return toast('Podaj nazwę licencjobiorcy.', true);
    const payload = { product: 'TEK-PLYTA', name, issued: new Date().toISOString().slice(0, 10) };
    const exp = $('#lExp').value; if (exp) payload.expires = exp;
    const extra = $('#lExtra').value.trim(); if (extra) payload.note = extra;
    const p = new TextEncoder().encode(JSON.stringify(payload));
    const key = `${b64u.enc(p)}.${b64u.enc(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, S.priv, p)))}`;
    const chk = await verifyLicense(key, S.pub);
    if (!chk.ok) return toast(`Kontrola klucza nie przeszła: ${chk.msg}`, true);
    S.issued.unshift({ ...payload, key, pub: S.pub }); saveReg(); render();
    $('#lOut').value = key; toast('Wystawiono licencję (sprawdzona podpisem).');
  },
  async verify() {
    const r = await verifyLicense($('#vKey').value.trim(), $('#vPub').value.trim() || S.pub);
    $('#vRes').innerHTML = `<span class="stat ${r.ok ? 'ok' : 'uw'}">${esc(r.msg)}</span>`;
  },
  copy(el) { navigator.clipboard?.writeText($(el.dataset.src).value ?? $(el.dataset.src).textContent).then(() => toast('Skopiowano.')); },
  csv() {
    const rows = [['nazwa', 'wydano', 'wygasa', 'uwagi', 'klucz publiczny', 'klucz licencji'], ...S.issued.map(x => [x.name, x.issued, x.expires ?? '', x.note ?? '', x.pub, x.key])];
    download('TEK-PLYTA-licencje.csv', '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n'), 'text/csv');
  },
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el) Promise.resolve(ACT[el.dataset.act](el)).catch(err => toast(err.message, true)); });

function render() {
  $('#view').innerHTML = `<div class="home"><section class="hero" style="padding:2rem 1rem 1.6rem"><div class="hl">${produkt()}</div><div class="tag">TEK-PLYTA-klucze · wydawanie licencji · offline</div><div class="hm">${tektoriaCiemne}</div></section>
  <div class="grid2"><div class="card"><h2>1. Klucz wydawcy</h2>
    ${S.priv ? `<p><span class="stat ok">wczytany</span> <code>${esc(S.fileName)}</code></p><h3>Klucz publiczny <small>wpisz do app/src/license-key.js</small></h3>
      <p><code id="pub">${esc(S.pub)}</code></p><div class="btns"><button class="btn sm" data-act="copy" data-src="#pub">Kopiuj</button></div>`
      : '<p class="hint">Wczytaj swój klucz prywatny (plik PEM) albo wygeneruj nową parę kluczy (tylko raz — przy pierwszym wydaniu programu).</p>'}
    <div class="btns"><button class="btn primary" data-act="load">Wczytaj klucz prywatny</button><button class="btn" data-act="generate">Wygeneruj nową parę</button></div>
    <div class="note">Klucz prywatny = możliwość wystawiania licencji. Przechowuj go poza komputerem roboczym (np. szyfrowany nośnik) i miej kopię. Utrata — trzeba wydać nową wersję programu z nowym kluczem publicznym.</div></div>
  <div class="card"><h2>2. Wystaw licencję</h2><div class="form"><span>Licencjobiorca</span><input type="text" id="lName" placeholder="Imię Nazwisko / Firma"><span>Wygasa (opcjonalnie)</span><input type="date" id="lExp"><span>Uwagi (NIP, e-mail)</span><input type="text" id="lExtra"></div>
    <div class="btns"><button class="btn primary" data-act="issue" ${S.priv ? '' : 'disabled'}>Wystaw</button></div>
    <textarea id="lOut" readonly placeholder="Tu pojawi się klucz licencji do przekazania klientowi"></textarea><div class="btns"><button class="btn sm" data-act="copy" data-src="#lOut">Kopiuj klucz</button></div></div></div>
  <div class="grid2"><div class="card"><h2>3. Sprawdź klucz</h2><textarea id="vKey" placeholder="klucz licencji"></textarea><input type="text" id="vPub" placeholder="klucz publiczny (puste = wczytany)"><div class="btns"><button class="btn" data-act="verify">Sprawdź</button></div><div id="vRes"></div></div>
  <div class="card"><h2>Rejestr wydanych licencji <small>w tej przeglądarce</small></h2>${S.issued.length ? `<table class="mini"><tr><th>Licencjobiorca</th><th>Wydano</th><th>Wygasa</th></tr>${S.issued.map(x => `<tr><td>${esc(x.name)}</td><td>${x.issued}</td><td>${x.expires ?? '—'}</td></tr>`).join('')}</table>` : '<p class="muted">Brak.</p>'}
    <div class="btns"><button class="btn" data-act="csv" ${S.issued.length ? '' : 'disabled'}>Pobierz rejestr CSV</button></div><p class="hint">Rejestr zapisywany lokalnie (localStorage) — eksportuj CSV do archiwum.</p></div></div></div>`;
}
render();
window.__KL = S;
