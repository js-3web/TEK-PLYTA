// Element DKT (Discrete Kirchhoff Triangle) — Batoz, Bathe, Ho (1980),
// "A study of three-node triangular plate bending elements", IJNME 15, 1771–1812.
//
// Stopnie swobody węzła i: [w_i, tx_i, ty_i]
//   w  — ugięcie (dodatnie zgodnie z obciążeniem q)
//   tx — obrót = dw/dy
//   ty — obrót = -dw/dx
// Konwencję potwierdza test tests/dkt-konwencja.test.js (odtworzenie pola kwadratowego).
//
// Obroty normalnej bx, by interpolowane są funkcjami Hx, Hy (kombinacje 6 funkcji
// kwadratowych N1..N6 we współrzędnych (xi, eta)), z bx = -dw/dx, by = -dw/dy
// (więzy Kirchhoffa narzucone dyskretnie na krawędziach).

const N = (xi, eta) => {
  const z = 1 - xi - eta;
  return [2 * z * (0.5 - xi - eta), xi * (2 * xi - 1), eta * (2 * eta - 1),
    4 * xi * eta, 4 * eta * z, 4 * xi * z];
};
// pochodne N po xi i eta
const dN = (xi, eta) => {
  const z = 1 - xi - eta;
  return {
    xi: [-3 + 4 * (xi + eta), 4 * xi - 1, 0, 4 * eta, -4 * eta, 4 * (z - xi)],
    eta: [-3 + 4 * (xi + eta), 0, 4 * eta - 1, 4 * xi, 4 * (z - eta), -4 * xi],
  };
};

// Geometria elementu: współczynniki a..e wg Batoza dla krawędzi k = 4 (23), 5 (31), 6 (12)
export function geometry(xy) {
  const [[x1, y1], [x2, y2], [x3, y3]] = xy;
  const x21 = x2 - x1, y21 = y2 - y1, x31 = x3 - x1, y31 = y3 - y1;
  const det = x21 * y31 - x31 * y21; // = 2A
  if (det <= 0) throw new Error('Element o zerowym polu lub odwróconej orientacji (węzły muszą iść przeciwnie do ruchu wskazówek zegara)');
  const edges = { 4: [1, 2], 5: [2, 0], 6: [0, 1] }; // ij: 23, 31, 12 (indeksy od 0)
  const c = {};
  for (const k of [4, 5, 6]) {
    const [i, j] = edges[k];
    const xij = xy[i][0] - xy[j][0], yij = xy[i][1] - xy[j][1];
    const l2 = xij * xij + yij * yij;
    c[k] = {
      a: -xij / l2, b: 0.75 * xij * yij / l2, c: (0.25 * xij * xij - 0.5 * yij * yij) / l2,
      d: -yij / l2, e: (0.25 * yij * yij - 0.5 * xij * xij) / l2,
    };
  }
  // Macierz odwrotna Jakobianu: [d/dx; d/dy] = Jinv * [d/dxi; d/deta]
  const Jinv = [[y31 / det, -y21 / det], [-x31 / det, x21 / det]];
  return { c, area: det / 2, Jinv };
}

// Współczynniki Hx, Hy: dla każdego z 9 DOF wektor 6 mnożników przy N1..N6
function hCoefficients(c) {
  const [c4, c5, c6] = [c[4], c[5], c[6]];
  const Z = () => [0, 0, 0, 0, 0, 0];
  const hx = Array.from({ length: 9 }, Z), hy = Array.from({ length: 9 }, Z);
  // węzeł 1
  hx[0][5] = 1.5 * c6.a; hx[0][4] = -1.5 * c5.a;
  hx[1][4] = c5.b; hx[1][5] = c6.b;
  hx[2][0] = 1; hx[2][4] = -c5.c; hx[2][5] = -c6.c;
  hy[0][5] = 1.5 * c6.d; hy[0][4] = -1.5 * c5.d;
  hy[1][0] = -1; hy[1][4] = c5.e; hy[1][5] = c6.e;
  hy[2][4] = -c5.b; hy[2][5] = -c6.b;
  // węzeł 2
  hx[3][3] = 1.5 * c4.a; hx[3][5] = -1.5 * c6.a;
  hx[4][5] = c6.b; hx[4][3] = c4.b;
  hx[5][1] = 1; hx[5][5] = -c6.c; hx[5][3] = -c4.c;
  hy[3][3] = 1.5 * c4.d; hy[3][5] = -1.5 * c6.d;
  hy[4][1] = -1; hy[4][5] = c6.e; hy[4][3] = c4.e;
  hy[5][5] = -c6.b; hy[5][3] = -c4.b;
  // węzeł 3
  hx[6][4] = 1.5 * c5.a; hx[6][3] = -1.5 * c4.a;
  hx[7][3] = c4.b; hx[7][4] = c5.b;
  hx[8][2] = 1; hx[8][3] = -c4.c; hx[8][4] = -c5.c;
  hy[6][4] = 1.5 * c5.d; hy[6][3] = -1.5 * c4.d;
  hy[7][2] = -1; hy[7][3] = c4.e; hy[7][4] = c5.e;
  hy[8][3] = -c4.b; hy[8][4] = -c5.b;
  return { hx, hy };
}

