import * as THREE from 'three';
import type { P2 } from '../../WorldLayout';
import type { KitMaterialName } from '../../kit/Materials';
import { houseRows, pavedStrip } from './cityKit';
import { EarthRegion } from './EarthRegion';
import type { BuildEnv } from './env';
import { annulusGeometry } from './geom';
import { bannerPole, crates, fountain, lanternPost, marketStall, stoneLantern, tree } from './parts';
import { GAOLING } from './spots';
import { gatehouse, LoopPath, loopWall, sectionsBetween, type WallStyle } from './walls';

/**
 * Gaoling: a prosperous walled town in the Earth Kingdom heartland. Town wall
 * with two gatehouses, a market square with a fountain, the walled estate of a
 * wealthy family (mansion, garden pond), stables, and the Earth Rumble arena:
 * a sunken ring floor (training_lin) surrounded by stepped stands.
 */

const WALL: WallStyle = {
  height: 7,
  thick: 2.8,
  batterOut: 0.5,
  batterIn: 0.3,
  body: 'stone_tan',
  trim: 'stone_light',
  bands: [],
  plinthH: 0.8,
  walk: 'paving',
  merlonW: 1.2,
  merlonH: 0.9,
  merlonGap: 1.0,
  parapetH: 0.9,
  innerParapetH: 0.8,
};

export class Gaoling extends EarthRegion {
  readonly id = 'gaoling';
  readonly center: P2 = { x: GAOLING.c.x, z: GAOLING.c.z };
  readonly loadRadius = 420;
  protected readonly seed = 5521;
  protected override readonly cell = 96;

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    const { chunks, mats, excl, rnd } = env;
    const c = GAOLING.c, Y = GAOLING.y;
    const A = GAOLING.arena, E = GAOLING.estate, S = GAOLING.square;
    // Ground.
    {
      const g = annulusGeometry(c.x, c.z, () => 0, () => GAOLING.wallR, Y + 0.015, 6, 72, 1);
      chunks.named('major', 'ground').builder.mesh(mats.groundLower, g, { x: 0, y: 0, z: 0 }, { castShadow: false });
      g.dispose();
    }
    // Town wall + gates.
    const path = new LoopPath(c, () => GAOLING.wallR, 360);
    const gw = 14;
    const gaps: Array<[number, number]> = GAOLING.gates.map((t) => {
      const s = path.sOf(t);
      return [s - gw / 2, s + gw / 2];
    });
    loopWall(chunks, { path, sections: sectionsBetween(path.total, gaps), parapetGaps: [], baseY: Y, style: WALL, key: 'wall', arcs: 3, segLen: 10 });
    const streets: P2[][] = [];
    for (const t of GAOLING.gates) {
      const out = { x: Math.cos(t), z: Math.sin(t) };
      const gx = c.x + out.x * GAOLING.wallR, gz = c.z + out.z * GAOLING.wallR;
      gatehouse(chunks.named('major', `gate_${t.toFixed(2)}`).builder, mats, { x: gx, z: gz, out, baseY: Y, width: gw, depth: 6, height: 9, passageW: 5.5, spring: 3.4, body: 'stone_tan', trim: 'stone_light', roof: 'roof_green', tower: { w: 9, d: 4.2, h: 3.2, tiers: 1 }, banners: true, doors: true });
      excl.seg(gx + out.x * 12, gz + out.z * 12, S.x, S.z, 5);
      streets.push([{ x: gx + out.x * 10, z: gz + out.z * 10 }, { x: gx - out.x * 8, z: gz - out.z * 8 }, { x: S.x + out.x * (S.r - 1), z: S.z + out.z * (S.r - 1) }]);
      // Gate guards.
      for (const sd of [-1, 1]) {
        const r = { x: -out.z, z: out.x };
        this.npc({ id: `gaoling_amb_guard_${t.toFixed(1)}_${sd}`, name: 'Town Guard', role: 'guard', nation: 'earth', element: 'earth', appearanceSeed: 8100 + sd + Math.round(t * 10), x: gx - out.x * 6 + r.x * sd * 4, z: gz - out.z * 6 + r.z * sd * 4, y: Y, yaw: Math.atan2(out.x, out.z), behavior: { type: 'idle', variant: 'guard' }, region: 'earth_heartland', marker: 'none' });
      }
    }
    for (const st of streets) pavedStrip(chunks.named('major', 'streets').builder, mats.road, st, 6, Y + 0.03, 4);
    // Exclusions.
    excl.circle(S.x, S.z, S.r + 3);
    excl.rect(E.x - E.hw - 2, E.z - E.hd - 2, E.x + E.hw + 4, E.z + E.hd + 2);
    excl.circle(A.x, A.z, A.standOut + 3);
    excl.circle(c.x - 30, c.z + 38, 10);
    excl.circle(c.x, c.z, 9); // landmark clear zone
    yield;

