import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import type { P2 } from '../../WorldLayout';
import { BSS, GROUND, hash01 } from './bssLayout';
import { frameAt, medallion, sign, type BssMats, type Frame } from './bssKit';
import type { DistrictSite } from './bssLower';
import { NavTag } from './bssNav';
import { tree } from './parts';

/**
 * Lake Laogai and the Dai Li base. The base is sealed inside a rock hill on
 * the north-east shore; its concealed door sits at the tip of a rocky spur
 * reaching into the lake, and a line of stepping stones rises from the water
 * between the east shore and the door when bent up. Inside: cold stone
 * tunnels lit green, sliding stone doors, the prison block, the training hall,
 * the brainwashing chamber (rows of stone chairs facing a spinning lantern)
 * and a cavern big enough for a sky bison. After the Dai Li captain on the
 * shore is beaten (flag laogai_raided) the door lies in pieces and the stones
 * stay up.
 */

const L = BSS.laogai;
const LAKE = BSS.lake;
const WATER_Y = 25.2;
/** Hill frame: origin at the hill centre, local +Z toward the door. */
const DIR = (() => {
  const dx = L.door.x - L.hill.x, dz = L.door.z - L.hill.z, l = Math.hypot(dx, dz);
  return { x: dx / l, z: dz / l, len: l };
})();
const HF: Frame = frameAt(L.hill.x, L.hill.z, DIR.x, DIR.z);
/** Hill boundary along the axis (local z) and the door (local z). */
const EDGE_Z = 1 / Math.hypot(DIR.x / L.hill.rx, DIR.z / L.hill.rz);
const DOOR_Z = DIR.len;
const TUN = { hw: 1.8, h: 4.2 };

interface Room {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  h: number;
  /** Door gaps per side: [side, centre along the side, width]. */
  gaps: Array<['n' | 's' | 'e' | 'w', number, number]>;
}

const ROOMS: Record<string, Room> = {
  ante: { x0: -6, x1: 6, z0: 15, z1: 23, h: 5, gaps: [['n', 0, 3.4], ['s', 0, 12]] },
  cavern: { x0: -11, x1: 11, z0: -7, z1: 15, h: 13, gaps: [['n', 0, 3.4], ['w', 4, 3.4], ['e', 4, 3.4], ['s', 0, 3.4]] },
  westHall: { x0: -17, x1: -11, z0: 2.2, z1: 5.8, h: 4.2, gaps: [['e', 4, 3.6], ['w', 4, 3.6]] },
  brainwash: { x0: -26, x1: -17, z0: -3, z1: 11, h: 6, gaps: [['e', 4, 3.4]] },
  eastHall: { x0: 11, x1: 16, z0: 2.2, z1: 5.8, h: 4.2, gaps: [['w', 4, 3.6], ['e', 4, 3.6]] },
  training: { x0: 16, x1: 26, z0: -6, z1: 12, h: 7, gaps: [['w', 4, 3.4]] },
  prison: { x0: -6, x1: 6, z0: -28, z1: -7, h: 4.6, gaps: [['n', 0, 12]] },
};

/** Inside the base (hill rooms or the entrance tunnel)? */
export function insideLaogai(x: number, z: number, y: number): boolean {
  if (y > GROUND + 14) return false;
  const dx = x - L.hill.x, dz = z - L.hill.z;
  const lx = dx * Math.cos(HF.yaw) - dz * Math.sin(HF.yaw), lz = dx * Math.sin(HF.yaw) + dz * Math.cos(HF.yaw);
  if (Math.abs(lx) <= TUN.hw + 0.3 && lz >= 0 && lz <= DOOR_Z - 0.6) return true;
  for (const r of Object.values(ROOMS)) if (lx >= r.x0 && lx <= r.x1 && lz >= r.z0 && lz <= r.z1) return true;
  return false;
}

export interface LaogaiBuild {
  stones: Array<{ x: number; z: number; yaw: number }>;
  doorFrame: Frame;
  lantern: P2;
  pathStart: P2;
  landing: P2;
}

/** Noisy rock blob (icosphere) for shore boulders and the spur. */
function rockGeo(seed: number, sx: number, sy: number, sz: number, detail = 1): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    // Displace by position so the duplicated vertices of the non-indexed mesh stay welded.
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 0.82 + 0.36 * hash01(seed * 7919 + Math.round(x * 97), Math.round(y * 97), Math.round(z * 97));
    p.setXYZ(i, x * sx * n, y * sy * n, z * sz * n);
  }
  g.computeVertexNormals();
  return g;
}

export function buildLaogai(site: DistrictSite): LaogaiBuild {
  shore(site);
  const hill = hillShell(site);
  rooms(site);
  return hill;
}

// ---------------------------------------------------------------------------
// Lake shore: reeds, boulders, trees, the boathouse and its pier
// ---------------------------------------------------------------------------

