// Saltline: boot, the fixed-step loop, and the renderer. The simulation
// runs at 60 Hz in step(); rendering copies state to the scene once per
// frame and never feeds back. ?shot=cover|buy|plant|smoke with &seed=N stages
// a deterministic frame through the real sim, renders it twice, freezes it
// and sets window.__shotReady for capture.
import * as THREE from 'three';
import { PALETTE, LIGHT } from './palette.js';
import { mulberry32 } from './rng.js';
import { createState, TICK, pushEvent, aliveOf } from './state.js';
import { createTextures, glowTexture } from './textures.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { createWorld, buildAgentMesh, pointInSite } from './world.js';
import { moveBody, groundSpeed, eyePosition, EYE_STAND } from './player.js';
import {
  WEAPONS, BUY_MENU, spreadFor, canFire, startReload, updateWeapon, switchWeapon,
} from './weapons.js';
import { shoot, throwGrenade, stepGrenades } from './combat.js';
import { stepBots } from './bots.js';
import { setupMatch, stepRounds, buyItem, restartMatch } from './rounds.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const rng = mulberry32(params.has('seed') ? seed : (Date.now() % 2147483647));

const S = createState(seed);
S.rngStream = rng;

// Renderer, scene, camera.
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 34, 110);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 260);
scene.add(camera);

// Sky dome: a gradient shader, dusk blue over an amber horizon.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    topColor: { value: new THREE.Color(PALETTE.skyTop) },
    horizonColor: { value: new THREE.Color(PALETTE.skyHorizon) },
    fogColor: { value: new THREE.Color(PALETTE.fog) },
  },
  vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 fogColor; varying vec3 vDir;',
    'void main() {',
    '  float h = vDir.y;',
    '  vec3 col = h > 0.0 ? mix(horizonColor, topColor, smoothstep(0.0, 0.55, h))',
    '                    : mix(horizonColor, fogColor, smoothstep(0.0, -0.25, h));',
    '  gl_FragColor = vec4(col, 1.0);',
    '}',
  ].join('\n'),
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), skyMat));

// Sun disc and slow clouds, all sprites on the shared glow texture.
const glow = glowTexture();
const sunDir = new THREE.Vector3(-50, 24, -12).normalize();
const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glow, color: PALETTE.sun, transparent: true, opacity: 0.95,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
sunSprite.position.copy(sunDir).multiplyScalar(108);
sunSprite.scale.set(30, 30, 1);
scene.add(sunSprite);
const clouds = [];
for (const [cx, cy, cz, cs] of [[-40, 34, -50, 46], [30, 40, -60, 58], [55, 30, 30, 40], [-60, 38, 40, 52]]) {
  const cloud = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: 0xfff2e0, transparent: true, opacity: 0.13, depthWrite: false,
  }));
  cloud.position.set(cx, cy, cz);
  cloud.scale.set(cs, cs * 0.36, 1);
  scene.add(cloud);
  clouds.push(cloud);
}