    // Market square: fountain, stalls, lanterns.
    {
      const b = chunks.named('props', 'square').builder;
      const g = new THREE.CylinderGeometry(S.r, S.r, 0.1, 32);
      b.mesh('paving', g, { x: S.x, y: Y - 0.02, z: S.z }, { castShadow: false });
      g.dispose();
      fountain(b, S.x, Y, S.z, 3.6, { id: 'gaoling_fountain', label: 'Gaoling square fountain', capacity: 60, regen: 1.5 });
      env.waterIds.push('gaoling_fountain');
      const aw: KitMaterialName[] = ['cloth_green', 'cloth_yellow', 'cloth_red', 'cloth_orange'];
      [-6, 6, 0].forEach((dx, i) => {
        marketStall(b, S.x + dx, Y, S.z - 9.5, 0, aw[i], rnd, 3.6, 2.2);
        crates(chunks.named('detail', 'square_detail').builder, S.x + dx + 2.6, Y, S.z - 11.5, rnd, 2);
      });
      for (const [dx, dz] of [[-9, 5], [9, 5], [-9, -4], [9, -4]]) lanternPost(b, S.x + dx, Y, S.z + dz, 'warm');
      this.npc({ id: 'gaoling_amb_vendor', name: 'Gaoling Merchant', role: 'merchant', nation: 'earth', appearanceSeed: 8200, x: S.x, z: S.z - 11.4, y: Y, yaw: 0, behavior: { type: 'idle', variant: 'work' }, region: 'earth_heartland', marker: 'none' });
      this.npc({ id: 'gaoling_amb_walker_1', name: 'Townsperson', role: 'villager', nation: 'earth', appearanceSeed: 8201, x: S.x + 4, z: S.z + 6, y: Y, yaw: 0, behavior: { type: 'wander', radius: 9 }, region: 'earth_heartland', marker: 'none' });
      this.npc({ id: 'gaoling_amb_walker_2', name: 'Townsperson', role: 'villager', nation: 'earth', appearanceSeed: 8202, x: S.x - 5, z: S.z + 4, y: Y, yaw: 0, behavior: { type: 'wander', radius: 8 }, region: 'earth_heartland', marker: 'none' });
    }
    yield;