function shore(site: DistrictSite): void {
  const { env, nav } = site;
  const b = env.chunks.named('props', 'laogai_shore').builder;
  const keep = (x: number, z: number) => {
    const ang = (q: P2) => Math.hypot(x - q.x, z - q.z);
    // Distance from the spur's axis (hill centre → door).
    const t = Math.max(0, Math.min(1, ((x - L.hill.x) * (L.door.x - L.hill.x) + (z - L.hill.z) * (L.door.z - L.hill.z)) / (DIR.len * DIR.len)));
    const spur = Math.hypot(x - (L.hill.x + (L.door.x - L.hill.x) * t), z - (L.hill.z + (L.door.z - L.hill.z) * t));
    return spur > 11 && ang(L.door) > 14 && ang(L.path.a) > 6 && ang(L.path.b) > 6 && ang(BSS.lakeDock.a) > 10 && ang(BSS.boathouse) > 9;
  };
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2 + hash01(i, 901) * 0.12;
    const r = LAKE.r - 1.5 + hash01(i, 902) * 3;
    const cx = LAKE.x + Math.cos(a) * r, cz = LAKE.z + Math.sin(a) * r;
    if (!keep(cx, cz)) continue;
    for (let k = 0; k < 7; k++) {
      const x = cx + (hash01(i, k, 903) - 0.5) * 2.4, z = cz + (hash01(i, k, 904) - 0.5) * 2.4;
      b.cylinder(env.mats.reed, { x, y: WATER_Y - 0.4, z, r: 0.04, rTop: 0.015, h: 1.4 + hash01(i, k, 905) * 1.0, segments: 4 });
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.3;
    const r = LAKE.r + 2 + hash01(i, 911) * 4;
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    if (!keep(x, z)) continue;
    const s = 0.6 + hash01(i, 912) * 0.7;
    b.rock('stone_grey', rockGeo(i, s * 1.2, s * 0.7, s), { x, y: GROUND + s * 0.2, z, yaw: a }, { shape: 'sphere', x, y: GROUND + s * 0.2, z, r: s * 0.9, walkable: true, solid: true, surface: 'stone' });
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + 0.1;
    const r = LAKE.r + 9 + hash01(i, 921) * 10;
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    if (!keep(x, z) || Math.hypot(x - L.hill.x, z - L.hill.z) < Math.max(L.hill.rx, L.hill.rz) + 4) continue;
    tree(b, env.mats, x, GROUND, z, 0.9 + hash01(i, 922) * 0.3, i % 3 ? 'round' : 'cypress', i);
  }
  // Boathouse pier on the west shore.
  const A = BSS.lakeDock.a, B = BSS.lakeDock.b;
  const len = Math.hypot(B.x - A.x, B.z - A.z), yaw = Math.atan2(B.x - A.x, B.z - A.z);
  b.box('wood', { x: (A.x + B.x) / 2, y: 26.15, z: (A.z + B.z) / 2, sx: 2.6, sy: 0.3, sz: len, yaw }, { collide: true, walkable: true });
  for (let t = 0; t <= 1.001; t += 0.2) {
    for (const s of [-1.1, 1.1]) {
      const x = A.x + (B.x - A.x) * t + Math.cos(yaw) * s, z = A.z + (B.z - A.z) * t - Math.sin(yaw) * s;
      b.cylinder('wood_dark', { x, y: 23.5, z, r: 0.14, h: 3.4, segments: 6 });
    }
  }
  env.chunks.addHouse(env.arch.F2, BSS.boathouse.x, GROUND, BSS.boathouse.z, Math.PI / 2, { scale: 0.85 });
  const end = { x: B.x - 1, z: B.z };
  nav.street([{ x: A.x - 6, z: A.z }, end], NavTag.farm | NavTag.water | NavTag.street, 8, 6);
  nav.poi(end.x, end.z, NavTag.farm | NavTag.water | NavTag.bench, Math.PI / 2, 8);
}

// ---------------------------------------------------------------------------
// The hill shell, the spur with the concealed door, the stepping stones
// ---------------------------------------------------------------------------

