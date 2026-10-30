// Element MITC3 — płyta Mindlina–Reissnera (uwzględnia odkształcenia postaciowe).
// P.-S. Lee, K.-J. Bathe (2004), "Development of MITC isotropic triangular shell
// finite elements", Computers & Structures 82, 945–962.
//
// Te same stopnie swobody co DKT: [w, tx, ty] w węźle, przy czym obroty normalnej
//   bx = ty, by = -tx   (w granicy Kirchhoffa: tx = dw/dy, ty = -dw/dx).
// Interpolacja liniowa w, bx, by. Odkształcenia postaciowe gamma = grad w + b
// wyznaczane z pól założonych (MITC): składowe kowariantne mierzone w punktach
// wiązania na krawędziach — to usuwa blokadę ścinania (shear locking).
//
// Stabilizacja (Lyly, Stenberg, Vihinen 1993): sztywność postaciowa
//   kGt * t^2 / (t^2 + alpha * h^2), h — najdłuższy bok elementu.
// alpha = 0 wyłącza stabilizację. Wartość domyślną ustalają testy.

export const DEFAULT_ALPHA = 0.1;

function geom(xy) {
  const [[x1, y1], [x2, y2], [x3, y3]] = xy;
  const x21 = x2 - x1, y21 = y2 - y1, x31 = x3 - x1, y31 = y3 - y1;
  const det = x21 * y31 - x31 * y21;
  if (det <= 0) throw new Error('Element o zerowym polu lub odwróconej orientacji (węzły muszą iść przeciwnie do ruchu wskazówek zegara)');
  const Jinv = [[y31 / det, -y21 / det], [-x31 / det, x21 / det]]; // [d/dx; d/dy] = Jinv [d/dr; d/ds]
  const h = Math.max(Math.hypot(x21, y21), Math.hypot(x31, y31), Math.hypot(x3 - x2, y3 - y2));
  return { x21, y21, x31, y31, det, area: det / 2, Jinv, h };
}

// Pochodne funkcji kształtu N1 = 1-r-s, N2 = r, N3 = s po x i y (stałe w elemencie)
function dNxy(g) {
  const dr = [-1, 1, 0], ds = [-1, 0, 1];
  const [[a, b], [c, d]] = g.Jinv;
  return { x: dr.map((v, i) => a * v + b * ds[i]), y: dr.map((v, i) => c * v + d * ds[i]) };
}

// Kowariantne odkształcenie postaciowe wzdłuż wektora v = (vx, vy) w punkcie (r, s):
// gamma_v = dw/dv + b · v, dla w liniowego dw/dv = różnica wartości węzłowych.
// Zwraca wiersz 1x9 (mnożniki przy u).
function covRow(wDiff, r, s, vx, vy) {
  const n = [1 - r - s, r, s];
  const row = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    row[3 * i] = wDiff[i];
    row[3 * i + 2] += n[i] * vx;   // bx = ty
    row[3 * i + 1] += -n[i] * vy;  // by = -tx
  }
  return row;
}

// Macierz Bs (2 x 9): [gamma_x; gamma_y] w punkcie (r, s) z pola założonego MITC3
function BsMatrix(g, r, s) {
  const wr = [-1, 1, 0], ws = [-1, 0, 1]; // dw/dr i dw/ds jako mnożniki w_i
  const er1 = covRow(wr, 0.5, 0, g.x21, g.y21);   // e_rt w punkcie (1/2, 0)
  const es2 = covRow(ws, 0, 0.5, g.x31, g.y31);   // e_st w punkcie (0, 1/2)
  const er3 = covRow(wr, 0.5, 0.5, g.x21, g.y21); // e_rt w punkcie (1/2, 1/2)
  const es3 = covRow(ws, 0.5, 0.5, g.x31, g.y31); // e_st w punkcie (1/2, 1/2)
  const er = new Array(9), es = new Array(9);
  for (let k = 0; k < 9; k++) {
    const c = es2[k] - er1[k] - es3[k] + er3[k];
    er[k] = er1[k] + c * s;
    es[k] = es2[k] - c * r;
  }
  // kowariantne -> kartezjańskie: [gx; gy] = J^-1 [er; es],  J = [[x21, y21], [x31, y31]]
  const [[a, b], [c2, d]] = g.Jinv;
  return [er.map((v, k) => a * v + b * es[k]), er.map((v, k) => c2 * v + d * es[k])];
}

// Macierz Bb (3 x 9): krzywizny [bx,x ; by,y ; bx,y + by,x] (stałe w elemencie)
function BbMatrix(g) {
  const dn = dNxy(g);
  const B = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
  for (let i = 0; i < 3; i++) {
    B[0][3 * i + 2] = dn.x[i];               // bx,x
    B[1][3 * i + 1] = -dn.y[i];              // by,y
    B[2][3 * i + 2] = dn.y[i];               // bx,y
    B[2][3 * i + 1] = -dn.x[i];              // by,x
  }
  return B;
}

function constants({ E, nu, t, alpha = DEFAULT_ALPHA }, h) {
  const D = E * t ** 3 / (12 * (1 - nu * nu));
  const G = E / (2 * (1 + nu));
  const kGt = (5 / 6) * G * t;
  const Ds = kGt * t * t / (t * t + alpha * h * h);
  return { Db: [[D, D * nu, 0], [D * nu, D, 0], [0, 0, D * (1 - nu) / 2]], Ds };
}

const GAUSS = [[1 / 6, 1 / 6], [2 / 3, 1 / 6], [1 / 6, 2 / 3]];

export function stiffness(xy, mat) {
  const g = geom(xy);
  const { Db, Ds } = constants(mat, g.h);
  const K = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const Bb = BbMatrix(g);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) {
    let s = 0;
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) s += Bb[p][i] * Db[p][q] * Bb[q][j];
    K[i][j] += s * g.area;
  }
  for (const [r, s] of GAUSS) {
    const Bs = BsMatrix(g, r, s);
    const w = g.area / 3 * Ds;
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) K[i][j] += w * (Bs[0][i] * Bs[0][j] + Bs[1][i] * Bs[1][j]);
  }
  return K;
}

// Wyniki w punkcie (r, s): momenty [mx, my, mxy] i siły poprzeczne [qx, qy].
// Siły poprzeczne ze sztywności użytej w macierzy K (stabilizowanej) — tylko
// wtedy są energetycznie zgodne z przemieszczeniami i spełniają równowagę.
export function results(xy, mat, u, r, s) {
  const g = geom(xy);
  const { Db, Ds } = constants(mat, g.h);
  const Bb = BbMatrix(g), Bs = BsMatrix(g, r, s);
  const kap = Bb.map(row => row.reduce((acc, b, k) => acc + b * u[k], 0));
  const gam = Bs.map(row => row.reduce((acc, b, k) => acc + b * u[k], 0));
  const m = Db.map(row => row[0] * kap[0] + row[1] * kap[1] + row[2] * kap[2]);
  return { m, q: [Ds * gam[0], Ds * gam[1]] };
}

// Macierze wyników w narożach: { m: Db·Bb (3 × 9), q: Ds·Bs(naroże) (2 × 9) }
export function cornerResultMatrices(xy, mat) {
  const g = geom(xy);
  const { Db, Ds } = constants(mat, g.h);
  const Bb = BbMatrix(g);
  const M = Db.map(row => Bb[0].map((_, k) => row[0] * Bb[0][k] + row[1] * Bb[1][k] + row[2] * Bb[2][k]));
  return [[0, 0], [1, 0], [0, 1]].map(([r, s]) => ({ m: M, q: BsMatrix(g, r, s).map(row => row.map(v => Ds * v)) }));
}
