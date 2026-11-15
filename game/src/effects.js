// Transient visuals, all pooled: tracers, impact sparks, smoke clouds,
// explosions, live grenades and the charge itself. Nothing here is allocated
// per frame; pools are filled once and recycled. The sim only ever pushes
// events, and main.js turns them into these calls.
import * as THREE from 'three';
import { glowTexture } from './textures.js';

const MAX_TRACERS = 64;
const MAX_SPARKS = 256;
const MAX_SMOKE_SPRITES = 24;
const MAX_GRENADES = 6;

export function createEffects(scene, camera) {
  const glow = glowTexture();

  // Tracers: one LineSegments, additive, fading to black (invisible).
  const tracerPos = new Float32Array(MAX_TRACERS * 6);
  const tracerCol = new Float32Array(MAX_TRACERS * 6);
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tracerPos, 3));
  tracerGeo.setAttribute('color', new THREE.BufferAttribute(tracerCol, 3));
  const tracerLines = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  const tracers = [];
  for (let i = 0; i < MAX_TRACERS; i += 1) {
    tracers.push({ life: 0, max: 0.07 });
    tracerPos[i * 6 + 1] = -100;
    tracerPos[i * 6 + 4] = -100;
  }
  let tracerNext = 0;

  // Sparks: one Points cloud, gravity on each particle.
  const sparkPos = new Float32Array(MAX_SPARKS * 3);
  const sparkCol = new Float32Array(MAX_SPARKS * 3);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3));
  const sparkPoints = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  }));
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);
  const sparks = [];
  for (let i = 0; i < MAX_SPARKS; i += 1) {
    sparks.push({ life: 0, max: 0.4, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 });
    sparkPos[i * 3 + 1] = -1000;
  }
  let sparkNext = 0;

  // Smoke: soft sprites that grow and thin out.
  const smokeSprites = [];
  for (let i = 0; i < MAX_SMOKE_SPRITES; i += 1) {
    const mat = new THREE.SpriteMaterial({
      map: glow, color: 0xbfbbb2, transparent: true, opacity: 0, depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    s.visible = false;
    scene.add(s);
    smokeSprites.push({ sprite: s, born: 0, until: 0, x: 0, y: 0, z: 0, ox: 0, oy: 0, oz: 0, grow: 1 });
  }
  let smokeNext = 0;

  // Explosion flash + light.
  const flashSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xffc070, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flashSprite.visible = false;
  scene.add(flashSprite);
  const blastLight = new THREE.PointLight(0xffa050, 0, 20, 1.6);
  scene.add(blastLight);
  let flashT = 0;

  // Muzzle light: one reusable light riding with the camera.
  const muzzleLight = new THREE.PointLight(0xffd9a0, 0, 7, 1.8);
  muzzleLight.position.set(0.3, -0.2, -0.9);
  camera.add(muzzleLight);
  let muzzleT = 0;

  // Live grenades: small dark spheres, synced from the sim.
  const grenadeMeshes = [];
  const grenadeGeo = new THREE.SphereGeometry(0.12, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < MAX_GRENADES; i += 1) {
    const m = new THREE.Mesh(grenadeGeo, grenadeMat);
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }

  // The charge: a dark box with a blinking red eye.
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.4 }),
  );
  bombBody.position.y = 0.15;
  bombGroup.add(bombBody);
  const bombLed = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xff4030, transparent: true, opacity: 0.9,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  bombLed.position.y = 0.38;
  bombLed.scale.set(0.3, 0.3, 1);
  bombGroup.add(bombLed);
  bombGroup.visible = false;
  scene.add(bombGroup);

  let shakeMag = 0;
  let shakeT = 0;

  return {
    shakeX: 0,
    shakeY: 0,

    spawnTracer(x0, y0, z0, x1, y1, z1) {
      const i = tracerNext;
      tracerNext = (tracerNext + 1) % MAX_TRACERS;
      tracerPos[i * 6] = x0;
      tracerPos[i * 6 + 1] = y0;
      tracerPos[i * 6 + 2] = z0;
      tracerPos[i * 6 + 3] = x1;
      tracerPos[i * 6 + 4] = y1;
      tracerPos[i * 6 + 5] = z1;
      tracers[i].life = tracers[i].max;
    },

    spawnSparks(x, y, z, nx, ny, nz, color, count) {
      const r = ((color >> 16) & 255) / 255;
      const g = ((color >> 8) & 255) / 255;
      const b = (color & 255) / 255;
      for (let k = 0; k < count; k += 1) {
        const i = sparkNext;
        sparkNext = (sparkNext + 1) % MAX_SPARKS;
        const s = sparks[i];
        s.life = s.max * (0.6 + Math.random() * 0.4);
        sparkPos[i * 3] = x;
        sparkPos[i * 3 + 1] = y;
        sparkPos[i * 3 + 2] = z;
        s.vx = nx * 2.4 + (Math.random() - 0.5) * 3.4;
        s.vy = ny * 2.4 + Math.random() * 2.6;
        s.vz = nz * 2.4 + (Math.random() - 0.5) * 3.4;
        s.r = r;
        s.g = g;
        s.b = b;
      }
    },

    spawnSmokeCloud(x, y, z, now) {
      for (let k = 0; k < 8; k += 1) {
        const s = smokeSprites[smokeNext];
        smokeNext = (smokeNext + 1) % MAX_SMOKE_SPRITES;
        s.born = now;
        s.until = now + 14;
        s.x = x;
        s.y = y + 0.6;
        s.z = z;
        s.ox = (Math.random() - 0.5) * 3.4;
        s.oy = Math.random() * 1.6;
        s.oz = (Math.random() - 0.5) * 3.4;
        s.grow = 0.8 + Math.random() * 0.5;
        s.sprite.visible = true;
      }
    },

    spawnExplosion(x, y, z) {
      flashSprite.position.set(x, y + 0.6, z);
      flashSprite.visible = true;
      flashSprite.scale.set(1, 1, 1);
      flashSprite.material.opacity = 0.95;
      blastLight.position.set(x, y + 1.2, z);
      blastLight.intensity = 60;
      flashT = 0.4;
      this.spawnSparks(x, y + 0.4, z, 0, 1, 0, 0xffa050, 40);
    },

    flashMuzzle() {
      muzzleLight.intensity = 5;
      muzzleT = 0.05;
    },

    shake(mag) {
      shakeMag = Math.max(shakeMag, mag);
      shakeT = 0.35;
    },

    update(dt, S, time) {
      // Tracers fade by darkening their colour.
      for (let i = 0; i < MAX_TRACERS; i += 1) {
        const t = tracers[i];
        if (t.life <= 0) continue;
        t.life -= dt;
        const f = Math.max(0, t.life / t.max);
        const c = 0.85 * f;
        tracerCol[i * 6] = c;
        tracerCol[i * 6 + 1] = c * 0.75;
        tracerCol[i * 6 + 2] = c * 0.4;
        tracerCol[i * 6 + 3] = c;
        tracerCol[i * 6 + 4] = c * 0.75;
        tracerCol[i * 6 + 5] = c * 0.4;
        if (t.life <= 0) {
          tracerPos[i * 6 + 1] = -100;
          tracerPos[i * 6 + 4] = -100;
        }
      }
      tracerGeo.attributes.position.needsUpdate = true;
      tracerGeo.attributes.color.needsUpdate = true;

      // Sparks fall and fade.
      for (let i = 0; i < MAX_SPARKS; i += 1) {
        const s = sparks[i];
        if (s.life <= 0) continue;
        s.life -= dt;
        s.vy -= 9 * dt;
        sparkPos[i * 3] += s.vx * dt;
        sparkPos[i * 3 + 1] += s.vy * dt;
        sparkPos[i * 3 + 2] += s.vz * dt;
        const f = Math.max(0, s.life / s.max);
        sparkCol[i * 3] = s.r * f;
        sparkCol[i * 3 + 1] = s.g * f;
        sparkCol[i * 3 + 2] = s.b * f;
        if (s.life <= 0 || sparkPos[i * 3 + 1] < 0.02) {
          s.life = 0;
          sparkPos[i * 3 + 1] = -1000;
          sparkCol[i * 3] = 0;
          sparkCol[i * 3 + 1] = 0;
          sparkCol[i * 3 + 2] = 0;
        }
      }
      sparkGeo.attributes.position.needsUpdate = true;
      sparkGeo.attributes.color.needsUpdate = true;

      // Smoke grows, drifts up, thins out. Aged on sim time, so a paused
      // game holds its smoke and a staged shot can age a cloud exactly.
      const now = time;
      for (const s of smokeSprites) {
        if (!s.sprite.visible) continue;
        if (now > s.until) {
          s.sprite.visible = false;
          s.sprite.material.opacity = 0;
          continue;
        }
        const age = now - s.born;
        const life = s.until - s.born;
        const f = age / life;
        const scale = (2.2 + f * 4.0) * s.grow;
        s.sprite.position.set(s.x + s.ox, s.y + s.oy + age * 0.12, s.z + s.oz);
        s.sprite.scale.set(scale, scale, 1);
        s.sprite.material.opacity = 0.62 * (f < 0.12 ? f / 0.12 : 1 - Math.max(0, (f - 0.7) / 0.3));
      }

      // Explosion flash and light decay.
      if (flashT > 0) {
        flashT -= dt;
        const f = Math.max(0, flashT / 0.4);
        flashSprite.material.opacity = 0.95 * f;
        flashSprite.scale.set(1 + (1 - f) * 7, 1 + (1 - f) * 7, 1);
        blastLight.intensity = 60 * f * f;
        if (flashT <= 0) {
          flashSprite.visible = false;
          blastLight.intensity = 0;
        }
      }
      if (muzzleT > 0) {
        muzzleT -= dt;
        if (muzzleT <= 0) muzzleLight.intensity = 0;
      }

      // Grenade meshes follow the sim.
      for (let i = 0; i < MAX_GRENADES; i += 1) {
        const m = grenadeMeshes[i];
        const g = S.grenades[i];
        if (g) {
          m.visible = true;
          m.position.set(g.pos.x, g.pos.y, g.pos.z);
        } else {
          m.visible = false;
        }
      }

      // The charge sits where it was planted or dropped, LED blinking faster
      // as the fuse runs down.
      const bomb = S.bomb;
      if (bomb.state === 'planted' || bomb.state === 'dropped') {
        bombGroup.visible = true;
        bombGroup.position.set(bomb.pos.x, 0, bomb.pos.z);
        if (bomb.state === 'planted') {
          const frac = bomb.fuseLeft / 40;
          const rate = 2 + (1 - frac) * 10;
          bombLed.material.opacity = Math.sin(time * rate * Math.PI * 2) > 0 ? 0.95 : 0.15;
        } else {
          bombLed.material.opacity = 0.5 + Math.sin(time * 3) * 0.3;
        }
      } else {
        bombGroup.visible = false;
      }

      // Camera shake: a fast wobble that decays.
      if (shakeT > 0) {
        shakeT -= dt;
        const f = Math.max(0, shakeT / 0.35);
        this.shakeX = Math.sin(time * 61) * shakeMag * f * 0.02;
        this.shakeY = Math.cos(time * 53) * shakeMag * f * 0.02;
        if (shakeT <= 0) shakeMag = 0;
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
    },
  };
}
