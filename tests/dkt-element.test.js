// T2 (część elementowa): konwencja znaków, ruchy sztywne, symetria macierzy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotations, stiffness, plateD } from '../src/dkt.js';

const xy = [[0.1, 0.2], [1.3, 0.4], [0.5, 1.1]]; // dowolny, nieregularny trójkąt
const Dm = plateD(30e6, 0.2, 0.2);

test('konwencja: tx = dw/dy, ty = -dw/dx; pole kwadratowe odtworzone dokładnie (bx = -w,x, by = -w,y)', () => {
  const w = (x, y) => 0.7 * x * x + 0.4 * x * y - 0.9 * y * y + 0.3 * x - 0.2 * y + 1;
  const wx = (x, y) => 1.4 * x + 0.4 * y + 0.3, wy = (x, y) => 0.4 * x - 1.8 * y - 0.2;
  const u = xy.flatMap(([x, y]) => [w(x, y), wy(x, y), -wx(x, y)]);
  for (const [xi, eta] of [[0.2, 0.3], [0.5, 0.1], [1 / 3, 1 / 3], [0.1, 0.7]]) {
    const x = xy[0][0] + (xy[1][0] - xy[0][0]) * xi + (xy[2][0] - xy[0][0]) * eta;
    const y = xy[0][1] + (xy[1][1] - xy[0][1]) * xi + (xy[2][1] - xy[0][1]) * eta;
    const { bx, by } = rotations(xy, u, xi, eta);
    assert.ok(Math.abs(bx + wx(x, y)) < 1e-12, `bx w (${xi},${eta})`);
    assert.ok(Math.abs(by + wy(x, y)) < 1e-12, `by w (${xi},${eta})`);
  }
});

test('ruchy sztywne (przesunięcie i dwa obroty) nie wywołują sił', () => {
  const K = stiffness(xy, Dm);
  const modes = [
    xy.flatMap(() => [1, 0, 0]),                       // w = 1
    xy.flatMap(([x]) => [x, 0, -1]),                   // w = x
    xy.flatMap(([, y]) => [y, 1, 0]),                  // w = y
  ];
  const scale = Math.max(...K.flat().map(Math.abs));
  for (const u of modes) for (const row of K) {
    const f = row.reduce((s, k, j) => s + k * u[j], 0);
    assert.ok(Math.abs(f) < 1e-10 * scale);
  }
});

test('macierz sztywności symetryczna', () => {
  const K = stiffness(xy, Dm);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++)
    assert.ok(Math.abs(K[i][j] - K[j][i]) <= 1e-9 * Math.abs(K[i][i]));
});

test('zła orientacja węzłów zgłaszana jako błąd', () => {
  assert.throws(() => stiffness([xy[0], xy[2], xy[1]], Dm), /orientacji/);
});
