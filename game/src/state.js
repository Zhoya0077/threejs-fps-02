// The one state store. Every system reads and writes this object and nothing
// else; rendering never mutates it, and the simulation never touches the DOM
// or the scene graph. Entities are plain data: positions are {x, y, z}, never
// allocated per frame, and mesh references are filled in by the renderer.
import { freshAmmo } from './weapons.js';

export const TICK = 1 / 60;
export const ROUND_TIME = 100;
export const BUY_TIME = 12;
export const BOMB_FUSE = 40;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const WIN_ROUNDS = 5;

export function createState(seed) {
  return {
    seed,
    time: 0,
    tick: 0,
    phase: 'buy',
    phaseT: BUY_TIME,
    round: 1,
    wins: { W: 0, J: 0 },
    lossStreak: { W: 0, J: 0 },
    bomb: {
      state: 'carried', // carried | planted | defused | exploded
      carrierId: -1,
      site: null,
      pos: { x: 0, y: 0, z: 0 },
      plantT: 0,
      fuseLeft: BOMB_FUSE,
      beepT: 0,
      defuserId: -1,
      defuseT: 0,
    },
    entities: [],
    grenades: [],
    smokes: [],
    // Events drain once per rendered frame: the sim pushes, main.js plays
    // audio, spawns effects and updates the HUD from them.
    events: [],
    feed: [],
    sounds: [],
    roundMsg: '',
    roundMsgT: 0,
    matchWinner: null,
    spectateId: -1,
    rngStream: null,
  };
}

export function pushEvent(S, type, data) {
  S.events.push({ type, ...data });
}

export function pushFeed(S, text, cls) {
  S.feed.push({ text, cls: cls || '', t: S.time });
  if (S.feed.length > 6) S.feed.shift();
}

export function aliveOf(S, team) {
  let n = 0;
  for (const e of S.entities) if (e.team === team && e.alive) n += 1;
  return n;
}

export function entityById(S, id) {
  for (const e of S.entities) if (e.id === id) return e;
  return null;
}

// One factory for every agent, player or bot. Meshes, bot brains and the
// charge are attached by the systems that own them.
export function createEntity(id, team, name, isPlayer, x, z, yaw) {
  return {
    id,
    name,
    team,
    isPlayer,
    alive: true,
    hp: 100,
    armor: false,
    pos: { x, y: 0, z },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: 0,
    rPitch: 0,
    rYaw: 0,
    eye: 1.62,
    crouch: false,
    onGround: true,
    weapon: 'pistol',
    owned: { pistol: true },
    ammo: freshAmmo(),
    reloading: 0,
    bloom: 0,
    nextShotAt: 0,
    money: 800,
    grenades: { frag: 0, smoke: 0 },
    hasCharge: false,
    kills: 0,
    deaths: 0,
    channel: null,
    channelT: 0,
    bot: null,
    mesh: null,
    muzzleT: 0,
    hurtT: 0,
    deadT: 0,
    stepT: 0,
  };
}
