// Rzadki rozkład Cholesky'ego K = L Lᵀ (algorytm „up-looking”, T. A. Davis,
// „Direct Methods for Sparse Linear Systems”, SIAM 2006 — funkcje cs_etree, cs_ereach, cs_chol).
//
// Dla nauki: przechowujemy tylko wyrazy niezerowe — w kolumnach (CSC: wskaźniki kolumn Ap,
// numery wierszy Ai, wartości Ax). Macierz sztywności płyty ma w kolumnie ~30 niezerowych
// wyrazów zamiast setek, więc pamięć i liczba działań spadają kilkadziesiąt razy — pod warunkiem
// dobrej numeracji równań (zagnieżdżony podział, ordering.js).

export class SparseSymMatrix {
  // cols[j] = posortowane numery wierszy i ≤ j występujące w kolumnie j (górny trójkąt)
  constructor(n, cols) {
    this.n = n;
    this.Ap = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) this.Ap[j + 1] = this.Ap[j] + cols[j].length;
    this.Ai = new Int32Array(this.Ap[n]);
    for (let j = 0; j < n; j++) this.Ai.set(cols[j], this.Ap[j]);
    this.Ax = new Float64Array(this.Ap[n]);
  }
  pos(i, j) { // pozycja wyrazu (i, j), i ≤ j — przeszukiwanie binarne w kolumnie
    let lo = this.Ap[j], hi = this.Ap[j + 1] - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, v = this.Ai[mid];
      if (v === i) return mid;
      if (v < i) lo = mid + 1; else hi = mid - 1;
    }
    throw new Error(`Wyraz (${i}, ${j}) spoza wzorca macierzy rzadkiej`);
  }
  add(i, j, v) { if (i > j) [i, j] = [j, i]; this.Ax[this.pos(i, j)] += v; }
  get size() { return this.Ap[this.n]; }
}

// Drzewo eliminacji (cs_etree, górny trójkąt w kolumnach)
function etree(A) {
  const { n, Ap, Ai } = A;
  const parent = new Int32Array(n).fill(-1), ancestor = new Int32Array(n).fill(-1);
  for (let k = 0; k < n; k++) for (let p = Ap[k]; p < Ap[k + 1]; p++) {
    let i = Ai[p];
    while (i !== -1 && i < k) {
      const next = ancestor[i];
      ancestor[i] = k;
      if (next === -1) parent[i] = k;
      i = next;
    }
  }
  return parent;
}

// Wzorzec wiersza k czynnika L (cs_ereach): s[top..n-1], w porządku topologicznym
function ereach(A, k, parent, s, w) {
  const { n, Ap, Ai } = A;
  let top = n;
  w[k] = k; // znacznik: odwiedzony w kroku k
  for (let p = Ap[k]; p < Ap[k + 1]; p++) {
    let i = Ai[p];
    if (i > k) continue;
    let len = 0;
    for (; w[i] !== k; i = parent[i]) { s[len++] = i; w[i] = k; }
    while (len > 0) s[--top] = s[--len];
  }
  return top;
}

export function sparseCholesky(A) {
  const { n, Ap, Ai, Ax } = A;
  const parent = etree(A);
  const s = new Int32Array(n), w = new Int32Array(n).fill(-1);
  // Faza symboliczna: liczba wyrazów w każdej kolumnie L
  const cnt = new Int32Array(n).fill(1); // przekątna
  for (let k = 0; k < n; k++) { const top = ereach(A, k, parent, s, w); for (let t = top; t < n; t++) cnt[s[t]]++; }
  const Lp = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) Lp[j + 1] = Lp[j] + cnt[j];
  const Li = new Int32Array(Lp[n]), Lx = new Float64Array(Lp[n]);
  const c = Int32Array.from(Lp.subarray(0, n));
  const x = new Float64Array(n);
  w.fill(-1);
  // Faza numeryczna: wiersz po wierszu
  for (let k = 0; k < n; k++) {
    const top = ereach(A, k, parent, s, w);
    x[k] = 0;
    for (let p = Ap[k]; p < Ap[k + 1]; p++) if (Ai[p] <= k) x[Ai[p]] = Ax[p];
    let d = x[k]; x[k] = 0;
    for (let t = top; t < n; t++) {
      const i = s[t];
      const lki = x[i] / Lx[Lp[i]];
      x[i] = 0;
      for (let p = Lp[i] + 1; p < c[i]; p++) x[Li[p]] -= Lx[p] * lki;
      d -= lki * lki;
      const p = c[i]++;
      Li[p] = k; Lx[p] = lki;
    }
    if (!(d > 0)) throw new Error(`Macierz sztywności nie jest dodatnio określona (DOF ${k}). Sprawdź podparcie płyty.`);
    const p = c[k]++;
    Li[p] = k; Lx[p] = Math.sqrt(d);
  }
  return { n, Lp, Li, Lx, nnz: Lp[n] };
}

export function sparseSolve(L, b) {
  const { n, Lp, Li, Lx } = L;
  const x = Float64Array.from(b);
  for (let j = 0; j < n; j++) {          // L y = b
    x[j] /= Lx[Lp[j]];
    const xj = x[j];
    for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) x[Li[p]] -= Lx[p] * xj;
  }
  for (let j = n - 1; j >= 0; j--) {     // Lᵀ x = y
    let sum = x[j];
    for (let p = Lp[j] + 1; p < Lp[j + 1]; p++) sum -= Lx[p] * x[Li[p]];
    x[j] = sum / Lx[Lp[j]];
  }
  return x;
}
