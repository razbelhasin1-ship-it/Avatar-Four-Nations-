import * as THREE from 'three';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { A, KI, KI_ROADS, yawOutward } from '../../landforms/kyoshiIsland';
import type { P2 } from '../../WorldLayout';
import type { BuildEnv } from '../earth/env';
import { barrel, fence, gableRoof, house, lanternPost, laundry, off, paperWindow, profileWallGeometry, type Mat } from './kit';
import type { KyoshiMats } from './materials';

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
  /** Bench seats at the Meeting Hall (where a seated elder's feet go, facing `yaw`). */
  seats: Array<{ x: number; z: number; y: number; yaw: number }>;
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

/**
 * Paths that cross the village's plots: the dojo path leaves the street between the houses and the
 * coast road passes the entrance plaza. Houses, fences, fields, laundry and stalls keep off them.
 */
const CROSSINGS = KI_ROADS.filter((r) => r.id === 'ki_dojo_path' || r.id === 'ki_coast_road').map((r) => {
  const pts: P2[] = [];
  for (let i = 0; i < r.points.length - 1; i++) {
    const a = r.points[i], c = r.points[i + 1];
    const L = Math.hypot(c.x - a.x, c.z - a.z);
    for (let t = 0; t < L; t += 1) pts.push({ x: a.x + ((c.x - a.x) * t) / L, z: a.z + ((c.z - a.z) * t) / L });
  }
  pts.push(r.points[r.points.length - 1]);
  return { half: r.width / 2, pts };
});

/**
 * True when a footprint (centre, `w` across × `d` along `yaw`, the kit's off() frame) comes within
 * `margin` of the edge of a path crossing the village. w = d = 0 tests a point.
 */
export function onVillagePath(c: P2, yaw: number, w: number, d: number, margin: number): boolean {
  const sn = Math.sin(yaw), cs = Math.cos(yaw);
  for (const r of CROSSINGS) {
    const reach = r.half + margin;
    const far = reach + Math.hypot(w, d) / 2 + 1;
    for (const p of r.pts) {
      const dx = p.x - c.x, dz = p.z - c.z;
      if (Math.abs(dx) > far || Math.abs(dz) > far) continue;
      // off(o, yaw, right, fwd): right runs along (−cos yaw, sin yaw), forward along (sin yaw, cos yaw).
      const right = -dx * cs + dz * sn, fwd = dx * sn + dz * cs;
      const ex = Math.max(0, Math.abs(right) - w / 2), ez = Math.max(0, Math.abs(fwd) - d / 2);
      if (ex * ex + ez * ez < reach * reach) return true;
    }
  }
  return false;
}

