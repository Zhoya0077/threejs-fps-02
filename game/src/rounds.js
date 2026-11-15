// Rounds, money and the charge. The match is first to five rounds. Each
// round opens with a buy phase at spawn, then a hundred seconds live: the
// Jackals win by eliminating the Wardens or detonating the charge, the
// Wardens win by eliminating the Jackals, defusing the charge, or running
// the clock out with the charge unplanted. Winners take $3250, losers take
// $1900 plus $500 per consecutive loss, up to $3400.
import {
  ROUND_TIME, BUY_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME, WIN_ROUNDS,
  pushEvent, pushFeed, aliveOf, createEntity,
} from './state.js';
import { WEAPONS, GEAR } from './weapons.js';
import { SPAWNS, pointInSite } from './world.js';
import { createBotFields, BOT_NAMES } from './bots.js';
import { applyDamage } from './combat.js';

export function setupMatch(S) {
  S.entities.length = 0;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.sounds.length = 0;
  S.feed.length = 0;
  S.round = 1;
  S.wins.W = 0;
  S.wins.J = 0;
  S.lossStreak.W = 0;
  S.lossStreak.J = 0;
  S.matchWinner = null;

  const playerSpawn = SPAWNS.W[1];
  const player = createEntity(0, 'W', 'You', true, playerSpawn.x, playerSpawn.z, playerSpawn.yaw);
  S.entities.push(player);
  const allyRoles = ['A', 'B'];
  for (let i = 0; i < 2; i += 1) {
    const sp = SPAWNS.W[i === 0 ? 0 : 2];
    const ally = createEntity(i + 1, 'W', BOT_NAMES.W[i], false, sp.x, sp.z, sp.yaw);
    ally.bot = createBotFields(allyRoles[i]);
    S.entities.push(ally);
  }
  const enemyRoles = ['A-push', 'B-push', 'mid-push'];
  for (let i = 0; i < 3; i += 1) {
    const sp = SPAWNS.J[i];
    const enemy = createEntity(i + 3, 'J', BOT_NAMES.J[i], false, sp.x, sp.z, sp.yaw);
    enemy.bot = createBotFields(enemyRoles[i]);
    S.entities.push(enemy);
  }
  startRound(S);
}

function botLoadout(ent, round) {
  const owned = { pistol: true };
  let weapon = 'pistol';
  if (round >= 2) {
    owned.smg = true;
    weapon = 'smg';
  }
  if (round >= 3) {
    owned.rifle = true;
    weapon = 'rifle';
  }
  if (round >= 4) {
    ent.armor = true;
    if (ent.name === 'Vex') {
      owned.marksman = true;
      weapon = 'marksman';
    }
  }
  ent.owned = owned;
  ent.weapon = weapon;
}

export function startRound(S) {
  S.phase = 'buy';
  S.phaseT = BUY_TIME;
  S.grenades.length = 0;
  S.smokes.length = 0;
  S.sounds.length = 0;
  S.bomb.state = 'carried';
  S.bomb.site = null;
  S.bomb.fuseLeft = BOMB_FUSE;
  S.bomb.beepT = 0;
  S.bomb.defuserId = -1;
  S.bomb.defuseT = 0;

  let wIdx = 0;
  let jIdx = 0;
  for (const ent of S.entities) {
    const died = !ent.alive;
    const sp = ent.team === 'W' ? SPAWNS.W[wIdx % 3] : SPAWNS.J[jIdx % 3];
    if (ent.team === 'W') wIdx += 1;
    else jIdx += 1;
    ent.alive = true;
    ent.hp = 100;
    ent.pos.x = sp.x;
    ent.pos.y = 0;
    ent.pos.z = sp.z;
    ent.vel.x = 0;
    ent.vel.y = 0;
    ent.vel.z = 0;
    ent.yaw = sp.yaw;
    ent.pitch = 0;
    ent.rPitch = 0;
    ent.rYaw = 0;
    ent.eye = 1.62;
    ent.crouch = false;
    ent.reloading = 0;
    ent.bloom = 0;
    ent.nextShotAt = 0;
    ent.channel = null;
    ent.channelT = 0;
    ent.hasCharge = false;
    ent.grenades.frag = 0;
    ent.grenades.smoke = 0;
    if (died) {
      // Death costs the loadout: back to the sidearm, money kept.
      ent.owned = { pistol: true };
      ent.weapon = 'pistol';
      ent.armor = false;
    }
    for (const id of Object.keys(ent.ammo)) {
      ent.ammo[id].mag = WEAPONS[id].mag;
      ent.ammo[id].reserve = WEAPONS[id].reserveMax;
    }
    if (ent.bot) {
      const role = ent.bot.role;
      ent.bot = createBotFields(role);
      botLoadout(ent, S.round);
      if (ent.team === 'W') {
        ent.bot.legs = role === 'A'
          ? [{ x: -16, z: -14 }]
          : [{ x: -14.5, z: 14 }];
      } else if (role === 'A-push') {
        ent.bot.legs = [{ x: -20, z: -16 }];
      } else if (role === 'B-push') {
        ent.bot.legs = [{ x: -20, z: 16 }];
      } else {
        ent.bot.legs = [{ x: 4, z: 0 }, { x: -20, z: -16 }];
      }
    }
  }
  // The charge rides with Rook, the first Jackal.
  const carrier = S.entities.find((e) => e.team === 'J');
  if (carrier) {
    carrier.hasCharge = true;
    S.bomb.carrierId = carrier.id;
  }
  pushFeed(S, `Round ${S.round} — buy phase`, 'warn');
  pushEvent(S, 'roundStart', { round: S.round });
}