function hillShell(site: DistrictSite): LaogaiBuild {
  const { env, bm } = site;
  const b = env.chunks.named('major', 'laogai_hill').builder;
  const H = L.hill;
  // Dome with steep cliffs at its foot (radial grid in the hill frame, rotated with the ellipse axes).
  const rings = 14, segs = 48;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const prof = (rho: number, a: number) => {
    const n = 1 + 0.1 * Math.sin(a * 4 + 1) + 0.06 * Math.sin(a * 9);
    const cliff = rho > 0.86 ? (1 - rho) / 0.14 : 1;
    return (H.h * Math.pow(Math.max(0, 1 - Math.pow(rho * 0.92, 2.2)), 0.7) * n) * (0.35 + 0.65 * cliff) - (rho > 0.98 ? 1.2 : 0);
  };
  pos.push(H.x, GROUND + prof(0, 0), H.z);
  uv.push(0, 0);
  for (let r = 1; r <= rings; r++) {
    const rho = r / rings;
    for (let s = 0; s < segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const wob = 1 + 0.05 * Math.sin(a * 6 + 2);
      const x = H.x + Math.cos(a) * H.rx * rho * wob, z = H.z + Math.sin(a) * H.rz * rho * wob;
      pos.push(x, GROUND + prof(rho, a), z);
      uv.push(x * 0.1, z * 0.1);
    }
  }
  for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
  // Leave a hole where the entrance tunnel passes through the hill's flank (the spur's rocks hide it).
  const inTunnel = (i0: number, i1: number, i2: number) => {
    const cx = (pos[i0 * 3] + pos[i1 * 3] + pos[i2 * 3]) / 3 - H.x, cy = (pos[i0 * 3 + 1] + pos[i1 * 3 + 1] + pos[i2 * 3 + 1]) / 3;
    const cz = (pos[i0 * 3 + 2] + pos[i1 * 3 + 2] + pos[i2 * 3 + 2]) / 3 - H.z;
    const lx = cx * Math.cos(HF.yaw) - cz * Math.sin(HF.yaw), lz = cx * Math.sin(HF.yaw) + cz * Math.cos(HF.yaw);
    return Math.abs(lx) < TUN.hw + 2.2 && lz > EDGE_Z - 9 && cy < GROUND + TUN.h + 2.5;
  };
  for (let r = 1; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = 1 + (r - 1) * segs + s, c = 1 + (r - 1) * segs + ((s + 1) % segs);
      if (!inTunnel(a, c, a + segs)) idx.push(a, c, a + segs);
      if (!inTunnel(c, c + segs, a + segs)) idx.push(c, c + segs, a + segs);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  b.mesh(bm.rock, g, { x: 0, y: 0, z: 0 });
  g.dispose();
  // Cliff colliders round the foot (a gap where the entrance tunnel comes in) and walkable terraces above the rooms.
  const n = 28;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = { x: H.x + Math.cos(a0) * H.rx * 0.97, z: H.z + Math.sin(a0) * H.rz * 0.97 };
    const p1 = { x: H.x + Math.cos(a1) * H.rx * 0.97, z: H.z + Math.sin(a1) * H.rz * 0.97 };
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    const lx = (mx - H.x) * Math.cos(HF.yaw) - (mz - H.z) * Math.sin(HF.yaw), lz = (mx - H.x) * Math.sin(HF.yaw) + (mz - H.z) * Math.cos(HF.yaw);
    if (lz > 0 && Math.abs(lx) < TUN.hw + 4) continue;
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
    b.collider({ shape: 'box', x: mx, y: GROUND + 7, z: mz, hx: 1.6, hy: 7, hz: len / 2 + 0.3, yaw: Math.atan2(p1.x - p0.x, p1.z - p0.z), walkable: false, solid: true, surface: 'stone' });
  }
  for (const [y, s] of [[15, 0.82], [18, 0.6], [20.5, 0.35]] as const) {
    b.collider({ shape: 'box', x: H.x, y: GROUND + y - 0.5, z: H.z, hx: H.rx * s * 0.7, hy: 0.5, hz: H.rz * s * 0.7, yaw: 0, walkable: true, solid: true, surface: 'stone' });
  }
  for (let k = 0; k < 6; k++) {
    const a = hash01(k, 931) * Math.PI * 2, rho = 0.2 + hash01(k, 932) * 0.4;
    const x = H.x + Math.cos(a) * H.rx * rho, z = H.z + Math.sin(a) * H.rz * rho;
    tree(env.chunks.at('props', x, z).builder, env.mats, x, GROUND + prof(rho, a) - 0.5, z, 0.85, k % 2 ? 'cypress' : 'round', k, false);
  }
  // Spur from the hill to the door, with the entrance tunnel inside it.
  const sb = env.chunks.named('major', 'laogai_spur').builder;
  const z0 = EDGE_Z - 3, z1 = DOOR_Z;
  for (let i = 0; i < 6; i++) {
    const lz = z0 + ((z1 - 3 - z0) * (i + 0.5)) / 6;
    const c = HF.at(0, lz);
    const s = 1 - (i / 6) * 0.25;
    sb.mesh(bm.rock, rockGeo(40 + i, 7.2 * s, 8.5 * s, 3.8, 2), { x: c.x, y: GROUND + 2.2, z: c.z, yaw: HF.yaw });
  }
  const mid = HF.at(0, (z0 + z1) / 2), slen = z1 - z0;
  for (const side of [-1, 1]) {
    const w = HF.at(side * (TUN.hw + 2.4), (z0 + z1) / 2);
    sb.collider({ shape: 'box', x: w.x, y: GROUND + 4, z: w.z, hx: 2.3, hy: 4.5, hz: slen / 2, yaw: HF.yaw, walkable: false, solid: true, surface: 'stone' });
  }
  sb.collider({ shape: 'box', x: mid.x, y: GROUND + TUN.h + 2.2, z: mid.z, hx: TUN.hw + 4.6, hy: 2.1, hz: slen / 2, yaw: HF.yaw, walkable: true, solid: true, surface: 'stone' });
  // The tunnel itself (floor, walls, ceiling, green lamps).
  const tb = env.chunks.named('major', 'laogai_tunnel').builder;
  // Bored through the outcrop: raw rock, so its mouth blends into the spur from the shore.
  corridor(tb, bm, HF, 0, ROOMS.ante.z1, 0, DOOR_Z - 0.4, TUN.hw * 2, TUN.h, 'z', bm.rock);
  // Door frame in the spur's face, a landing in front, and the stepping stones.
  const df = frameAt(L.door.x, L.door.z, DIR.x, DIR.z);
  const land = df.at(0, 2.2);
  sb.box('stone_grey', { x: land.x, y: WATER_Y + 0.15, z: land.z, sx: 4.6, sy: 0.9, sz: 3.2, yaw: df.yaw }, { collide: true, walkable: true });
  // Threshold slab from the landing into the tunnel floor (no gap down to the shore under the door).
  const thr = df.at(0, 0.3);
  sb.box('stone_grey', { x: thr.x, y: GROUND - 0.22, z: thr.z, sx: TUN.hw * 2 + 0.4, sy: 0.6, sz: 2.4, yaw: df.yaw }, { collide: true, walkable: true });
  for (const side of [-1, 1]) {
    const j = df.at(side * (TUN.hw + 0.45), 0.2);
    // Jambs and lintel in the spur's own rock: the entrance is meant to pass for part of the outcrop.
    sb.box(bm.rock, { x: j.x, y: GROUND + TUN.h / 2, z: j.z, sx: 0.9, sy: TUN.h + 0.4, sz: 1.2, yaw: df.yaw });
  }
  const lin = df.at(0, 0.2);
  sb.box(bm.rock, { x: lin.x, y: GROUND + TUN.h + 0.5, z: lin.z, sx: TUN.hw * 2 + 1.8, sy: 1.0, sz: 1.2, yaw: df.yaw });
  // Rock masses close round the mouth (the tunnel runs a few metres past the spur's last boulder),
  // so from the shore the doorway reads as a crevice in the outcrop.
  for (const side of [-1, 1]) {
    const m = df.at(side * (TUN.hw + 2.6), -2.0);
    const g = rockGeo(77 + side, 2.2, 3.2, 2.8);
    sb.mesh(bm.rock, g, { x: m.x, y: GROUND + 2.2, z: m.z, yaw: df.yaw });
    g.dispose();
  }
  const cap = df.at(0, -2.0);
  const cg = rockGeo(79, TUN.hw + 2.4, 1.6, 2.8);
  sb.mesh(bm.rock, cg, { x: cap.x, y: GROUND + TUN.h + 2.0, z: cap.z, yaw: df.yaw });
  cg.dispose();
  const stones: Array<{ x: number; z: number; yaw: number }> = [];
  const A = L.path.a, B = L.path.b;
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    stones.push({ x: A.x + (B.x - A.x) * t + (hash01(i, 941) - 0.5) * 0.5, z: A.z + (B.z - A.z) * t + (hash01(i, 942) - 0.5) * 0.5, yaw: hash01(i, 943) * 0.6 });
  }
  site.nav.street([A, B, df.at(0, 1)], NavTag.farm | NavTag.water | NavTag.street, 6, 5);
  site.mark('laogai_door', L.door.x, GROUND, L.door.z);
  return { stones, doorFrame: df, lantern: HF.at(-24.4, 4), pathStart: A, landing: land };
}

