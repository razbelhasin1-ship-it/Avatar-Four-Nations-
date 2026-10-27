import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { defineSpots } from '../../Spots';
import { WaterRegion } from './base';
import { boulder, brazier as brazierGeo, igloo, mergeParts, pillow, tentCone } from './geometry';
import { wtMat, wtWater } from './materials';
import { banner, barrel, canalBoat, crate, drift, dryingRack, iceSpikes, V, WaterSheets } from './parts';
import { rasterRects } from './raster';

/**
 * Southern Water Tribe — a small, proud village of hide tents and snow-brick
 * huts behind a low snow wall, on the plateau at (220,1600). The southern
 * road arrives from the north; to the south the village opens onto a sheet of
 * sea ice (with fishing holes of open water) where Hunter Akka trains benders.
 */

const C = { x: 220, z: 1598 }; // village centre (landmark swt_village is (220,1600))
const G = 3.0; // plateau height
const WALL_R = 39;
const ICE = { x: 222, z: 1666, r: 22, top: 3.28 };
const HOLES = [
  { x: 204, z: 1671, r: 1.25 },
  { x: 238.5, z: 1677, r: 1.1 },
  { x: 226, z: 1684.5, r: 1.2 },
];
const FIRE = { x: 220, z: 1588 };
const TOWER = { x: 254, z: 1568 };
const CHIEF = { x: 199, z: 1598 };
const R = 'southern_water_tribe';

defineSpots({
  master_akka: { x: ICE.x, z: ICE.z - 16.5, y: ICE.top, yaw: 0, r: 2, label: 'Hunter Akka', region: R },
  training_akka: { x: ICE.x, z: ICE.z, y: ICE.top, r: 14, label: 'Hunting Ice', region: R },
  giver_swt_chief: { x: CHIEF.x + 6.5, z: CHIEF.z, y: G, yaw: Math.PI / 2, r: 2, label: "Chieftain's Lodge", region: R },
  merchant_swt_1: { x: 238, z: 1612, y: G, yaw: -Math.PI / 2, r: 2, label: 'Trader', region: R },
  dock_swt_ice: { x: 245, z: 1657, y: ICE.top, yaw: Math.PI / 2, r: 3, label: 'Canoe Landing', region: R },
  viewpoint_swt_tower: { x: TOWER.x, z: TOWER.z + 5, y: G, r: 3, label: 'Watchtower', region: R },
  shrine_swt_firepit: { x: FIRE.x, z: FIRE.z + 6, y: G, r: 4, label: 'Village Fire', region: R },
  habitat_otter_penguin_2: { x: 207, z: 1681, y: ICE.top, r: 8, label: 'Ice Floes', region: R },
});

export class SouthernWaterTribe extends WaterRegion {
  constructor() {
    super('swt_village', { x: 220, z: 1610 }, 330);
  }

  protected construct(ctx: GameContext): void {
    const b = this.builder(this.main);
    const p = this.builder(this.props);
    const sheets = new WaterSheets();
    const rnd = new Random(2020);
    const density = Math.max(0.3, Math.min(1.5, ctx.settings.data.graphics.foliageDensity));

    this.seaIce(b, p, sheets);
    this.wall(b, p, rnd);
    this.dwellings(b, p, rnd);
    this.centre(b, p);
    this.tower(b, p);
    this.shore(b, p, rnd);
    this.clutter(b, p, rnd);
    this.dressing(p, rnd, density);
    this.people();
    sheets.flush(b);
  }

  // ---------------------------------------------------------------------------

