// Saltline Terminal: the map, its colliders and its nav graph. The map is
// data first: every wall, crate and silo is a box in a list, and the meshes,
// the colliders and the minimap all read the same list, so what you see is
// what blocks you. Ground is flat (y = 0); height lives in props and the
// conveyor bridge overhead, which bots and players walk under.
//
// Layout: Wardens spawn west, Jackals east. Three lanes run east-west: the
// north lane to site A (pump house and evaporation ponds), mid under the
// conveyor bridge, and the south lane to site B (silos and warehouse). Two
// cross connectors join the lanes on each half of the map.
import * as THREE from 'three';
import { PALETTE, TEAM } from './palette.js';
import { tile, signTexture, glowTexture } from './textures.js';

const BOUNDS = { x0: -32, x1: 32, z0: -24, z1: 24 };

// One shared unit geometry per shape; meshes scale it. Fewer geometries,
// fewer state changes, and the map builds in milliseconds.
let boxGeo = null;
let cylGeo = null;
let sphereGeo = null;
let coneGeo = null;
let planeGeo = null;

function geos() {
  if (!boxGeo) {
    boxGeo = new THREE.BoxGeometry(1, 1, 1);
    cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    sphereGeo = new THREE.SphereGeometry(0.5, 18, 12);
    coneGeo = new THREE.ConeGeometry(0.5, 1, 20);
    planeGeo = new THREE.PlaneGeometry(1, 1);
  }
  return { boxGeo, cylGeo, sphereGeo, coneGeo, planeGeo };
}

// Waypoints: node id -> [x, z]. Edges are bidirectional. Bots path with BFS;
// the graph is small enough that no heuristic is needed.
const NODES = [
  [-28, 0], [-24, -4], [-24, 4], [-20, 0], [-12, 0], [-4, 0], [4, 0], [12, 0],
  [20, 0], [28, 0], [24, -4], [24, 4], [-17, -11], [-12, -18], [-4, -18],
  [4, -18], [12, -18], [20, -18], [-14.5, 16], [-12, 18], [-4, 18], [4, 18],
  [12, 18], [20, 18], [-4, -9], [12, -9], [-4, 9], [12, 9], [-20, -8],
  [-16, 8], [-24, -12.5], [-16, -14], [-24, 16], [-14.5, 14], [-20, -12], [-20, 12],
];
const EDGES = [
  [0, 1], [0, 2], [1, 28], [2, 29], [1, 3], [2, 3], [3, 4], [4, 5], [5, 6],
  [6, 7], [7, 8], [8, 9], [8, 10], [8, 11], [9, 10], [9, 11], [10, 17],
  [11, 23], [17, 16], [16, 15], [15, 14], [14, 13], [13, 12], [12, 30],
  [12, 31], [12, 34], [13, 34], [31, 34], [23, 22], [22, 21], [21, 20],
  [20, 19], [19, 18], [18, 32], [18, 33], [18, 35], [19, 35], [33, 35],
  [25, 16], [25, 7], [24, 14], [24, 5], [27, 22], [27, 7], [26, 20], [26, 5],
  [28, 12], [28, 3], [29, 18], [29, 3], [34, 28], [35, 29],
];

export const SITES = {
  A: { letter: 'A', name: 'Pump House', x0: -26, x1: -14, z0: -20, z1: -12 },
  B: { letter: 'B', name: 'Silos', x0: -26, x1: -14, z0: 12, z1: 20 },
};

export const SPAWNS = {
  W: [
    { x: -28, z: -4, yaw: -Math.PI / 2 },
    { x: -28, z: 0, yaw: -Math.PI / 2 },
    { x: -28, z: 4, yaw: -Math.PI / 2 },
  ],
  J: [
    { x: 28, z: -4, yaw: Math.PI / 2 },
    { x: 28, z: 0, yaw: Math.PI / 2 },
    { x: 28, z: 4, yaw: Math.PI / 2 },
  ],
};

// Hold spots: where defenders wait, and where each looks.
export const HOLDS = {
  A: { x: -16, z: -14, lx: 4, lz: -18 },
  B: { x: -14.5, z: 14, lx: 4, lz: 18 },
  MID: { x: -12, z: 0, lx: 20, lz: 0 },
};

export function pointInSite(x, z) {
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return key;
  }
  return null;
}

