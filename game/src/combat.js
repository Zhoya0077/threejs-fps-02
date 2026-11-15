// Combat: hitscan guns and thrown grenades. Shots are analytic, never a
// scene-graph raycast: one ray against the world's boxes and one against each
// enemy's three body spheres (head, chest, pelvis), nearest wins. No friendly
// fire. Grenades are ballistic, bounce off the world, and the frag checks
// line of sight from the blast so walls are real cover.
import { pushEvent, pushFeed } from './state.js';
import { WEAPONS, damageAtRange, spreadFor } from './weapons.js';
import { aimDirection, eyePosition, applyRecoil, groundSpeed } from './player.js';
import { rayWorld, segmentBlocked } from './world.js';
import { bell } from './rng.js';

// Scratch vectors: the hot path allocates nothing.
const eye = { x: 0, y: 0, z: 0 };
const dir = { x: 0, y: 0, z: 0 };
const right = { x: 0, y: 0, z: 0 };
const up = { x: 0, y: 0, z: 0 };
const hitOut = { t: 0, nx: 0, ny: 0, nz: 0 };

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return Infinity;
  const t = tca - Math.sqrt(r2 - d2);
  return t > 0 ? t : Infinity;
}

function bodyHit(ent, ox, oy, oz, dx, dy, dz) {
  // Crouching compresses the body: the head drops to where the chest was.
  const k = ent.crouch ? 0.7 : 1;
  const py = ent.pos.y;
  const headT = raySphere(ox, oy, oz, dx, dy, dz, ent.pos.x, py + 1.62 * k, ent.pos.z, 0.23);
  if (headT < Infinity) return { t: headT, part: 'head' };
  const chestT = raySphere(ox, oy, oz, dx, dy, dz, ent.pos.x, py + 1.12 * k, ent.pos.z, 0.36);
  const pelvisT = raySphere(ox, oy, oz, dx, dy, dz, ent.pos.x, py + 0.62 * k, ent.pos.z, 0.33);
  if (chestT <= pelvisT) return { t: chestT, part: 'chest' };
  return { t: pelvisT, part: 'pelvis' };
}

export function shoot(S, world, shooter, rng, ads) {
  const def = WEAPONS[shooter.weapon];
  const ammo = shooter.ammo[shooter.weapon];
  if (ammo.mag <= 0) {
    shooter.nextShotAt = S.time + 0.3;
    pushEvent(S, 'dry', { id: shooter.id });
    return false;
  }
  ammo.mag -= 1;
  shooter.nextShotAt = S.time + def.interval;
  shooter.bloom = Math.min(def.maxBloom, shooter.bloom + def.bloom);
  shooter.muzzleT = 0.05;
  applyRecoil(shooter, def.kick * (0.8 + rng() * 0.4), (rng() * 2 - 1) * def.kick * 0.4);

  eyePosition(shooter, eye);
  aimDirection(shooter, dir);
  // Orthonormal basis around the aim direction, for the spread cone.
  right.x = -dir.z;
  right.y = 0;
  right.z = dir.x;
  const rl = Math.hypot(right.x, right.z) || 1;
  right.x /= rl;
  right.z /= rl;
  up.x = right.y * dir.z - right.z * dir.y;
  up.y = right.z * dir.x - right.x * dir.z;
  up.z = right.x * dir.y - right.y * dir.x;
  const spread = spreadFor(shooter, def, groundSpeed(shooter), ads);
  const ex = bell(rng) * spread;
  const ey = bell(rng) * spread;
  dir.x += right.x * ex + up.x * ey;
  dir.y += right.y * ex + up.y * ey;
  dir.z += right.z * ex + up.z * ey;
  const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir.x /= dl;
  dir.y /= dl;
  dir.z /= dl;

  const wallT = rayWorld(world, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, def.range, hitOut);
  let bestT = wallT;
  let bestEnt = null;
  let bestPart = '';
  for (const ent of S.entities) {
    if (ent === shooter || !ent.alive || ent.team === shooter.team) continue;
    const hit = bodyHit(ent, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z);
    if (hit.t < bestT) {
      bestT = hit.t;
      bestEnt = ent;
      bestPart = hit.part;
    }
  }

  const endX = eye.x + dir.x * bestT;
  const endY = eye.y + dir.y * bestT;
  const endZ = eye.z + dir.z * bestT;
  const gunX = eye.x + dir.x * 0.5 + right.x * 0.18 - up.x * 0.1;
  const gunY = eye.y + dir.y * 0.5 + right.y * 0.18 - up.y * 0.1;
  const gunZ = eye.z + dir.z * 0.5 + right.z * 0.18 - up.z * 0.1;
  pushEvent(S, 'shot', { id: shooter.id, kind: def.id, x: eye.x, y: eye.y, z: eye.z });
  pushEvent(S, 'tracer', { x0: gunX, y0: gunY, z0: gunZ, x1: endX, y1: endY, z1: endZ });
  S.sounds.push({ x: eye.x, z: eye.z, team: shooter.team, t: S.time });

  if (bestEnt) {
    let dmg = damageAtRange(def, bestT);
    if (bestPart === 'head') dmg *= def.headMult;
    if (bestEnt.armor) dmg *= 0.55;
    applyDamage(S, bestEnt, dmg, shooter, bestPart, 'shot');
  } else if (wallT < def.range) {
    pushEvent(S, 'impact', {
      x: endX, y: endY, z: endZ,
      nx: hitOut.nx, ny: hitOut.ny, nz: hitOut.nz,
    });
  }
  return true;
}