/** The runs of a polyline (fence line, washing line) that stay clear of the paths, as polylines. */
function clearRuns(pts: P2[], margin: number): P2[][] {
  const runs: P2[][] = [];
  let cur: P2[] | null = null;
  let last: P2 | null = null;
  const close = () => {
    if (cur && last && cur[cur.length - 1] !== last) cur.push(last);
    if (cur && cur.length > 1) runs.push(cur);
    cur = null;
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], c = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.5));
    for (let k = i === 0 ? 0 : 1; k <= n; k++) {
      const p = k === n ? c : { x: a.x + ((c.x - a.x) * k) / n, z: a.z + ((c.z - a.z) * k) / n };
      if (onVillagePath(p, 0, 0, 0, margin)) {
        close();
        continue;
      }
      if (!cur) cur = [p];
      else if (k === n) cur.push(p);
      last = p;
    }
  }
  close();
  return runs;
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
  // Two-step stone plinth and the tall pillar of pale carved cedar, lacquered red bands with gold rims.
  b.cylinder('stone_grey', { x: at.x, y: y0 - 0.5, z: at.z, r: 2.5, rTop: 2.35, h: 0.85, segments: 20 }, { collide: true, solid: true });
  b.cylinder('stone_light', { x: at.x, y: y0 + 0.35, z: at.z, r: 1.8, rTop: 1.65, h: 0.55, segments: 20 }, { collide: true, solid: true });
  const PH = 15;
  b.cylinder('wood', { x: at.x, y: y0 + 0.9, z: at.z, r: 0.95, rTop: 0.85, h: PH, segments: 18 }, { collide: true, solid: true });
  for (const k of [0.08, 0.4, 0.72, 0.95]) {
    const by = y0 + 0.9 + PH * k;
    b.cylinder('wood_red', { x: at.x, y: by, z: at.z, r: 1.0, h: 0.46, segments: 18 });
    for (const e of [-0.03, 0.46]) b.cylinder('gold', { x: at.x, y: by + e, z: at.z, r: 1.03, h: 0.05, segments: 18 });
  }
  const top = y0 + 0.9 + PH;
  b.cylinder('wood_red', { x: at.x, y: top, z: at.z, r: 1.55, rTop: 1.4, h: 0.4, segments: 18 });
  b.cylinder('gold', { x: at.x, y: top + 0.38, z: at.z, r: 1.42, h: 0.05, segments: 18 });
  // Figure, carved large (it is read from the street far below): flared green robe, sash, torso,
  // white face, gold headdress. S scales the original 3.6 m figure.
  const S = 1.55;
  const fy = top + 0.4;
  b.cylinder('cloth_green', { x: at.x, y: fy, z: at.z, r: 1.15 * S, rTop: 0.62 * S, h: 1.9 * S, segments: 16 });
  b.cylinder('roof_green', { x: at.x, y: fy + 0.05 * S, z: at.z, r: 1.18 * S, rTop: 1.05 * S, h: 0.35 * S, segments: 16 });
  b.cylinder('gold', { x: at.x, y: fy + 1.75 * S, z: at.z, r: 0.64 * S, h: 0.22 * S, segments: 16 });
  b.cylinder('cloth_green', { x: at.x, y: fy + 1.95 * S, z: at.z, r: 0.6 * S, rTop: 0.5 * S, h: 0.95 * S, segments: 14 });
  b.box('stone_dark', { x: at.x, y: fy + 2.45 * S, z: at.z, sx: 1.25 * S, sy: 0.38 * S, sz: 0.62 * S, yaw }); // shoulder armour
  const head = new THREE.SphereGeometry(0.34 * S, 14, 10);
  b.mesh('plaster_white', head, { x: at.x, y: fy + 3.18 * S, z: at.z });
  head.dispose();
  const hair = new THREE.SphereGeometry(0.36 * S, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const hb = off(at, yaw, 0, -0.04 * S);
  b.mesh('stone_dark', hair, { x: hb.x, y: fy + 3.22 * S, z: hb.z });
  hair.dispose();
  // Red eye make-up band and the gold headdress (crown band + tall front plate + side ornaments).
  const eb = off(at, yaw, 0, 0.27 * S);
  b.box('cloth_red', { x: eb.x, y: fy + 3.22 * S, z: eb.z, sx: 0.5 * S, sy: 0.09 * S, sz: 0.06 * S, yaw }, { castShadow: false });
  b.cylinder('gold', { x: at.x, y: fy + 3.36 * S, z: at.z, r: 0.37 * S, h: 0.12 * S, segments: 16 });
  const fp = off(at, yaw, 0, 0.3 * S);
  b.box('gold', { x: fp.x, y: fy + 3.62 * S, z: fp.z, sx: 0.36 * S, sy: 0.46 * S, sz: 0.06 * S, yaw });
  for (const s of [-1, 1]) {
    const q = off(at, yaw, s * 0.38 * S, 0.06 * S);
    b.box('gold', { x: q.x, y: fy + 3.46 * S, z: q.z, sx: 0.08 * S, sy: 0.32 * S, sz: 0.22 * S, yaw });
  }
  // Arms with the two open fans (京 raised high, 士 held out), painted on both faces.
  const fans: Array<{ ch: '京' | '士'; right: number; up: number; fwd: number; tilt: number }> = [
    { ch: '京', right: 1.0, up: 3.55, fwd: 0.25, tilt: 0.25 },
    { ch: '士', right: -1.05, up: 2.35, fwd: 0.55, tilt: -0.15 },
  ];
  for (const f of fans) {
    const sh = off(at, yaw, Math.sign(f.right) * 0.6 * S, 0);
    const hand = off(at, yaw, f.right * S, f.fwd * S);
    const len = Math.hypot(hand.x - sh.x, hand.z - sh.z, (f.up - 2.55) * S);
    const arm = new THREE.CylinderGeometry(0.15 * S, 0.17 * S, len, 8);
    arm.translate(0, len / 2, 0);
    const dir = new THREE.Vector3(hand.x - sh.x, (f.up - 2.55) * S, hand.z - sh.z).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    arm.applyQuaternion(q);
    b.mesh('cloth_green', arm, { x: sh.x, y: fy + 2.55 * S, z: sh.z });
    arm.dispose();
    const tex = fanTexture(f.ch);
    const mat = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.45, roughness: 0.45, side: THREE.DoubleSide });
    mat.name = 'gold_fan';
    out.owned.push(mat, tex);
    const fan = fanGeometry(0.85 * S);
    b.mesh(mat, fan, { x: hand.x, y: fy + f.up * S, z: hand.z, yaw, roll: f.tilt });
    fan.dispose();
  }
  out.marks.statue = { x: at.x, y: y0, z: at.z };
  out.marks.statue_top = { x: at.x, y: fy + 3.6 * S, z: at.z };
}

