// Rozwiązywanie K u = f, K symetryczna dodatnio określona.
// Zapis "skyline" (profilowy): dla każdej kolumny j przechowujemy wyrazy od
// pierwszego niezerowego wiersza do przekątnej. Zera poza profilem nie zajmują
// pamięci, a rozkład Cholesky'ego K = L L^T nie tworzy wyrazów poza profilem.
// Mały profil wymaga dobrej numeracji węzłów (patrz mesh.js / v1: RCM).

export class SkylineMatrix {
  constructor(n, firstRow) {
    this.n = n;
    this.first = firstRow; // first[j] = najmniejszy indeks wiersza w kolumnie j
    this.ptr = new Int32Array(n + 1);
    for (let j = 0; j < n; j++) this.ptr[j + 1] = this.ptr[j] + (j - firstRow[j] + 1);
    this.val = new Float64Array(this.ptr[n]);
  }
  idx(i, j) { // i <= j
    return this.ptr[j] + (i - this.first[j]);
  }
  add(i, j, v) {
    if (i > j) [i, j] = [j, i];
    this.val[this.idx(i, j)] += v;
  }
  get(i, j) {
    if (i > j) [i, j] = [j, i];
    if (i < this.first[j]) return 0;
    return this.val[this.idx(i, j)];
  }
  get size() { return this.ptr[this.n]; }
}

// Profil na podstawie list DOF elementów
export function buildProfile(n, elementDofs) {
  const first = new Int32Array(n);
  for (let j = 0; j < n; j++) first[j] = j;
  for (const dofs of elementDofs) {
    let mn = Infinity;
    for (const d of dofs) if (d >= 0 && d < mn) mn = d;
    for (const d of dofs) if (d >= 0 && mn < first[d]) first[d] = mn;
  }
  return first;
}

// Rozkład Cholesky'ego w miejscu (kolumnami). Rzuca błąd, gdy macierz nie jest
// dodatnio określona — w praktyce: płyta niedostatecznie podparta (mechanizm).
export function choleskyInPlace(A) {
  const { n, first, val } = A;
  for (let j = 0; j < n; j++) {
    const fj = first[j];
    for (let i = fj; i <= j; i++) {
      const fi = first[i];
      const k0 = Math.max(fi, fj);
      let s = val[A.idx(i, j)];
      const pi = A.ptr[i] - fi, pj = A.ptr[j] - fj;
      for (let k = k0; k < i; k++) s -= val[pi + k] * val[pj + k];
      if (i < j) {
        val[A.idx(i, j)] = s / val[A.idx(i, i)];
      } else {
        if (!(s > 0)) throw new Error(`Macierz sztywności nie jest dodatnio określona (DOF ${j}). Sprawdź podparcie płyty.`);
        val[A.idx(j, j)] = Math.sqrt(s);
      }
    }
  }
  return A;
}

// Rozwiązanie L L^T x = b po rozkładzie
export function choleskySolve(L, b) {
  const { n, first, val } = L;
  const x = Float64Array.from(b);
  // L y = b  (L = U^T, U przechowywana kolumnami)
  for (let j = 0; j < n; j++) {
    let s = x[j];
    const p = L.ptr[j] - first[j];
    for (let k = first[j]; k < j; k++) s -= val[p + k] * x[k];
    x[j] = s / val[L.idx(j, j)];
  }
  // U x = y
  for (let j = n - 1; j >= 0; j--) {
    x[j] /= val[L.idx(j, j)];
    const p = L.ptr[j] - first[j];
    const xj = x[j];
    for (let k = first[j]; k < j; k++) x[k] -= val[p + k] * xj;
  }
  return x;
}