export function nearestNode(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < NODES.length; i += 1) {
    const dx = NODES[i][0] - x;
    const dz = NODES[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// BFS over the nav graph. Returns node ids from start to goal, inclusive.
export function findPath(from, to) {
  if (from === to) return [from];
  const prev = new Int16Array(NODES.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of ADJ[cur]) {
      if (prev[nb] !== -1) continue;
      prev[nb] = cur;
      if (nb === to) {
        const path = [to];
        let n = to;
        while (n !== from) {
          n = prev[n];
          path.push(n);
        }
        path.reverse();
        return path;
      }
      queue.push(nb);
    }
  }
  return [from, to];
}

const ADJ = NODES.map(() => []);
for (const [a, b] of EDGES) {
  ADJ[a].push(b);
  ADJ[b].push(a);
}

export function createWorld(scene, tex) {
  const { boxGeo: box, cylGeo: cyl, sphereGeo: sph, coneGeo: cone, planeGeo: plane } = geos();
  const mats = tex.materials;
  const colliders = [];
  const group = new THREE.Group();
  scene.add(group);
  const animated = [];

  function addCollider(cx, cz, w, d, h, y0) {
    colliders.push({
      x0: cx - w / 2, x1: cx + w / 2,
      z0: cz - d / 2, z1: cz + d / 2,
      y0: y0 ?? 0, y1: (y0 ?? 0) + h,
    });
  }

  function mesh(geo, mat, x, y, z, sx, sy, sz, collide, castShadow) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.castShadow = castShadow !== false;
    m.receiveShadow = true;
    group.add(m);
    if (collide) addCollider(x, z, sx, sz, sy, y - sy / 2);
    return m;
  }

  // Ground: salt pan, with a darker apron under the terminal buildings.
  const ground = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({
    map: tile(mats.salt.map, 18, 13), roughness: 0.95, metalness: 0,
  }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0);
  ground.scale.set(64, 48, 1);
  ground.receiveShadow = true;
  group.add(ground);
  const apron = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({
    map: tile(mats.concrete.map, 8, 6), roughness: 0.9, metalness: 0,
  }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(-22, 0.02, 0);
  apron.scale.set(20, 44, 1);
  apron.receiveShadow = true;
  group.add(apron);

  // Perimeter walls.
  const wallMat = new THREE.MeshStandardMaterial({
    map: tile(mats.concrete.map, 12, 1.5), roughness: 0.9, metalness: 0,
  });
  mesh(box, wallMat, 0, 2, -24.5, 66, 4, 1, true);
  mesh(box, wallMat, 0, 2, 24.5, 66, 4, 1, true);
  mesh(box, wallMat, -32.5, 2, 0, 1, 4, 50, true);
  mesh(box, wallMat, 32.5, 2, 0, 1, 4, 50, true);

  // Pump house (site A): solid block, roof slab, chimney, side pipes.
  mesh(box, mats.concrete, -21.5, 1.6, -16.5, 7, 3.2, 5, true);
  mesh(box, mats.roof, -21.5, 3.45, -16.5, 7.6, 0.5, 5.6, false);
  mesh(cyl, mats.metal, -24, 4.4, -18, 0.8, 2.6, 0.8, false);
  mesh(cyl, mats.rust || mats.metal, -18.2, 1.1, -16.5, 0.5, 2.2, 0.5, false);
  mesh(box, mats.steelDark || mats.metal, -21.5, 1.1, -13.9, 1.6, 2.2, 0.15, false);

  // Evaporation ponds: shallow brine, walkable, hazard edging.
  const brine = new THREE.MeshStandardMaterial({
    color: 0x7fb2b8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85,
  });
  for (const [px, pz, pw, pd] of [[-24, -13, 4, 3], [-17, -19, 4, 3]]) {
    const pond = new THREE.Mesh(plane, brine);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(px, 0.04, pz);
    pond.scale.set(pw, pd, 1);
    pond.receiveShadow = true;
    group.add(pond);
  }

  // Warehouse (site B): walls with two door gaps, flat roof, vents.
  const wallH = 3.4;
  const wallT = 0.6;
  // North wall (z=13) with a door gap at x=-19.
  mesh(box, mats.metal, -22.5, wallH / 2, 13, 7, wallH, wallT, true);
  mesh(box, mats.metal, -16.8, wallH / 2, 13, 1.6, wallH, wallT, true);
  mesh(box, mats.metal, -19, 2.9, 13, 2, 1, wallT, false); // lintel over the door
  // East wall (x=-16) with a door gap at z=16.5.
  mesh(box, mats.metal, -16, wallH / 2, 14.4, wallT, wallH, 2.2, true);
  mesh(box, mats.metal, -16, wallH / 2, 18.4, wallT, wallH, 2.6, true);
  mesh(box, mats.metal, -16, 2.9, 16.5, wallT, 1, 2, false);
  // South and west walls, solid.
  mesh(box, mats.metal, -21, wallH / 2, 20, 10.6, wallH, wallT, true);
  mesh(box, mats.metal, -26, wallH / 2, 16.5, wallT, wallH, 7.6, true);
  mesh(box, mats.roof, -21, wallH + 0.25, 16.5, 11, 0.5, 8, false);
  mesh(cyl, mats.metal, -23, wallH + 0.9, 15, 0.9, 0.9, 0.9, false);
  mesh(cyl, mats.metal, -19, wallH + 0.9, 18, 0.9, 0.9, 0.9, false);
  // Interior crates.
  mesh(box, mats.wood, -23, 0.6, 18.5, 1.2, 1.2, 1.2, true);
  mesh(box, mats.wood, -18, 0.6, 14.5, 1.2, 1.2, 1.2, true);

  // Silos: three big cylinders with cone roofs, ladders and a connecting pipe.
  for (const [sx, sz] of [[-24, 9], [-20, 9], [-22, 6.5]]) {
    mesh(cyl, mats.metal, sx, 4.5, sz, 5, 9, 5, true);
    mesh(cone, mats.roof, sx, 9.8, sz, 5.4, 1.8, 5.4, false);
    mesh(box, mats.steelDark || mats.metal, sx + 2.6, 3, sz, 0.3, 6, 0.6, false);
  }
  mesh(cyl, mats.metal, -22, 7.6, 7.8, 0.5, 5.5, 0.5, false).rotation.z = Math.PI / 2;

  // Conveyor bridge over mid: deck, rails, legs, rollers.
  mesh(box, mats.steelDark || mats.metal, 0, 3.7, 0, 20, 0.35, 2.4, false);
  mesh(box, mats.metal, 0, 4.1, -1.1, 20, 0.5, 0.15, false);
  mesh(box, mats.metal, 0, 4.1, 1.1, 20, 0.5, 0.15, false);
  for (const lx of [-8, 0, 8]) {
    mesh(box, mats.metal, lx, 1.75, -1, 0.4, 3.5, 0.4, true);
    mesh(box, mats.metal, lx, 1.75, 1, 0.4, 3.5, 0.4, true);
  }
  for (let rx = -9; rx <= 9; rx += 2) {
    const roller = mesh(cyl, mats.steelDark || mats.metal, rx, 3.95, 0, 0.28, 2, 0.28, false);
    roller.rotation.x = Math.PI / 2;
  }

  // Watchtower between mid and the north lane: legs, platform, roof, beacon.
  const towerX = 6;
  const towerZ = -12;
  for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    mesh(box, mats.wood, towerX + ox, 1.6, towerZ + oz, 0.3, 3.2, 0.3, false);
  }
  addCollider(towerX, towerZ, 2.4, 2.4, 3.2, 0);
  mesh(box, mats.wood, towerX, 3.3, towerZ, 2.8, 0.25, 2.8, false);
  mesh(box, mats.roof, towerX, 5.4, towerZ, 3.2, 0.2, 3.2, false);
  mesh(box, mats.wood, towerX, 4.6, towerZ - 1.3, 2.8, 0.9, 0.15, false);
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff5a3c, emissive: 0xff5a3c, emissiveIntensity: 2, roughness: 0.4,
  });
  const beacon = mesh(sph, beaconMat, towerX, 5.7, towerZ, 0.35, 0.35, 0.35, false, false);
  animated.push({ kind: 'beacon', mesh: beacon, mat: beaconMat });

  // Pumpjack at A: slow nodding arm, the map's one moving machine.
  const jack = new THREE.Group();
  jack.position.set(-27, 0, -21.5);
  group.add(jack);
  const jackBase = new THREE.Mesh(box, mats.metal);
  jackBase.position.y = 0.5;
  jackBase.scale.set(1.6, 1, 1);
  jack.add(jackBase);
  const jackArm = new THREE.Mesh(box, mats.rust || mats.metal);
  jackArm.scale.set(3.2, 0.25, 0.25);
  jackArm.position.set(0, 1.6, 0);
  jack.add(jackArm);
  animated.push({ kind: 'jack', mesh: jackArm });
  addCollider(-27, -21.5, 2, 1.4, 1.6, 0);

  // Depot office behind the Warden spawn, with the terminal sign.
  mesh(box, mats.concrete, -30.5, 2, 0, 3, 4, 16, false);
  const officeSign = new THREE.Mesh(
    plane,
    new THREE.MeshStandardMaterial({ map: signTexture('SALTLINE', 'TERMINAL 7', '#ffb454'), roughness: 0.8 }),
  );
  officeSign.position.set(-28.9, 2.8, 0);
  officeSign.rotation.y = Math.PI / 2;
  officeSign.scale.set(6, 1.9, 1);
  group.add(officeSign);

  // East gate frame behind the Jackal spawn.
  mesh(box, mats.metal, 30.5, 2.5, -4, 1, 5, 1, false);
  mesh(box, mats.metal, 30.5, 2.5, 4, 1, 5, 1, false);
  mesh(box, mats.metal, 30.5, 5, 0, 1, 0.6, 9, false);

  // Crates and barrels: cover, kept clear of nav lines.
  const crates = [
    [2, 2.5, 1.2], [8, -2.5, 1.2], [-8, 2.5, 1.2], [-14, -2.5, 1.2],
    [16, 3, 1.2], [-2, -3, 1.2], [-10, -15.5, 1.2], [-14, -20.5, 1.2],
    [0, -20.5, 1.2], [16, -15.5, 1.2], [-10, 15.5, 1.2], [-14, 20.5, 1.2],
    [0, 20.5, 1.2], [16, 15.5, 1.2], [24, -9, 1.2], [24, 9, 1.2],
    [-26, -9, 1.2], [-26, 9, 1.2], [2, 2.5, 1.2, 1.2], [-10, -15.5, 1.2, 1.2],
  ];
  for (const [cx, cz, size, lift] of crates) {
    mesh(box, mats.wood, cx, size / 2 + (lift || 0), cz, size, size, size, !lift);
  }
  const barrels = [
    [6, 3.5], [6.9, 3.1], [-6, -3.5], [-6.9, -3.1], [20, -12], [-26, -14],
    [-26, 14], [26, -14], [26, 14], [-12, 12],
  ];
  const barrelMat = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.4 });
  for (const [bx, bz] of barrels) {
    mesh(cyl, barrelMat, bx, 0.55, bz, 0.9, 1.1, 0.9, true);
  }

  // Low sandbag lines: chest-high cover you can shoot over standing.
  const bagMat = new THREE.MeshStandardMaterial({ color: 0xa89a7c, roughness: 1, metalness: 0 });
  mesh(box, bagMat, 0, 0.55, 3.4, 4, 1.1, 0.7, true);
  mesh(box, bagMat, -18, 0.55, -12.6, 4, 1.1, 0.7, true);
  mesh(box, bagMat, -18, 0.55, 12.6, 4, 1.1, 0.7, true);
  mesh(box, bagMat, 0, 0.55, -15.5, 4, 1.1, 0.7, true);
  mesh(box, bagMat, 0, 0.55, 15.5, 4, 1.1, 0.7, true);

  // Salt piles: pale cones, walkable around, soft cover at range.
  const pileMat = new THREE.MeshStandardMaterial({ color: PALETTE.saltPile, roughness: 1, metalness: 0 });
  for (const [px, pz, pr, ph] of [[-8, -6, 2.2, 1.6], [10, 6, 2.6, 1.9], [-26, 0, 2, 1.4], [26, 0, 2, 1.4]]) {
    mesh(cone, pileMat, px, ph / 2, pz, pr * 2, ph, pr * 2, true);
  }

  // Site markers: hazard ground quads and standing letter boards.
  for (const key of ['A', 'B']) {
    const s = SITES[key];
    const cx = (s.x0 + s.x1) / 2;
    const cz = (s.z0 + s.z1) / 2;
    const quad = new THREE.Mesh(plane, new THREE.MeshStandardMaterial({
      map: tile(mats.hazard.map, 6, 4), roughness: 0.8, transparent: true, opacity: 0.55,
    }));
    quad.rotation.x = -Math.PI / 2;
    quad.position.set(cx, 0.06, cz);
    quad.scale.set(s.x1 - s.x0, s.z1 - s.z0, 1);
    quad.receiveShadow = true;
    group.add(quad);
    const board = new THREE.Mesh(
      plane,
      new THREE.MeshStandardMaterial({
        map: signTexture(`SITE ${key}`, SITES[key].name.toUpperCase(), '#ffb454'),
        roughness: 0.8, side: THREE.DoubleSide,
      }),
    );
    board.position.set(cx, 2.4, key === 'A' ? s.z0 + 0.4 : s.z1 - 0.4);
    board.scale.set(4, 1.25, 1);
    group.add(board);
    mesh(box, mats.steelDark || mats.metal, cx - 1.6, 1.1, board.position.z, 0.18, 2.2, 0.18, false);
    mesh(box, mats.steelDark || mats.metal, cx + 1.6, 1.1, board.position.z, 0.18, 2.2, 0.18, false);
  }

  // Floodlight poles: emissive lamps with glow halos.
  const glowTex = glowTexture();
  for (const [px, pz] of [[-14, -6], [-14, 6], [14, -6], [14, 6]]) {
    mesh(cyl, mats.steelDark || mats.metal, px, 3, pz, 0.25, 6, 0.25, true);
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff2cc, emissive: 0xffd9a0, emissiveIntensity: 2.4, roughness: 0.4,
    });
    mesh(box, lampMat, px, 6.1, pz, 0.9, 0.3, 0.5, false, false);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0.35,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    halo.position.set(px, 6.1, pz);
    halo.scale.set(3.2, 3.2, 1);
    group.add(halo);
  }

  // Distant silhouettes beyond the walls, for depth in the fog.
  for (const [vx, vz, vh] of [[44, -18, 16], [46, 8, 20], [-44, -14, 14], [-44, 16, 18]]) {
    const sil = new THREE.Mesh(cyl, mats.concrete);
    sil.position.set(vx, vh / 2, vz);
    sil.scale.set(7, vh, 7);
    group.add(sil);
  }

  return {
    group,
    colliders,
    bounds: BOUNDS,
    sites: SITES,
    spawns: SPAWNS,
    nodes: NODES,
    adj: ADJ,
    animated,
    update(time) {
      for (const a of animated) {
        if (a.kind === 'beacon') a.mat.emissiveIntensity = 1.2 + Math.sin(time * 3.2) * 1.1;
        if (a.kind === 'jack') a.mesh.rotation.z = Math.sin(time * 0.9) * 0.22;
      }
    },
  };
}

