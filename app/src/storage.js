// Zapis i odczyt plików oraz bazy: w oknie .exe (Neutralino) — prawdziwe pliki na dysku;
// w przeglądarce (wersja robocza) — pobieranie plików i baza w IndexedDB.

export const isNative = () => typeof window !== 'undefined' && !!window.Neutralino && typeof window.NL_PORT !== 'undefined';

export async function saveFile(name, data, mime = 'application/octet-stream') {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  if (isNative()) {
    const ext = name.split('.').pop();
    const path = await Neutralino.os.showSaveDialog('Zapisz plik', { defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await Neutralino.filesystem.writeBinaryFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return path;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
}

// Wybór pliku do odczytu → { name, text } (DXF w kodowaniu latin1 — bajty 1:1, polskie znaki w etykietach nieistotne)
export function openFile(accept, encoding = 'latin1') {
  return new Promise((resolve) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept });
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return resolve(null);
      const buf = await f.arrayBuffer();
      resolve({ name: f.name, text: new TextDecoder(encoding === 'latin1' ? 'iso-8859-1' : encoding).decode(buf) });
    };
    inp.click();
  });
}

// --- baza: bajty pliku SQLite ---
const DB_FILE = 'tekplyta.db';
async function nativeDbPath() {
  const dir = await Neutralino.os.getPath('documents');
  return `${dir}/TEK-PLYTA/${DB_FILE}`;
}
export async function loadDbBytes() {
  if (isNative()) {
    try { return new Uint8Array(await Neutralino.filesystem.readBinaryFile(await nativeDbPath())); } catch { return null; }
  }
  return idb('get');
}
export async function saveDbBytes(bytes) {
  if (isNative()) {
    const path = await nativeDbPath();
    try { await Neutralino.filesystem.createDirectory(path.slice(0, path.lastIndexOf('/'))); } catch { /* istnieje */ }
    await Neutralino.filesystem.writeBinaryFile(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return path;
  }
  await idb('put', bytes);
  return 'IndexedDB przeglądarki';
}
function idb(op, value) {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open('tekplyta', 1); } catch { return resolve(null); }
    req.onupgradeneeded = () => req.result.createObjectStore('db');
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const tx = req.result.transaction('db', op === 'get' ? 'readonly' : 'readwrite'), st = tx.objectStore('db');
      const r = op === 'get' ? st.get(DB_FILE) : st.put(value, DB_FILE);
      r.onsuccess = () => resolve(op === 'get' ? (r.result ?? null) : true);
      r.onerror = () => resolve(null);
    };
  });
}
