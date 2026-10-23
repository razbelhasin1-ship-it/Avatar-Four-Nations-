import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { heightAt } from '../../Heightfield';
import { FireRegion } from './FireRegion';
import { mulberry } from './geom';
import { awningMat, bannerDarkMat, crimsonMat, goldMat, lacquerRedMat, paperMat, sandStoneMat } from './materials';
import { bannerPole, brazier, crest, flight, hall, hangingLantern, house, lanternPost, P, parapet, rampSlab, roof, stall, tree, wallBanner } from './parts';
import { addFireSpots } from './spots';

/**
 * Ember Island resort: a palm-lined seaside promenade along the south-east
 * beach, beach houses on the sea side, the Ember Island Players' theatre, the
 * terrace tea house of General Iro (training ground in front), the royal beach
 * house, a small pier and lanterns. All laid out in a promenade frame:
 * `along` runs north-east → south-west parallel to the shore, `inland` points
 * north-west away from the sea.
 */
export const EMBER = (() => {
  const a = { x: -1585, z: 1778 };
  const u = { x: -0.864, z: 0.504 }; // along the promenade
  const n = { x: -0.504, z: -0.864 }; // inland
  const P = (along: number, inland: number) => ({ x: a.x + u.x * along + n.x * inland, z: a.z + u.z * along + n.z * inland });
  const seaYaw = Math.atan2(-n.x, -n.z); // local +Z faces the sea
  return { a, u, n, P, seaYaw, length: 150, width: 8, theater: { along: 62, inland: 30 }, teahouse: { along: 108, inland: 27, w: 34, d: 38 }, pier: { along: 18 }, villa: { x: -1726, z: 1726 } };
})();

const groundMax = (pts: Array<{ x: number; z: number }>) => pts.reduce((m, p) => Math.max(m, heightAt(p.x, p.z)), -Infinity);

export class EmberIsland extends FireRegion {
  readonly id = 'fire_ember_island';
  readonly center = { x: -1670, z: 1785 };
  readonly loadRadius = 360;
  teaY = 0;
  /** Promenade top height at every 6 m boundary (debug/tests). */
  promenadeTops: number[] = [];
  theaterY = 0;

  /** Promenade top height at `along` (interpolated between slab boundaries). */
  private promenadeAt(along: number): number {
    const i = Math.max(0, Math.min(this.promenadeTops.length - 2, Math.floor(along / 6)));
    const t = Math.max(0, Math.min(1, along / 6 - i));
    return this.promenadeTops[i] + (this.promenadeTops[i + 1] - this.promenadeTops[i]) * t;
  }

  protected construct(_ctx: GameContext): void {
    this.buildPromenade();
    this.buildBeachHouses();
    this.buildTheater();
    this.buildTeaHouse();
    this.buildVilla();
    this.buildPier();
    this.ambientLife();
  }

  private ambientLife(): void {
    const E = EMBER;
    let seed = 9500;
    const R = 'ember_island';
    const add = (id: string, name: string, role: 'villager' | 'noble' | 'child', p: { x: number; z: number }, y: number | undefined, yaw: number, behavior: { type: 'idle'; variant?: 'stand' | 'sit' } | { type: 'wander'; radius: number } | { type: 'converse' }) =>
      this.npc({ id: `ember_${id}`, name, role, nation: 'fire', appearanceSeed: seed++, x: p.x, z: p.z, y, yaw, behavior, region: R, marker: 'none' });
    const th = E.teahouse;
    const tableY = this.teaY;
    add('tea_guest_1', 'Tea Guest', 'noble', E.P(th.along - 13.2, th.inland - th.d / 2 + th.d - 15), tableY, E.seaYaw, { type: 'idle', variant: 'sit' });
    add('tea_guest_2', 'Tea Guest', 'villager', E.P(th.along + 12.8, th.inland - th.d / 2 + th.d - 15), tableY, E.seaYaw + Math.PI, { type: 'idle', variant: 'sit' });
    add('theatre_goer_1', 'Theatre-goer', 'noble', E.P(E.theater.along - 6, 10), undefined, E.seaYaw + Math.PI, { type: 'converse' });
    add('theatre_goer_2', 'Theatre-goer', 'villager', E.P(E.theater.along - 4.6, 11.2), undefined, E.seaYaw, { type: 'converse' });
    add('beachgoer_1', 'Beachgoer', 'villager', E.P(56, -22), undefined, E.seaYaw, { type: 'wander', radius: 7 });
    add('beachgoer_2', 'Beachgoer', 'child', E.P(110, -24), undefined, E.seaYaw, { type: 'wander', radius: 6 });
  }