function endRound(S, winner, reason) {
  if (S.phase !== 'live') return;
  S.phase = 'end';
  S.phaseT = 4;
  S.wins[winner] += 1;
  const loser = winner === 'W' ? 'J' : 'W';
  S.lossStreak[winner] = 0;
  S.lossStreak[loser] += 1;
  const loserBonus = 1900 + 500 * Math.min(3, S.lossStreak[loser] - 1);
  for (const ent of S.entities) {
    ent.money += ent.team === winner ? 3250 : loserBonus;
    if (ent.money > 16000) ent.money = 16000;
  }
  S.roundMsg = reason;
  S.roundMsgT = 4;
  pushFeed(S, `${winner === 'W' ? 'Wardens' : 'Jackals'} take the round — ${reason}`, winner === 'W' ? 'good' : 'bad');
  pushEvent(S, 'roundEnd', { winner, reason });
}

export function stepRounds(S, world, dt) {
  if (S.phase === 'match') return;
  S.phaseT -= dt;
  if (S.roundMsgT > 0) S.roundMsgT -= dt;

  if (S.phase === 'buy') {
    if (S.phaseT <= 0) {
      S.phase = 'live';
      S.phaseT = ROUND_TIME;
      pushFeed(S, 'Round live', 'warn');
      pushEvent(S, 'roundLive', {});
    }
    return;
  }
  if (S.phase === 'end') {
    if (S.phaseT <= 0) {
      if (S.wins.W >= WIN_ROUNDS || S.wins.J >= WIN_ROUNDS) {
        S.phase = 'match';
        S.matchWinner = S.wins.W >= WIN_ROUNDS ? 'W' : 'J';
        pushEvent(S, 'matchEnd', { winner: S.matchWinner });
      } else {
        S.round += 1;
        startRound(S);
      }
    }
    return;
  }

  // Live round: channels, the fuse, pickups, then win conditions.
  for (const ent of S.entities) {
    if (!ent.alive || !ent.channel) continue;
    if (ent.channel === 'plant') {
      const site = pointInSite(ent.pos.x, ent.pos.z);
      if (ent.hasCharge && site && S.bomb.state === 'carried') {
        ent.channelT += dt;
        if (ent.channelT >= PLANT_TIME) {
          ent.hasCharge = false;
          ent.channel = null;
          ent.channelT = 0;
          S.bomb.state = 'planted';
          S.bomb.site = site;
          S.bomb.fuseLeft = BOMB_FUSE;
          S.bomb.pos.x = ent.pos.x;
          S.bomb.pos.y = 0.3;
          S.bomb.pos.z = ent.pos.z;
          pushFeed(S, `Charge planted at site ${site}`, 'warn');
          pushEvent(S, 'planted', { site, x: S.bomb.pos.x, y: 0.3, z: S.bomb.pos.z });
        }
      } else {
        ent.channelT = 0;
      }
    } else if (ent.channel === 'defuse') {
      const dx = ent.pos.x - S.bomb.pos.x;
      const dz = ent.pos.z - S.bomb.pos.z;
      if (ent.team === 'W' && S.bomb.state === 'planted' && dx * dx + dz * dz < 4.84) {
        ent.channelT += dt;
        if (ent.channelT >= DEFUSE_TIME) {
          ent.channel = null;
          ent.channelT = 0;
          S.bomb.state = 'defused';
          pushEvent(S, 'defused', {});
          endRound(S, 'W', 'Charge defused');
          return;
        }
      } else {
        ent.channelT = 0;
      }
    }
  }

  if (S.bomb.state === 'planted') {
    S.bomb.fuseLeft -= dt;
    S.bomb.beepT -= dt;
    if (S.bomb.beepT <= 0) {
      const frac = S.bomb.fuseLeft / BOMB_FUSE;
      S.bomb.beepT = 0.15 + frac * 0.75;
      pushEvent(S, 'beep', { x: S.bomb.pos.x, y: 0.3, z: S.bomb.pos.z });
    }
    if (S.bomb.fuseLeft <= 0) {
      S.bomb.state = 'exploded';
      pushEvent(S, 'explosion', { x: S.bomb.pos.x, y: 0.5, z: S.bomb.pos.z });
      for (const ent of S.entities) {
        if (!ent.alive) continue;
        const dx = ent.pos.x - S.bomb.pos.x;
        const dz = ent.pos.z - S.bomb.pos.z;
        if (dx * dx + dz * dz < 100) applyDamage(S, ent, 200, null, 'blast', 'frag');
      }
      endRound(S, 'J', 'The charge detonated');
      return;
    }
  }

  if (S.bomb.state === 'dropped') {
    for (const ent of S.entities) {
      if (!ent.alive || ent.team !== 'J') continue;
      const dx = ent.pos.x - S.bomb.pos.x;
      const dz = ent.pos.z - S.bomb.pos.z;
      if (dx * dx + dz * dz < 1.69) {
        ent.hasCharge = true;
        S.bomb.state = 'carried';
        S.bomb.carrierId = ent.id;
        pushFeed(S, `${ent.name} recovered the charge`, '');
        break;
      }
    }
  }

  const wardens = aliveOf(S, 'W');
  const jackals = aliveOf(S, 'J');
  if (S.bomb.state !== 'planted') {
    if (jackals === 0) {
      endRound(S, 'W', 'Jackals eliminated');
      return;
    }
    if (wardens === 0) {
      endRound(S, 'J', 'Wardens eliminated');
      return;
    }
    if (S.phaseT <= 0) {
      endRound(S, 'W', 'Time expired — site held');
      return;
    }
  } else if (wardens === 0) {
    endRound(S, 'J', 'Wardens eliminated');
  }
}

