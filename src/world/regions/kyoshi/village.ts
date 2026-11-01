import * as THREE from 'three';
import { heightAt } from '../../Heightfield';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import type { BuildEnv } from '../earth/env';
import { barrel, fence, house, laundry, off, type Mat } from './kit';

/**
 * Suki's village (image 1): at the entrance, the carved and painted Avatar Kyoshi on a very tall
 * round pillar; a pale dirt street climbing between two rows of dark gabled plank houses to the
 * A-frame Meeting Hall where the elders sit; fences, rice paddies and vegetable terraces either
 * side, communal kitchens, a little market, wells and laundry lines.
 */

export interface VillageOut {
  /** Named anchors. */
  marks: Record<string, { x: number; y: number; z: number }>;
  /** Doors / stalls / kitchens the villagers use (for the crowd). */
  doors: Array<{ x: number; z: number; yaw: number }>;
  stalls: Array<{ x: number; z: number; yaw: number }>;
  kitchens: Array<{ x: number; z: number }>;
  fields: Array<{ x: number; z: number; yaw: number; w: number; d: number }>;
  wells: P2[];
  /** Lanterns lit at dusk. */
  lanterns: THREE.Vector3[];
  /** Painted textures / materials to dispose. */
  owned: Array<THREE.Material | THREE.Texture>;
}

const H = (x: number, z: number) => heightAt(x, z);
const V = KI.village;
/** Street frame: forward = up the street (outward from the bay). */
export const STREET_YAW = yawOutward(V.u);
const gate = A(V.u, V.gateR);

/** Point in the street frame: `s` metres up the street from the entrance, `lat` to the right. */
export function streetPt(s: number, lat: number): P2 {
  return off(gate, STREET_YAW, lat, s);
}

/** Fan face with 京 or 士 brushed in red-brown on gold (no fonts: drawn as strokes). */
function fanTexture(ch: '京' | '士'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, '#f3d27a');
  grd.addColorStop(1, '#c9971f');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#7a2a12';
  g.lineCap = 'round';
  g.lineWidth = 7;
  const L = (x0: number, y0: number, x1: number, y1: number) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  };
  if (ch === '京') {
    L(64, 14, 66, 26); // dot
    L(30, 32, 98, 32); // long horizontal
    g.strokeRect(44, 44, 40, 24); // 口
    L(64, 72, 64, 112); // vertical
    L(64, 112, 56, 106); // hook
    L(44, 86, 34, 104); // left dot
    L(84, 86, 94, 104); // right dot
  } else {
    L(26, 46, 102, 46); // long top horizontal
    L(64, 18, 64, 102); // vertical
    L(42, 102, 86, 102); // shorter bottom
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A half-open war fan (semicircle) facing local +Z, pivot at the origin. */
function fanGeometry(r: number): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 16, Math.PI * 0.08, Math.PI * 0.84);
  return g;
}

/**
 * The Avatar Kyoshi statue: a carved and painted wooden figure (green robes, gold fans bearing
 * 京 and 士, gold headdress, white face) on a very tall round wooden pillar.
 */