// Obroty normalnej (bx, by) w punkcie (xi, eta) — używane w teście konwencji
export function rotations(xy, u, xi, eta) {
  const { c } = geometry(xy);
  const { hx, hy } = hCoefficients(c);
  const n = N(xi, eta);
  let bx = 0, by = 0;
  for (let d = 0; d < 9; d++) for (let m = 0; m < 6; m++) {
    bx += hx[d][m] * n[m] * u[d];
    by += hy[d][m] * n[m] * u[d];
  }
  return { bx, by };
}

// Macierz B (3 x 9): krzywizny kappa = [bx,x ; by,y ; bx,y + by,x] = B u
export function Bmatrix(geo, hc, xi, eta) {
  const d = dN(xi, eta);
  const [[j11, j12], [j21, j22]] = geo.Jinv;
  const B = [new Array(9).fill(0), new Array(9).fill(0), new Array(9).fill(0)];
  for (let k = 0; k < 9; k++) {
    let hxXi = 0, hxEta = 0, hyXi = 0, hyEta = 0;
    for (let m = 0; m < 6; m++) {
      hxXi += hc.hx[k][m] * d.xi[m]; hxEta += hc.hx[k][m] * d.eta[m];
      hyXi += hc.hy[k][m] * d.xi[m]; hyEta += hc.hy[k][m] * d.eta[m];
    }
    const hxX = j11 * hxXi + j12 * hxEta, hxY = j21 * hxXi + j22 * hxEta;
    const hyX = j11 * hyXi + j12 * hyEta, hyY = j21 * hyXi + j22 * hyEta;
    B[0][k] = hxX; B[1][k] = hyY; B[2][k] = hxY + hyX;
  }
  return B;
}

// Macierz sprężystości płyty izotropowej D = E t^3 / (12 (1 - nu^2))
export function plateD(E, t, nu) {
  const D = E * t ** 3 / (12 * (1 - nu * nu));
  return [[D, D * nu, 0], [D * nu, D, 0], [0, 0, D * (1 - nu) / 2]];
}

// 3-punktowa kwadratura Gaussa na trójkącie (dokładna dla wielomianów 2. stopnia)
const GAUSS = [[1 / 6, 1 / 6], [2 / 3, 1 / 6], [1 / 6, 2 / 3]];

// Macierz sztywności elementu (9 x 9)
export function stiffness(xy, Dm) {
  const geo = geometry(xy);
  const hc = hCoefficients(geo.c);
  const K = Array.from({ length: 9 }, () => new Array(9).fill(0));
  const wgt = geo.area / 3;
  for (const [xi, eta] of GAUSS) {
    const B = Bmatrix(geo, hc, xi, eta);
    // DB = Dm * B
    const DB = [0, 1, 2].map(r => B[0].map((_, k) => Dm[r][0] * B[0][k] + Dm[r][1] * B[1][k] + Dm[r][2] * B[2][k]));
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++)
      K[i][j] += wgt * (B[0][i] * DB[0][j] + B[1][i] * DB[1][j] + B[2][i] * DB[2][j]);
  }
  return K;
}

// Momenty [mx, my, mxy] w punkcie (xi, eta) — kNm/m przy danych w kN, m.
// Znak: mx > 0 rozciąga spód płyty (strona przeciwna do zwrotu w).
// bx = -dw/dx  =>  bx,x = -w,xx, a mx = -D (w,xx + nu w,yy) = D (bx,x + nu by,y).
export function moments(xy, Dm, u, xi, eta) {
  const geo = geometry(xy);
  const hc = hCoefficients(geo.c);
  const B = Bmatrix(geo, hc, xi, eta);
  const kap = [0, 1, 2].map(r => B[r].reduce((s, b, k) => s + b * u[k], 0));
  return [0, 1, 2].map(r => Dm[r][0] * kap[0] + Dm[r][1] * kap[1] + Dm[r][2] * kap[2]);
}

// Macierze wyników w narożach elementu (do szybkiego liczenia momentów dla wielu przypadków):
// m(naroże a) = M[a] · u, M[a] = D · B(naroże a), wymiar 3 × 9
export function cornerMomentMatrices(xy, Dm) {
  const geo = geometry(xy), hc = hCoefficients(geo.c);
  return [[0, 0], [1, 0], [0, 1]].map(([xi, eta]) => {
    const B = Bmatrix(geo, hc, xi, eta);
    return [0, 1, 2].map(r => B[0].map((_, k) => Dm[r][0] * B[0][k] + Dm[r][1] * B[1][k] + Dm[r][2] * B[2][k]));
  });
}

// Obciążenie zastępcze od krzywizny wymuszonej κ0 = [κx, κy, κxy] (np. skurcz, 7.4.3(6)):
// f = ∫ Bᵀ D κ0 dA (znak jak momentów: κ0 > 0 wygina płytę jak obciążenie z góry).
export function initialCurvatureLoad(xy, Dm, k0) {
  const geo = geometry(xy), hc = hCoefficients(geo.c), wgt = geo.area / 3;
  const m0 = [0, 1, 2].map(r => Dm[r][0] * k0[0] + Dm[r][1] * k0[1] + Dm[r][2] * k0[2]);
  const f = new Array(9).fill(0);
  for (const [xi, eta] of GAUSS) {
    const B = Bmatrix(geo, hc, xi, eta);
    for (let k = 0; k < 9; k++) f[k] += wgt * (B[0][k] * m0[0] + B[1][k] * m0[1] + B[2][k] * m0[2]);
  }
  return f;
}