export function buyItem(S, ent, id) {
  if (S.phase !== 'buy') return 'Buy time is over';
  if (WEAPONS[id]) {
    const def = WEAPONS[id];
    if (ent.owned[id]) return `${def.name} already owned`;
    if (ent.money < def.price) return 'Not enough money';
    ent.money -= def.price;
    ent.owned[id] = true;
    ent.weapon = id;
    ent.ammo[id].mag = def.mag;
    ent.ammo[id].reserve = def.reserveMax;
    pushEvent(S, 'buy', { id: ent.id });
    return '';
  }
  const gear = GEAR[id];
  if (!gear) return 'Unknown item';
  if (id === 'armor') {
    if (ent.armor) return 'Vest already worn';
    if (ent.money < gear.price) return 'Not enough money';
    ent.money -= gear.price;
    ent.armor = true;
    pushEvent(S, 'buy', { id: ent.id });
    return '';
  }
  if (ent.grenades[id] >= gear.max) return `Only ${gear.max} carried`;
  if (ent.money < gear.price) return 'Not enough money';
  ent.money -= gear.price;
  ent.grenades[id] += 1;
  pushEvent(S, 'buy', { id: ent.id });
  return '';
}

export function restartMatch(S) {
  for (const ent of S.entities) {
    ent.money = 800;
    ent.kills = 0;
    ent.deaths = 0;
  }
  setupMatch(S);
}