// Light: one warm sun with shadows, one hemisphere fill. Nothing else casts.
const sun = new THREE.DirectionalLight(LIGHT.sunColor, LIGHT.sunIntensity);
sun.position.set(-50, 25, -12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -42;
sun.shadow.camera.right = 42;
sun.shadow.camera.top = 42;
sun.shadow.camera.bottom = -42;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 130;
sun.shadow.bias = -0.0003;
scene.add(sun);
scene.add(new THREE.HemisphereLight(LIGHT.hemiSky, LIGHT.hemiGround, LIGHT.hemiIntensity));
scene.add(new THREE.AmbientLight(0xffd9b0, LIGHT.ambientBoost));

// Systems.
const tex = createTextures(seed);
const world = createWorld(scene, tex);
const audio = createAudio();
const effects = createEffects(scene, camera);
const hud = createHud(S, world);
const input = createInput(renderer.domElement, onLockChange);

setupMatch(S);
let player = S.entities[0];
const agentMeshes = [];

function setupAgents() {
  for (const m of agentMeshes) scene.remove(m.group);
  agentMeshes.length = 0;
  for (const ent of S.entities) {
    if (ent.isPlayer) continue;
    const mesh = buildAgentMesh(ent.team, ent.name, ent.team === 'W');
    mesh.group.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    mesh.userData = { phase: Math.random() * Math.PI * 2 };
    scene.add(mesh.group);
    ent.mesh = mesh;
    agentMeshes.push(mesh);
  }
}
setupAgents();

// First-person viewmodel: one gun per weapon, built from boxes.
const viewmodel = new THREE.Group();
camera.add(viewmodel);
const vmGuns = {};
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.5 });
  const grip = new THREE.MeshStandardMaterial({ color: 0x4a3b28, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.3 });
  const specs = {
    pistol: { len: 0.3, mag: 0.1, sight: 0.02 },
    smg: { len: 0.46, mag: 0.16, sight: 0.03 },
    rifle: { len: 0.58, mag: 0.18, sight: 0.04 },
    marksman: { len: 0.72, mag: 0.12, sight: 0.06 },
  };
  for (const [id, spec] of Object.entries(specs)) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.1, spec.len), dark);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 10), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.02, -spec.len / 2 - 0.06);
    g.add(barrel);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, spec.mag, 0.09), dark);
    mag.position.set(0, -0.08 - spec.mag / 2 + 0.05, 0.02);
    mag.rotation.x = 0.18;
    g.add(mag);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, spec.sight, 0.06), accent);
    sight.position.set(0, 0.07, -0.1);
    g.add(sight);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.16), grip);
    stock.position.set(0, -0.01, spec.len / 2 + 0.05);
    g.add(stock);
    g.visible = false;
    viewmodel.add(g);
    vmGuns[id] = g;
  }
}
const vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({
  map: glow, color: 0xffd9a0, transparent: true, opacity: 0,
  depthWrite: false, blending: THREE.AdditiveBlending,
}));
vmFlash.scale.set(0.34, 0.34, 1);
viewmodel.add(vmFlash);
let vmKick = 0;
let vmBob = 0;
let vmAds = 0;
let vmSwayX = 0;
let vmSwayY = 0;

let started = false;
let paused = false;
let frozen = false;
let prevFire = false;
let hintUntil = 0;
let stepAcc = 0;
let lastTime = performance.now();
let accumulator = 0;
const camPos = { x: 0, y: 0, z: 0 };

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    paused = false;
    hud.hideOverlay();
    audio.resume();
  } else if (started && !hud.isBuyOpen() && S.phase !== 'match') {
    paused = true;
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  audio.resume();
  input.requestLock();
});
hud.onRestart(() => {
  restartMatch(S);
  player = S.entities[0];
  setupAgents();
  hud.hideOverlay();
  started = true;
  paused = false;
  input.requestLock();
});
hud.onBuy((id) => {
  const msg = buyItem(S, player, id);
  hud.setBuyMsg(msg);
  hud.refreshBuy(player);
});
hud.onCloseBuy(() => {
  hud.closeBuy();
  if (started && !shot) input.requestLock();
});

function setHint(text, holdMs) {
  hud.setHint(text);
  hintUntil = performance.now() + (holdMs || 4000);
}

function toggleBuy() {
  if (S.phase !== 'buy') {
    setHint('Buy time is over — the round is live.', 2200);
    return;
  }
  if (hud.isBuyOpen()) {
    hud.closeBuy();
    input.requestLock();
  } else {
    hud.openBuy(player);
    input.releaseLock();
  }
}

function cycleWeapon(dir) {
  const owned = Object.keys(WEAPONS).filter((id) => player.owned[id]);
  if (owned.length < 2) return;
  const idx = owned.indexOf(player.weapon);
  const next = owned[(idx + dir + owned.length) % owned.length];
  switchWeapon(player, next);
}

