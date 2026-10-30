// Serwer roboczy: aplikacja w przeglądarce pod http://localhost:8080 (bez instalacji czegokolwiek).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.dxf': 'application/dxf', '.map': 'application/json' };
const root = join(process.cwd(), 'app'), port = +(process.env.PORT ?? 8080);
createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(root, path || 'index.html');
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  let body;
  try { body = await readFile(file); } catch { res.writeHead(404); return res.end('nie znaleziono'); }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(body);
}).listen(port, () => console.log(`TEK-PŁYTA: http://localhost:${port}`));
