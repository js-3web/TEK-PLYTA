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