  private seaIce(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, sheets: WaterSheets): void {
    // Ice sheet with fishing holes: extruded disc (holes cut through) + walkable colliders around the holes.
    const shape = new THREE.Shape();
    shape.absarc(0, 0, ICE.r, 0, Math.PI * 2, false);
    for (const h of HOLES) {
      const hole = new THREE.Path();
      hole.absarc(h.x - ICE.x, -(h.z - ICE.z), h.r, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
    const depth = 0.7;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSize: 0.6, bevelThickness: 0.25, bevelSegments: 2, curveSegments: 48 });
    geo.rotateX(-Math.PI / 2); // shape's +Y becomes -Z, extrusion goes up
    b.mesh(wtMat('ice_clear'), geo, { x: ICE.x, y: ICE.top - depth - 0.25, z: ICE.z }, { castShadow: false });
    geo.dispose();
    for (const r of rasterRects(ICE.x - ICE.r, ICE.z - ICE.r, ICE.x + ICE.r, ICE.z + ICE.r, 1, (x, z) => {
      if (Math.hypot(x - ICE.x, z - ICE.z) > ICE.r + 0.3) return false;
      return !HOLES.some((h) => Math.hypot(x - h.x, z - h.z) < h.r + 0.2);
    })) {
      b.collider({ shape: 'box', x: (r.x0 + r.x1) / 2, y: ICE.top - 0.4, z: (r.z0 + r.z1) / 2, hx: (r.x1 - r.x0) / 2, hy: 0.4, hz: (r.z1 - r.z0) / 2, walkable: true, solid: true, surface: 'ice' });
    }
    // Open water in the holes (real liquid sources) and the whole sheet as an ice source.
    HOLES.forEach((h, i) => {
      sheets.disc(wtWater('pond'), h.x, h.z, h.r + 0.05, ICE.top - 0.35, 20);
      const bed = new THREE.CircleGeometry(h.r + 0.1, 16);
      bed.rotateX(-Math.PI / 2);
      b.mesh(wtMat('canal_bed'), bed, { x: h.x, y: ICE.top - 0.95, z: h.z }, { castShadow: false });
      bed.dispose();
      b.collider({ shape: 'cylinder', x: h.x, y: ICE.top - 1.2, z: h.z, r: h.r + 0.25, hy: 0.15, walkable: true, solid: false, surface: 'water' });
      this.registerWater({ id: `swt:fishing_hole_${i}`, type: 'pond', label: 'Fishing Hole', x: h.x, y: ICE.top - 0.35, z: h.z, r: h.r, capacity: 90, regen: 5, size: 'small' });
      // fishing gear beside each hole
      p.instance('swt_fishing_pole', () => {
        const pole = new THREE.CylinderGeometry(0.03, 0.04, 2.4, 5);
        pole.rotateZ(0.9);
        pole.translate(0.6, 0.9, 0);
        return pole;
      }, wtMat('wood'), new THREE.Matrix4().makeTranslation(h.x + h.r + 0.4, ICE.top, h.z));
    });
    this.registerWater({ id: 'swt:sea_ice', type: 'ice', label: 'Sea Ice', x: ICE.x, y: ICE.top, z: ICE.z, r: ICE.r, capacity: 400, regen: 6, frozen: true, size: 'large' });
    // Pressure ridges & floes around the sheet (outside the training ring).
    const rnd = new Random(7);
    for (let i = 0; i < 10; i++) {
      const a = Math.PI * 0.05 + (i / 10) * Math.PI * 0.95; // southern half
      const r = ICE.r + rnd.range(0.5, 2.5);
      const x = ICE.x + Math.cos(a) * r, z = ICE.z + Math.sin(a) * r;
      iceSpikes(p, x, heightAt(x, z) - 0.1, z, rnd.range(1.2, 2.6), 40 + i);
    }
    for (let i = 0; i < 5; i++) {
      const a = rnd.range(-0.3, Math.PI + 0.3);
      const r = ICE.r + rnd.range(5, 12);
      const x = ICE.x + Math.cos(a) * r, z = ICE.z + Math.sin(a) * r;
      const fl = new THREE.CylinderGeometry(rnd.range(1.5, 3), rnd.range(1.8, 3.3), 0.4, 7);
      b.mesh(wtMat('ice_clear'), fl, { x, y: heightAt(x, z) + 0.1, z, yaw: rnd.range(0, 3) }, { castShadow: false });
      fl.dispose();
    }
  }

