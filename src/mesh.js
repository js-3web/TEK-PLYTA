// Siatka strukturalna na równoległoboku — do testów wzorcowych.
// (Siatka dla dowolnego obrysu z DXF powstanie w etapie 3.)
// Narożnik o w punkcie origin, boki wektorami a i b (a × b > 0), podział nx × ny.
// Przekątne w sąsiednich komórkach naprzemiennie, żeby nie faworyzować kierunku.

export function parallelogramMesh({ origin = [0, 0], a, b, nx, ny }) {
  const nodes = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++)
    nodes.push([origin[0] + a[0] * i / nx + b[0] * j / ny, origin[1] + a[1] * i / nx + b[1] * j / ny]);
  const id = (i, j) => j * (nx + 1) + i;
  const elems = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n00 = id(i, j), n10 = id(i + 1, j), n11 = id(i + 1, j + 1), n01 = id(i, j + 1);
    if ((i + j) % 2 === 0) elems.push([n00, n10, n11], [n00, n11, n01]);
    else elems.push([n00, n10, n01], [n10, n11, n01]);
  }
  const edge = {
    bottom: Array.from({ length: nx + 1 }, (_, i) => id(i, 0)),
    top: Array.from({ length: nx + 1 }, (_, i) => id(i, ny)),
    left: Array.from({ length: ny + 1 }, (_, j) => id(0, j)),
    right: Array.from({ length: ny + 1 }, (_, j) => id(nx, j)),
  };
  const corners = [id(0, 0), id(nx, 0), id(nx, ny), id(0, ny)];
  return { nodes, elems, edge, corners, id };
}

// Podparcie przegubowe ("twarde") na krawędziach równoległoboku:
// w = 0 i dw/dt = 0 wzdłuż krawędzi; w narożnikach oba obroty = 0.
export function simplySupported(mesh, a, b) {
  const fix = new Map();
  const set = (nodesList, tangent) => nodesList.forEach(n => fix.set(n, { w: true, tangent }));
  set(mesh.edge.bottom, a); set(mesh.edge.top, a);
  set(mesh.edge.left, b); set(mesh.edge.right, b);
  for (const c of mesh.corners) fix.set(c, { w: true, tx: true, ty: true });
  return fix;
}

export function clamped(mesh) {
  const fix = new Map();
  for (const list of Object.values(mesh.edge)) for (const n of list) fix.set(n, { w: true, tx: true, ty: true });
  return fix;
}
