// Odwrócony algorytm Cuthilla–McKee (RCM): numeracja węzłów, która skupia
// niezerowe wyrazy macierzy sztywności blisko przekątnej (mały profil).
// E. Cuthill, J. McKee (1969); A. George, J. Liu, "Computer Solution of Large
// Sparse Positive Definite Systems", Prentice-Hall 1981 (węzeł pseudo-peryferyjny).
//
// Idea na budowlanym przykładzie: numerujemy węzły "warstwami" od jednego końca
// płyty jak fronty robót — sąsiedzi mają bliskie numery, więc w macierzy leżą
// blisko przekątnej. Odwrócenie kolejności (Reverse) dodatkowo zmniejsza wypełnienie.

export function adjacency(nNodes, elems) {
  const sets = Array.from({ length: nNodes }, () => new Set());
  for (const e of elems) for (const a of e) for (const b of e) if (a !== b) sets[a].add(b);
  return sets.map(s => [...s]);
}

// Przeszukiwanie wszerz: struktura poziomów od węzła start (tylko w obrębie jego składowej)
function levels(adj, start) {
  const lev = new Map([[start, 0]]);
  let front = [start], depth = 0, last = [start];
  while (front.length) {
    const next = [];
    for (const v of front) for (const u of adj[v]) if (!lev.has(u)) { lev.set(u, depth + 1); next.push(u); }
    if (next.length) { last = next; depth++; }
    front = next;
  }
  return { depth, last, lev };
}

// Węzeł pseudo-peryferyjny: "najdalszy" węzeł składowej (George–Liu)
function pseudoPeripheral(adj, start) {
  let v = start, { depth, last } = levels(adj, v);
  for (;;) {
    const u = last.reduce((best, x) => (adj[x].length < adj[best].length ? x : best), last[0]);
    const L = levels(adj, u);
    if (L.depth <= depth) return v;
    v = u; depth = L.depth; last = L.last;
  }
}

// Zwraca order: order[k] = węzeł, który dostaje k-ty numer
export function rcm(nNodes, elems) {
  const adj = adjacency(nNodes, elems);
  const visited = new Uint8Array(nNodes);
  const order = [];
  for (let s = 0; s < nNodes; s++) {
    if (visited[s]) continue;
    const root = pseudoPeripheral(adj, s);
    const queue = [root]; visited[root] = 1;
    for (let h = 0; h < queue.length; h++) {
      const v = queue[h];
      const nb = adj[v].filter(u => !visited[u]).sort((p, q) => adj[p].length - adj[q].length);
      for (const u of nb) { visited[u] = 1; queue.push(u); }
    }
    order.push(...queue);
  }
  return order.reverse();
}

// Zagnieżdżony podział geometryczny (nested dissection) dla siatek płaskich.
// A. George (1973), „Nested dissection of a regular finite element mesh”, SIAM J. Numer. Anal. 10.
// Zbiór węzłów dzielimy prostą prostopadłą do dłuższego boku prostokąta otaczającego (w medianie);
// separator = węzły jednej strony mające sąsiada po drugiej stronie (mniejszy z dwóch zbiorów).
// Kolejność: lewa część, prawa część, separator — rekurencyjnie.
export function nestedDissection(nodes, elems, leaf = 48) {
  const adj = adjacency(nodes.length, elems);
  const side = new Int8Array(nodes.length);
  const order = [];
  // głębokość rekurencji ≈ log2(n / leaf) — kilkanaście poziomów nawet dla dużych siatek
  const rec = list => {
    if (list.length <= leaf) { order.push(...list); return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const n of list) { const [x, y] = nodes[n]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const ax = x1 - x0 >= y1 - y0 ? 0 : 1;
    const sorted = list.slice().sort((a, b) => nodes[a][ax] - nodes[b][ax]);
    const mid = sorted.length >> 1;
    for (let k = 0; k < sorted.length; k++) side[sorted[k]] = k < mid ? 1 : 2;
    const sepOf = s => sorted.filter(n => side[n] === s && adj[n].some(m => side[m] === 3 - s));
    const sL = sepOf(1), sR = sepOf(2);
    const sep = sL.length <= sR.length ? sL : sR;
    for (const n of sep) side[n] = 0;
    const L = sorted.filter(n => side[n] === 1), R = sorted.filter(n => side[n] === 2);
    for (const n of sorted) side[n] = 0;
    if (!L.length || !R.length) { order.push(...list); return; } // nie da się podzielić
    rec(L); rec(R); order.push(...sep);
  };
  rec([...nodes.keys()]);
  return order;
}