function statue(env: BuildEnv, at: P2, out: VillageOut): void {
  const b = env.chunks.at('major', at.x, at.z).builder;
  const y0 = H(at.x, at.z);
  const yaw = STREET_YAW + Math.PI; // faces the arriving road / the bay
  // Stone base and the tall pillar with carved rings.
  b.cylinder('stone_grey', { x: at.x, y: y0 - 0.4, z: at.z, r: 1.7, rTop: 1.5, h: 1.2, segments: 16 }, { collide: true, solid: true });
  const PH = 15;
  b.cylinder('wood_dark', { x: at.x, y: y0 + 0.8, z: at.z, r: 0.95, rTop: 0.85, h: PH, segments: 18 }, { collide: true, solid: true });
  for (const k of [0.12, 0.45, 0.78, 0.97]) b.cylinder('wood', { x: at.x, y: y0 + 0.8 + PH * k, z: at.z, r: 1.02, h: 0.28, segments: 18 });
  const top = y0 + 0.8 + PH;
  b.cylinder('wood', { x: at.x, y: top, z: at.z, r: 1.35, rTop: 1.2, h: 0.35, segments: 18 });
  // Figure (~3.6 m): flared green robe, sash, torso, white face, gold headdress.
  const fy = top + 0.35;
  b.cylinder('cloth_green', { x: at.x, y: fy, z: at.z, r: 1.15, rTop: 0.62, h: 1.9, segments: 16 });
  b.cylinder('roof_green', { x: at.x, y: fy + 0.05, z: at.z, r: 1.18, rTop: 1.05, h: 0.35, segments: 16 });
  b.cylinder('gold', { x: at.x, y: fy + 1.75, z: at.z, r: 0.64, h: 0.22, segments: 16 });
  b.cylinder('cloth_green', { x: at.x, y: fy + 1.95, z: at.z, r: 0.6, rTop: 0.5, h: 0.95, segments: 14 });
  b.box('stone_dark', { x: at.x, y: fy + 2.45, z: at.z, sx: 1.25, sy: 0.38, sz: 0.62, yaw }); // shoulder armour
  const head = new THREE.SphereGeometry(0.34, 14, 10);
  b.mesh('plaster_white', head, { x: at.x, y: fy + 3.18, z: at.z });
  head.dispose();
  const hair = new THREE.SphereGeometry(0.36, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const hb = off(at, yaw, 0, -0.04);
  b.mesh('stone_dark', hair, { x: hb.x, y: fy + 3.22, z: hb.z });
  hair.dispose();
  // Red eye make-up band and the gold headdress (crown band + tall front plate + side ornaments).
  const eb = off(at, yaw, 0, 0.27);
  b.box('cloth_red', { x: eb.x, y: fy + 3.22, z: eb.z, sx: 0.5, sy: 0.09, sz: 0.06, yaw }, { castShadow: false });
  b.cylinder('gold', { x: at.x, y: fy + 3.36, z: at.z, r: 0.37, h: 0.12, segments: 16 });
  const fp = off(at, yaw, 0, 0.3);
  b.box('gold', { x: fp.x, y: fy + 3.62, z: fp.z, sx: 0.36, sy: 0.46, sz: 0.06, yaw });
  for (const s of [-1, 1]) {
    const q = off(at, yaw, s * 0.38, 0.06);
    b.box('gold', { x: q.x, y: fy + 3.46, z: q.z, sx: 0.08, sy: 0.32, sz: 0.22, yaw });
  }
  // Arms with the two open fans (京 raised high, 士 held out), painted on both faces.
  const fans: Array<{ ch: '京' | '士'; right: number; up: number; fwd: number; tilt: number }> = [
    { ch: '京', right: 1.0, up: 3.55, fwd: 0.25, tilt: 0.25 },
    { ch: '士', right: -1.05, up: 2.35, fwd: 0.55, tilt: -0.15 },
  ];
  for (const f of fans) {
    const sh = off(at, yaw, Math.sign(f.right) * 0.6, 0);
    const hand = off(at, yaw, f.right, f.fwd);
    const len = Math.hypot(hand.x - sh.x, hand.z - sh.z, f.up - 2.55);
    const arm = new THREE.CylinderGeometry(0.15, 0.17, len, 8);
    arm.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(hand.x - sh.x, f.up - 2.55, hand.z - sh.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arm.applyQuaternion(q);
    b.mesh('cloth_green', arm, { x: sh.x, y: fy + 2.55, z: sh.z });
    arm.dispose();
    const tex = fanTexture(f.ch);
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.45, roughness: 0.45, side: THREE.DoubleSide });
    mat.name = 'gold_fan';
    out.owned.push(mat, tex);
    const fan = fanGeometry(0.85);
    b.mesh(mat, fan, { x: hand.x, y: fy + f.up, z: hand.z, yaw, roll: f.tilt });
    fan.dispose();
  }
  out.marks.statue = { x: at.x, y: y0, z: at.z };
  out.marks.statue_top = { x: at.x, y: fy + 3.6, z: at.z };
}