/** Straight corridor in a frame along local z (axis 'z') or x (axis 'x'), from a to b. */
function corridor(b: ContentBuilder, bm: BssMats, F: Frame, c0: number, a: number, c1: number, e: number, w: number, h: number, axis: 'z' | 'x', wall: THREE.Material = bm.cave): void {
  const len = Math.abs(e - a), mid = (a + e) / 2;
  const at = (u: number, v: number) => (axis === 'z' ? F.at(u, v) : F.at(v, u));
  const yawOff = axis === 'z' ? 0 : Math.PI / 2;
  const c = at(c0, mid);
  b.box('stone_dark', { x: c.x, y: GROUND + 0.04, z: c.z, sx: w, sy: 0.08, sz: len, yaw: F.yaw + yawOff });
  // A solid floor: near the door the terrain under the hill is the lake shore, a metre and more lower.
  b.collider({ shape: 'box', x: c.x, y: GROUND - 0.42, z: c.z, hx: w / 2 + 0.4, hy: 0.5, hz: len / 2, yaw: F.yaw + yawOff, walkable: true, solid: true, surface: 'stone' });
  b.box(wall, { x: c.x, y: GROUND + h + 0.4, z: c.z, sx: w + 1.6, sy: 0.8, sz: len, yaw: F.yaw + yawOff });
  for (const side of [-1, 1]) {
    const s = at(c0 + side * (w / 2 + 0.4), mid);
    b.box(wall, { x: s.x, y: GROUND + h / 2, z: s.z, sx: 0.8, sy: h, sz: len, yaw: F.yaw + yawOff }, { collide: true });
  }
  for (let v = Math.min(a, e) + 4; v < Math.max(a, e) - 2; v += 7) {
    const l = at(c0 + (w / 2 - 0.05), v);
    b.box(bm.daiGlow, { x: l.x, y: GROUND + h * 0.66, z: l.z, sx: 0.14, sy: 0.8, sz: 0.45, yaw: F.yaw + yawOff });
  }
  void c1;
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

function roomShell(b: ContentBuilder, bm: BssMats, r: Room): void {
  const F = HF;
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2, W = r.x1 - r.x0, D = r.z1 - r.z0;
  const c = F.at(cx, cz);
  b.box('stone_dark', { x: c.x, y: GROUND + 0.04, z: c.z, sx: W, sy: 0.08, sz: D, yaw: F.yaw });
  b.box(bm.cave, { x: c.x, y: GROUND + r.h + 0.5, z: c.z, sx: W + 1.6, sy: 1.0, sz: D + 1.6, yaw: F.yaw });
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const a = F.at(x0, z0), e = F.at(x1, z1);
    const len = Math.hypot(e.x - a.x, e.z - a.z);
    if (len < 0.2) return;
    b.box(bm.cave, { x: (a.x + e.x) / 2, y: GROUND + r.h / 2, z: (a.z + e.z) / 2, sx: 0.8, sy: r.h, sz: len + 0.8, yaw: Math.atan2(e.x - a.x, e.z - a.z) }, { collide: true });
  };
  // n = +Z side (toward the door), s = −Z, e = +X, w = −X.
  const side = (s: 'n' | 's' | 'e' | 'w', x0: number, z0: number, x1: number, z1: number, along: 'x' | 'z') => {
    const gaps = r.gaps.filter((g) => g[0] === s).map((g) => [g[1] - g[2] / 2, g[1] + g[2] / 2] as [number, number]).sort((p, q) => p[0] - q[0]);
    let start = along === 'x' ? x0 : z0;
    const end = along === 'x' ? x1 : z1;
    const sideLen = along === 'x' ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    for (const [g0, g1] of gaps) {
      if (along === 'x') wall(start, z0, g0, z1);
      else wall(x0, start, x1, g0);
      // A side that is open over its full length belongs to the neighbouring room (no wall, no lintel).
      if (g1 - g0 >= sideLen - 0.05) {
        start = g1;
        continue;
      }
      // Lintel over the doorway.
      const lc = along === 'x' ? F.at((g0 + g1) / 2, z0) : F.at(x0, (g0 + g1) / 2);
      const lh = r.h - 3.4;
      if (lh > 0.1) b.box(bm.cave, { x: lc.x, y: GROUND + 3.4 + lh / 2, z: lc.z, sx: along === 'x' ? g1 - g0 : 0.8, sy: lh, sz: along === 'x' ? 0.8 : g1 - g0, yaw: F.yaw }, { collide: true });
      start = g1;
    }
    if (along === 'x') wall(start, z0, end, z1);
    else wall(x0, start, x1, end);
  };
  side('n', r.x0, r.z1, r.x1, r.z1, 'x');
  side('s', r.x0, r.z0, r.x1, r.z0, 'x');
  side('e', r.x1, r.z0, r.x1, r.z1, 'z');
  side('w', r.x0, r.z0, r.x0, r.z1, 'z');
  // Green lamps on the long walls.
  for (let x = r.x0 + 2.5; x < r.x1 - 1; x += 5) {
    for (const z of [r.z0 + 0.45, r.z1 - 0.45]) {
      const p = F.at(x, z);
      b.box(bm.daiGlow, { x: p.x, y: GROUND + Math.min(r.h - 1, 3.1), z: p.z, sx: 0.5, sy: 0.9, sz: 0.14, yaw: F.yaw });
    }
  }
}

