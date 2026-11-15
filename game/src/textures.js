// All art is painted here, at runtime, on small canvases: no image assets
// ship with the game. Every generator takes the seeded stream so the map
// looks the same on every load, and every texture tiles cleanly.
import * as THREE from 'three';
import { mulberry32 } from './rng.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function speckle(ctx, w, h, rng, n, colors, lo, hi) {
  for (let i = 0; i < n; i += 1) {
    ctx.fillStyle = colors[Math.floor(rng() * colors.length)];
    ctx.globalAlpha = lo + rng() * (hi - lo);
    const s = 1 + rng() * 3;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
  ctx.globalAlpha = 1;
}

function toTexture(c, repeat) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// Clone a map with its own repeat: the image is shared, the tiling is not.
export function tile(map, rx, ry) {
  const t = map.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

function saltGround(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8e2d4';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, 2600, ['#f4efe4', '#d9d2c0', '#cfc7b4', '#ffffff'], 0.25, 0.7);
  // Faint polygonal salt-pan cracks.
  ctx.strokeStyle = 'rgba(160,150,130,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 26; i += 1) {
    let x = rng() * 256;
    let y = rng() * 256;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k += 1) {
      x += (rng() - 0.5) * 46;
      y += (rng() - 0.5) * 46;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function concrete(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8d8578';
  ctx.fillRect(0, 0, 256, 256);
  speckle(ctx, 256, 256, rng, 2200, ['#7d7568', '#9b9384', '#6b655c', '#a89f8e'], 0.2, 0.55);
  // Panel seams and weather streaks.
  ctx.strokeStyle = 'rgba(60,55,48,0.5)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.stroke();
  for (let i = 0; i < 14; i += 1) {
    const x = rng() * 256;
    const grad = ctx.createLinearGradient(x, 0, x, 256);
    grad.addColorStop(0, 'rgba(70,64,54,0.28)');
    grad.addColorStop(1, 'rgba(70,64,54,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 3 + rng() * 7, 256);
  }
  return c;
}

function rustMetal(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a5258';
  ctx.fillRect(0, 0, 256, 256);
  // Corrugation.
  for (let x = 0; x < 256; x += 16) {
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(x, 0, 5, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x + 9, 0, 5, 256);
  }
  // Rust blooms and drips.
  for (let i = 0; i < 30; i += 1) {
    const x = rng() * 256;
    const y = rng() * 256;
    const r = 6 + rng() * 22;
    const grad = ctx.createRadialGradient(x, y, 1, x, y, r);
    grad.addColorStop(0, 'rgba(180,85,45,0.55)');
    grad.addColorStop(1, 'rgba(180,85,45,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  speckle(ctx, 256, 256, rng, 900, ['#33393f', '#5d666c', '#7e3a1e'], 0.2, 0.5);
  return c;
}

function crateWood(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9a7b4f';
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 64) {
    ctx.fillStyle = y % 128 === 0 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(0, y, 256, 64);
    ctx.strokeStyle = 'rgba(60,44,24,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  speckle(ctx, 256, 256, rng, 700, ['#8a6b42', '#ab8c5e', '#755a36'], 0.2, 0.5);
  ctx.strokeStyle = 'rgba(50,38,20,0.8)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, 250, 250);
  ctx.beginPath();
  ctx.moveTo(6, 6);
  ctx.lineTo(250, 250);
  ctx.moveTo(250, 6);
  ctx.lineTo(6, 250);
  ctx.stroke();
  return c;
}

function hazard() {
  const c = canvas(128, 128);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9a419';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#23262b';
  for (let x = -128; x < 256; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 128);
    ctx.lineTo(x + 16, 128);
    ctx.lineTo(x + 144, 0);
    ctx.lineTo(x + 128, 0);
    ctx.closePath();
    ctx.fill();
  }
  return c;
}

function roofSheet(rng) {
  const c = canvas(256, 256);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b4a34';
  ctx.fillRect(0, 0, 256, 256);
  for (let x = 0; x < 256; x += 12) {
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, 0, 4, 256);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + 7, 0, 4, 256);
  }
  speckle(ctx, 256, 256, rng, 600, ['#7e3a1e', '#5a3a26'], 0.15, 0.4);
  return c;
}

// A painted sign: dark plate, stencilled letters, a thin accent rule.
export function signTexture(text, sub, accent) {
  const c = canvas(512, 160);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#23262b';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = 'rgba(233,230,223,0.25)';
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 496, 144);
  ctx.fillStyle = accent || '#ffb454';
  ctx.fillRect(24, 118, 120, 6);
  ctx.fillStyle = '#e9e6df';
  ctx.font = '700 56px system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, 24, 84);
  if (sub) {
    ctx.fillStyle = '#98a0a8';
    ctx.font = '500 26px system-ui, sans-serif';
    ctx.fillText(sub, 24, 142);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A soft radial glow: muzzle flashes, lamp halos, the sun disc. One texture,
// tinted per sprite by its material colour.
export function glowTexture() {
  const c = canvas(64, 64);
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextures(seed) {
  const rng = mulberry32(seed);
  const maps = {
    salt: toTexture(saltGround(rng)),
    concrete: toTexture(concrete(rng)),
    metal: toTexture(rustMetal(rng)),
    wood: toTexture(crateWood(rng)),
    hazard: toTexture(hazard()),
    roof: toTexture(roofSheet(rng)),
  };
  const std = (map, rough, metal) =>
    new THREE.MeshStandardMaterial({ map, roughness: rough, metalness: metal });
  return {
    maps,
    materials: {
      salt: std(maps.salt, 0.95, 0),
      concrete: std(maps.concrete, 0.9, 0),
      metal: std(maps.metal, 0.6, 0.25),
      wood: std(maps.wood, 0.85, 0),
      hazard: std(maps.hazard, 0.7, 0.1),
      roof: std(maps.roof, 0.7, 0.35),
      flat: (color, rough) =>
        new THREE.MeshStandardMaterial({ color, roughness: rough ?? 0.85, metalness: 0 }),
    },
  };
}
