// Budowa aplikacji: app/src → app/dist (esbuild łączy moduły ES w pliki dla przeglądarki/WebView2).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

mkdirSync('app/dist', { recursive: true });
const common = { bundle: true, format: 'esm', target: 'chrome110', sourcemap: true, logLevel: 'warning',
  external: ['fs', 'path', 'crypto'] }; // sql.js zawiera gałąź dla Node — w przeglądarce niewykonywana
await build({ ...common, entryPoints: ['app/src/main.js'], outfile: 'app/dist/main.js' });
await build({ ...common, entryPoints: ['app/src/worker.js'], outfile: 'app/dist/worker.js' });
copyFileSync('node_modules/sql.js/dist/sql-wasm.wasm', 'app/dist/sql-wasm.wasm');
copyFileSync('assets/TEK-PLYTA_wzorzec.dxf', 'app/dist/TEK-PLYTA_wzorzec.dxf');
copyFileSync('THIRD_PARTY_LICENSES.md', 'app/dist/THIRD_PARTY_LICENSES.txt'); // licencje bibliotek dołączone do programu
// numer kompilacji (data + skrót commita, jeśli dostępny) — do strony tytułowej raportu
let rev = ''; try { rev = readFileSync('.git/HEAD', 'utf8').startsWith('ref:') ? readFileSync(`.git/${readFileSync('.git/HEAD', 'utf8').slice(5).trim()}`, 'utf8').slice(0, 7) : ''; } catch { /* brak gita */ }
writeFileSync('app/dist/build.json', JSON.stringify({ built: new Date().toISOString(), rev }));
console.log('app/dist gotowe');

// TEK-KLUCZE — osobna aplikacja do wydawania licencji: jeden plik HTML (CSS, fonty i skrypt wbudowane)
mkdirSync('dist-tools', { recursive: true });
const kl = await build({ ...common, sourcemap: false, format: 'iife', entryPoints: ['tools/klucze/klucze.js'], write: false });
const css = readFileSync('app/fonts.css', 'utf8') + readFileSync('app/styles.css', 'utf8');
writeFileSync('dist-tools/TEK-KLUCZE.html', `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>TEK-KLUCZE</title><style>${css}</style></head>`
  + `<body><header class="appbar"><div class="brand" style="color:#22C3E6;font-family:var(--mono);font-size:.8rem;letter-spacing:.08em">TEK-KLUCZE</div></header><main><div id="view"></div></main><div id="toast" class="toast"></div>`
  + `<script>${kl.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script></body></html>`);
console.log('dist-tools/TEK-KLUCZE.html gotowe');