  private wall(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    // Low snow-brick wall ring with a north gate (road) and a south gate (to the ice).
    const n = 44;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const gateN = Math.abs(Math.atan2(Math.sin(am + Math.PI / 2), Math.cos(am + Math.PI / 2))) < 0.17;
      const gateS = Math.abs(Math.atan2(Math.sin(am - Math.PI / 2), Math.cos(am - Math.PI / 2))) < 0.17;
      const gateE = Math.abs(Math.atan2(Math.sin(am), Math.cos(am))) < 0.08;
      if (gateN || gateS || gateE) continue;
      const x0 = C.x + Math.cos(a0) * WALL_R, z0 = C.z + Math.sin(a0) * WALL_R;
      const x1 = C.x + Math.cos(a1) * WALL_R, z1 = C.z + Math.sin(a1) * WALL_R;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(-(z1 - z0), x1 - x0);
      const h = 1.5 + rnd.range(-0.15, 0.25);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      b.box(wtMat('snow'), { x: cx, y: G + h / 2 - 0.1, z: cz, sx: len + 0.25, sy: h, sz: 1.3, yaw }, { collide: true, walkable: false, surface: 'snow' });
      const cap = pillow(len + 0.4, 1.5, 0.35, 0.15, 1);
      b.mesh(wtMat('snow'), cap, { x: cx, y: G + h - 0.2, z: cz, yaw }, { castShadow: false });
      cap.dispose();
      // brick courses (visual)
      b.box(wtMat('ice_wall'), { x: cx, y: G + 0.45, z: cz, sx: len + 0.2, sy: 0.08, sz: 1.34, yaw }, { castShadow: false });
      b.box(wtMat('ice_wall'), { x: cx, y: G + 0.95, z: cz, sx: len + 0.2, sy: 0.08, sz: 1.34, yaw }, { castShadow: false });
    }
    // Whalebone arch at the north gate, spear posts at the south gate.
    const gx = C.x, gz = C.z - WALL_R;
    for (const off of [-0.8, 0.8]) {
      const rib = new THREE.TorusGeometry(3.4, 0.22, 6, 18, Math.PI);
      b.mesh(wtMat('bone'), rib, { x: gx, y: G - 0.2, z: gz + off });
      rib.dispose();
    }
    for (const sx of [-1, 1]) b.collider({ shape: 'cylinder', x: gx + sx * 3.4, y: G + 1, z: gz, r: 0.35, hy: 1, walkable: false, solid: true });
    banner(p, gx, G + 3.6, gz - 0.2, Math.PI, 1.1, 1.8, 'banner_water');
    for (const sx of [-1, 1]) {
      const x = C.x + sx * 5.5, z = C.z + WALL_R;
      b.cylinder(wtMat('wood'), { x, y: G, z, r: 0.12, rTop: 0.05, h: 3.6, segments: 6 }, { collide: true, walkable: false });
      p.instance('swt_spear_tip', () => new THREE.ConeGeometry(0.1, 0.5, 5), wtMat('bone'), new THREE.Matrix4().makeTranslation(x, G + 3.85, z));
    }
  }

  private dwellings(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    const occupied: Array<{ x: number; z: number; r: number }> = [
      { x: C.x, z: C.z + 2, r: 10 }, // meeting ground around the landmark
      { x: FIRE.x, z: FIRE.z, r: 6 },
      { x: TOWER.x, z: TOWER.z, r: 6 },
      { x: CHIEF.x, z: CHIEF.z, r: 8 },
      { x: 238, z: 1612, r: 4.5 }, // trader
    ];
    const free = (x: number, z: number, r: number) => occupied.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + r + 1.8);
    const igl = (x: number, z: number, r: number, yaw: number) => {
      const g = igloo(r);
      b.mesh(wtMat('snow'), g, { x, y: G - 0.05, z, yaw });
      g.dispose();
      const door = new THREE.CircleGeometry(r * 0.3, 10, 0, Math.PI);
      b.mesh(wtMat('dark'), door, { x: x + Math.sin(yaw) * r * 1.29, y: G - 0.04, z: z + Math.cos(yaw) * r * 1.29, yaw }, { castShadow: false });
      door.dispose();
      b.collider({ shape: 'cylinder', x, y: G + r * 0.4, z, r: r * 0.98, hy: r * 0.42, walkable: false, solid: true });
      occupied.push({ x, z, r: r * 1.3 });
    };
    const tent = (x: number, z: number, r: number, h: number, yaw: number, dark: boolean) => {
      const g = tentCone(r, h, 10);
      b.mesh(wtMat(dark ? 'hide_dark' : 'hide'), g, { x, y: G - 0.05, z, yaw });
      g.dispose();
      // poles poking out of the top and a dark door flap
      p.instance('swt_tent_poles', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          const pole = new THREE.CylinderGeometry(0.035, 0.035, 1.3, 4);
          pole.rotateZ(0.25);
          pole.rotateY(a);
          pole.translate(Math.cos(a) * 0.12, 0.55, Math.sin(a) * 0.12);
          parts.push(pole);
        }
        return mergeParts(parts);
      }, wtMat('wood'), new THREE.Matrix4().compose(V(x, G + h - 0.4, z), new THREE.Quaternion(), V(1, 1, 1)));
      const flap = new THREE.PlaneGeometry(r * 0.55, h * 0.42);
      b.mesh(wtMat('dark'), flap, { x: x + Math.sin(yaw) * r * 0.82, y: G + h * 0.21, z: z + Math.cos(yaw) * r * 0.82, yaw, pitch: -0.32 }, { castShadow: false });
      flap.dispose();
      b.collider({ shape: 'cylinder', x, y: G + h * 0.3, z, r: r * 0.9, hy: h * 0.3, walkable: false, solid: true });
      occupied.push({ x, z, r });
    };
    // Chieftain's lodge: a big hide lodge joined to a snow dome.
    tent(CHIEF.x, CHIEF.z, 4.6, 8.2, Math.PI / 2, true);
    igl(CHIEF.x - 5.2, CHIEF.z - 2.5, 3.0, Math.PI / 2);
    banner(p, CHIEF.x + 5, G + 4.4, CHIEF.z + 3, Math.PI / 2, 1.0, 2.2, 'banner_water');
    b.cylinder(wtMat('wood'), { x: CHIEF.x + 5, y: G, z: CHIEF.z + 3, r: 0.09, h: 4.6, segments: 6 }, { collide: true, walkable: false });
    // Ring of homes facing the centre.
    let placed = 0;
    for (let ring = 0; ring < 3; ring++) {
      const rr = [17, 25, 32.5][ring];
      const n = [9, 14, 18][ring];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.13 + rnd.range(-0.06, 0.06);
        // keep the north road, the south ice gate and the east gate clear
        const toN = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
        const toS = Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2)));
        if (toN < 0.38 || toS < 0.38 || Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.18) continue;
        const r = rr + rnd.range(-1.5, 1.5);
        const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
        const yaw = Math.atan2(C.x - x, C.z - z); // face the centre
        const isTent = rnd.chance(0.55);
        const size = isTent ? rnd.range(2.2, 3.0) - ring * 0.1 : rnd.range(2.2, 3.1) - ring * 0.1;
        if (!free(x, z, size)) continue;
        if (isTent) tent(x, z, size, size * rnd.range(1.8, 2.1), yaw, rnd.chance(0.4));
        else igl(x, z, size, yaw);
        placed++;
      }
    }
    void placed;
  }

  private centre(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>): void {
    // Fire pit: ring of stones, logs and a real fire (emitters).
    const { x, z } = FIRE;
    // Blocks of white ice (three shapes shared by instancing): the Water Tribes have no stone to bend.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * 1.35, G + 0.08, z + Math.sin(a) * 1.35), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a * 3), new THREE.Vector3(1, 1, 1));
      b.instance(`swt_firestone_${i % 3}`, () => boulder(300 + (i % 3), 0.38, 0.28, 0.34, 0), wtMat('ice_wall'), m);
    }
    for (let i = 0; i < 4; i++) {
      const log = new THREE.CylinderGeometry(0.12, 0.14, 1.6, 6);
      b.mesh(wtMat('wood'), log, { x, y: G + 0.25, z, yaw: (i / 4) * Math.PI, pitch: Math.PI / 2 - 0.35 });
      log.dispose();
    }
    p.instance('swt_fire', () => {
      const g = new THREE.ConeGeometry(0.55, 1.1, 7);
      g.translate(0, 0.75, 0);
      return g;
    }, wtMat('fire'), new THREE.Matrix4().makeTranslation(x, G, z), false);
    b.collider({ shape: 'cylinder', x, y: G + 0.3, z, r: 1.7, hy: 0.3, walkable: false, solid: true });
    this.ambientEmitter('flame', 10, V(x, G + 0.6, z), { radius: 0.35, size: 1.1 }, 90, false);
    this.ambientEmitter('embers', 3, V(x, G + 1.0, z), { radius: 0.3 }, 70, true);
    this.ambientEmitter('smoke', 1.2, V(x, G + 2.2, z), { radius: 0.3, size: 0.8, speed: 0.6 }, 90, true);
    // Log benches around the fire (low, walkable).
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = x + Math.cos(a) * 4, bz = z + Math.sin(a) * 4;
      b.box(wtMat('wood'), { x: bx, y: G + 0.22, z: bz, sx: 2.2, sy: 0.44, sz: 0.55, yaw: -a + Math.PI / 2 }, { collide: true, walkable: true, surface: 'wood' });
    }
    // Braziers lighting the meeting ground.
    for (const [bx, bz] of [[C.x - 9, C.z + 8], [C.x + 9, C.z + 8]] as const) {
      p.instance('swt_brazier', () => brazierGeo(0.5, 1.1), wtMat('rock_dark'), new THREE.Matrix4().makeTranslation(bx, G, bz));
      p.instance('swt_brazier_fire', () => {
        const g = new THREE.ConeGeometry(0.36, 0.6, 7);
        g.translate(0, 1.3, 0);
        return g;
      }, wtMat('fire'), new THREE.Matrix4().makeTranslation(bx, G, bz), false);
      b.collider({ shape: 'cylinder', x: bx, y: G + 0.55, z: bz, r: 0.5, hy: 0.55, walkable: false, solid: true });
      this.ambientEmitter('flame', 5, V(bx, G + 1.3, bz), { radius: 0.15, size: 0.7 }, 70, true);
    }
    // Trader's stall.
    const tx = 238, tz = 1612;
    b.box(wtMat('wood'), { x: tx, y: G + 0.45, z: tz, sx: 1, sy: 0.9, sz: 3.2 }, { collide: true, walkable: false });
    const roof = new THREE.PlaneGeometry(3.2, 3.6);
    roof.rotateX(-Math.PI / 2);
    roof.rotateZ(0.2);
    b.mesh(wtMat('hide'), roof, { x: tx + 0.6, y: G + 2.6, z: tz }, { castShadow: false });
    roof.dispose();
    for (const dz of [-1.5, 1.5]) for (const dx of [-0.9, 1.9]) b.cylinder(wtMat('wood'), { x: tx + dx, y: G, z: tz + dz, r: 0.07, h: dx < 0 ? 2.5 : 2.9, segments: 5 });
    crate(p, tx + 1.2, G, tz + 2.6, 0.3, 0.8);
    barrel(p, tx + 1.4, G, tz - 2.6, 0.8);
  }

  private tower(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>): void {
    const { x, z } = TOWER;
    const h = 9;
    for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]] as const) {
      b.cylinder(wtMat('wood'), { x: x + dx, y: G, z: z + dz, r: 0.16, rTop: 0.13, h: h + 1.6, segments: 6 }, { collide: true, walkable: false });
    }
    // cross braces
    for (const yy of [2.5, 5.5]) {
      for (const s of [-1, 1]) {
        b.box(wtMat('wood'), { x, y: G + yy, z: z + s * 1.4, sx: 3.2, sy: 0.12, sz: 0.12, roll: s * 0.6 });
        b.box(wtMat('wood'), { x: x + s * 1.4, y: G + yy, z, sx: 0.12, sy: 0.12, sz: 3.2, pitch: s * 0.6 });
      }
    }
    b.box(wtMat('wood'), { x, y: G + h, z, sx: 4, sy: 0.3, sz: 4 }, { collide: true, walkable: true, surface: 'wood' });
    b.box(wtMat('hide'), { x, y: G + h + 0.6, z, sx: 4, sy: 0.9, sz: 4 }, { castShadow: true });
    const r = tentCone(3.2, 2.4, 8);
    b.mesh(wtMat('hide_dark'), r, { x, y: G + h + 1.4, z });
    r.dispose();
    // ladder
    for (let i = 0; i < 9; i++) b.box(wtMat('wood'), { x: x + 1.75, y: G + 0.5 + i, z, sx: 0.08, sy: 0.08, sz: 0.9 });
    banner(p, x, G + h + 3.6, z + 0.2, 0, 0.9, 1.6, 'banner_water');
    p.cylinder(wtMat('wood'), { x, y: G + h + 1.4, z, r: 0.05, h: 2.6, segments: 4 });
  }

  private shore(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    // Canoes pulled up on the ice and the snow by the south gate.
    const boats: Array<[number, number, number]> = [
      [245, 1655, 1.2],
      [248.5, 1660, 1.35],
      [200, 1649, -1.3],
      [196.5, 1653.5, -1.1],
    ];
    for (const [x, z, yaw] of boats) {
      const y = Math.hypot(x - ICE.x, z - ICE.z) < ICE.r ? ICE.top : heightAt(x, z);
      canalBoat(p, x, y + 0.25, z, yaw, rnd.range(4.6, 5.4));
      b.collider({ shape: 'box', x, y: y + 0.3, z, hx: 0.6, hy: 0.3, hz: 2.5, yaw, walkable: true, solid: true, surface: 'wood' });
    }
    // Drying racks with fish, kayak racks, sleds.
    const racks: Array<[number, number, number]> = [[205, 1636, 0.3], [236, 1636, -0.3], [190, 1620, 1.2], [250, 1624, -1.1]];
    for (const [x, z, yaw] of racks) {
      dryingRack(p, x, G, z, yaw, 3.4);
      b.collider({ shape: 'box', x, y: G + 1, z, hx: 1.8, hy: 1, hz: 0.25, yaw, walkable: false, solid: true });
    }
    for (const [x, z, yaw] of [[262, 1604, 0.2], [178, 1588, -0.4]] as const) {
      const sled = new THREE.BoxGeometry(1.1, 0.25, 2.6);
      b.mesh(wtMat('wood'), sled, { x, y: G + 0.35, z, yaw });
      sled.dispose();
      for (const s of [-1, 1]) {
        const run = new THREE.BoxGeometry(0.08, 0.12, 3.0);
        b.mesh(wtMat('bone'), run, { x: x + Math.cos(yaw) * s * 0.45, y: G + 0.12, z: z - Math.sin(yaw) * s * 0.45, yaw });
        run.dispose();
      }
    }
  }

  private clutter(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    // Kayaks resting on bone trestles.
    const kayaks: Array<[number, number, number]> = [[187, 1607, 0.4], [252, 1593, -0.5], [233, 1630, 0.15], [204, 1630, -0.2]];
    for (const [x, z, yaw] of kayaks) {
      const m = new THREE.Matrix4().compose(V(x, G, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), V(1, 1, 1));
      p.instance('swt_kayak', () => {
        const hullG = new THREE.SphereGeometry(1, 10, 6);
        hullG.scale(0.42, 0.3, 2.6);
        hullG.translate(0, 1.15, 0);
        return hullG;
      }, wtMat('hide_dark'), m);
      p.instance('swt_trestle', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (const zz of [-1.4, 1.4]) {
          for (const xx of [-0.45, 0.45]) {
            const leg = new THREE.CylinderGeometry(0.05, 0.06, 1.1, 5);
            leg.rotateZ(xx > 0 ? 0.35 : -0.35);
            leg.translate(xx * 0.7, 0.5, zz);
            parts.push(leg);
          }
        }
        return mergeParts(parts);
      }, wtMat('bone'), m);
      b.collider({ shape: 'box', x, y: G + 0.7, z, hx: 0.6, hy: 0.7, hz: 2.4, yaw, walkable: false, solid: true });
    }
    // Snow-block windbreaks on the west side.
    for (const [x, z, yaw] of [[186, 1581, 1.2], [191, 1567, 0.8], [249, 1580, -1.0]] as const) {
      b.box(wtMat('snow'), { x, y: G + 0.6, z, sx: 4.2, sy: 1.2, sz: 0.9, yaw }, { collide: true, walkable: false, surface: 'snow' });
      b.box(wtMat('ice_wall'), { x, y: G + 0.62, z, sx: 4.25, sy: 0.07, sz: 0.94, yaw }, { castShadow: false });
    }
    // Fish piles and pelts.
    for (let i = 0; i < 5; i++) {
      const a = rnd.range(0, Math.PI * 2), r = rnd.range(11, 14);
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      p.instance('swt_fish_pile', () => {
        const parts: THREE.BufferGeometry[] = [];
        for (let j = 0; j < 6; j++) {
          const f = new THREE.ConeGeometry(0.12, 0.7, 4);
          f.rotateZ(Math.PI / 2);
          f.scale(1, 0.4, 1);
          f.rotateY(j * 1.1);
          f.translate(Math.cos(j) * 0.25, 0.08 + (j % 3) * 0.07, Math.sin(j) * 0.25);
          parts.push(f);
        }
        return mergeParts(parts);
      }, wtMat('fish'), new THREE.Matrix4().makeTranslation(x, G, z), false);
      p.instance('swt_pelt', () => {
        const g = new THREE.CircleGeometry(0.9, 8);
        g.rotateX(-Math.PI / 2);
        g.translate(0, 0.02, 0);
        return g;
      }, wtMat('fur'), new THREE.Matrix4().compose(V(x + 1.2, G, z + 0.6), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)), V(1, 1, 0.7)), false);
    }
  }

  private dressing(p: ReturnType<WaterRegion['builder']>, rnd: Random, density: number): void {
    // Snow drifts against the wall and between homes (decor only).
    const n = Math.round(24 * density);
    for (let i = 0; i < n; i++) {
      const a = rnd.range(0, Math.PI * 2);
      const r = WALL_R - rnd.range(1.5, 3);
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      drift(p, x, G, z, rnd.range(2, 4.5), rnd.range(1.2, 2.2), rnd.range(0.3, 0.7), -a);
    }
    // Barrels / crates of supplies.
    for (let i = 0; i < Math.round(8 * density); i++) {
      const a = rnd.range(0, Math.PI * 2), r = rnd.range(14, 18);
      const x = C.x + Math.cos(a) * r, z = C.z + Math.sin(a) * r;
      if (rnd.chance(0.5)) barrel(p, x, G, z, 0.8);
      else crate(p, x, G, z, a, 0.75);
    }
  }

  private people(): void {
    const npc = (id: string, name: string, x: number, z: number, yaw: number, behavior: Parameters<WaterRegion['ambientNPC']>[0]['behavior'], seed: number, role: 'villager' | 'guard' = 'villager') =>
      this.ambientNPC({ id: `swt_amb_${id}`, name, role, nation: 'water', x, z, yaw, behavior, appearanceSeed: seed, region: R, marker: 'none' });
    npc('fire_1', 'Villager', FIRE.x + 3, FIRE.z + 3, -2.4, { type: 'idle', variant: 'sit' }, 8101);
    npc('fire_2', 'Elder', FIRE.x - 3, FIRE.z + 3, 2.4, { type: 'converse' }, 8102);
    npc('children', 'Child', C.x + 6, C.z + 4, 0, { type: 'wander', radius: 9 }, 8103);
    npc('fisher', 'Ice Fisher', HOLES[0].x + 2.4, HOLES[0].z, -Math.PI / 2, { type: 'idle', variant: 'kneel' }, 8104);
    npc('gate', 'Wall Watch', C.x + 4.5, C.z - WALL_R + 2, Math.PI, { type: 'idle', variant: 'guard' }, 8105, 'guard');
    npc('racks', 'Villager', 236, 1633, 0, { type: 'idle', variant: 'work' }, 8106);
  }
}

export function createSouthernWaterTribe(): SouthernWaterTribe {
  return new SouthernWaterTribe();
}
