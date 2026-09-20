export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

/** Hermite smoothstep; działa też „w dół”, gdy edge0 > edge1. */
export function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * Najkrótsza droga po okręgu o długości `len`.
 * wrapDelta(2, 3) === -1 — bo z pozycji 0 bliżej do slajdu 2 „w lewo”.
 */
export function wrapDelta(delta, len) {
  const half = len / 2;
  let d = ((delta % len) + len) % len;
  if (d > half) d -= len;
  return d;
}

export const wrapIndex = (i, len) => ((i % len) + len) % len;
