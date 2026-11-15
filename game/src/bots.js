// Bot brains: routes, holds, perception and fire discipline. Each bot runs a
// small state machine over the nav graph, sees through the same line-of-sight
// test the bullets use, hears gunshots, and shoots with the same guns, spread
// and recoil as the player. Difficulty is fair on purpose: bots react after a
// human-like delay, miss when their target moves, and never know what they
// cannot see or hear.
import { pushEvent } from './state.js';
import { WEAPONS, canFire, startReload } from './weapons.js';
import { moveBody, groundSpeed, eyePosition } from './player.js';
import { nearestNode, findPath, segmentBlocked, pointInSite, HOLDS } from './world.js';
import { shoot, smokeBetween } from './combat.js';
import { bell } from './rng.js';

export const BOT_NAMES = {
  W: ['Mira', 'Okafor'],
  J: ['Rook', 'Vex', 'Sable'],
};

const THINK_EVERY = 0.12;
const SEE_DIST = 48;
const HEAR_DIST = 26;
const botEye = { x: 0, y: 0, z: 0 };

export function createBotFields(role) {
  return {
    role, // 'A' | 'B' | 'MID' for defenders; 'A-push' | 'B-push' | 'mid-push' for attackers
    state: 'advance',
    legs: [],
    route: [],
    routeIdx: 0,
    dest: null,
    targetId: -1,
    targetDist: Infinity,
    lastSeen: null,
    lastSeenT: -9,
    reactAt: 0,
    burstLeft: 0,
    nextBurstAt: 0,
    aimErrX: 0,
    aimErrY: 0,
    aimErrT: 0,
    hold: null,
    investigate: null,
    scanT: 0,
    holdT: 0,
    strafeDir: 1,
    strafeT: 0,
    stuckT: 0,
    lastX: 0,
    lastZ: 0,
    sidestep: 0,
    sidestepT: 0,
    thinkT: 0,
  };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function setRoute(S, world, ent, tx, tz) {
  const b = ent.bot;
  const from = nearestNode(ent.pos.x, ent.pos.z);
  const to = nearestNode(tx, tz);
  b.route = findPath(from, to);
  b.routeIdx = 0;
  b.dest = { x: tx, z: tz };
  b.stuckT = 0;
}

function routeTarget(world, ent) {
  const b = ent.bot;
  while (b.routeIdx < b.route.length) {
    const n = world.nodes[b.route[b.routeIdx]];
    const dx = n[0] - ent.pos.x;
    const dz = n[1] - ent.pos.z;
    if (dx * dx + dz * dz < 1.44) {
      b.routeIdx += 1;
      continue;
    }
    return { x: n[0], z: n[1] };
  }
  return b.dest;
}

function perceive(S, world, ent, rng) {
  const b = ent.bot;
  const eye = eyePosition(ent, botEye);
  const fx = -Math.sin(ent.yaw);
  const fz = -Math.cos(ent.yaw);
  let best = null;
  let bestD = Infinity;
  for (const other of S.entities) {
    if (!other.alive || other.team === ent.team) continue;
    const cx = other.pos.x;
    const cy = other.pos.y + (other.crouch ? 0.8 : 1.15);
    const cz = other.pos.z;
    const dx = cx - eye.x;
    const dy = cy - eye.y;
    const dz = cz - eye.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > SEE_DIST || d >= bestD) continue;
    const dot = (dx * fx + dz * fz) / (d || 1);
    if (dot < 0.45 && d > 4) continue; // outside the view cone, unless adjacent
    if (segmentBlocked(world, eye.x, eye.y, eye.z, cx, cy, cz)) continue;
    if (smokeBetween(S, eye.x, eye.y, eye.z, cx, cy, cz)) continue;
    best = other;
    bestD = d;
  }
  if (best) {
    // Mission focus: the carrier, the fetcher and the defuser do not chase
    // distant contacts — they keep their route and only fight close threats.
    // Without this the carrier duels down every long lane and never plants.
    const focused = ent.hasCharge || b.state === 'fetch' || b.state === 'defuse';
    if (focused && bestD > 14) {
      b.lastSeen = { x: best.pos.x, z: best.pos.z };
      b.lastSeenT = S.time;
      return;
    }
    if (b.targetId !== best.id) {
      b.targetId = best.id;
      b.reactAt = S.time + 0.3 + rng() * 0.25;
    }
    b.targetDist = bestD;
    b.lastSeen = { x: best.pos.x, z: best.pos.z };
    b.lastSeenT = S.time;
    // A close threat interrupts a plant or defuse; a distant one does not.
    if (b.state === 'plant' || b.state === 'defuse') {
      if (bestD < 20 && !(b.state === 'defuse' && S.bomb.fuseLeft < 9)) {
        ent.channel = null;
        ent.channelT = 0;
        b.state = 'engage';
      }
    } else if (b.state !== 'engage') {
      b.state = 'engage';
    }
    return;
  }
  if (b.targetId !== -1 && S.time - b.lastSeenT > 1.0) {
    b.targetId = -1;
    b.targetDist = Infinity;
    if (b.state === 'engage') {
      b.state = 'investigate';
      b.investigate = b.lastSeen;
      b.scanT = 0;
      if (b.lastSeen) setRoute(S, world, ent, b.lastSeen.x, b.lastSeen.z);
    }
  }
  // Hearing: an enemy shot nearby, with no target, is worth a look — unless
  // the carrier is running the charge, in which case the route wins.
  if (!ent.hasCharge && b.targetId === -1 && (b.state === 'hold' || b.state === 'advance' || b.state === 'investigate')) {
    for (const s of S.sounds) {
      if (s.team === ent.team || S.time - s.t > 1.2) continue;
      const dx = s.x - ent.pos.x;
      const dz = s.z - ent.pos.z;
      if (dx * dx + dz * dz < HEAR_DIST * HEAR_DIST) {
        b.state = 'investigate';
        b.investigate = { x: s.x, z: s.z };
        b.scanT = 0;
        setRoute(S, world, ent, s.x, s.z);
        break;
      }
    }
  }
}