    // Earth Rumble arena: ring floor + lip with an entrance, stepped stands with a gap.
    {
      const b = chunks.named('major', 'arena').builder;
      const pr = chunks.named('props', 'arena_props').builder;
      const ent = Math.atan2(S.z - A.z, S.x - A.x); // entrance faces the square
      const inGap = (a: number, half: number) => {
        let d = Math.abs(a - ent) % (Math.PI * 2);
        if (d > Math.PI) d = Math.PI * 2 - d;
        return d < half;
      };
      // Floor (slightly raised, walkable) with a darker fighting circle.
      b.cylinder('stone_tan', { x: A.x, y: Y - 0.5, z: A.z, r: A.floorR + 1.4, h: 0.8, segments: 40 }, { collide: true, walkable: true, surface: 'stone' });
      const disc = new THREE.CircleGeometry(A.floorR - 1, 40);
      disc.rotateX(-Math.PI / 2);
      b.mesh(mats.groundDirt, disc, { x: A.x, y: Y + 0.31, z: A.z }, { castShadow: false });
      disc.dispose();
      // Stands: 4 stepped tiers in segments, entrance gap toward the square.
      const segs = 28;
      for (let k = 0; k < 4; k++) {
        const r0 = A.standIn + k * 2, r1 = r0 + 2;
        const h = 0.9 * (k + 1);
        for (let i = 0; i < segs; i++) {
          const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2, am = (a0 + a1) / 2;
          if (inGap(am, 0.32)) continue;
          const rm = (r0 + r1) / 2;
          const len = 2 * rm * Math.sin((a1 - a0) / 2) + 0.12;
          const x = A.x + Math.cos(am) * rm, z = A.z + Math.sin(am) * rm;
          const yaw = Math.atan2(-Math.cos(am), -Math.sin(am)) + Math.PI / 2;
          b.block(k % 2 ? 'stone_light' : 'stone_tan', { x, y: Y, z, sx: len, sy: h, sz: 2, yaw: yaw - Math.PI / 2 }, { collide: true, walkable: true });
        }
      }
      // Back wall with banners and lanterns.
      for (let i = 0; i < segs; i++) {
        const am = ((i + 0.5) / segs) * Math.PI * 2;
        if (inGap(am, 0.32)) continue;
        const rm = A.standOut + 0.6;
        const len = 2 * rm * Math.sin(Math.PI / segs) + 0.12;
        const x = A.x + Math.cos(am) * rm, z = A.z + Math.sin(am) * rm;
        const yaw = Math.atan2(-Math.cos(am), -Math.sin(am));
        b.block('stone_tan', { x, y: Y, z, sx: len, sy: 5.2, sz: 1.2, yaw }, { collide: true, walkable: false });
        if (i % 4 === 0) bannerPole(pr, mats, A.x + Math.cos(am) * (A.standOut - 0.4), Y + 3.6, A.z + Math.sin(am) * (A.standOut - 0.4), yaw, 5);
      }
      for (const sd of [-1, 1]) {
        const a = ent + sd * 0.42;
        stoneLantern(pr, A.x + Math.cos(a) * (A.standIn - 1), Y + 0.3, A.z + Math.sin(a) * (A.standIn - 1), 1.3);
      }
      // Spectators on the stands.
      for (let i = 0; i < 6; i++) {
        const a = ent + Math.PI + (i - 2.5) * 0.35;
        const k = i % 3;
        const r = A.standIn + k * 2 + 1;
        this.npc({ id: `gaoling_amb_fan_${i}`, name: 'Earth Rumble Fan', role: 'villager', nation: 'earth', appearanceSeed: 8300 + i, x: A.x + Math.cos(a) * r, z: A.z + Math.sin(a) * r, y: Y + 0.9 * (k + 1), yaw: Math.atan2(-Math.cos(a), -Math.sin(a)), behavior: { type: 'idle', variant: 'sit' }, region: 'earth_heartland', marker: 'none' });
      }
      this.mark('arena', A.x, Y + 0.3, A.z);
      this.mark('arenaEntrance', A.x + Math.cos(ent) * (A.standOut + 4), Y, A.z + Math.sin(ent) * (A.standOut + 4));
    }
    yield;

