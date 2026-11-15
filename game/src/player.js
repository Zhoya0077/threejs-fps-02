// One movement model for the player and every bot: acceleration and friction
// on the ground, gravity and a jump in the air, crouching that lowers the eye
// and slows the body, and collision resolved by the world's circle test.
// Recoil lives here too: a transient pitch/yaw offset that each shot adds to
// and that decays, so the aim direction and the camera agree.
import { collideCircle } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;
export const BODY_RADIUS = 0.35;
export const BODY_HEIGHT = 1.8;

const WALK = 4.3;
const CROUCH_SPEED = 2.1;
const SLOW_SPEED = 2.2;
const ADS_SPEED = 3.0;
const ACCEL = 46;
const AIR_ACCEL = 14;
const FRICTION = 11;
const GRAVITY = 19;
const JUMP = 6.4;
const RECOIL_DECAY = 7;

export function moveBody(world, ent, wishX, wishZ, dt, opts) {
  const o = opts || {};
  const crouch = !!o.crouch;
  ent.crouch = crouch;
  const targetEye = crouch ? EYE_CROUCH : EYE_STAND;
  ent.eye += (targetEye - ent.eye) * Math.min(1, dt * 11);

  let maxSpeed = WALK;
  if (crouch) maxSpeed = CROUCH_SPEED;
  else if (o.slow) maxSpeed = SLOW_SPEED;
  else if (o.ads) maxSpeed = ADS_SPEED;
  // Analog throttle: a half-deflected stick walks at half speed. Keyboard
  // and bots pass none, which means full speed.
  if (o.throttle != null) maxSpeed *= Math.min(1, Math.max(0, o.throttle));

  const wishLen = Math.hypot(wishX, wishZ);
  const nx = wishLen > 0 ? wishX / wishLen : 0;
  const nz = wishLen > 0 ? wishZ / wishLen : 0;
  const accel = ent.onGround ? ACCEL : AIR_ACCEL;
  ent.vel.x += nx * accel * dt;
  ent.vel.z += nz * accel * dt;

  // Friction pulls toward stillness when no input; speed is capped so a
  // sprint into a turn bleeds off instead of snapping.
  const speed = Math.hypot(ent.vel.x, ent.vel.z);
  if (wishLen === 0 && ent.onGround && speed > 0) {
    const drop = Math.min(speed, FRICTION * dt);
    ent.vel.x -= (ent.vel.x / speed) * drop;
    ent.vel.z -= (ent.vel.z / speed) * drop;
  }
  const capped = Math.hypot(ent.vel.x, ent.vel.z);
  if (capped > maxSpeed) {
    ent.vel.x *= maxSpeed / capped;
    ent.vel.z *= maxSpeed / capped;
  }

  if (o.jump && ent.onGround) {
    ent.vel.y = JUMP;
    ent.onGround = false;
  }
  ent.vel.y -= GRAVITY * dt;

  ent.pos.x += ent.vel.x * dt;
  ent.pos.z += ent.vel.z * dt;
  ent.pos.y += ent.vel.y * dt;
  if (ent.pos.y <= 0) {
    ent.pos.y = 0;
    ent.vel.y = 0;
    ent.onGround = true;
  }
  collideCircle(world, ent.pos, BODY_RADIUS, BODY_HEIGHT);

  // Recoil offsets decay back to zero; the next shot re-adds them.
  const decay = Math.exp(-RECOIL_DECAY * dt);
  ent.rPitch *= decay;
  ent.rYaw *= decay;
}

export function groundSpeed(ent) {
  return Math.hypot(ent.vel.x, ent.vel.z);
}

// Aim direction, including the live recoil offset. dir is written in place.
export function aimDirection(ent, dir) {
  const yaw = ent.yaw + ent.rYaw;
  const pitch = ent.pitch + ent.rPitch;
  const cp = Math.cos(pitch);
  dir.x = -Math.sin(yaw) * cp;
  dir.y = Math.sin(pitch);
  dir.z = -Math.cos(yaw) * cp;
  return dir;
}

export function eyePosition(ent, out) {
  out.x = ent.pos.x;
  out.y = ent.pos.y + ent.eye;
  out.z = ent.pos.z;
  return out;
}

export function applyRecoil(ent, pitchKick, yawKick) {
  ent.rPitch += pitchKick;
  ent.rYaw += yawKick;
  if (ent.rPitch > 0.22) ent.rPitch = 0.22;
  if (ent.rYaw > 0.1) ent.rYaw = 0.1;
  if (ent.rYaw < -0.1) ent.rYaw = -0.1;
}