/** The Meeting Hall: a large A-frame — a steep thatched roof almost to the ground over low walls. */
function meetingHall(env: BuildEnv, out: VillageOut): void {
  const c = A(V.u, V.hallR + 2);
  const b = env.chunks.at('major', c.x, c.z).builder;
  const y = H(c.x, c.z);
  const yaw = STREET_YAW + Math.PI; // its gable front looks down the street
  const W = 15, D = 21, wallH = 1.8, roofH = 11;
  b.box('stone_grey', { x: c.x, y: y + 0.25, z: c.z, sx: W + 1.2, sy: 0.5, sz: D + 1.2, yaw }, { collide: true, walkable: true, solid: true });
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * W / 2, 0);
    b.box('wood_dark', { x: q.x, y: y + 0.5 + wallH / 2, z: q.z, sx: 0.3, sy: wallH, sz: D, yaw });
  }
  const backW = off(c, yaw, 0, -D / 2);
  b.box('wood_dark', { x: backW.x, y: y + 0.5 + wallH / 2, z: backW.z, sx: W, sy: wallH, sz: 0.3, yaw });
  // The A-frame: ridge along the hall's length; thatch, with timber gable fronts.
  b.roof(env.mats.hay, { x: c.x, y: y + 0.5 + wallH, z: c.z, w: D, d: W, height: roofH, yaw: yaw + Math.PI / 2, overhang: 0.9, curve: 0.05, style: 'gable', ridge: 'wood_dark' });
  for (const f of [-1, 1]) {
    const q = off(c, yaw, 0, f * (D / 2));
    const sh = new THREE.Shape();
    sh.moveTo(-W / 2, 0);
    sh.lineTo(W / 2, 0);
    sh.lineTo(0, roofH);
    sh.closePath();
    if (f > 0) {
      // Front gable: open doorway framed by heavy timbers.
      const hole = new THREE.Path();
      hole.moveTo(-1.8, 0);
      hole.lineTo(1.8, 0);
      hole.lineTo(1.8, 3.4);
      hole.lineTo(-1.8, 3.4);
      hole.closePath();
      sh.holes.push(hole);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false });
    g.translate(0, 0, -0.15);
    b.mesh('wood', g, { x: q.x, y: y + 0.5 + wallH, z: q.z, yaw });
    g.dispose();
  }
  // Big frame timbers on the front, steps, and the dark interior behind the door.
  const front = off(c, yaw, 0, D / 2 + 0.25);
  for (const s of [-1, 1]) {
    const q = off(front, yaw, s * 2.0, 0);
    b.box('wood_dark', { x: q.x, y: y + 0.5 + (wallH + 3.6) / 2, z: q.z, sx: 0.4, sy: wallH + 3.6, sz: 0.4, yaw });
  }
  b.box('wood_dark', { x: front.x, y: y + 0.5 + wallH + 3.55, z: front.z, sx: 4.6, sy: 0.4, sz: 0.45, yaw });
  const inner = off(c, yaw, 0, D / 2 - 0.6);
  b.box('stone_dark', { x: inner.x, y: y + 0.5 + 2.2, z: inner.z, sx: 3.6, sy: 4.4, sz: 0.2, yaw }, { castShadow: false });
  const st0 = off(c, yaw, 0, D / 2 + 2.6), st1 = off(c, yaw, 0, D / 2 + 0.6);
  b.stairs({ from: new THREE.Vector3(st0.x, y - 0.05, st0.z), to: new THREE.Vector3(st1.x, y + 0.5, st1.z), width: 4.4, material: 'stone_grey' });
  b.collider({ shape: 'box', x: c.x, y: y + 0.5 + (wallH + roofH * 0.5) / 2, z: c.z, hx: W / 2 + 0.4, hy: (wallH + roofH * 0.5) / 2, hz: D / 2, yaw, walkable: true, solid: true, surface: 'wood' });
  // Lanterns either side of the door.
  for (const s of [-1, 1]) {
    const q = off(front, yaw, s * 3.4, 1.2);
    out.lanterns.push(new THREE.Vector3(q.x, y + 2.9, q.z));
    b.lantern(new THREE.Vector3(q.x, y + 2.9, q.z), { color: 'warm', post: true });
  }
  out.marks.meeting_hall = { x: front.x, y, z: front.z };
}

