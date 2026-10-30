// Baza projektów (specyfikacja, sekcja 9): SQLite w pliku, bez serwera — sql.js (SQLite w WebAssembly).
// Moduł nie zna miejsca zapisu: dostaje bajty bazy i oddaje je przez export() — aplikacja zapisuje je
// do pliku (Neutralino) albo do IndexedDB (przeglądarka).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projekty (id INTEGER PRIMARY KEY, nazwa TEXT NOT NULL, inwestor TEXT, obiekt TEXT, autor TEXT,
  utworzono TEXT NOT NULL, zmieniono TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS warianty (id INTEGER PRIMARY KEY, projekt_id INTEGER NOT NULL REFERENCES projekty(id) ON DELETE CASCADE,
  nazwa TEXT NOT NULL, opis TEXT, utworzono TEXT NOT NULL, zmieniono TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS geometria (wariant_id INTEGER PRIMARY KEY REFERENCES warianty(id) ON DELETE CASCADE, dxf TEXT, walidacja TEXT);
CREATE TABLE IF NOT EXISTS dane (wariant_id INTEGER PRIMARY KEY REFERENCES warianty(id) ON DELETE CASCADE, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wyniki (wariant_id INTEGER PRIMARY KEY REFERENCES warianty(id) ON DELETE CASCADE, skrot TEXT NOT NULL,
  wersja TEXT NOT NULL, policzono TEXT NOT NULL);
`;

const now = () => new Date().toISOString();

export class ProjectDB {
  constructor(SQL, bytes = null) {
    this.db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.exec(SCHEMA);
  }
  rows(sql, params = []) {
    const st = this.db.prepare(sql); st.bind(params);
    const out = []; while (st.step()) out.push(st.getAsObject()); st.free();
    return out;
  }
  export() { return this.db.export(); }

  // Zapis wariantu: projekt (nowy albo istniejący) + wariant (nowy albo nadpisany)
  saveVariant({ projectId = null, variantId = null, project, variantName = 'wariant', description = '', geometryCheck = null, resultSummary = null, version }) {
    const t = now(), m = project.meta ?? {};
    if (projectId == null) {
      this.db.run('INSERT INTO projekty (nazwa, inwestor, obiekt, autor, utworzono, zmieniono) VALUES (?,?,?,?,?,?)', [m.name || 'bez nazwy', m.investor || '', m.object || '', m.author || '', t, t]);
      projectId = this.rows('SELECT last_insert_rowid() AS id')[0].id;
    } else this.db.run('UPDATE projekty SET nazwa=?, inwestor=?, obiekt=?, autor=?, zmieniono=? WHERE id=?', [m.name || 'bez nazwy', m.investor || '', m.object || '', m.author || '', t, projectId]);
    if (variantId == null) {
      this.db.run('INSERT INTO warianty (projekt_id, nazwa, opis, utworzono, zmieniono) VALUES (?,?,?,?,?)', [projectId, variantName, description, t, t]);
      variantId = this.rows('SELECT last_insert_rowid() AS id')[0].id;
    } else this.db.run('UPDATE warianty SET nazwa=?, opis=?, zmieniono=? WHERE id=?', [variantName, description, t, variantId]);
    const { dxf, ...data } = project;
    this.db.run('INSERT OR REPLACE INTO geometria (wariant_id, dxf, walidacja) VALUES (?,?,?)', [variantId, dxf ?? null, JSON.stringify(geometryCheck)]);
    this.db.run('INSERT OR REPLACE INTO dane (wariant_id, json) VALUES (?,?)', [variantId, JSON.stringify(data)]);
    if (resultSummary) this.db.run('INSERT OR REPLACE INTO wyniki (wariant_id, skrot, wersja, policzono) VALUES (?,?,?,?)', [variantId, JSON.stringify(resultSummary), version, t]);
    else this.db.run('DELETE FROM wyniki WHERE wariant_id=?', [variantId]); // dane zmienione → stare wyniki nieaktualne
    return { projectId, variantId };
  }

  // Lista: projekty z wariantami; status wyników: 'aktualne' | 'do przeliczenia' (inna wersja programu) | 'brak'
  list(currentVersion) {
    return this.rows('SELECT * FROM projekty ORDER BY zmieniono DESC').map(p => ({
      ...p,
      warianty: this.rows(`SELECT w.*, r.wersja, r.policzono, r.skrot FROM warianty w LEFT JOIN wyniki r ON r.wariant_id = w.id
        WHERE w.projekt_id = ? ORDER BY w.utworzono`, [p.id]).map(w => ({
        id: w.id, nazwa: w.nazwa, opis: w.opis, zmieniono: w.zmieniono, policzono: w.policzono,
        skrot: w.skrot ? JSON.parse(w.skrot) : null,
        status: !w.wersja ? 'brak' : w.wersja === currentVersion ? 'aktualne' : 'do przeliczenia',
      })),
    }));
  }

  loadVariant(variantId) {
    const d = this.rows('SELECT json FROM dane WHERE wariant_id=?', [variantId])[0];
    if (!d) throw new Error(`Brak wariantu ${variantId}`);
    const g = this.rows('SELECT dxf FROM geometria WHERE wariant_id=?', [variantId])[0];
    const v = this.rows('SELECT projekt_id, nazwa FROM warianty WHERE id=?', [variantId])[0];
    return { project: { ...JSON.parse(d.json), dxf: g?.dxf ?? null }, projectId: v.projekt_id, variantId, variantName: v.nazwa };
  }

  deleteProject(id) { this.db.run('DELETE FROM projekty WHERE id=?', [id]); }
  deleteVariant(id) { this.db.run('DELETE FROM warianty WHERE id=?', [id]); }
}

// Plik .tekplyta: jeden wariant projektu jako JSON (kopia, przenoszenie między komputerami)
export const FORMAT = 'tekplyta/1';
export function exportProjectFile(project, version) {
  return JSON.stringify({ format: FORMAT, version, saved: now(), project }, null, 1);
}
export function importProjectFile(text) {
  const o = JSON.parse(text);
  if (o.format !== FORMAT) throw new Error(`To nie jest plik projektu TEK-PŁYTA (format: ${o.format ?? 'brak'}).`);
  return o.project;
}