// Axis-separated circle-vs-AABB resolve: slide along walls, never tunnel.
// pos is mutated in place; radius is the body's XZ radius, height its top.
export function collideCircle(world, pos, radius, height) {
  const b = world.bounds;
  if (pos.x - radius < b.x0) pos.x = b.x0 + radius;
  if (pos.x + radius > b.x1) pos.x = b.x1 - radius;
  if (pos.z - radius < b.z0) pos.z = b.z0 + radius;
  if (pos.z + radius > b.z1) pos.z = b.z1 - radius;
  for (const c of world.colliders) {
    if (pos.y >= c.y1 || pos.y + height <= c.y0) continue;
    const nx = Math.max(c.x0, Math.min(pos.x, c.x1));
    const nz = Math.max(c.z0, Math.min(pos.z, c.z1));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
    } else {
      // Centre inside the box: push out along the smallest overlap.
      const pushW = pos.x - c.x0 + radius;
      const pushE = c.x1 - pos.x + radius;
      const pushN = pos.z - c.z0 + radius;
      const pushS = c.z1 - pos.z + radius;
      const m = Math.min(pushW, pushE, pushN, pushS);
      if (m === pushW) pos.x = c.x0 - radius;
      else if (m === pushE) pos.x = c.x1 + radius;
      else if (m === pushN) pos.z = c.z0 - radius;
      else pos.z = c.z1 + radius;
    }
  }
}