/** Rice paddies / vegetable plots: flat beds terraced into the slope with earth bunds. */
function field(env: BuildEnv, c: P2, yaw: number, w: number, d: number, kind: 'paddy' | 'veg', out: VillageOut): void {
  const b = env.chunks.at('props', c.x, c.z).builder;
  let maxY = -Infinity, minY = Infinity;
  for (const r of [-1, 0, 1]) for (const f of [-1, 0, 1]) {
    const q = off(c, yaw, (r * w) / 2, (f * d) / 2);
    const h = H(q.x, q.z);
    maxY = Math.max(maxY, h);
    minY = Math.min(minY, h);
  }
  const top = maxY + 0.12;
  const bank = top - minY + 0.4;
  // Earth body (terrace wall on the downhill side shows as the bund).
  const mats = env.mats;
  b.box(mats.groundDirt, { x: c.x, y: top - bank / 2, z: c.z, sx: w + 0.8, sy: bank, sz: d + 0.8, yaw }, { collide: true, walkable: true, solid: true, surface: 'mud' });
  if (kind === 'paddy') {
    const water = new THREE.PlaneGeometry(w, d);
    water.rotateX(-Math.PI / 2);
    b.mesh(mats.paddy, water, { x: c.x, y: top + 0.03, z: c.z, yaw });
    water.dispose();
    // Rice clumps in rows.
    const clump = new THREE.ConeGeometry(0.16, 0.55, 5);
    for (let i = 0; i < Math.floor(w / 0.9); i++) for (let j = 0; j < Math.floor(d / 0.9); j++) {
      if ((i + j) % 2) continue;
      const q = off(c, yaw, -w / 2 + 0.45 + i * 0.9, -d / 2 + 0.45 + j * 0.9);
      b.mesh(mats.crops[0], clump, { x: q.x, y: top + 0.28, z: q.z });
    }
    clump.dispose();
  } else {
    const soil = new THREE.PlaneGeometry(w, d);
    soil.rotateX(-Math.PI / 2);
    b.mesh(mats.groundDirt, soil, { x: c.x, y: top + 0.02, z: c.z, yaw });
    soil.dispose();
    const plant = new THREE.SphereGeometry(0.28, 6, 4);
    plant.scale(1, 0.7, 1);
    for (let i = 0; i < Math.floor(d / 1.1); i++) {
      for (let k = 0; k < Math.floor(w / 0.8); k++) {
        const q = off(c, yaw, -w / 2 + 0.4 + k * 0.8, -d / 2 + 0.55 + i * 1.1);
        b.mesh(mats.crops[(i % (mats.crops.length - 1)) + 1] ?? mats.crops[0], plant, { x: q.x, y: top + 0.2, z: q.z });
      }
    }
    plant.dispose();
  }
  out.fields.push({ x: c.x, z: c.z, yaw, w, d });
}

/** A market stall with a cloth awning and baskets of produce. */
function stall(env: BuildEnv, c: P2, yaw: number, out: VillageOut, k: number): void {
  const b = env.chunks.at('props', c.x, c.z).builder;
  const y = H(c.x, c.z);
  b.box('wood', { x: c.x, y: y + 0.45, z: c.z, sx: 2.6, sy: 0.9, sz: 1.1, yaw }, { collide: true, solid: true });
  for (const r of [-1, 1]) for (const f of [-1, 1]) {
    const q = off(c, yaw, r * 1.25, f * 0.5);
    b.box('wood_dark', { x: q.x, y: y + 1.2, z: q.z, sx: 0.08, sy: 2.4, sz: 0.08, yaw });
  }
  const awn = off(c, yaw, 0, 0.25);
  b.box(k % 2 ? 'cloth_blue' : 'cloth_white', { x: awn.x, y: y + 2.42, z: awn.z, sx: 3.0, sy: 0.05, sz: 1.9, yaw, pitch: 0.2 }, { castShadow: false });
  // Produce: cucumbers, eggplant, taro, apples, scallions, daikon.
  const goods: Array<{ mat: Mat; g: () => THREE.BufferGeometry }> = [
    { mat: 'cloth_green', g: () => new THREE.CylinderGeometry(0.035, 0.035, 0.24, 6).rotateZ(Math.PI / 2) },
    { mat: 'roof_blue', g: () => new THREE.SphereGeometry(0.06, 6, 4).scale(1, 1.6, 1) },
    { mat: 'wood', g: () => new THREE.SphereGeometry(0.07, 6, 4) },
    { mat: 'cloth_red', g: () => new THREE.SphereGeometry(0.055, 6, 4) },
    { mat: 'jade', g: () => new THREE.CylinderGeometry(0.015, 0.02, 0.32, 4) },
    { mat: 'plaster_white', g: () => new THREE.ConeGeometry(0.05, 0.36, 6).rotateX(Math.PI / 2) },
  ];
  for (let i = 0; i < 3; i++) {
    const basket = off(c, yaw, -0.85 + i * 0.85, 0.12);
    b.cylinder('wood', { x: basket.x, y: y + 0.9, z: basket.z, r: 0.33, rTop: 0.38, h: 0.16, segments: 10 });
    const good = goods[(k * 3 + i) % goods.length];
    const g = good.g();
    for (let n = 0; n < 7; n++) {
      const a = n * 2.4, r = 0.12 + (n % 3) * 0.06;
      b.mesh(good.mat, g, { x: basket.x + Math.cos(a) * r, y: y + 1.1 + (n % 2) * 0.05, z: basket.z + Math.sin(a) * r, yaw: a });
    }
    g.dispose();
  }
  out.stalls.push({ x: c.x, z: c.z, yaw });
}