function arriveBehavior(S, world, ent, rng) {
  const b = ent.bot;
  if (ent.team === 'J') {
    if (ent.hasCharge) {
      const site = pointInSite(ent.pos.x, ent.pos.z);
      if (site) {
        b.state = 'plant';
        return;
      }
      // Not on a site yet: head for the nearer one.
      const target = b.role === 'B-push' ? { x: -20, z: 16 } : { x: -20, z: -16 };
      setRoute(S, world, ent, target.x, target.z);
      b.state = 'advance';
      return;
    }
    if (S.bomb.state === 'planted') {
      b.state = 'guard';
      b.hold = { x: ent.pos.x, z: ent.pos.z, lx: ent.pos.x + 8, lz: ent.pos.z };
      return;
    }
    // Escort: hold near the site the carrier is taking.
    const site = b.role === 'B-push' ? { x: -16, z: 14 } : { x: -16, z: -14 };
    b.state = 'hold';
    b.hold = { x: site.x, z: site.z, lx: site.x + 14, lz: site.z };
    b.holdT = 0;
    return;
  }
  // Defenders take their hold.
  const hold = HOLDS[b.role] || HOLDS.MID;
  b.state = 'hold';
  b.hold = { x: hold.x, z: hold.z, lx: hold.lx, lz: hold.lz };
  b.holdT = 0;
}

function bombOrders(S, world, ent) {
  const b = ent.bot;
  const bomb = S.bomb;
  if (ent.team === 'W' && bomb.state === 'planted' && b.state !== 'defuse' && b.state !== 'engage') {
    b.state = 'defuse';
    ent.channel = null;
    setRoute(S, world, ent, bomb.pos.x, bomb.pos.z);
    return true;
  }
  if (ent.team === 'J' && bomb.state === 'dropped' && !ent.hasCharge && b.state !== 'engage') {
    // The nearest living Jackal fetches the charge.
    let nearest = null;
    let nearestD = Infinity;
    for (const e of S.entities) {
      if (!e.alive || e.team !== 'J' || e.bot === null) continue;
      const dx = e.pos.x - bomb.pos.x;
      const dz = e.pos.z - bomb.pos.z;
      const d = dx * dx + dz * dz;
      if (d < nearestD) {
        nearestD = d;
        nearest = e;
      }
    }
    if (nearest === ent && b.state !== 'fetch') {
      b.state = 'fetch';
      setRoute(S, world, ent, bomb.pos.x, bomb.pos.z);
      return true;
    }
  }
  return false;
}

function turnToward(ent, wantYaw, wantPitch, dt) {
  const dyaw = wrapAngle(wantYaw - ent.yaw);
  const maxYaw = 3.4 * dt;
  ent.yaw += Math.max(-maxYaw, Math.min(maxYaw, dyaw));
  const dpitch = wantPitch - ent.pitch;
  const maxPitch = 2.6 * dt;
  ent.pitch += Math.max(-maxPitch, Math.min(maxPitch, dpitch));
  ent.pitch = Math.max(-1.35, Math.min(1.35, ent.pitch));
  return Math.abs(dyaw);
}

