// Saltline palette: one dusk, held everywhere. The map is a salt-harvest
// terminal at golden hour: salt-white ground, rusted steel, deep dusk blue
// above, amber sun low in the west. HUD, teams, tracers and lights all draw
// from these six families and nothing else.
export const PALETTE = {
  skyTop: 0x2e4a6b,
  skyHorizon: 0xf2a65a,
  sun: 0xffd9a0,
  fog: 0xe8a86b,
  ground: 0xe8e2d4,
  saltPile: 0xf4efe4,
  concrete: 0x8d8578,
  concreteDark: 0x6b655c,
  steel: 0x4a5258,
  steelDark: 0x33393f,
  rust: 0xb4552d,
  rustDark: 0x7e3a1e,
  wood: 0x9a7b4f,
  canvas: 0x14161a,
  surface: 0x1e2228,
  hairline: 0x2c323a,
  ink: 0xe9e6df,
  muted: 0x98a0a8,
  accent: 0xffb454,
};

export const TEAM = {
  // Wardens defend the terminal. Jackals come to break it.
  W: { name: 'Wardens', color: 0x2f8f83, cloth: 0x276f66, accent: 0x7fd4c7, css: '#2f8f83' },
  J: { name: 'Jackals', color: 0xc25e33, cloth: 0x8f4525, accent: 0xf09a63, css: '#c25e33' },
};

export const LIGHT = {
  sunColor: 0xffc98a,
  sunIntensity: 2.6,
  hemiSky: 0x8fa8c8,
  hemiGround: 0xc9a06a,
  hemiIntensity: 1.0,
  ambientBoost: 0.12,
};