    // The estate: compound wall with an east gate, mansion, garden pond, trees.
    {
      const b = chunks.named('major', 'estate').builder;
      const pr = chunks.named('props', 'estate_props').builder;
      const x0 = E.x - E.hw, x1 = E.x + E.hw, z0 = E.z - E.hd, z1 = E.z + E.hd;
      const wall = (ax: number, az: number, bx: number, bz: number) => {
        const len = Math.hypot(bx - ax, bz - az);
        const yaw = Math.atan2(-(bz - az), bx - ax);
        b.box('plaster_cream', { x: (ax + bx) / 2, y: Y + 1.75, z: (az + bz) / 2, sx: len, sy: 3.5, sz: 0.8, yaw }, { collide: true, walkable: false });
        b.box('roof_green', { x: (ax + bx) / 2, y: Y + 3.65, z: (az + bz) / 2, sx: len + 0.4, sy: 0.3, sz: 1.5, yaw });
      };
      wall(x0, z0, x1, z0);
      wall(x0, z1, x1, z1);
      wall(x0, z0, x0, z1);
      wall(x1, z0, x1, E.z - 3.5);
      wall(x1, E.z + 3.5, x1, z1);
      // Gate roof over the opening.
      b.roof('roof_green', { x: x1, y: Y + 4.4, z: E.z, w: 2, d: 8.5, height: 1.4, overhang: 0.6, style: 'hip', curve: 0.7 });
      for (const sd of [-1, 1]) b.box('wood_red', { x: x1, y: Y + 2.2, z: E.z + sd * 3.6, sx: 0.6, sy: 4.4, sz: 0.6 }, { collide: true, walkable: false });
      // Mansion (front faces east toward the gate).
      env.chunks.addHouse(env.arch.G1, E.x - 8, Y, E.z - 4, Math.PI / 2, { scale: 1.45, tint: new THREE.Color('#fbf6ec') });
      env.chunks.addHouse(env.arch.M1, E.x - 6, Y, E.z + 12, Math.PI, { scale: 1.0, tint: new THREE.Color('#f6f0e2') });
      fountain(pr, E.x + 9, Y, E.z + 9, 4.5, { id: 'gaoling_estate_pond', label: 'Estate garden pond', capacity: 80, regen: 2, spout: false, type: 'pond' });
      env.waterIds.push('gaoling_estate_pond');
      for (let i = 0; i < 7; i++) tree(pr, mats, E.x + 3 + (i % 4) * 4.5, Y, z0 + 3 + Math.floor(i / 4) * 5, 1.1, i % 2 ? 'blossom' : 'round', i);
      for (const dz of [-8, 8]) stoneLantern(pr, x1 - 4, Y, E.z + dz, 1.2);
      this.mark('estateGate', x1 + 3, Y, E.z);
    }
    // Stables (ostrich-horse habitat).
    {
      const b = chunks.named('props', 'stables').builder;
      const sx = c.x - 30, sz = c.z + 38;
      b.building({ x: sx - 3, y: Y, z: sz + 4, w: 9, d: 4.5, h: 3.2, wall: 'wood', roof: 'roof_dark', trim: 'wood_dark', roofStyle: 'gable', roofHeight: 1.6, door: false, windows: false, plinth: null });
      for (let i = 0; i < 6; i++) b.box('wood_dark', { x: sx - 8 + i * 3, y: Y + 0.6, z: sz - 5, sx: 0.15, sy: 1.2, sz: 0.15 }, { collide: true, walkable: false });
      b.box('wood', { x: sx - 0.5, y: Y + 1.0, z: sz - 5, sx: 15.5, sy: 0.12, sz: 0.1 });
      crates(chunks.named('detail', 'stables_detail').builder, sx + 3, Y, sz + 1, rnd, 3);
    }
    yield;

    // Houses (wealthy town: plaster and timber, green and grey roofs).
    const n = houseRows(env, {
      c,
      rOuter: GAOLING.wallR - WALL.thick / 2 - 0.5,
      edge: 4.5,
      rStop: 12,
      y: Y,
      types: [['L1', 1.6], ['L3', 1.1], ['L3b', 0.8], ['F2', 0.8], ['L2', 1], ['M1', 0.7], ['L5', 0.6]],
      scale: [1.0, 1.2],
      pitch: 9.6,
      street: 4.6,
      gap: [0.8, 2.4],
      alleyEvery: 0,
      alleyW: 0,
      vacancy: 0.1,
      laundry: 0.12,
      onVacant: (x, z) => tree(chunks.at('props', x, z).builder, mats, x, Y, z, 1, rnd.chance(0.5) ? 'blossom' : 'round', rnd.range(0, 6)),
    });
    this.mark('houses', n, 0, 0);
  }
}