/**
 * The Meeting Hall: a large A-frame — a steep, thick straw roof almost to the ground over low plaster
 * walls, a straw ridge with logs across it and crossed boards at the gable ends; plastered gables in
 * a timber frame with a band of paper windows over the doorway; a stone platform with two benches
 * against the front where the elders sit in council.
 */
function meetingHall(env: BuildEnv, out: VillageOut, km: KyoshiMats): void {
  const c = A(V.u, V.hallR + 2);
  const b = env.chunks.at('major', c.x, c.z).builder;
  const y = H(c.x, c.z);
  const yaw = STREET_YAW + Math.PI; // its gable front looks down the street
  const W = 15, D = 21, wallH = 1.8, roofH = 11, eave = 0.9;
  const fy = y + 0.5; // platform top
  const ry = fy + wallH; // roof base
  // Stone platform, deeper at the front for the council benches.
  const FRONT = 2.4;
  const pc = off(c, yaw, 0, FRONT / 2);
  b.box('stone_grey', { x: pc.x, y: y + 0.25, z: pc.z, sx: W + 1.2, sy: 0.5, sz: D + 1.2 + FRONT, yaw }, { collide: true, walkable: true, solid: true });
  // Low plaster walls in a dark timber frame (posts every few metres, a sill and a top plate).
  for (const s of [-1, 1]) {
    const q = off(c, yaw, (s * W) / 2, 0);
    b.box('plaster_white', { x: q.x, y: fy + wallH / 2, z: q.z, sx: 0.3, sy: wallH, sz: D, yaw });
    for (let k = 0; k <= 6; k++) {
      const p = off(c, yaw, s * (W / 2 + 0.08), -D / 2 + (k * D) / 6);
      b.box('wood_dark', { x: p.x, y: fy + wallH / 2, z: p.z, sx: 0.24, sy: wallH, sz: 0.24, yaw });
    }
    for (const hy of [0.12, wallH - 0.1]) {
      const p = off(c, yaw, s * (W / 2 + 0.1), 0);
      b.box('wood_dark', { x: p.x, y: fy + hy, z: p.z, sx: 0.16, sy: 0.18, sz: D + 0.3, yaw });
    }
  }
  const backW = off(c, yaw, 0, -D / 2);
  b.box('plaster_white', { x: backW.x, y: fy + wallH / 2, z: backW.z, sx: W, sy: wallH, sz: 0.3, yaw });
  // The front under the gable: low walls either side of the doorway (the benches stand against them).
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * (2.2 + (W / 2 - 2.2) / 2), D / 2);
    b.box('plaster_white', { x: q.x, y: fy + wallH / 2, z: q.z, sx: W / 2 - 2.2, sy: wallH, sz: 0.3, yaw });
    const p = off(c, yaw, s * (W / 2 - 1.6), D / 2 + 0.12);
    b.box('wood_dark', { x: p.x, y: fy + wallH / 2, z: p.z, sx: 0.24, sy: wallH, sz: 0.12, yaw });
  }
  // The A-frame: ridge along the hall's length, thick thatch in two layers, open at the gable ends over
  // plaster gables cut to its underside. (Roof frame: its X runs along the ridge toward the back.)
  const under = gableRoof(b, km.thatch, { x: c.x, y: ry, z: c.z, yaw: yaw + Math.PI / 2, w: D, d: W, height: roofH, overhang: eave, curve: 0.05, thick: 0.5, ridge: null });
  /** Half the width of the gable at height `hy` above the roof base (its edge follows the roof). */
  const halfAt = (hy: number): number => {
    let lo = 0, hi = W / 2;
    if (under(hi) >= hy) return hi;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (under(m) >= hy) lo = m;
      else hi = m;
    }
    return lo;
  };
  // Straw ridge roll with logs laid across it, crossed boards rising above each gable end.
  const apex = ry + roofH;
  const roll = new THREE.CylinderGeometry(0.5, 0.5, D + eave * 2 + 0.4, 12);
  roll.rotateX(Math.PI / 2);
  b.mesh(km.thatchOld, roll, { x: c.x, y: apex + 0.05, z: c.z, yaw });
  roll.dispose();
  const log = new THREE.CylinderGeometry(0.17, 0.17, 1.7, 8);
  log.rotateZ(Math.PI / 2);
  for (let k = 0; k < 8; k++) {
    const p = off(c, yaw, 0, -D / 2 + 1.2 + (k * (D - 2.4)) / 7);
    b.mesh('wood_dark', log, { x: p.x, y: apex + 0.55, z: p.z, yaw });
  }
  log.dispose();
  // The roof is steepest at the ridge (its tangent there: 1.6 × height / half-width).
  const slope = Math.atan((1.6 * roofH) / (W / 2 + eave));
  for (const f of [-1, 1]) {
    for (const s of [-1, 1]) {
      // Each board continues one roof slope past the ridge: centre 0.7 m out along it from the apex.
      const p = off(c, yaw, -s * Math.cos(slope) * 0.7, f * (D / 2 + eave + 0.12));
      b.box('wood_dark', { x: p.x, y: apex + Math.sin(slope) * 0.7, z: p.z, sx: 3.2, sy: 0.34, sz: 0.14, yaw, roll: s * slope });
    }
  }
  // Gables: plaster in a timber frame; the front has the doorway and a band of paper windows.
  for (const f of [-1, 1]) {
    const ge = profileWallGeometry((-f * D) / 2, W / 2, (z) => under(z) - 0.08, 0.3, f > 0 ? [1.8, 3.4] : undefined);
    b.mesh('plaster_white', ge, { x: c.x, y: ry, z: c.z, yaw: yaw + Math.PI / 2 });
    ge.dispose();
    // Timber frame on the gable: posts and two tie beams, cut to the roof line.
    const face = f > 0 ? yaw : yaw + Math.PI;
    const fq = off(c, yaw, 0, f * (D / 2 + 0.18));
    for (const px of [-3.3, 3.3]) {
      const hTop = under(px) - 0.25;
      const p = off(fq, face, px, 0);
      b.box('wood_dark', { x: p.x, y: ry + hTop / 2, z: p.z, sx: 0.26, sy: hTop, sz: 0.12, yaw: face });
    }
    for (const hy of [3.6, 7.0]) {
      const span = halfAt(hy + 0.13) * 2 - 0.2;
      if (span > 0.5) b.box('wood_dark', { x: fq.x, y: ry + hy, z: fq.z, sx: span, sy: 0.26, sz: 0.12, yaw: face });
    }
    // Paper windows between the tie beams (front: above the doorway; back: a smaller band).
    const ww = Math.min(f > 0 ? 4.0 : 3.0, halfAt(6.2) * 2 - 0.4);
    paperWindow(b, off(c, yaw, 0, f * (D / 2 + 0.1)), ry + 5.25, face, ww, 1.4, km.shoji);
  }
  // Big frame timbers on the front, steps, and the dark interior behind the door.
  const front = off(c, yaw, 0, D / 2 + 0.25);
  for (const s of [-1, 1]) {
    const q = off(front, yaw, s * 2.0, 0);
    b.box('wood_dark', { x: q.x, y: fy + (wallH + 3.6) / 2, z: q.z, sx: 0.4, sy: wallH + 3.6, sz: 0.4, yaw });
  }
  b.box('wood_dark', { x: front.x, y: fy + wallH + 3.55, z: front.z, sx: 4.6, sy: 0.4, sz: 0.45, yaw });
  const inner = off(c, yaw, 0, D / 2 - 0.6);
  b.box('stone_dark', { x: inner.x, y: fy + 2.2, z: inner.z, sx: 3.6, sy: 4.4, sz: 0.2, yaw }, { castShadow: false });
  const st0 = off(c, yaw, 0, D / 2 + 2.6 + FRONT), st1 = off(c, yaw, 0, D / 2 + 0.6 + FRONT);
  b.stairs({ from: new THREE.Vector3(st0.x, y - 0.05, st0.z), to: new THREE.Vector3(st1.x, fy, st1.z), width: 4.4, material: 'stone_grey' });
  b.collider({ shape: 'box', x: c.x, y: fy + (wallH + roofH * 0.5) / 2, z: c.z, hx: W / 2 + 0.4, hy: (wallH + roofH * 0.5) / 2, hz: D / 2, yaw, walkable: true, solid: true, surface: 'wood' });
  // Council benches against the front either side of the door; the elders sit on them facing the street.
  const benchFwd = D / 2 + 0.55;
  for (const s of [-1, 1]) {
    const bc = off(c, yaw, s * 3.9, benchFwd);
    b.box('wood', { x: bc.x, y: fy + 0.42, z: bc.z, sx: 3.3, sy: 0.08, sz: 0.5, yaw }, { collide: true, walkable: true, solid: true, surface: 'wood' });
    for (const k of [-1.4, 0, 1.4]) {
      const l = off(bc, yaw, k, 0);
      b.box('wood_dark', { x: l.x, y: fy + 0.19, z: l.z, sx: 0.1, sy: 0.38, sz: 0.42, yaw }, { castShadow: false });
    }
    for (const k of [-1, 0, 1]) {
      const st = off(c, yaw, s * 3.9 + k * 1.05, benchFwd + 0.42);
      out.seats.push({ x: st.x, z: st.z, y: fy, yaw });
    }
  }
  // Lamps at the platform's front corners, their lanterns toward the steps.
  for (const s of [-1, 1]) {
    const q = off(c, yaw, s * (W / 2 + 0.1), D / 2 + FRONT + 0.2);
    out.lanterns.push(lanternPost(b, q.x, fy, q.z, yaw + (s * Math.PI) / 2, 'red'));
  }
  out.marks.meeting_hall = { x: front.x, y, z: front.z };
}