// Ray vs the world: nearest AABB or ground hit. Slab method, no allocation.
// Returns t along the ray, or Infinity; normal is written into `out`.
export function rayWorld(world, ox, oy, oz, dx, dy, dz, maxT, out) {
  let best = maxT;
  let nx = 0;
  let ny = 1;
  let nz = 0;
  if (dy < -1e-9) {
    const t = -oy / dy;
    if (t > 0 && t < best) {
      best = t;
      nx = 0;
      ny = 1;
      nz = 0;
    }
  }
  for (const c of world.colliders) {
    let tmin = 0;
    let tmax = best;
    let axis = -1;
    let sign = 0;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ox < c.x0 || ox > c.x1) continue;
    } else {
      const inv = 1 / dx;
      let t1 = (c.x0 - ox) * inv;
      let t2 = (c.x1 - ox) * inv;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1; t1 = t2; t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) { tmin = t1; axis = 0; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (Math.abs(dy) < 1e-9) {
      if (oy < c.y0 || oy > c.y1) continue;
    } else {
      const inv = 1 / dy;
      let t1 = (c.y0 - oy) * inv;
      let t2 = (c.y1 - oy) * inv;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1; t1 = t2; t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) { tmin = t1; axis = 1; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (oz < c.z0 || oz > c.z1) continue;
    } else {
      const inv = 1 / dz;
      let t1 = (c.z0 - oz) * inv;
      let t2 = (c.z1 - oz) * inv;
      let s = -1;
      if (t1 > t2) {
        const tmp = t1; t1 = t2; t2 = tmp;
        s = 1;
      }
      if (t1 > tmin) { tmin = t1; axis = 2; sign = s; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
    }
    if (tmin > 0.001 && tmin < best) {
      best = tmin;
      nx = axis === 0 ? sign : 0;
      ny = axis === 1 ? sign : 0;
      nz = axis === 2 ? sign : 0;
    }
  }
  if (out) {
    out.t = best;
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
  }
  return best;
}