function playerStep(dt) {
  const ent = player;
  if (!ent.alive) return;
  const ads = input.mouse.ads && !hud.isBuyOpen();
  // Look.
  const look = input.takeLook();
  const sens = ads ? 0.0015 : 0.0022;
  ent.yaw -= look.x * sens;
  ent.pitch -= look.y * sens;
  if (ent.pitch > 1.35) ent.pitch = 1.35;
  if (ent.pitch < -1.35) ent.pitch = -1.35;
  vmSwayX += (-look.x * 0.0004 - vmSwayX) * Math.min(1, dt * 10);
  vmSwayY += (look.y * 0.0004 - vmSwayY) * Math.min(1, dt * 10);

  // Move.
  const k = input.keys;
  const f = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const s = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  const fx = -Math.sin(ent.yaw);
  const fz = -Math.cos(ent.yaw);
  const rx = Math.cos(ent.yaw);
  const rz = -Math.sin(ent.yaw);
  const jump = input.wasPressed('Space');
  moveBody(world, ent, fx * f + rx * s, fz * f + rz * s, dt, {
    crouch: k.has('ControlLeft') || k.has('KeyC'),
    slow: k.has('ShiftLeft') || k.has('ShiftRight'),
    ads,
    jump,
  });

  // Footsteps: distance-based, silent while crouched or slow-walking.
  const speed = groundSpeed(ent);
  if (speed > 0.5 && ent.onGround && !ent.crouch && !k.has('ShiftLeft')) {
    ent.stepT += speed * dt;
    if (ent.stepT > 2.4) {
      ent.stepT = 0;
      pushEvent(S, 'step', { x: ent.pos.x, y: ent.pos.y, z: ent.pos.z });
    }
  }

  // Fire.
  const def = WEAPONS[ent.weapon];
  const firing = input.mouse.fire && !hud.isBuyOpen();
  const fresh = firing && (!def.auto ? !prevFire : true);
  if (fresh && canFire(ent, def, S.time)) {
    shoot(S, world, ent, rng, ads);
    vmKick = Math.min(0.09, vmKick + 0.045);
  } else if (firing && ent.ammo[ent.weapon].mag === 0 && S.time >= ent.nextShotAt) {
    ent.nextShotAt = S.time + 0.3;
    pushEvent(S, 'dry', { id: ent.id });
  }
  prevFire = firing;

  if (input.wasPressed('KeyR') && startReload(ent, def, S.time)) {
    pushEvent(S, 'reload', { id: ent.id });
  }
  if (input.wasPressed('Digit1')) {
    const prim = ['rifle', 'marksman', 'smg'].find((id) => ent.owned[id]);
    if (prim) switchWeapon(ent, prim);
  }
  if (input.wasPressed('Digit2')) switchWeapon(ent, 'pistol');
  const wheel = input.takeWheel();
  if (wheel !== 0) cycleWeapon(wheel > 0 ? 1 : -1);
  if (input.wasPressed('KeyG')) throwGrenade(S, ent, 'frag');
  if (input.wasPressed('KeyF')) throwGrenade(S, ent, 'smoke');
  if (input.wasPressed('KeyB')) toggleBuy();
  if (hud.isBuyOpen()) {
    for (let i = 0; i < BUY_MENU.length; i += 1) {
      if (input.wasPressed(`Digit${i + 1}`)) {
        const msg = buyItem(S, ent, BUY_MENU[i].id);
        hud.setBuyMsg(msg);
        hud.refreshBuy(ent);
      }
    }
  }

  // Plant / defuse channel: hold E, conditions checked by the round logic.
  if (k.has('KeyE') && S.phase === 'live') {
    if (ent.hasCharge && pointInSite(ent.pos.x, ent.pos.z)) ent.channel = 'plant';
    else if (S.bomb.state === 'planted' && ent.team === 'W') {
      const dx = ent.pos.x - S.bomb.pos.x;
      const dz = ent.pos.z - S.bomb.pos.z;
      ent.channel = dx * dx + dz * dz < 4.84 ? 'defuse' : null;
    } else ent.channel = null;
  } else {
    ent.channel = null;
  }
}

function step(dt) {
  S.time += dt;
  S.tick += 1;
  stepRounds(S, world, dt);
  stepBots(S, world, dt, rng);
  stepGrenades(S, world, dt);
  if (started || shot) playerStep(dt);
  for (const ent of S.entities) {
    updateWeapon(ent, dt);
    if (ent.muzzleT > 0) ent.muzzleT -= dt;
    if (ent.hurtT > 0) ent.hurtT -= dt;
  }
}