  private buildPromenade(): void {
    const s = this.layer('promenade', { far: true });
    const d = this.layer('promenade_detail');
    const E = EMBER;
    const yaw = E.seaYaw;
    // A chain of gently sloping slabs: boundary heights clear the ground across the
    // whole width (± half a segment), slabs ramp between them.
    const seg = 6;
    const hAt = (al: number) => {
      const pts: Array<{ x: number; z: number }> = [];
      for (const da of [-seg / 2, 0, seg / 2]) for (const inl of [-E.width / 2, -E.width / 4, 0, E.width / 4, E.width / 2]) pts.push(E.P(al + da, inl));
      return groundMax(pts) + 0.15;
    };
    const tops: number[] = [];
    for (let al = 0; al <= E.length; al += seg) tops.push(hAt(al));
    this.promenadeTops = tops;
    for (let i = 0; i < tops.length - 1; i++) {
      const al = i * seg;
      const a0 = E.P(al, 0), a1 = E.P(al + seg, 0);
      rampSlab(s, sandStoneMat(), { x: a0.x, y: tops[i], z: a0.z }, { x: a1.x, y: tops[i + 1], z: a1.z }, E.width, { thick: 1.2 });
      // Border kerbs.
      for (const side of [-1, 1]) {
        const k0 = E.P(al, side * (E.width / 2 - 0.2)), k1 = E.P(al + seg, side * (E.width / 2 - 0.2));
        const mid = { x: (k0.x + k1.x) / 2, z: (k0.z + k1.z) / 2 };
        d.box('stone_light', { x: mid.x, y: (tops[i] + tops[i + 1]) / 2 + 0.04, z: mid.z, sx: seg, sy: 0.12, sz: 0.4, yaw: yaw + Math.PI, roll: Math.atan2(tops[i + 1] - tops[i], seg) }, { castShadow: false });
      }
    }
    // Palms on both sides, lanterns alternating.
    const r = mulberry(55);
    // Keep the openings clear: tea-house stair, theatre steps, the stall, the pier and beach-house steps.
    const keepClear = (al: number, side: number) =>
      side > 0
        ? Math.abs(al - E.teahouse.along) < 9 || Math.abs(al - E.theater.along) < 15 || Math.abs(al - 40) < 4
        : Math.abs(al - E.pier.along) < 4 || [8, 30, 84, 128, 146].some((b) => Math.abs(al - b) < 3);
    for (let al = 5; al < E.length - 2; al += 11) {
      for (const side of [-1, 1]) {
        if (keepClear(al, side)) continue;
        const p = E.P(al + (r() - 0.5) * 2, side * (E.width / 2 + 2.2 + r() * 1.2));
        tree(s, 'palm', { x: p.x, y: heightAt(p.x, p.z) - 0.1, z: p.z, s: 8 + r() * 4, yaw: r() * 6, variant: Math.floor(r() * 3), collide: true });
      }
      const ls = Math.round(al / 11) % 2 ? 1 : -1;
      if (keepClear(al + 5.5, ls)) continue;
      const lp = E.P(al + 5.5, ls * (E.width / 2 + 0.8));
      lanternPost(d, { x: lp.x, y: heightAt(lp.x, lp.z), z: lp.z, yaw, h: 3.4 });
    }
    // Souvenir / fruit stall (merchant_ember_1) on the inland side.
    const st = E.P(40, E.width / 2 + 3.2);
    stall(d, { x: st.x, y: heightAt(st.x, st.z), z: st.z, yaw: yaw, seed: 77, w: 4, awning: awningMat() });
  }

