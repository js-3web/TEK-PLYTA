// Sztywności podpór sprężystych (słupy, ściany) — mechanika prętów, sprężysto.
//   Słup: k_w = E A / H (osiowa), k_phi = c E I / H, c = 4 (dół utwierdzony), 3 (dół przegubowy).
//   Ściana na metr długości: k_w = E t / H, obrót wokół osi ściany: c E (t^3/12) / H albo 0.
// Uwaga (granica modelu): sprężyny nie uwzględniają zarysowania słupa ani pełzania;
// raport podaje przyjęte E.

export function columnSprings({ E, b, h = b, H, bottom = 'fixed', round = false }) {
  if (!(E > 0 && b > 0 && h > 0 && H > 0)) throw new Error('Słup: E, b, h, H muszą być dodatnie');
  const c = bottom === 'fixed' ? 4 : bottom === 'pinned' ? 3 : (() => { throw new Error(`Nieznany warunek dołu słupa: ${bottom}`); })();
  const A = round ? Math.PI * b * b / 4 : b * h;
  const Ix = round ? Math.PI * b ** 4 / 64 : b * h ** 3 / 12; // zginanie w płaszczyźnie y-z (obrót wokół x)
  const Iy = round ? Ix : h * b ** 3 / 12;
  return { kw: E * A / H, ktx: c * E * Ix / H, kty: c * E * Iy / H };
}

export function wallSpringsPerMeter({ E, t, H, bottom = 'pinned' }) {
  if (!(E > 0 && t > 0 && H > 0)) throw new Error('Ściana: E, t, H muszą być dodatnie');
  const c = bottom === 'fixed' ? 4 : bottom === 'pinned' ? 3 : 0;
  return { kw: E * t / H, kRot: bottom === 'free' ? 0 : c * E * t ** 3 / 12 / H };
}