/** Communal kitchen: an open shed with a hearth, steaming pots and long tables. */
function kitchen(env: BuildEnv, c: P2, yaw: number, out: VillageOut): void {
  const b = env.chunks.at('props', c.x, c.z).builder;
  const y = H(c.x, c.z);
  b.box('stone_grey', { x: c.x, y: y + 0.1, z: c.z, sx: 7.4, sy: 0.2, sz: 5.4, yaw }, { collide: true, walkable: true, solid: true });
  for (const r of [-1, 1]) for (const f of [-1, 1]) {
    const q = off(c, yaw, r * 3.4, f * 2.4);
    b.box('wood_dark', { x: q.x, y: y + 1.5, z: q.z, sx: 0.22, sy: 3.0, sz: 0.22, yaw }, { collide: true, solid: true });
  }
  b.roof('roof_dark', { x: c.x, y: y + 3.0, z: c.z, w: 7.2, d: 5.2, height: 1.7, yaw, overhang: 0.6, curve: 0.2, style: 'gable', ridge: 'wood_dark' });
  const hearth = off(c, yaw, -1.6, -0.6);
  b.cylinder('stone_dark', { x: hearth.x, y: y + 0.2, z: hearth.z, r: 0.9, rTop: 0.8, h: 0.55, segments: 12 }, { collide: true, solid: true });
  b.cylinder('iron', { x: hearth.x, y: y + 0.75, z: hearth.z, r: 0.55, rTop: 0.62, h: 0.5, segments: 12 });
  for (const s of [0.8, 2.2]) {
    const t = off(c, yaw, s, 0.4);
    b.box('wood', { x: t.x, y: y + 0.95, z: t.z, sx: 1.0, sy: 0.1, sz: 3.6, yaw }, { collide: true, solid: true });
  }
  out.kitchens.push({ x: hearth.x, z: hearth.z });
}

function well(env: BuildEnv, c: P2, out: VillageOut): void {
  const b = env.chunks.at('props', c.x, c.z).builder;
  const y = H(c.x, c.z);
  b.cylinder('stone_grey', { x: c.x, y, z: c.z, r: 0.9, rTop: 0.85, h: 0.85, segments: 14 }, { collide: true, solid: true });
  b.cylinder('stone_dark', { x: c.x, y: y + 0.84, z: c.z, r: 0.7, h: 0.02, segments: 14 });
  for (const s of [-1, 1]) b.box('wood', { x: c.x + s * 0.85, y: y + 1.3, z: c.z, sx: 0.12, sy: 2.6, sz: 0.12 });
  b.box('wood', { x: c.x, y: y + 2.5, z: c.z, sx: 1.9, sy: 0.12, sz: 0.12 });
  b.roof('roof_dark', { x: c.x, y: y + 2.6, z: c.z, w: 1.9, d: 1.4, height: 0.7, overhang: 0.2, curve: 0.1, style: 'gable', ridge: null });
  out.wells.push(c);
}