  private buildBeachHouses(): void {
    const s = this.layer('beach_houses', { far: true });
    const d = this.layer('beach_houses_detail');
    const E = EMBER;
    const r = mulberry(91);
    for (const al of [8, 30, 84, 128, 146]) {
      const c = E.P(al, -15);
      const w = 9 + r() * 2, dd = 8;
      const corners = [E.P(al - w / 2, -15 - dd / 2), E.P(al + w / 2, -15 - dd / 2), E.P(al - w / 2, -15 + dd / 2), E.P(al + w / 2, -15 + dd / 2)];
      const g = groundMax(corners);
      const lo = Math.min(...corners.map((p) => heightAt(p.x, p.z)));
      const fy = Math.max(g + 0.3, 2.4) + 0.9;
      // Stilts and deck.
      for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
        const p = E.P(al + lx * (w / 2 + 0.4), -15 + lz * (dd / 2 + 1.6));
        s.box('wood_dark', { x: p.x, y: (lo - 1 + fy) / 2, z: p.z, sx: 0.32, sy: fy - lo + 1, sz: 0.32, yaw: E.seaYaw });
      }
      const deck = E.P(al, -15 - 1.2);
      s.box('wood', { x: deck.x, y: fy - 0.15, z: deck.z, sx: w + 1.6, sy: 0.3, sz: dd + 4.4, yaw: E.seaYaw }, { collide: true, walkable: true, surface: 'wood' });
      house(s, { x: c.x, y: fy, z: c.z, yaw: E.seaYaw, w, d: dd, floors: r() < 0.4 ? 2 : 1, wall: r() < 0.5 ? 'plaster_cream' : 'plaster_white', upperWall: crimsonMat(), roofMat: r() < 0.6 ? 'roof_red' : 'roof_dark', seed: 400 + al, base: null, ornate: r() < 0.3 }, d);
      // Steps from the deck down to the beach (seaward).
      const st0 = E.P(al, -15 - 1.2 - (dd + 4.4) / 2 - 3.4);
      const st1 = E.P(al, -15 - 1.2 - (dd + 4.4) / 2);
      const gy = heightAt(st0.x, st0.z);
      if (fy - gy > 0.4) flight(s, { from: new THREE.Vector3(st0.x, gy, st0.z), to: new THREE.Vector3(st1.x, fy, st1.z), width: 2.2, mat: 'wood', surface: 'wood' });
      // Steps on the promenade side too.
      const sp0 = E.P(al, -E.width / 2 - 0.1), sp1 = E.P(al, -15 - 1.2 + (dd + 4.4) / 2);
      const py = heightAt(sp0.x, sp0.z) + 0.1;
      if (fy - py > 0.4) flight(s, { from: new THREE.Vector3(sp0.x, py, sp0.z), to: new THREE.Vector3(sp1.x, fy, sp1.z), width: 2.2, mat: 'wood', surface: 'wood' });
      hangingLantern(d, { x: deck.x, y: fy + 2.6, z: deck.z, s: 0.8 });
    }
  }

  private buildTheater(): void {
    const s = this.layer('theater', { far: true });
    const d = this.layer('theater_detail');
    const E = EMBER;
    const t = E.theater;
    const yaw = E.seaYaw;
    const c = E.P(t.along, t.inland);
    const W = 30, D = 22, H = 11;
    const fy = groundMax([E.P(t.along - W / 2, t.inland - D / 2 - 8), E.P(t.along + W / 2, t.inland - D / 2 - 8), E.P(t.along - W / 2, t.inland + D / 2), E.P(t.along + W / 2, t.inland + D / 2)]) + 0.6;
    // Forecourt (paved) between the promenade and the doors.
    const fc = E.P(t.along, (E.width / 2 + t.inland - D / 2) / 2 + 0.5);
    const fd = t.inland - D / 2 - E.width / 2 - 1;
    s.box(sandStoneMat(), { x: fc.x, y: fy - 0.6, z: fc.z, sx: W + 6, sy: 1.2, sz: fd, yaw }, { collide: true, walkable: true, castShadow: false });
    this.theaterY = fy;
    // Broad steps from the promenade up onto the forecourt (ending at its edge).
    const fz0 = (E.width / 2 + t.inland - D / 2) / 2 + 0.5 - fd / 2;
    const pTop = this.promenadeAt(t.along);
    if (fy - pTop > 0.12) {
      const st0 = E.P(t.along, fz0 - Math.max(1.2, (fy - pTop) / 0.55)), st1 = E.P(t.along, fz0);
      flight(s, { from: new THREE.Vector3(st0.x, pTop, st0.z), to: new THREE.Vector3(st1.x, fy, st1.z), width: 18, mat: 'stone_light' });
    }
    // Building: podium, walls, gold band, double roof.
    s.block('stone_light', { x: c.x, y: fy - 1, z: c.z, sx: W + 2, sy: 1.6, sz: D + 2, yaw }, { collide: true, walkable: true });
    s.block(crimsonMat(), { x: c.x, y: fy + 0.6, z: c.z, sx: W, sy: H, sz: D, yaw }, { collide: true, walkable: true });
    s.box(goldMat(), { x: c.x, y: fy + H - 1, z: c.z, sx: W + 0.15, sy: 0.25, sz: D + 0.15, yaw }, { castShadow: false });
    roof(s, { x: c.x, y: fy + 0.6 + H, z: c.z, w: W, d: D, h: 5.5, yaw, mat: 'roof_red', overhang: 2.2, curve: 1.3, horns: 2.2, tips: 1.2, crest: 1.6 });
    // Portico with columns, a pediment banner and the playbill banners.
    const front = (lx: number, off: number) => {
      const p = E.P(t.along + lx, t.inland - D / 2 - off);
      return p;
    };
    for (let k = -2; k <= 2; k++) {
      const p = front(k * 5.2, 4);
      s.mesh(lacquerRedMat(), P.column(), { x: p.x, y: fy + 0.6, z: p.z, sx: 0.45, sy: 7.2, sz: 0.45 });
      s.collider({ shape: 'cylinder', x: p.x, y: fy + 4.2, z: p.z, r: 0.5, hy: 3.6, walkable: false, solid: true });
    }
    const pr = front(0, 2.2);
    s.box('black_lacquer', { x: pr.x, y: fy + 8.1, z: pr.z, sx: 24, sy: 0.8, sz: 5, yaw });
    roof(s, { x: pr.x, y: fy + 8.5, z: pr.z, w: 23, d: 4.6, h: 2.2, yaw, mat: 'roof_dark', overhang: 1, curve: 0.8, horns: 1.2, tips: 0.8 });
    const facade = front(0, 0.06);
    crest(s, { x: facade.x, y: fy + 9.2, z: facade.z, yaw, size: 2.4 });
    for (const lx of [-8.5, 8.5]) {
      const p = front(lx, 0.08);
      wallBanner(d, { x: p.x, y: fy + 7.4, z: p.z, yaw, w: 3.2, len: 5.5, mat: bannerDarkMat() });
    }
    // Doors (paper-lit) and theatre posters.
    for (const lx of [-3, 3]) {
      const p = front(lx, 0.05);
      d.box(paperMat(), { x: p.x, y: fy + 2.4, z: p.z, sx: 3.6, sy: 3.6, sz: 0.06, yaw }, { castShadow: false });
    }
    for (const lx of [-13, 13]) {
      const p = front(lx, 0.07);
      d.box(awningMat(), { x: p.x, y: fy + 3.4, z: p.z, sx: 2.4, sy: 3.4, sz: 0.05, yaw }, { castShadow: false });
    }
    // Entrance steps from the forecourt up to the podium.
    const s0 = front(0, 7.2), s1 = front(0, 5.2);
    flight(s, { from: new THREE.Vector3(s0.x, fy - 0.0, s0.z), to: new THREE.Vector3(s1.x, fy + 0.6, s1.z), width: 22, mat: 'stone_light' });
    s.box('stone_light', { x: front(0, 3.2).x, y: fy + 0.3, z: front(0, 3.2).z, sx: 26, sy: 0.6, sz: 4.2, yaw }, { collide: true, walkable: true });
    // Braziers and banner poles in the forecourt.
    for (const lx of [-15, 15]) {
      const p = front(lx, 6);
      brazier(d, this.flames, { x: p.x, y: fy, z: p.z, size: 1.2 });
      const b = front(lx * 1.15, 9);
      bannerPole(d, { x: b.x, y: fy, z: b.z, yaw, h: 9, w: 1.6, len: 5 });
    }
  }

  private buildTeaHouse(): void {
    const s = this.layer('teahouse', { far: true });
    const d = this.layer('teahouse_detail');
    const E = EMBER;
    const th = E.teahouse;
    const yaw = E.seaYaw;
    const c = E.P(th.along, th.inland);
    const x0 = th.along - th.w / 2, z0 = th.inland - th.d / 2;
    const corners = [E.P(x0, z0), E.P(x0 + th.w, z0), E.P(x0, z0 + th.d), E.P(x0 + th.w, z0 + th.d), c];
    const lo = Math.min(...corners.map((p) => heightAt(p.x, p.z)));
    const top = Math.round((groundMax(corners) + 1.4) * 10) / 10;
    this.teaY = top;
    s.box('stone_tan', { x: c.x, y: (lo - 1 + top) / 2, z: c.z, sx: th.w, sy: top - lo + 1, sz: th.d, yaw }, { collide: true, walkable: true });
    s.box('paving', { x: c.x, y: top + 0.02, z: c.z, sx: th.w - 0.4, sy: 0.04, sz: th.d - 0.4, yaw }, { castShadow: false });
    s.box(crimsonMat(), { x: c.x, y: top - 0.3, z: c.z, sx: th.w + 0.1, sy: 0.6, sz: th.d + 0.1, yaw });
    // Front steps (seaward, toward the promenade) — wide.
    const f0 = E.P(th.along, z0 - 2.6), f1 = E.P(th.along, z0);
    flight(s, { from: new THREE.Vector3(f0.x, heightAt(f0.x, f0.z), f0.z), to: new THREE.Vector3(f1.x, top, f1.z), width: 12, mat: 'stone_light' });
    // Low parapet around the terrace except the stair opening.
    const L = (al: number, inl: number) => E.P(al, inl);
    parapet(s, [L(x0 + 0.3, z0 + 0.3), L(th.along - 6.5, z0 + 0.3)], { y: top, h: 0.8, thick: 0.4, mat: crimsonMat() });
    parapet(s, [L(th.along + 6.5, z0 + 0.3), L(x0 + th.w - 0.3, z0 + 0.3), L(x0 + th.w - 0.3, z0 + th.d - 0.3), L(x0 + 0.3, z0 + th.d - 0.3), L(x0 + 0.3, z0 + 0.3)], { y: top, h: 0.8, thick: 0.4, mat: crimsonMat() });
    // The tea house: two storeys at the back of the terrace.
    const hc = L(th.along, z0 + th.d - 6);
    hall(s, { x: hc.x, y: top, z: hc.z, yaw, w: 16, d: 7, h: 4.2, veranda: 2, colSpacing: 3.6, wall: 'plaster_cream', roofMat: 'roof_red', colMat: lacquerRedMat(), upper: { h: 3.2, inset: 2.4, roofH: 3 }, horns: 1.2, crest: 1 });
    // Sign board over the door.
    const sign = L(th.along, z0 + th.d - 6 - 3.6);
    s.box('black_lacquer', { x: sign.x, y: top + 3.9, z: sign.z, sx: 4.2, sy: 0.9, sz: 0.12, yaw });
    s.box(goldMat(), { x: sign.x, y: top + 3.9, z: sign.z, sx: 3.6, sy: 0.08, sz: 0.14, yaw }, { castShadow: false });
    // Tables with stools under lanterns, in front of the tea house (outside the training circle).
    const r = mulberry(12);
    for (const ta of [-15, -11, 11, 15]) {
      const tp = L(th.along + ta, z0 + th.d - 15);
      d.cylinder('wood_red', { x: tp.x, y: top, z: tp.z, r: 0.75, h: 0.75, segments: 10 }, { collide: true, walkable: false });
      for (let q = 0; q < 3; q++) {
        const a = (q / 3) * Math.PI * 2 + r();
        d.cylinder('wood_dark', { x: tp.x + Math.cos(a) * 1.25, y: top, z: tp.z + Math.sin(a) * 1.25, r: 0.25, h: 0.45, segments: 6 });
      }
      hangingLantern(d, { x: tp.x, y: top + 3.2, z: tp.z, s: 0.9 });
    }
    // Lantern strings on posts at the terrace corners; potted plants.
    for (const [al, inl] of [[x0 + 1.2, z0 + 1.2], [x0 + th.w - 1.2, z0 + 1.2], [x0 + 1.2, z0 + th.d - 1.2], [x0 + th.w - 1.2, z0 + th.d - 1.2]]) {
      const p = L(al, inl);
      lanternPost(d, { x: p.x, y: top, z: p.z, yaw, h: 3.2 });
    }
    for (const al of [x0 + 3, x0 + th.w - 3]) {
      const p = L(al, z0 + 2.5);
      tree(d, 'bush', { x: p.x, y: top, z: p.z, s: 1.6, variant: Math.round(al), collide: true });
    }
    for (const al of [x0 - 3, x0 + th.w + 3]) {
      const p = L(al, z0 + th.d / 2);
      tree(s, 'palm', { x: p.x, y: heightAt(p.x, p.z), z: p.z, s: 10, variant: 1, collide: true });
    }
  }

  private buildVilla(): void {
    const s = this.layer('villa', { far: true });
    const d = this.layer('villa_detail');
    const v = EMBER.villa;
    const yaw = EMBER.seaYaw;
    const y = Math.max(heightAt(v.x, v.z), 3) + 0.4;
    s.block('stone_light', { x: v.x, y: y - 1, z: v.z, sx: 30, sy: 1.2, sz: 24, yaw }, { collide: true, walkable: true });
    hall(s, { x: v.x, y: y + 0.2, z: v.z - 0, yaw, w: 18, d: 9, h: 4.6, veranda: 2.2, colSpacing: 3.8, wall: crimsonMat(), roofMat: 'roof_dark', upper: { h: 3.4, inset: 2.6, roofH: 3.2 }, horns: 1.6, crest: 1.2 });
    for (const side of [-1, 1]) {
      const off = { x: v.x + Math.cos(yaw) * side * 12, z: v.z - Math.sin(yaw) * side * 12 };
      house(s, { x: off.x, y: y + 0.2, z: off.z, yaw, w: 7, d: 9, floors: 1, wall: 'plaster_cream', roofMat: 'roof_dark', seed: 880 + side, ornate: true, base: null }, d);
    }
    const g = { x: v.x + Math.sin(yaw) * 12.5, z: v.z + Math.cos(yaw) * 12.5 };
    const sy = heightAt(g.x, g.z);
    flight(s, { from: new THREE.Vector3(g.x + Math.sin(yaw) * 1.8, sy, g.z + Math.cos(yaw) * 1.8), to: new THREE.Vector3(g.x - Math.sin(yaw) * 0.2, y + 0.2, g.z - Math.cos(yaw) * 0.2), width: 6, mat: 'stone_light' });
  }

  private buildPier(): void {
    const s = this.layer('pier', { far: true });
    const d = this.layer('pier_detail');
    const E = EMBER;
    const yaw = E.seaYaw;
    const al = E.pier.along;
    const start = E.P(al, -E.width / 2);
    const y0 = heightAt(start.x, start.z) + 0.15;
    const len = 46;
    const deckY = Math.max(y0, 2.2);
    const mid = E.P(al, -E.width / 2 - len / 2);
    s.box('wood', { x: mid.x, y: deckY - 0.2, z: mid.z, sx: 4, sy: 0.4, sz: len, yaw }, { collide: true, walkable: true, surface: 'wood' });
    for (let k = 0; k <= len; k += 5) for (const side of [-1, 1]) {
      const p = E.P(al + side * 1.8, -E.width / 2 - k);
      s.cylinder('wood_dark', { x: p.x, y: -6, z: p.z, r: 0.22, h: deckY + 5.6, segments: 6 });
    }
    for (let k = 8; k < len; k += 12) {
      const p = E.P(al + 1.6, -E.width / 2 - k);
      lanternPost(d, { x: p.x, y: deckY, z: p.z, yaw, h: 3 });
    }
    this.pierEnd = { ...E.P(al, -E.width / 2 - len + 2), y: deckY };
  }

  pierEnd: { x: number; z: number; y: number } | null = null;
}