function rooms(site: DistrictSite): void {
  const { env, bm, nav, gates } = site;
  const b = env.chunks.named('major', 'laogai_rooms').builder;
  const d = env.chunks.named('props', 'laogai_props').builder;
  for (const r of Object.values(ROOMS)) roomShell(b, bm, r);
  // Sliding stone doors (they sink into the floor as you approach).
  const door = (id: string, lx: number, lz: number, alongX: boolean) => {
    const p = HF.at(lx, lz);
    const f = frameAt(p.x, p.z, alongX ? Math.sin(HF.yaw + Math.PI / 2) : Math.sin(HF.yaw), alongX ? Math.cos(HF.yaw + Math.PI / 2) : Math.cos(HF.yaw));
    gates.add({ id, f, lz: 0, baseY: GROUND, aw: 3.3, spring: 2.2, thick: 0.6, openR: 5.5 });
  };
  door('laogai_hub', 0, ROOMS.ante.z0, false);
  door('laogai_prison', 0, ROOMS.cavern.z0, false);
  door('laogai_west', ROOMS.westHall.x0, 4, true);
  door('laogai_east', ROOMS.eastHall.x1, 4, true);
  // Cavern: room for a sky bison — hay, a trough, chains, a ring of stone posts.
  const cc = HF.at(0, 4);
  d.cylinder('stone_grey', { x: cc.x, y: GROUND, z: cc.z, r: 6.5, h: 0.12, segments: 32 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    d.cylinder(bm.cave, { x: cc.x + Math.cos(a) * 7.2, y: GROUND, z: cc.z + Math.sin(a) * 7.2, r: 0.35, h: 2.4, segments: 8 }, { collide: true });
    d.box('iron', { x: cc.x + Math.cos(a) * 7.2, y: GROUND + 6.5, z: cc.z + Math.sin(a) * 7.2, sx: 0.08, sy: 6.5, sz: 0.08 });
  }
  for (const [lx, lz] of [[-8, 11], [8.5, -4], [-7.5, -3.5]]) {
    const h = HF.at(lx, lz);
    d.cylinder(env.mats.hay, { x: h.x, y: GROUND, z: h.z, r: 1.6, rTop: 0.4, h: 1.6, segments: 10 }, { collide: true });
  }
  const tr = HF.at(8, 11);
  d.box('wood_dark', { x: tr.x, y: GROUND + 0.45, z: tr.z, sx: 4, sy: 0.9, sz: 1.2, yaw: HF.yaw }, { collide: true });
  // Prison block: cells down both sides of the corridor, stone doors with slits, a bench inside each.
  const P = ROOMS.prison;
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const z0 = P.z0 + 1.2 + i * 4.6, z1 = z0 + 4.0;
      const wallX = sx * 2.2;
      const front = (a: number, e: number) => {
        const p0 = HF.at(wallX, a), p1 = HF.at(wallX, e);
        d.box(bm.cave, { x: (p0.x + p1.x) / 2, y: GROUND + 1.6, z: (p0.z + p1.z) / 2, sx: 0.5, sy: 3.2, sz: Math.hypot(p1.x - p0.x, p1.z - p0.z), yaw: HF.yaw }, { collide: true });
      };
      front(z0, z0 + 1.0);
      front(z1 - 1.0, z1);
      const dr = HF.at(wallX, (z0 + z1) / 2);
      d.box('stone_grey', { x: dr.x, y: GROUND + 1.25, z: dr.z, sx: 0.32, sy: 2.5, sz: 2.0, yaw: HF.yaw }, { collide: true });
      d.box('black_lacquer', { x: dr.x + Math.cos(HF.yaw) * sx * -0.17, y: GROUND + 1.9, z: dr.z - Math.sin(HF.yaw) * sx * -0.17, sx: 0.04, sy: 0.12, sz: 0.9, yaw: HF.yaw });
      const sep = HF.at(sx * 4.1, z1 + 0.3);
      d.box(bm.cave, { x: sep.x, y: GROUND + 1.6, z: sep.z, sx: 3.8, sy: 3.2, sz: 0.5, yaw: HF.yaw }, { collide: true });
      const bench = HF.at(sx * 5.2, (z0 + z1) / 2);
      d.box('stone_grey', { x: bench.x, y: GROUND + 0.25, z: bench.z, sx: 1.0, sy: 0.5, sz: 2.4, yaw: HF.yaw }, { collide: true, walkable: true });
    }
  }
  // Training hall: pillars, rock targets, a sparring circle, emblems.
  const T = ROOMS.training;
  const tc = HF.at((T.x0 + T.x1) / 2, (T.z0 + T.z1) / 2);
  d.cylinder('stone_grey', { x: tc.x, y: GROUND, z: tc.z, r: 4.2, h: 0.1, segments: 32 });
  for (const [lx, lz] of [[18.5, -3.5], [23.8, -3.5], [18.5, 9.5], [23.8, 9.5]]) {
    const p = HF.at(lx, lz);
    d.cylinder(bm.cave, { x: p.x, y: GROUND, z: p.z, r: 0.55, h: T.h, segments: 10 }, { collide: true });
  }
  for (let i = 0; i < 4; i++) {
    const p = HF.at(T.x1 - 1.2, T.z0 + 3 + i * 4);
    d.box('stone_tan', { x: p.x, y: GROUND + 0.8, z: p.z, sx: 1.0, sy: 1.6, sz: 1.0, yaw: HF.yaw + i }, { collide: true });
  }
  const me = HF.at(T.x1 - 0.42, (T.z0 + T.z1) / 2);
  medallion(d, bm, me.x, GROUND + 4.2, me.z, HF.yaw - Math.PI / 2, 1.2, 0.2);
  // Brainwashing chamber: rows of stone chairs facing the spinning lantern on its plinth.
  const W = ROOMS.brainwash;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const lx = W.x1 - 2.8 - row * 2.4, lz = W.z0 + 2.2 + col * 3.0;
      const p = HF.at(lx, lz);
      d.box('stone_grey', { x: p.x, y: GROUND + 0.25, z: p.z, sx: 0.9, sy: 0.5, sz: 0.9, yaw: HF.yaw }, { collide: true, walkable: true });
      const back = HF.at(lx + 0.4, lz);
      d.box('stone_grey', { x: back.x, y: GROUND + 0.85, z: back.z, sx: 0.16, sy: 1.2, sz: 0.9, yaw: HF.yaw });
      const band = HF.at(lx + 0.05, lz);
      d.box('iron', { x: band.x, y: GROUND + 0.62, z: band.z, sx: 0.7, sy: 0.06, sz: 0.95, yaw: HF.yaw });
    }
  }
  const ln = HF.at(-24.4, 4);
  d.cylinder(bm.cave, { x: ln.x, y: GROUND, z: ln.z, r: 0.7, h: 1.4, segments: 10 }, { collide: true });
  const sg = HF.at(W.x0 + 0.42, 4);
  sign(d, bm, '靜心', sg.x, GROUND + 4.3, sg.z, HF.yaw + Math.PI / 2, 0.8, { vertical: false, bg: '#14261c', fg: '#7dffb0', border: '#3c6a4a' });
  // Walking graph inside (Dai Li patrol routes).
  const T2 = NavTag.patrol | NavTag.farm;
  nav.street([HF.at(0, DOOR_Z - 1.5), HF.at(0, ROOMS.ante.z1), HF.at(0, ROOMS.ante.z0 - 1), HF.at(0, 4), HF.at(0, ROOMS.cavern.z0 - 1), HF.at(0, P.z0 + 2)], T2 | NavTag.street, 6, 3);
  nav.street([HF.at(-10, 4), HF.at(ROOMS.westHall.x0 - 1, 4), HF.at(-21, 4)], T2 | NavTag.street, 6, 3);
  nav.street([HF.at(10, 4), HF.at(ROOMS.eastHall.x1 + 1, 4), HF.at(22, 3)], T2 | NavTag.street, 6, 3);
  nav.join(HF.at(0, 4).x, HF.at(0, 4).z, 11);
  // Night patrol along the east and south shore, from the stepping stones round to the pier.
  const shoreLoop: P2[] = [L.path.a];
  for (const deg of [5, 30, 60, 95, 130, 160]) shoreLoop.push({ x: LAKE.x + Math.cos((deg * Math.PI) / 180) * 57, z: LAKE.z + Math.sin((deg * Math.PI) / 180) * 57 });
  shoreLoop.push({ x: BSS.lakeDock.a.x - 6, z: BSS.lakeDock.a.z });
  nav.street(shoreLoop, T2 | NavTag.water | NavTag.street, 8, 4);
  site.mark('laogai_base', HF.at(0, 4).x, GROUND, HF.at(0, 4).z);
}

