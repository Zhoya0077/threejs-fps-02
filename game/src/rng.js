// Deterministic randomness: one mulberry32 stream per purpose, so a seeded
// run (screenshots, replays) stages the same frame every time. Gameplay uses
// its own stream, seeded once per match; the shot stager reseeds it.
export function mulberry32(initial) {
  let a = initial | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export function chance(rng, p) {
  return rng() < p;
}

// A small gaussian-ish draw for aim error and spread: the sum of three
// uniforms, centred on zero, cheap and good enough for a game.
export function bell(rng) {
  return (rng() + rng() + rng() - 1.5) * 2;
}