export function applyDamage(S, target, amount, attacker, part, cause) {
  if (!target.alive) return;
  target.hp -= amount;
  target.hurtT = 0.3;
  if (attacker && attacker.isPlayer) {
    pushEvent(S, 'hitmark', { kill: target.hp <= 0, head: part === 'head' });
  }
  if (target.isPlayer) pushEvent(S, 'hurt', { from: attacker ? attacker.id : -1 });
  if (target.hp > 0) return;

  target.hp = 0;
  target.alive = false;
  target.deaths += 1;
  target.deadT = S.time;
  target.channel = null;
  target.channelT = 0;
  if (attacker) {
    attacker.kills += 1;
    if (attacker.isPlayer) {
      attacker.money += 300;
      pushEvent(S, 'kill', { id: attacker.id });
    }
  }
  const weapon = attacker ? WEAPONS[attacker.weapon].name : 'Frag';
  pushFeed(S, `${attacker ? attacker.name : '—'}  ▸  ${target.name}  ·  ${part === 'head' ? 'headshot · ' : ''}${cause === 'frag' ? 'Saltcracker' : weapon}`, attacker && attacker.isPlayer ? 'good' : target.isPlayer ? 'bad' : '');
  pushEvent(S, 'death', { id: target.id, x: target.pos.x, y: target.pos.y, z: target.pos.z });
  if (target.hasCharge) {
    target.hasCharge = false;
    S.bomb.state = 'dropped';
    S.bomb.carrierId = -1;
    S.bomb.pos.x = target.pos.x;
    S.bomb.pos.y = 0.3;
    S.bomb.pos.z = target.pos.z;
    pushFeed(S, 'The charge was dropped', 'warn');
  }
}

export function throwGrenade(S, ent, kind) {
  if (!ent.alive || ent.grenades[kind] <= 0) return false;
  ent.grenades[kind] -= 1;
  eyePosition(ent, eye);
  aimDirection(ent, dir);
  S.grenades.push({
    kind,
    owner: ent.id,
    team: ent.team,
    pos: { x: eye.x + dir.x * 0.4, y: eye.y - 0.1, z: eye.z + dir.z * 0.4 },
    vel: {
      x: dir.x * 14 + ent.vel.x * 0.5,
      y: dir.y * 14 + 3.2,
      z: dir.z * 14 + ent.vel.z * 0.5,
    },
    fuse: kind === 'frag' ? 2.2 : 1.4,
    rest: false,
  });
  pushEvent(S, 'throw', { id: ent.id, kind });
  return true;
}