function drainEvents() {
  for (const ev of S.events) {
    if (ev.type === 'shot') {
      audio.play('shot', { x: ev.x, y: ev.y, z: ev.z }, ev.kind);
      if (ev.id === player.id) effects.flashMuzzle();
    } else if (ev.type === 'tracer') {
      effects.spawnTracer(ev.x0, ev.y0, ev.z0, ev.x1, ev.y1, ev.z1);
    } else if (ev.type === 'impact') {
      effects.spawnSparks(ev.x, ev.y, ev.z, ev.nx, ev.ny, ev.nz, 0xcfc7b4, 6);
    } else if (ev.type === 'hitmark') {
      hud.hitMarker(ev.kill, ev.head, shot ? 4000 : 90);
      audio.play('hit');
    } else if (ev.type === 'hurt') {
      audio.play('hurt');
    } else if (ev.type === 'kill') {
      audio.play('kill');
    } else if (ev.type === 'dry') {
      audio.play('dry');
    } else if (ev.type === 'reload') {
      const ent = S.entities.find((e) => e.id === ev.id);
      audio.play('reload', ent ? { x: ent.pos.x, y: ent.pos.y, z: ent.pos.z } : null);
    } else if (ev.type === 'throw') {
      audio.play('throwIt');
    } else if (ev.type === 'bounce') {
      audio.play('bounce', { x: ev.x, y: ev.y, z: ev.z });
    } else if (ev.type === 'smoke') {
      effects.spawnSmokeCloud(ev.x, ev.y, ev.z, S.time);
      audio.play('smoke', { x: ev.x, y: ev.y, z: ev.z });
    } else if (ev.type === 'explosion') {
      effects.spawnExplosion(ev.x, ev.y, ev.z);
      audio.play('explosion', { x: ev.x, y: ev.y, z: ev.z });
      const dx = player.pos.x - ev.x;
      const dz = player.pos.z - ev.z;
      const d = Math.hypot(dx, dz);
      if (d < 20) effects.shake(0.15 + 0.5 * (1 - d / 20));
    } else if (ev.type === 'beep') {
      audio.play('beep', { x: ev.x, y: ev.y, z: ev.z });
    } else if (ev.type === 'planted') {
      hud.showBanner('CHARGE PLANTED', `Site ${ev.site} — defend it, or defuse it`, 'warn', 3000);
      audio.play('plant');
    } else if (ev.type === 'defused') {
      audio.play('defuse');
    } else if (ev.type === 'roundStart') {
      if (S.round > 1) hud.showBanner(`ROUND ${S.round}`, 'Buy phase — press B', '', 2200);
    } else if (ev.type === 'roundLive') {
      hud.showBanner('GO', '', '', 900);
    } else if (ev.type === 'roundEnd') {
      const won = ev.winner === 'W';
      hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', ev.reason, won ? 'good' : 'bad', 3200);
      audio.play(won ? 'roundWin' : 'roundLose');
    } else if (ev.type === 'matchEnd') {
      input.releaseLock();
      hud.showOverlay('match', { winner: ev.winner });
    } else if (ev.type === 'buy') {
      audio.play('buy');
    } else if (ev.type === 'step') {
      audio.play('step', { x: ev.x, y: ev.y, z: ev.z });
    }
  }
  S.events.length = 0;
}