// ---------------------------------------------------------------------------
// Runtime: stepping stones, the concealed door, the lantern, the light inside
// ---------------------------------------------------------------------------

export class LaogaiRuntime {
  readonly group = new THREE.Group();
  private readonly stones: Array<{ mesh: THREE.Mesh; x: number; z: number; col: number }> = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly door: THREE.Mesh;
  private readonly lantern: THREE.Group;
  private readonly rubble: THREE.Group;
  private ctx: GameContext | null = null;
  private doorCol = 0;
  /** 0 = sunk, 1 = raised. */
  private rise = 0;
  private riseTarget = 0;
  /** 0 = shut, 1 = slid aside. */
  private open = 0;
  private openTarget = 0;
  private raided = false;
  private inside = 0;
  private offKilled: (() => void) | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly green = new THREE.Color('#123526');

  constructor(parent: THREE.Group, private readonly bm: BssMats, private readonly info: LaogaiBuild) {
    this.group.name = 'laogai_runtime';
    parent.add(this.group);
    const sg = new THREE.BoxGeometry(1.5, 1.2, 1.5);
    this.geos.push(sg);
    for (const s of info.stones) {
      const m = new THREE.Mesh(sg, bm.slab);
      m.position.set(s.x, 0, s.z);
      m.rotation.y = s.yaw;
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
      this.stones.push({ mesh: m, x: s.x, z: s.z, col: 0 });
    }
    // The concealed door is a rough boulder plugging the crevice (a flat slab read as a box from the shore).
    const dg = rockGeo(4242, TUN.hw + 0.9, TUN.h / 2 + 0.6, 0.9, 2);
    this.geos.push(dg);
    this.door = new THREE.Mesh(dg, bm.rock);
    this.door.castShadow = true;
    this.group.add(this.door);
    // Rubble shown once the base has been raided.
    this.rubble = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const g = rockGeo(60 + i, 0.5 + hash01(i, 951) * 0.5, 0.35 + hash01(i, 952) * 0.3, 0.5 + hash01(i, 953) * 0.4);
      this.geos.push(g);
      const m = new THREE.Mesh(g, bm.rock);
      const p = info.doorFrame.at((hash01(i, 954) - 0.5) * 4.4, 0.8 + hash01(i, 955) * 2.4);
      m.position.set(p.x, WATER_Y + 0.55, p.z);
      m.rotation.set(hash01(i, 956), hash01(i, 957) * 3, 0);
      this.rubble.add(m);
    }
    this.rubble.visible = false;
    this.group.add(this.rubble);
    // The spinning lantern: a glowing core inside a cage of dark slats.
    this.lantern = new THREE.Group();
    const core = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12);
    this.geos.push(core);
    const coreMat = new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffd27a', emissiveIntensity: 2.2 });
    this.lantern.add(new THREE.Mesh(core, coreMat));
    const slat = new THREE.BoxGeometry(0.1, 1.2, 0.22);
    this.geos.push(slat);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(slat, bm.slab);
      const a = (i / 6) * Math.PI * 2;
      m.position.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      m.rotation.y = -a;
      this.lantern.add(m);
    }
    this.lantern.position.set(info.lantern.x, GROUND + 2.1, info.lantern.z);
    this.ownMat = coreMat;
    this.group.add(this.lantern);
    this.placeStones();
    this.placeDoor();
  }

  private readonly ownMat: THREE.Material;

  get state(): { rise: number; open: number; raided: boolean; inside: boolean } {
    return { rise: +this.rise.toFixed(2), open: +this.open.toFixed(2), raided: this.raided, inside: this.inside > 0.5 };
  }

  onSessionStart(ctx: GameContext): void {
    this.ctx = ctx;
    this.raided = ctx.quests.hasFlag('laogai_raided');
    if (this.raided) this.rise = this.riseTarget = this.open = this.openTarget = 1;
    for (const s of this.stones) {
      s.col = ctx.world.collision.add({ shape: 'box', x: s.x, y: this.stoneY() - 0.6, z: s.z, hx: 0.75, hy: 0.6, hz: 0.75, yaw: 0, solid: true, walkable: true, tag: 'ba_sing_se' }, true);
    }
    const f = this.info.doorFrame;
    this.doorCol = ctx.world.collision.add({ shape: 'box', x: f.x, y: GROUND + TUN.h / 2, z: f.z, hx: TUN.hw + 0.1, hy: TUN.h / 2, hz: 0.4, yaw: f.yaw, solid: true, walkable: false, tag: 'ba_sing_se' }, true);
    this.placeStones();
    this.placeDoor();
    const start = new THREE.Vector3(this.info.pathStart.x, GROUND + 1, this.info.pathStart.z);
    const landing = new THREE.Vector3(this.info.landing.x, WATER_Y + 1, this.info.landing.z);
    ctx.interactions.register({
      id: 'bss_laogai_path',
      position: start,
      radius: 3.2,
      label: 'Bend the hidden stepping stones up',
      priority: 2,
      enabled: () => this.riseTarget < 1,
      interact: () => this.raise(),
    });
    ctx.interactions.register({
      id: 'bss_laogai_door',
      position: landing,
      radius: 2.8,
      label: 'Slide the concealed stone door open',
      priority: 2,
      enabled: () => this.openTarget < 1 && this.rise > 0.9,
      interact: () => this.openDoor(),
    });
    this.offKilled = ctx.events.on('entity:killed', (e) => {
      if (!e.tags.includes('boss_dai_li_captain') || this.raided) return;
      ctx.quests.setFlag('laogai_raided');
      this.raided = true;
      this.riseTarget = 1;
      this.openTarget = 1;
      ctx.ui.notify('The Dai Li post has fallen — the way into Lake Laogai lies open.', 'success', 4);
    });
  }

  onSessionEnd(): void {
    const ctx = this.ctx;
    if (ctx) {
      for (const s of this.stones) if (s.col) ctx.world.collision.remove(s.col);
      if (this.doorCol) ctx.world.collision.remove(this.doorCol);
      ctx.interactions.unregister?.('bss_laogai_path');
      ctx.interactions.unregister?.('bss_laogai_door');
    }
    for (const s of this.stones) s.col = 0;
    this.doorCol = 0;
    this.offKilled?.();
    this.offKilled = null;
    this.ctx = null;
  }

  /** Set the path and door directly (tests): no sound, no particles. */
  setState(rise: number, open: number): void {
    this.rise = this.riseTarget = rise;
    this.open = this.openTarget = open;
    this.placeStones();
    this.placeDoor();
  }

  raise(): void {
    if (this.riseTarget >= 1 || !this.ctx) return;
    this.riseTarget = 1;
    this.ctx.audio.play('bend_earth_rise', { position: new THREE.Vector3(this.info.pathStart.x, WATER_Y, this.info.pathStart.z), volume: 0.9, pitch: 0.8 });
    this.ctx.events.emit('camera:shake', { intensity: 0.08, duration: 0.6 });
  }

  openDoor(): void {
    if (this.openTarget >= 1 || !this.ctx) return;
    this.openTarget = 1;
    const f = this.info.doorFrame;
    this.ctx.audio.play('bend_earth_sink', { position: new THREE.Vector3(f.x, GROUND + 1.5, f.z), volume: 0.9, pitch: 0.6 });
    this.ctx.events.emit('camera:shake', { intensity: 0.06, duration: 0.6 });
  }

  /** Top of the stepping stones: well under water when sunk, a hand above it when raised. */
  private stoneY(): number {
    const k = this.rise * this.rise * (3 - 2 * this.rise);
    return WATER_Y - 0.9 + k * 1.25;
  }

  private placeStones(): void {
    const top = this.stoneY();
    for (let i = 0; i < this.stones.length; i++) {
      const s = this.stones[i];
      // Each stone lags a little behind the one before it.
      const lag = Math.max(0, Math.min(1, this.rise * 1.6 - (i / this.stones.length) * 0.6));
      const k = lag * lag * (3 - 2 * lag);
      const y = WATER_Y - 0.9 + k * 1.25;
      s.mesh.position.y = y - 0.6;
      if (this.ctx && s.col) this.ctx.world.collision.update(s.col, { y: y - 0.6 });
    }
    void top;
  }

  private placeDoor(): void {
    const f = this.info.doorFrame;
    const k = this.open * this.open * (3 - 2 * this.open);
    const p = f.at(-k * (TUN.hw * 2 + 1.8), -0.05);
    this.door.position.set(p.x, GROUND + TUN.h / 2 + 0.05, p.z);
    this.door.rotation.y = f.yaw;
    this.door.visible = !this.raided;
    this.rubble.visible = this.raided;
    if (this.ctx && this.doorCol) {
      const c = f.at(this.raided ? -40 : -k * (TUN.hw * 2 + 0.6), 0);
      this.ctx.world.collision.update(this.doorCol, { x: c.x, z: c.z, y: this.raided || k > 0.97 ? -50 : GROUND + TUN.h / 2 });
    }
  }

  update(dt: number, ctx: GameContext, full: boolean): void {
    const cam = ctx.camera?.position;
    if (cam) this.group.visible = (cam.x - L.hill.x) ** 2 + (cam.z - L.hill.z) ** 2 < 300 * 300;
    if (this.rise !== this.riseTarget) {
      this.rise = Math.min(1, this.rise + dt * 0.45);
      this.placeStones();
      if (full && Math.random() < dt * 14) {
        const s = this.stones[Math.floor(Math.random() * this.stones.length)];
        ctx.vfx.burst('splash', this.tmp.set(s.x, WATER_Y + 0.1, s.z), { count: 5, radius: 0.7, size: 0.9 });
      }
    }
    if (this.open !== this.openTarget) {
      this.open = Math.min(1, this.open + dt * 0.5);
      this.placeDoor();
      if (full && Math.random() < dt * 10) {
        const p = this.info.doorFrame.at((Math.random() - 0.5) * 3, 0.6);
        ctx.vfx.burst('dust', this.tmp.set(p.x, GROUND + 0.4, p.z), { count: 4, radius: 0.8, size: 1.3 });
      }
    }
    this.lantern.rotation.y += dt * 1.6;
    // Cold, dim, green light while the player is inside (Sky has already set this frame's lights and fog).
    const pl = ctx.player?.position;
    const want = pl && insideLaogai(pl.x, pl.z, pl.y) ? 1 : 0;
    this.inside += (want - this.inside) * Math.min(1, dt * 2.5);
    if (this.inside > 0.01) {
      const k = this.inside;
      const r = ctx.render;
      r.sun.intensity *= 1 - 0.85 * k;
      r.hemi.intensity = THREE.MathUtils.lerp(r.hemi.intensity, 1.35, k);
      r.hemi.color.lerp(this.tmpColor.set('#9fe6bf'), 0.7 * k);
      r.hemi.groundColor.lerp(this.tmpColor.set('#4f8a68'), 0.75 * k);
      const fog = r.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.lerp(this.green, k);
        fog.near = THREE.MathUtils.lerp(fog.near, 2, k);
        fog.far = THREE.MathUtils.lerp(fog.far, 58, k);
      }
    }
  }

  private readonly tmpColor = new THREE.Color();

  dispose(): void {
    this.onSessionEnd();
    for (const g of this.geos) g.dispose();
    this.geos.length = 0;
    this.ownMat.dispose();
    this.group.removeFromParent();
    this.group.clear();
    void this.bm;
  }
}