function detonate(S, world, g) {
  if (g.kind === 'smoke') {
    S.smokes.push({ x: g.pos.x, y: 1.4, z: g.pos.z, r: 3.4, until: S.time + 14, born: S.time });
    pushEvent(S, 'smoke', { x: g.pos.x, y: g.pos.y, z: g.pos.z });
    return;
  }
  pushEvent(S, 'explosion', { x: g.pos.x, y: g.pos.y, z: g.pos.z });
  const owner = S.entities.find((e) => e.id === g.owner) || null;
  for (const ent of S.entities) {
    if (!ent.alive || ent.team === g.team) continue;
    const dx = ent.pos.x - g.pos.x;
    const dy = ent.pos.y + 1.1 - g.pos.y;
    const dz = ent.pos.z - g.pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 8) continue;
    let dmg = 15 + 100 * (1 - d / 8);
    if (segmentBlocked(world, g.pos.x, g.pos.y, g.pos.z, ent.pos.x, ent.pos.y + 1.1, ent.pos.z)) {
      dmg *= 0.3;
    }
    applyDamage(S, ent, dmg, owner, 'blast', 'frag');
  }
}

export function stepGrenades(S, world, dt) {
  for (let i = S.grenades.length - 1; i >= 0; i -= 1) {
    const g = S.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    if (g.pos.y < 0.12) {
      g.pos.y = 0.12;
      if (Math.abs(g.vel.y) > 1.6) {
        g.vel.y = -g.vel.y * 0.38;
        g.vel.x *= 0.72;
        g.vel.z *= 0.72;
        pushEvent(S, 'bounce', { x: g.pos.x, y: g.pos.y, z: g.pos.z });
      } else {
        g.vel.y = 0;
        g.vel.x *= 0.86;
        g.vel.z *= 0.86;
        g.rest = true;
      }
    }
    // Walls: push the grenade out of any box it entered, and bounce the
    // velocity on the axis it hit. Grenades are small, so a direct AABB
    // test is enough; the shared circle helper is for bodies.
    for (const c of world.colliders) {
      if (g.pos.y > c.y1 || g.pos.y + 0.24 < c.y0) continue;
      const nx = Math.max(c.x0, Math.min(g.pos.x, c.x1));
      const nz = Math.max(c.z0, Math.min(g.pos.z, c.z1));
      const dx = g.pos.x - nx;
      const dz = g.pos.z - nz;
      if (dx * dx + dz * dz < 0.0144) {
        if (Math.abs(g.pos.x - nx) > Math.abs(g.pos.z - nz)) {
          g.pos.x = nx + (dx >= 0 ? 0.12 : -0.12);
          g.vel.x = -g.vel.x * 0.4;
        } else {
          g.pos.z = nz + (dz >= 0 ? 0.12 : -0.12);
          g.vel.z = -g.vel.z * 0.4;
        }
      }
    }
    if (g.fuse <= 0) {
      detonate(S, world, g);
      S.grenades.splice(i, 1);
    }
  }
  for (let i = S.smokes.length - 1; i >= 0; i -= 1) {
    if (S.time > S.smokes[i].until) S.smokes.splice(i, 1);
  }
}

// True when the segment between two points passes through a live smoke cloud.
export function smokeBetween(S, ax, ay, az, bx, by, bz) {
  for (const s of S.smokes) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    let t = 0;
    if (len2 > 0) {
      t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
      t = Math.max(0, Math.min(1, t));
    }
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const cz = az + dz * t;
    const dd = (cx - s.x) * (cx - s.x) + (cy - s.y) * (cy - s.y) + (cz - s.z) * (cz - s.z);
    if (dd < s.r * s.r) return true;
  }
  return false;
}