export function* buildVillage(env: BuildEnv, out: VillageOut): Generator<unknown, void, unknown> {
  const rnd = env.rnd;
  // Entrance plaza: statue on the left of the street as you walk in.
  statue(env, streetPt(-1, -9), out);
  out.marks.village_entrance = { ...streetPt(-6, 0), y: H(streetPt(-6, 0).x, streetPt(-6, 0).z) };
  yield;
  // Two rows of seven houses up the street (fronts to the street), the Meeting Hall at the top.
  const right = { x: -Math.cos(STREET_YAW), z: Math.sin(STREET_YAW) };
  const yawLeftRow = Math.atan2(right.x, right.z); // left-row houses face right (toward the street)
  const yawRightRow = yawLeftRow + Math.PI;
  for (let i = 0; i < 7; i++) {
    for (const side of [-1, 1]) {
      const s = 18 + i * 12.4 + (side > 0 ? 3.5 : 0) + rnd.range(-0.8, 0.8);
      const w = rnd.range(5.4, 6.4), d = rnd.range(5.0, 5.8);
      const c = streetPt(s, side * (4.6 + d / 2 + rnd.range(0, 0.8)));
      const yaw = side < 0 ? yawLeftRow : yawRightRow;
      let gy = Infinity, gmin = Infinity;
      for (const r of [-1, 1]) for (const f of [-1, 1]) {
        const q = off(c, yaw, (r * w) / 2, (f * d) / 2);
        const h = H(q.x, q.z);
        gy = Math.min(gy, h);
        gmin = Math.min(gmin, h);
      }
      const ground = H(c.x, c.z);
      const floor = Math.max(0.5, ground + rnd.range(0.55, 0.9) - ground) + Math.max(0, ground - gy) * 0.5;
      const tiled = rnd.chance(0.35);
      let finish = 0;
      house(env.chunks.at('houses', c.x, c.z).builder, {
        x: c.x,
        z: c.z,
        y: ground,
        minY: gmin,
        yaw,
        w,
        d,
        h: rnd.range(2.5, 2.9),
        floor,
        roofH: rnd.range(2.7, 3.3),
        roof: tiled ? 'roof_dark' : 'wood_dark',
        // Painted plaster on dark timber, or plain boards.
        wall: (finish = rnd.range(0, 1)) < 0.4 ? 'plaster_cream' : finish < 0.7 ? 'wood' : 'wood_dark',
        trim: finish < 0.4 ? 'wood_dark' : 'wood',
        stairs: rnd.chance(0.5) ? 'front' : 'side',
        porch: rnd.chance(0.4),
      });
      out.doors.push({ ...off(c, yaw, 0, d / 2 + 1.6), yaw });
    }
    if (i % 2 === 0) yield;
  }
  meetingHall(env, out);
  yield;
  // Street lanterns and fences along the plots behind the houses.
  for (let s = 10; s <= 98; s += 14) {
    for (const side of [-1, 1]) {
      const q = streetPt(s + (side > 0 ? 7 : 0), side * 3.6);
      const y = H(q.x, q.z);
      env.chunks.at('props', q.x, q.z).builder.lantern(new THREE.Vector3(q.x, y + 2.9, q.z), { color: 'warm', post: true });
      out.lanterns.push(new THREE.Vector3(q.x, y + 2.9, q.z));
    }
  }
  for (const side of [-1, 1]) {
    const pts = [streetPt(14, side * 17), streetPt(50, side * 18), streetPt(96, side * 16)];
    fence(env.chunks.at('props', pts[1].x, pts[1].z).builder, pts, H);
  }
  yield;
  // Rice paddies terraced on the west (left) slope, vegetable plots on the east.
  for (let i = 0; i < 6; i++) {
    for (const lat of [-24, -32]) {
      const c = streetPt(16 + i * 13, lat - (i % 2) * 1.5);
      field(env, c, STREET_YAW, 7, 10.5, 'paddy', out);
    }
    if (i % 2) yield;
  }
  for (let i = 0; i < 5; i++) {
    for (const lat of [23, 30.5]) {
      const c = streetPt(20 + i * 14, lat);
      field(env, c, STREET_YAW, 6, 11, 'veg', out);
    }
  }
  yield;
  // Market at the entrance plaza (east side), communal kitchens either side lower down, wells.
  for (let i = 0; i < 4; i++) stall(env, streetPt(2 + i * 4.2, 8.2), STREET_YAW - Math.PI / 2, out, i);
  kitchen(env, streetPt(24, 13), STREET_YAW - Math.PI / 2, out);
  kitchen(env, streetPt(62, -13.5), STREET_YAW + Math.PI / 2, out);
  well(env, streetPt(8, -5.2), out);
  well(env, streetPt(56, 5.4), out);
  // Barrels, chopping blocks and laundry between the houses.
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const q = streetPt(24 + i * 12.4, side * 12.6);
    const y = H(q.x, q.z);
    barrel(env.chunks.at('detail', q.x, q.z).builder, q.x, y, q.z, 0.9);
    const lq = streetPt(30 + i * 12.4, side * 14.5), lq2 = streetPt(35 + i * 12.4, side * 14.5);
    laundry(env.chunks.at('detail', lq.x, lq.z).builder, lq, lq2, H(lq.x, lq.z));
    const cb = streetPt(21 + i * 12.4, side * 11.4);
    const cy = H(cb.x, cb.z);
    env.chunks.at('detail', cb.x, cb.z).builder.cylinder('wood', { x: cb.x, y: cy, z: cb.z, r: 0.4, h: 0.55, segments: 10 }, { collide: true, solid: true });
  }
  out.marks.street_top = { ...streetPt(98, 0), y: H(streetPt(98, 0).x, streetPt(98, 0).z) };
}