/** Rice paddies / vegetable plots: flat beds terraced into the slope with earth bunds. */
function field(env: BuildEnv, c: P2, yaw: number, w: number, d: number, kind: 'paddy' | 'veg', out: VillageOut): void {
  // The raised bed stays off the paths through the plots.
  if (onVillagePath(c, yaw, w + 0.8, d + 0.8, 0.8)) return;
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

export function* buildVillage(env: BuildEnv, out: VillageOut, km: KyoshiMats): Generator<unknown, void, unknown> {
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
      // The look comes from its own dice, so the plots above (and every test that walks between the
      // houses) keep their places: thatch, grey tile or cedar shingles; white or cream plaster in a dark
      // timber frame, pale cedar boards or dark planks; paper windows; a lantern by many doors.
      const look = new Random(0x6b5100 + i * 2 + (side > 0 ? 1 : 0));
      const thatch = !tiled && look.chance(0.7);
      const roof: Mat = tiled ? 'roof_dark' : thatch ? (look.chance(0.55) ? km.thatch : km.thatchOld) : 'wood';
      const opts: Parameters<typeof house>[1] = {
        x: c.x,
        z: c.z,
        y: ground,
        minY: gmin,
        yaw,
        w,
        d,
        h: rnd.range(2.5, 2.9),
        floor,
        roofH: rnd.range(2.7, 3.3) + (thatch ? 0.4 : 0),
        roof,
        thickRoof: thatch,
        wall: (finish = rnd.range(0, 1)) < 0.22 ? 'plaster_white' : finish < 0.42 ? 'plaster_cream' : finish < 0.86 ? 'wood' : 'wood_dark',
        trim: finish < 0.86 ? 'wood_dark' : 'wood',
        stairs: rnd.chance(0.5) ? 'front' : 'side',
        porch: rnd.chance(0.4),
        windows: km.shoji,
        lantern: look.chance(0.65) ? (look.chance(0.5) ? 'red' : 'warm') : undefined,
      };
      // A lane where the dojo path leaves the street (its plot stays open; the dice still roll so
      // every other house keeps its look).
      if (onVillagePath(c, yaw, w, d, 2)) continue;
      house(env.chunks.at('houses', c.x, c.z).builder, opts);
      out.doors.push({ ...off(c, yaw, 0, d / 2 + 1.6), yaw });
    }
    if (i % 2 === 0) yield;
  }
  meetingHall(env, out, km);
  yield;
  // Street lamps (paper lanterns on timber posts, their arms over the street) and fences along the
  // plots behind the houses.
  let lamp = 0;
  for (let s = 10; s <= 98; s += 14) {
    for (const side of [-1, 1]) {
      const q = streetPt(s + (side > 0 ? 7 : 0), side * 3.6);
      const y = H(q.x, q.z);
      out.lanterns.push(lanternPost(env.chunks.at('props', q.x, q.z).builder, q.x, y, q.z, STREET_YAW + (side * Math.PI) / 2, lamp++ % 2 ? 'red' : 'warm'));
    }
  }
  for (const side of [-1, 1]) {
    const pts = [streetPt(14, side * 17), streetPt(50, side * 18), streetPt(96, side * 16)];
    // A gap where the dojo path goes through.
    for (const run of clearRuns(pts, 0.6)) fence(env.chunks.at('props', pts[1].x, pts[1].z).builder, run, H);
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
  // Market at the entrance plaza (east side, up the street from the coast road through the
  // entrance), communal kitchens either side lower down, wells.
  for (let i = 0; i < 3; i++) {
    const c = streetPt(7 + i * 4.2, 8.2);
    if (!onVillagePath(c, STREET_YAW - Math.PI / 2, 2.6, 1.1, 0.5)) stall(env, c, STREET_YAW - Math.PI / 2, out, i);
  }
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
    // No washing line across the dojo path.
    if (clearRuns([lq, lq2], 0.6).length === 1 && !onVillagePath(lq, 0, 0, 0, 0.6) && !onVillagePath(lq2, 0, 0, 0, 0.6)) {
      laundry(env.chunks.at('detail', lq.x, lq.z).builder, lq, lq2, H(lq.x, lq.z));
    }
    const cb = streetPt(21 + i * 12.4, side * 11.4);
    const cy = H(cb.x, cb.z);
    env.chunks.at('detail', cb.x, cb.z).builder.cylinder('wood', { x: cb.x, y: cy, z: cb.z, r: 0.4, h: 0.55, segments: 10 }, { collide: true, solid: true });
  }
  out.marks.street_top = { ...streetPt(98, 0), y: H(streetPt(98, 0).x, streetPt(98, 0).z) };
}
