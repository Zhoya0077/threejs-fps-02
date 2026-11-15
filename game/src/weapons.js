// The armoury: four guns, two grenades, one vest. Damage, spread and recoil
// are tuned so that stopping, crouching and aiming down sights pay, and
// spraying on the move does not. Ammo is tracked per weapon so switching
// keeps what each gun had left.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', slot: 'side', price: 0,
    damage: 28, headMult: 3, mag: 12, reserveMax: 48,
    interval: 0.16, auto: false, reload: 1.4,
    spread: 0.011, moveSpread: 0.02, bloom: 0.006, maxBloom: 0.03,
    kick: 0.011, range: 55,
  },
  smg: {
    id: 'smg', name: 'Dunehopper', slot: 'primary', price: 1500,
    damage: 22, headMult: 3, mag: 30, reserveMax: 90,
    interval: 0.075, auto: true, reload: 2.0,
    spread: 0.016, moveSpread: 0.03, bloom: 0.005, maxBloom: 0.045,
    kick: 0.007, range: 45,
  },
  rifle: {
    id: 'rifle', name: 'Longsalt AR', slot: 'primary', price: 2700,
    damage: 26, headMult: 4, mag: 30, reserveMax: 90,
    interval: 0.1, auto: true, reload: 2.3,
    spread: 0.008, moveSpread: 0.028, bloom: 0.004, maxBloom: 0.035,
    kick: 0.009, range: 70,
  },
  marksman: {
    id: 'marksman', name: 'Meridian 7', slot: 'primary', price: 4000,
    damage: 85, headMult: 2, mag: 5, reserveMax: 15,
    interval: 0.9, auto: false, reload: 3.0,
    spread: 0.0012, moveSpread: 0.05, bloom: 0.02, maxBloom: 0.05,
    kick: 0.032, range: 90,
  },
};

export const GEAR = {
  frag: { id: 'frag', name: 'Saltcracker frag', price: 300, max: 2 },
  smoke: { id: 'smoke', name: 'Whiteout smoke', price: 300, max: 2 },
  armor: { id: 'armor', name: 'Plated vest', price: 650 },
};

export const BUY_MENU = [
  { id: 'smg', kind: 'gun' },
  { id: 'rifle', kind: 'gun' },
  { id: 'marksman', kind: 'gun' },
  { id: 'frag', kind: 'gear' },
  { id: 'smoke', kind: 'gear' },
  { id: 'armor', kind: 'gear' },
];

export function freshAmmo() {
  const ammo = {};
  for (const id of Object.keys(WEAPONS)) {
    ammo[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveMax };
  }
  return ammo;
}

// Current spread in radians: base, plus movement, plus accumulated bloom,
// reduced by crouching and by aiming down sights.
export function spreadFor(ent, def, speed, ads) {
  let s = def.spread + def.moveSpread * Math.min(1, speed / 4.3) + ent.bloom;
  if (ent.crouch) s *= 0.7;
  if (ads) s *= 0.45;
  return s;
}

// Damage falls off past 15 metres, down to 70% at the gun's max range.
export function damageAtRange(def, dist) {
  if (dist <= 15) return def.damage;
  const t = Math.min(1, (dist - 15) / Math.max(1, def.range - 15));
  return def.damage * (1 - 0.3 * t);
}

export function canFire(ent, def, time) {
  if (!ent.alive || ent.reloading > 0) return false;
  if (ent.ammo[ent.weapon].mag <= 0) return false;
  return time >= ent.nextShotAt;
}

export function startReload(ent, def, time) {
  const a = ent.ammo[ent.weapon];
  if (ent.reloading > 0 || a.mag >= def.mag || a.reserve <= 0) return false;
  ent.reloading = def.reload;
  void time;
  return true;
}

export function updateWeapon(ent, dt) {
  // Bloom recovers when the trigger is off.
  ent.bloom = Math.max(0, ent.bloom - dt * 0.05);
  if (ent.reloading > 0) {
    ent.reloading -= dt;
    if (ent.reloading <= 0) {
      ent.reloading = 0;
      const def = WEAPONS[ent.weapon];
      const a = ent.ammo[ent.weapon];
      const need = def.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take;
      a.reserve -= take;
    }
  }
}

export function switchWeapon(ent, id) {
  if (!WEAPONS[id] || ent.weapon === id) return false;
  if (!ent.owned[id]) return false;
  ent.weapon = id;
  ent.reloading = 0;
  ent.bloom = Math.min(ent.bloom, 0.01);
  ent.nextShotAt = 0;
  return true;
}