function syncVisuals(dt, time) {
  // Camera: the player's eye, or the spectated teammate's.
  let view = player;
  if (!player.alive && S.phase === 'live') {
    const ally = S.entities.find((e) => e.id === S.spectateId && e.alive)
      || S.entities.find((e) => e.team === 'W' && e.alive);
    if (ally) {
      view = ally;
      S.spectateId = ally.id;
    }
  }
  eyePosition(view, camPos);
  camera.position.set(camPos.x, camPos.y, camPos.z);
  const lean = view === player
    ? -((input.keys.has('KeyA') ? 1 : 0) - (input.keys.has('KeyD') ? 1 : 0)) * 0.012
    : 0;
  camera.rotation.set(
    view.pitch + view.rPitch + effects.shakeY,
    view.yaw + view.rYaw + effects.shakeX,
    lean,
    'YXZ',
  );

  // Agent meshes: pose, walk cycle, muzzle flash, death fall.
  for (const ent of S.entities) {
    const m = ent.mesh;
    if (!m) continue;
    m.group.position.set(ent.pos.x, ent.pos.y, ent.pos.z);
    if (ent.alive) {
      m.group.rotation.set(0, ent.yaw + Math.PI, 0);
      const speed = groundSpeed(ent);
      m.userData.phase += speed * dt * 2.4;
      const swing = Math.min(0.55, speed * 0.14) * Math.sin(m.userData.phase);
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.group.position.y = ent.pos.y + (speed > 0.5 ? Math.abs(Math.cos(m.userData.phase)) * 0.03 : 0);
      m.flash.material.opacity = ent.muzzleT > 0 ? 0.95 : 0;
    } else {
      const f = Math.min(1, (S.time - ent.deadT) * 3.2);
      m.group.rotation.set(-1.35 * f, ent.yaw + Math.PI, 0);
      m.flash.material.opacity = 0;
    }
  }

  // Viewmodel: bob, sway, kick, ADS, reload dip, weapon visibility.
  const ads = input.mouse.ads && player.alive && !hud.isBuyOpen();
  vmAds += ((ads ? 1 : 0) - vmAds) * Math.min(1, dt * 12);
  const speed = groundSpeed(player);
  if (player.onGround && speed > 0.5) vmBob += speed * dt * 1.9;
  vmKick *= Math.exp(-9 * dt);
  const hip = { x: 0.28, y: -0.24, z: -0.55 };
  const adsPos = { x: 0, y: -0.148, z: -0.42 };
  viewmodel.position.set(
    hip.x + (adsPos.x - hip.x) * vmAds + vmSwayX + Math.cos(vmBob) * 0.006 * Math.min(1, speed / 4),
    hip.y + (adsPos.y - hip.y) * vmAds + vmSwayY + Math.abs(Math.sin(vmBob)) * 0.008 * Math.min(1, speed / 4),
    hip.z + (adsPos.z - hip.z) * vmAds + vmKick,
  );
  const reloadDip = player.reloading > 0 ? -0.45 : 0;
  viewmodel.rotation.x = vmKick * 1.4 + reloadDip * 0.6;
  for (const [id, g] of Object.entries(vmGuns)) g.visible = id === player.weapon;
  vmFlash.material.opacity = player.muzzleT > 0 ? 0.95 : 0;
  if (player.muzzleT > 0) {
    vmFlash.material.rotation = Math.random() * Math.PI;
    const barrelZ = { pistol: -0.28, smg: -0.4, rifle: -0.48, marksman: -0.58 }[player.weapon];
    vmFlash.position.set(0, 0.02, barrelZ);
  }
  viewmodel.visible = player.alive && S.phase !== 'match';
  const wantFov = 74 - vmAds * 17;
  if (Math.abs(camera.fov - wantFov) > 0.01) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }

  // Clouds drift almost imperceptibly.
  for (let i = 0; i < clouds.length; i += 1) {
    clouds[i].position.x += Math.sin(time * 0.008 + i) * dt * 0.12;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= TICK && steps < 5) {
      step(TICK);
      accumulator -= TICK;
      steps += 1;
    }
    if (accumulator > TICK * 5) accumulator = 0;
    // Spectate switching: click while dead.
    if (!player.alive && input.mouse.fire && !prevFire && S.phase === 'live') {
      const alive = S.entities.filter((e) => e.team === 'W' && e.alive);
      if (alive.length > 1) {
        const idx = alive.findIndex((e) => e.id === S.spectateId);
        S.spectateId = alive[(idx + 1) % alive.length].id;
      }
    }
    prevFire = input.mouse.fire;
  }
  drainEvents();
  syncVisuals(dt, S.time);
  world.update(S.time);
  effects.update(dt, S, S.time);
  eyePosition(player, camPos);
  audio.setListener(camPos.x, camPos.y, camPos.z);
  const def = WEAPONS[player.weapon];
  const spreadPx = spreadFor(player, def, groundSpeed(player), input.mouse.ads) * 600;
  hud.update(player, spreadPx, dt, now);
  if (hintUntil && now > hintUntil) {
    hud.setHint('');
    hintUntil = 0;
  } else if (!hintUntil) {
    // Context hint, refreshed while nothing else claims the line.
    if (S.phase === 'buy' && started) hud.setHint('Press B to buy — the round starts soon');
    else if (player.hasCharge && pointInSite(player.pos.x, player.pos.z)) hud.setHint('Hold E to plant the charge');
    else if (S.bomb.state === 'planted' && player.team === 'W') hud.setHint('Defuse the charge — hold E beside it');
    else hud.setHint('');
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(TICK);
}