// --- Spots ---------------------------------------------------------------
{
  const E = EMBER;
  const th = E.teahouse;
  const tc = E.P(th.along, th.inland - th.d / 2 + 13);
  const mi = E.P(th.along, th.inland + th.d / 2 - 12);
  const corners = [E.P(th.along - th.w / 2, th.inland - th.d / 2), E.P(th.along + th.w / 2, th.inland - th.d / 2), E.P(th.along - th.w / 2, th.inland + th.d / 2), E.P(th.along + th.w / 2, th.inland + th.d / 2), E.P(th.along, th.inland)];
  const top = Math.round((groundMax(corners) + 1.4) * 10) / 10;
  const st = E.P(40, E.width / 2 + 3.2);
  const pierEnd = E.P(E.pier.along, -E.width / 2 - 44);
  const pierStart = E.P(E.pier.along, -E.width / 2);
  const pierDeckY = Math.max(heightAt(pierStart.x, pierStart.z) + 0.15, 2.2);
  const sea = E.seaYaw;
  addFireSpots({
    master_iro: { x: mi.x, z: mi.z, y: top, yaw: sea, r: 3, label: "General Iro's tea house", region: 'ember_island' },
    training_iro: { x: tc.x, z: tc.z, y: top, yaw: sea + Math.PI, r: 12, label: 'Tea house terrace', region: 'ember_island' },
    merchant_ember_1: { x: st.x - Math.sin(sea) * 0.15, z: st.z - Math.cos(sea) * 0.15, yaw: sea, r: 2, label: 'Promenade fruit stall', region: 'ember_island' },
    dock_ember_island: { x: pierEnd.x, z: pierEnd.z, y: pierDeckY, yaw: sea, r: 3, label: 'Ember Island pier', region: 'ember_island' },
    viewpoint_ember_promenade: { ...E.P(20, 0), r: 22, label: 'Ember Island promenade', region: 'ember_island' },
    viewpoint_ember_beach: { ...E.P(135, -5), r: 24, label: 'Ember Island beach', region: 'ember_island' },
    shrine_ember_theater: { ...E.P(E.theater.along, E.width / 2 + 6), r: 6, label: 'Ember Island Players theatre', region: 'ember_island' },
  });
}