// Line of sight between two points: true when no wall or prop is between.
export function segmentBlocked(world, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) return false;
  const t = rayWorld(world, ax, ay, az, dx / dist, dy / dist, dz / dist, dist - 0.05, null);
  return t < dist - 0.05;
}

// Agent bodies: primitives in team colours, with a name tag for allies and a
// muzzle sprite the renderer flashes. Built once per agent, posed per frame.
export function buildAgentMesh(team, name, showTag) {
  const t = TEAM[team];
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: t.cloth, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xc9a586, roughness: 0.8 });
  const accent = new THREE.MeshStandardMaterial({ color: t.accent, roughness: 0.6 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.85, 10), cloth);
  torso.position.y = 1.12;
  torso.castShadow = true;
  group.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.34), dark);
  vest.position.y = 1.18;
  group.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 10), skin);
  head.position.y = 1.72;
  head.castShadow = true;
  group.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), accent);
  helmet.position.y = 1.74;
  group.add(helmet);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), dark);
  legL.position.set(-0.13, 0.35, 0);
  group.add(legL);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), dark);
  legR.position.set(0.13, 0.35, 0);
  group.add(legR);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.55, 0.13), cloth);
  armL.position.set(-0.34, 1.18, 0.1);
  armL.rotation.x = -0.7;
  group.add(armL);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), dark);
  gun.position.set(0.18, 1.28, 0.35);
  group.add(gun);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.18, 0.12), dark);
  mag.position.set(0.18, 1.16, 0.3);
  mag.rotation.x = 0.25;
  group.add(mag);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: 0xffd9a0, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flash.position.set(0.18, 1.3, 0.78);
  flash.scale.set(0.55, 0.55, 1);
  group.add(flash);

  let tag = null;
  if (showTag) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const ctx = c.getContext('2d');
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(20,22,26,0.65)';
    const w = ctx.measureText(name).width + 24;
    ctx.fillRect(128 - w / 2, 4, w, 38);
    ctx.fillStyle = '#e9e6df';
    ctx.fillText(name, 128, 33);
    const tagTex = new THREE.CanvasTexture(c);
    tagTex.colorSpace = THREE.SRGBColorSpace;
    tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, transparent: true, depthWrite: false }));
    tag.position.y = 2.12;
    tag.scale.set(1.5, 0.28, 1);
    group.add(tag);
  }

  return { group, torso, head, legL, legR, gun, flash, tag };
}