function aimAt(ent, x, y, z) {
  eyePosition(ent, camPos);
  const dx = x - camPos.x;
  const dy = y - camPos.y;
  const dz = z - camPos.z;
  ent.yaw = Math.atan2(-dx, -dz);
  ent.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function place(ent, x, z, yaw) {
  ent.pos.x = x;
  ent.pos.z = z;
  ent.pos.y = 0;
  ent.yaw = yaw;
  ent.pitch = 0;
  ent.vel.x = 0;
  ent.vel.z = 0;
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  setupMatch(S);
  player = S.entities[0];
  setupAgents();
  S.phase = 'live';
  S.phaseT = 62;
  const [ally1, ally2, foe1, foe2, foe3] = S.entities.slice(1);
  let visTime = S.time;
  player.money = 4200;
  player.owned.rifle = true;
  player.weapon = 'rifle';
  player.ammo.rifle.mag = 24;

  if (name === 'buy') {
    S.phase = 'buy';
    S.phaseT = 8;
    settle(10);
    hud.openBuy(player);
  } else if (name === 'plant') {
    // The charge sits on open ground east of the pump house block, in plain
    // view; the old spot was inside the building's collider.
    S.bomb.state = 'planted';
    S.bomb.site = 'A';
    S.bomb.fuseLeft = 28;
    S.bomb.pos.x = -16.5;
    S.bomb.pos.y = 0.3;
    S.bomb.pos.z = -15.5;
    place(player, -13, -12, 0);
    aimAt(player, -16.5, 0.3, -15.5);
    place(foe1, -19, -13, 0);
    aimAt(foe1, -13, 1.2, -12);
    place(foe2, -17, -19, 0);
    aimAt(foe2, -13, 1.2, -12);
    place(ally1, -14.5, -10.5, 0);
    aimAt(ally1, -16.5, 1.2, -15.5);
    settle(12);
    aimAt(player, -16.5, 0.6, -15.5);
  } else if (name === 'smoke') {
    // Same clean lane as the cover shot, the cloud under the bridge deck so
    // the dark structure backs it, foes flanking beyond it.
    place(player, 8, 0, 0);
    aimAt(player, -4, 1.2, 0);
    S.smokes.push({ x: -4, y: 1.4, z: 0, r: 3.4, until: S.time + 14, born: S.time });
    effects.spawnSmokeCloud(-4, 0.4, 0, S.time);
    place(foe1, -7, 2.5, 0);
    aimAt(foe1, 8, 1.2, 0);
    place(foe2, -7, -2.5, 0);
    aimAt(foe2, 8, 1.2, 0);
    place(ally1, 11, -2, 0);
    aimAt(ally1, -4, 1.2, 0);
    settle(10);
    // Age the cloud three and a half seconds so it reads as a wall of smoke.
    for (let k = 0; k < 210; k += 1) effects.update(TICK, S, S.time + k * TICK);
    visTime = S.time + 210 * TICK;
    aimAt(player, -4, 1.2, 0);
  } else {
    // cover: mid-lane firefight, tracer in the air, muzzle lit. Foes face the
    // player, allies face the fight.
    place(player, 8, 0, 0);
    aimAt(player, -2, 1.15, 0.5);
    place(foe1, -1, 0.5, -Math.PI / 2);
    place(foe2, -4.5, -2, -Math.PI / 2);
    place(foe3, -7, 2.5, -Math.PI / 2);
    place(ally1, 11.5, -2.5, Math.PI / 2);
    place(ally2, 12, 2.5, Math.PI / 2);
    settle(14);
    aimAt(player, -1, 1.15, 0.5);
    shoot(S, world, player, rng, false);
    foe1.muzzleT = 0.5;
    player.muzzleT = 0.5;
    effects.flashMuzzle();
  }
  drainEvents();
  // One effects pass so tracer colours, the charge mesh and grenade meshes
  // are synced before the frozen paint; without it the tracer is black and
  // the planted charge never appears. The smoke shot keeps its aged time.
  effects.update(0.001, S, visTime);
  syncVisuals(0, S.time);
  world.update(S.time);
  const def = WEAPONS[player.weapon];
  hud.update(player, spreadFor(player, def, 0, false) * 600, 0, performance.now());
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncVisuals(0, S.time);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