export function stepBots(S, world, dt, rng) {
  // Expire old sounds once per tick.
  for (let i = S.sounds.length - 1; i >= 0; i -= 1) {
    if (S.time - S.sounds[i].t > 1.5) S.sounds.splice(i, 1);
  }
  for (const ent of S.entities) {
    if (!ent.alive || !ent.bot) continue;
    const b = ent.bot;
    b.thinkT -= dt;
    if (b.thinkT <= 0) {
      b.thinkT = THINK_EVERY;
      perceive(S, world, ent, rng);
      if (S.phase === 'live') bombOrders(S, world, ent);
    }
    if (S.phase !== 'live') {
      // Buy phase: stand at spawn, face the map.
      turnToward(ent, ent.team === 'J' ? Math.PI / 2 : -Math.PI / 2, 0, dt);
      moveBody(world, ent, 0, 0, dt, {});
      continue;
    }

    let moveX = null;
    let moveZ = null;
    let wantYaw = ent.yaw;
    let wantPitch = 0;
    let crouch = false;
    let wantFire = false;

    // Opportunistic plant: the carrier plants whenever he stands on a site
    // with no live threat close by, whatever state the fight left him in.
    // Arriving via a leg is not the only way onto a site.
    if (ent.hasCharge && b.state !== 'plant' && pointInSite(ent.pos.x, ent.pos.z)
        && (b.targetId === -1 || S.time - b.lastSeenT > 1.0 || b.targetDist > 20)) {
      b.state = 'plant';
    }

    const target = b.targetId === -1 ? null : S.entities.find((e) => e.id === b.targetId && e.alive);
    if (b.state === 'engage' && target) {
      const dx = target.pos.x - ent.pos.x;
      const dz = target.pos.z - ent.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      // Strafe perpendicular, keep a fighting distance.
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafeT = 0.8 + rng() * 0.7;
        b.strafeDir = rng() < 0.5 ? -1 : 1;
      }
      const px = (-dz / dist) * b.strafeDir;
      const pz = (dx / dist) * b.strafeDir;
      let approach = 0;
      if (dist > 24) approach = 1;
      else if (dist < 6) approach = -1;
      moveX = ent.pos.x + px * 2 + (dx / dist) * approach * 2;
      moveZ = ent.pos.z + pz * 2 + (dz / dist) * approach * 2;
      // Aim at the chest, with an error that grows with distance and target speed.
      b.aimErrT -= dt;
      if (b.aimErrT <= 0) {
        b.aimErrT = 0.4;
        const err = 0.12 + dist * 0.008 + groundSpeed(target) * 0.05;
        b.aimErrX = bell(rng) * err;
        b.aimErrY = bell(rng) * err * 0.7;
      }
      const aimX = target.pos.x + b.aimErrX;
      const aimY = target.pos.y + (target.crouch ? 0.8 : 1.15) + b.aimErrY;
      const aimZ = target.pos.z;
      const eye = eyePosition(ent, botEye);
      wantYaw = Math.atan2(-(aimX - eye.x), -(aimZ - eye.z));
      const flat = Math.hypot(aimX - eye.x, aimZ - eye.z) || 1;
      wantPitch = Math.atan2(aimY - eye.y, flat);
      const aimed = turnToward(ent, wantYaw, wantPitch, dt);
      const def = WEAPONS[ent.weapon];
      if (S.time >= b.reactAt && aimed < 0.06 && canFire(ent, def, S.time)) {
        if (b.burstLeft <= 0 && S.time >= b.nextBurstAt) {
          b.burstLeft = def.auto ? 3 + Math.floor(rng() * 3) : 1;
        }
        if (b.burstLeft > 0) {
          wantFire = true;
          b.burstLeft -= 1;
          if (b.burstLeft === 0) b.nextBurstAt = S.time + 0.4 + rng() * 0.35;
        }
      }
      const ammo = ent.ammo[ent.weapon];
      if (ammo.mag === 0 && startReload(ent, def, S.time)) {
        pushEvent(S, 'reload', { id: ent.id });
      }
    } else if (b.state === 'plant') {
      ent.channel = 'plant';
      wantYaw = ent.yaw;
    } else if (b.state === 'defuse') {
      const bomb = S.bomb;
      const dx = bomb.pos.x - ent.pos.x;
      const dz = bomb.pos.z - ent.pos.z;
      if (Math.hypot(dx, dz) < 2.0) {
        ent.channel = 'defuse';
      } else {
        ent.channel = null;
        const wp = routeTarget(world, ent);
        if (wp) {
          moveX = wp.x;
          moveZ = wp.z;
        } else {
          moveX = bomb.pos.x;
          moveZ = bomb.pos.z;
        }
        wantYaw = Math.atan2(-dx, -dz);
      }
    } else if (b.state === 'fetch') {
      const bomb = S.bomb;
      if (bomb.state !== 'dropped') {
        b.state = 'advance';
        arriveBehavior(S, world, ent, rng);
      } else {
        const wp = routeTarget(world, ent);
        moveX = wp ? wp.x : bomb.pos.x;
        moveZ = wp ? wp.z : bomb.pos.z;
        wantYaw = Math.atan2(-(moveX - ent.pos.x), -(moveZ - ent.pos.z));
      }
    } else if (b.state === 'hold' || b.state === 'guard') {
      const h = b.hold;
      if (h) {
        const dx = h.x - ent.pos.x;
        const dz = h.z - ent.pos.z;
        if (Math.hypot(dx, dz) > 0.9) {
          moveX = h.x;
          moveZ = h.z;
          wantYaw = Math.atan2(-dx, -dz);
        } else {
          b.holdT += dt;
          crouch = b.holdT > 1.2 && b.state === 'hold';
          b.scanT += dt;
          const sway = Math.sin(b.scanT * 0.5) * 0.35;
          wantYaw = Math.atan2(-(h.lx - ent.pos.x), -(h.lz - ent.pos.z)) + sway;
        }
      }
    } else if (b.state === 'investigate') {
      const inv = b.investigate;
      if (inv) {
        const dx = inv.x - ent.pos.x;
        const dz = inv.z - ent.pos.z;
        if (Math.hypot(dx, dz) < 1.4) {
          b.scanT += dt;
          wantYaw = ent.yaw + Math.sin(b.scanT * 1.4) * 0.8;
          if (b.scanT > 2.2) {
            b.state = 'advance';
            arriveBehavior(S, world, ent, rng);
          }
        } else {
          const wp = routeTarget(world, ent);
          moveX = wp ? wp.x : inv.x;
          moveZ = wp ? wp.z : inv.z;
          wantYaw = Math.atan2(-(moveX - ent.pos.x), -(moveZ - ent.pos.z));
        }
      }
    } else {
      // advance: follow legs in order, then the role behaviour.
      if (!b.dest) {
        if (b.legs.length > 0) {
          const leg = b.legs.shift();
          setRoute(S, world, ent, leg.x, leg.z);
        } else {
          arriveBehavior(S, world, ent, rng);
        }
      }
      if (b.dest) {
        const dx = b.dest.x - ent.pos.x;
        const dz = b.dest.z - ent.pos.z;
        if (Math.hypot(dx, dz) < 1.2) {
          b.dest = null;
          b.route = [];
          if (b.legs.length > 0) {
            const leg = b.legs.shift();
            setRoute(S, world, ent, leg.x, leg.z);
          } else {
            arriveBehavior(S, world, ent, rng);
          }
        } else {
          const wp = routeTarget(world, ent);
          moveX = wp ? wp.x : b.dest.x;
          moveZ = wp ? wp.z : b.dest.z;
          wantYaw = Math.atan2(-(moveX - ent.pos.x), -(moveZ - ent.pos.z));
        }
      }
    }

    if (b.state !== 'engage') turnToward(ent, wantYaw, wantPitch, dt);

    // Steering with stuck recovery: if progress stalls, sidestep.
    let wishX = 0;
    let wishZ = 0;
    if (moveX !== null) {
      const dx = moveX - ent.pos.x;
      const dz = moveZ - ent.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      wishX = dx / d;
      wishZ = dz / d;
      b.stuckT += dt;
      if (b.stuckT > 0.8) {
        const moved = Math.hypot(ent.pos.x - b.lastX, ent.pos.z - b.lastZ);
        if (moved < 0.25) {
          b.sidestepT = 0.7;
          b.sidestep = rng() < 0.5 ? -1 : 1;
        }
        b.stuckT = 0;
        b.lastX = ent.pos.x;
        b.lastZ = ent.pos.z;
      }
      if (b.sidestepT > 0) {
        b.sidestepT -= dt;
        const px = -wishZ * b.sidestep;
        const pz = wishX * b.sidestep;
        wishX = (wishX + px * 0.9) / 1.4;
        wishZ = (wishZ + pz * 0.9) / 1.4;
      }
    }
    moveBody(world, ent, wishX, wishZ, dt, { crouch });

    if (wantFire) {
      shoot(S, world, ent, rng, false);
    } else if (ent.ammo[ent.weapon].mag <= 6 && b.targetId === -1 && ent.reloading <= 0) {
      if (startReload(ent, WEAPONS[ent.weapon], S.time)) pushEvent(S, 'reload', { id: ent.id });
    }
  }
}
