import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import type { ContentBuilder } from '../../kit/Builder';
import { heightAt } from '../../Heightfield';
import { FireRegion } from './FireRegion';
import type { FlameField } from './flames';
import { mulberry, roofGeo, turtleDuckGeo } from './geom';
import { basaltMat, bannerDarkMat, crimsonMat, goldMat, ivoryMat, lacquerRedMat, lawnMat, paperMat, pondBedMat, pondWaterMat, canalWaterMat } from './materials';
import {
  bannerPole,
  brazier,
  crest,
  dragonStatue,
  flight,
  hall,
  hangingLantern,
  house,
  lanternPost,
  local,
  maskSlab,
  P,
  pagodaTower,
  parapet,
  rock,
  roof,
  slab,
  stall,
  stoneLantern,
  tree,
  wallBanner,
  yawTo,
} from './parts';
import { boulevardStall, CAPITAL } from './layout';
import { buildCityRing, type RingStair } from './cityRing';
import { buildRimGate, RIM_GATE } from './rimGate';

const C = CAPITAL;

/**
 * The Fire Nation Capital, inside the volcano caldera (plateau y = 42).
 *
 *   North : the Fire Lord's Palace on an 8 m terrace (y = 50) — Gate of Agni at
 *           the top of the grand stair, forecourt, throne hall, central tower,
 *           twin pagodas, the walled garden with the turtle-duck pond (west).
 *   Centre: the Royal Plaza, a raised parade ground (y = 43.2) flanked by
 *           canals and roofed galleries, braziers and banners.
 *   East  : the Agni Kai Arena; the boulevard from the rim gate.
 *   West  : the Fire Sages' Temple and its training court.
 *   Ring  : terraced city quarters climbing the caldera walls (cityRing.ts),
 *           the rim gatehouse on the pass road (rimGate.ts).
 */
export class FireCapital extends FireRegion {
  readonly id = 'fire_capital';
  readonly center = { x: C.cx, z: C.cz };
  readonly loadRadius = 620;
  private pondWater: THREE.Mesh | null = null;
  private pondLevel: number = C.pond.y;
  private ducks: Array<{ obj: THREE.Object3D; a: number; r: number; speed: number; phase: number }> = [];
  private duckMeshes: THREE.InstancedMesh[] = [];
  /** Terrace stairs of the city ring (debug/tests). */
  ringStairs: RingStair[] = [];

  protected construct(ctx: GameContext): void {
    this.buildPlaza();
    this.buildPalaceTerrace();
    this.buildPalace();
    this.buildGarden();
    this.buildArena();
    this.buildTemple();
    this.buildBoulevard();
    this.ambientLife();
    // The terraced ring is the heaviest part: built over several frames when the player is far.
    this.deferBuild(buildCityRing(this.ctx, (n, o) => this.layer(n, o), this.flames, (s) => this.ambient(s), this.ringStairs));
    buildRimGate(this.ctx, (n, o) => this.layer(n, o), this.flames, (s) => this.ambient(s));
    void ctx;
  }

  // -------------------------------------------------------------------------
  // Royal Plaza
  // -------------------------------------------------------------------------

  private buildPlaza(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const pz = C.plaza;
    const PY = pz.y;
    const inCanal = (x: number, z: number) => pz.canals.some((c) => x > c.x0 && x < c.x1 && z > pz.canalZ0 && z < pz.canalZ1);
    // Platform with canal cut-outs.
    maskSlab(s, 'paving', { x0: pz.x0, z0: pz.z0, x1: pz.x1, z1: pz.z1, cell: 2, top: PY, thick: PY - 41.8 }, inCanal);
    // Parade ground inlays: dark field with a red processional way and gold borders.
    s.box('paving_dark', { x: (pz.paradeX0 + pz.paradeX1) / 2, y: PY + 0.012, z: (pz.canalZ0 + pz.z1 - 6) / 2, sx: pz.paradeX1 - pz.paradeX0 - 6, sy: 0.024, sz: pz.z1 - 6 - pz.canalZ0 }, { castShadow: false });
    s.box('stone_red', { x: C.cx, y: PY + 0.03, z: (pz.stairBase + pz.z1) / 2, sx: 12, sy: 0.03, sz: pz.z1 - pz.stairBase }, { castShadow: false });
    for (const side of [-1, 1]) s.box(goldMat(), { x: C.cx + side * 6.3, y: PY + 0.035, z: (pz.stairBase + pz.z1) / 2, sx: 0.35, sy: 0.03, sz: pz.z1 - pz.stairBase }, { castShadow: false });
    // Gold emblem inlay at the heart of the plaza.
    d.mesh(goldMat(), P.emblem(), { x: C.cx, y: PY + 0.05, z: C.plaza.emblemZ, pitch: -Math.PI / 2, sx: 7, sy: 7, sz: 0.3 }, { castShadow: false });

    // Canals: bed, water surface, balustrades, bridges; registered as water sources.
    for (const c of pz.canals) {
      const cx = (c.x0 + c.x1) / 2, w = c.x1 - c.x0, len = pz.canalZ1 - pz.canalZ0, cz = (pz.canalZ0 + pz.canalZ1) / 2;
      s.box(basaltMat(), { x: cx, y: 42.0, z: cz, sx: w, sy: 0.2, sz: len }, { collide: true, walkable: true, surface: 'stone', castShadow: false });
      const geo = new THREE.PlaneGeometry(w + 0.2, len + 0.2);
      geo.rotateX(-Math.PI / 2);
      const water = new THREE.Mesh(geo, canalWaterMat());
      water.position.set(cx, pz.canalWater, cz);
      water.renderOrder = 2;
      water.name = `canal_${c.id}`;
      this.own(water);
      this.water({ id: `fire_capital:${c.id}`, type: 'canal', label: 'Plaza Canal', x: cx, y: pz.canalWater, z: cz, r: w / 2, capacity: Infinity, regen: 0, size: 'medium', path: [{ x: cx, z: pz.canalZ0 + 0.5 }, { x: cx, z: pz.canalZ1 - 0.5 }] });
      // Balustrades on both edges with a gap at the bridge.
      for (const ex of [c.x0, c.x1]) {
        for (const [z0, z1] of [[pz.canalZ0, pz.bridgeZ - 3.5], [pz.bridgeZ + 3.5, pz.canalZ1]]) {
          const ox = ex === c.x0 ? -0.25 : 0.25;
          s.box('stone_light', { x: ex + ox, y: PY + 0.45, z: (z0 + z1) / 2, sx: 0.4, sy: 0.9, sz: z1 - z0 }, { collide: true, walkable: false });
          s.box(goldMat(), { x: ex + ox, y: PY + 0.94, z: (z0 + z1) / 2, sx: 0.5, sy: 0.08, sz: z1 - z0 }, { castShadow: false });
          for (let z = z0 + 1.5; z < z1 - 0.5; z += 6) d.box('stone_light', { x: ex + ox, y: PY + 0.6, z, sx: 0.6, sy: 1.2, sz: 0.6 });
        }
      }
      // Canal end walls (north/south) above the bed.
      // Arched bridge across at the gallery passage.
      s.bridge({ a: new THREE.Vector3(c.x0 - 0.6, PY, pz.bridgeZ), b: new THREE.Vector3(c.x1 + 0.6, PY, pz.bridgeZ), width: 6, deck: 'stone_light', rail: 'stone_light', arch: 0.7, surface: 'stone' });
    }

    // Perimeter steps (south face full width, east/west forecourt faces and gallery passages).
    flight(s, { from: new THREE.Vector3(C.cx, 41.9, pz.z1 + 3.2), to: new THREE.Vector3(C.cx, PY, pz.z1), width: pz.x1 - pz.x0, mat: 'stone_light' });
    for (const side of [-1, 1]) {
      const ex = side < 0 ? pz.x0 : pz.x1;
      flight(s, { from: new THREE.Vector3(ex + side * 3.2, 41.9, (pz.z0 + pz.canalZ0) / 2), to: new THREE.Vector3(ex, PY, (pz.z0 + pz.canalZ0) / 2), width: pz.canalZ0 - pz.z0 - 0.4, mat: 'stone_light' });
      flight(s, { from: new THREE.Vector3(ex + side * 3.2, 41.9, pz.bridgeZ), to: new THREE.Vector3(ex, PY, pz.bridgeZ), width: 11, mat: 'stone_light' });
    }

    // Galleries (roofed colonnades) along the outer edges of the canals.
    for (const side of [-1, 1]) {
      const gx0 = side < 0 ? pz.x0 + 0.5 : pz.x1 - pz.galleryW - 0.5;
      const gx1 = gx0 + pz.galleryW;
      const backX = side < 0 ? gx0 + 0.6 : gx1 - 0.6;
      const colX = side < 0 ? gx1 - 0.8 : gx0 + 0.8;
      const z0 = pz.canalZ0, z1 = pz.z1;
      // Back wall (crimson with ivory base) with the central passage.
      for (const [a, bz] of [[z0, pz.bridgeZ - 6], [pz.bridgeZ + 6, z1]]) {
        s.box(crimsonMat(), { x: backX, y: PY + 3.2, z: (a + bz) / 2, sx: 1.2, sy: 6.4, sz: bz - a }, { collide: true, walkable: false });
        s.box(ivoryMat(), { x: backX, y: PY + 0.6, z: (a + bz) / 2, sx: 1.4, sy: 1.2, sz: bz - a });
        // Lattice windows on the back wall.
        for (let z = a + 3; z < bz - 2; z += 6) d.box(paperMat(), { x: backX - side * 0.65, y: PY + 3.3, z, sx: 0.06, sy: 2.0, sz: 2.6 }, { castShadow: false });
      }
      // Columns.
      for (let z = z0 + 1; z <= z1 - 1; z += 4.6) {
        if (Math.abs(z - pz.bridgeZ) < 5) continue;
        s.mesh(lacquerRedMat(), P.column(), { x: colX, y: PY, z, sx: 0.36, sy: 6.4, sz: 0.36 });
        s.collider({ shape: 'cylinder', x: colX, y: PY + 3.2, z, r: 0.42, hy: 3.2, walkable: false, solid: true });
      }
      s.box('black_lacquer', { x: colX, y: PY + 6.1, z: (z0 + z1) / 2, sx: 0.6, sy: 0.6, sz: z1 - z0 });
      // Long roof (local X along world Z via yaw = PI/2).
      roof(s, { x: (gx0 + gx1) / 2, y: PY + 6.4, z: (z0 + z1) / 2, w: z1 - z0, d: pz.galleryW, h: 3.6, yaw: Math.PI / 2, overhang: 1.4, curve: 0.9, mat: 'roof_red', horns: 1.4, tips: 0.9, segU: 10, segT: 3 });
      // Passage gate pavilion (taller, crossing roof).
      roof(s, { x: (gx0 + gx1) / 2, y: PY + 8.2, z: pz.bridgeZ, w: pz.galleryW + 2, d: 12, h: 3.8, yaw: 0, overhang: 1.2, curve: 1.0, mat: 'roof_dark', horns: 1.6, tips: 1.0, crest: 1.3 });
      for (const dz of [-6, 6]) {
        for (const xx of [gx0 + 0.8, gx1 - 0.8]) {
          s.mesh(lacquerRedMat(), P.column(), { x: xx, y: PY, z: pz.bridgeZ + dz, sx: 0.5, sy: 8.2, sz: 0.5 });
          s.collider({ shape: 'cylinder', x: xx, y: PY + 4.1, z: pz.bridgeZ + dz, r: 0.55, hy: 4.1, walkable: false, solid: true });
        }
      }
      s.box('black_lacquer', { x: (gx0 + gx1) / 2, y: PY + 7.9, z: pz.bridgeZ, sx: pz.galleryW + 0.6, sy: 0.7, sz: 12.6 });
      // Hanging lanterns along the gallery.
      for (let z = z0 + 3.3; z < z1 - 2; z += 9.2) if (Math.abs(z - pz.bridgeZ) > 7) hangingLantern(d, { x: (gx0 + gx1) / 2, y: PY + 5.2, z });
    }

    // Braziers lining the parade ground; great braziers at the stair foot.
    for (let z = pz.canalZ0 + 10; z <= pz.z1 - 8; z += 20) {
      brazier(d, this.flames, { x: pz.paradeX0 + 5, y: PY, z, size: 1.1 });
      brazier(d, this.flames, { x: pz.paradeX1 - 5, y: PY, z, size: 1.1 });
    }
    for (const sx of [-1, 1]) {
      brazier(d, this.flames, { x: C.cx + sx * 21, y: PY, z: pz.stairBase + 6, size: 1.7 });
      dragonStatue(s, { x: C.cx + sx * 15.5, y: PY, z: pz.stairBase + 3.5, yaw: 0, s: 4.2, pedestalH: 1.8 });
      bannerPole(d, { x: C.cx + sx * 27, y: PY, z: pz.stairBase + 2, yaw: 0, h: 13, w: 2.4, len: 7.5 });
      bannerPole(d, { x: C.cx + sx * 9, y: PY, z: pz.z1 - 3, yaw: Math.PI, h: 12, w: 2.2, len: 7 });
      bannerPole(d, { x: C.cx + sx * 55, y: PY, z: pz.z0 + 8, yaw: 0, h: 11, w: 2, len: 6 });
      this.ambient({ x: C.cx + sx * 21, y: PY + 3.2, z: pz.stairBase + 6, preset: 'embers', rate: 5, range: 60 });
    }
    // South entrance: twin obelisk pylons.
    for (const sx of [-1, 1]) {
      const x = C.cx + sx * 15;
      s.block(basaltMat(), { x, y: PY, z: pz.z1 - 2.5, sx: 2.6, sy: 1.2, sz: 2.6 }, { collide: true });
      s.block(crimsonMat(), { x, y: PY + 1.2, z: pz.z1 - 2.5, sx: 1.8, sy: 9, sz: 1.8 }, { collide: true, walkable: false });
      s.box(goldMat(), { x, y: PY + 10.3, z: pz.z1 - 2.5, sx: 2.1, sy: 0.25, sz: 2.1 });
      s.cylinder(goldMat(), { x, y: PY + 10.4, z: pz.z1 - 2.5, r: 0.7, rTop: 0.05, h: 2.6, segments: 4 });
    }
  }

  // -------------------------------------------------------------------------
  // Palace terrace (y = 50) with retaining walls, grand stair and parapets
  // -------------------------------------------------------------------------

  private buildPalaceTerrace(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const t = C.terrace;
    const TY = t.y;
    const cx = (t.x0 + t.x1) / 2, cz = (t.z0 + t.z1) / 2;
    const W = t.x1 - t.x0, D = t.z1 - t.z0;
    // Core block (retaining walls) — walkable at TY-1 (seen only under the pond).
    s.box(ivoryMat(), { x: cx, y: (41.8 + TY - 1) / 2, z: cz, sx: W, sy: TY - 1 - 41.8, sz: D }, { collide: true, walkable: true });
    // Paving + lawn layer with the pond hole.
    const g = C.garden;
    const pond = C.pond;
    const inGarden = (x: number, z: number) => x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1;
    maskSlab(s, 'paving', { x0: t.x0, z0: t.z0, x1: t.x1, z1: t.z1, cell: 2, top: TY, thick: 1.0 }, inGarden);
    maskSlab(s, lawnMat(), { x0: g.x0, z0: g.z0, x1: g.x1, z1: g.z1, cell: 1, top: TY, thick: 1.0, surface: 'grass' }, (x, z) => pondRadius(x, z) < 0);
    // Wall dressing: basalt base, ivory face with tan pilasters, crimson band, gold coping.
    const faces: Array<{ x: number; z: number; len: number; yaw: number; out: [number, number] }> = [
      { x: cx, z: t.z1, len: W, yaw: 0, out: [0, 1] },
      { x: cx, z: t.z0, len: W, yaw: 0, out: [0, -1] },
      { x: t.x0, z: cz, len: D, yaw: Math.PI / 2, out: [-1, 0] },
      { x: t.x1, z: cz, len: D, yaw: Math.PI / 2, out: [1, 0] },
    ];
    for (const f of faces) {
      const ox = f.out[0], oz = f.out[1];
      s.box(basaltMat(), { x: f.x + ox * 0.4, y: 42.6, z: f.z + oz * 0.4, sx: f.len + 1.6, sy: 1.8, sz: 0.8, yaw: f.yaw });
      s.box(crimsonMat(), { x: f.x + ox * 0.15, y: TY - 0.75, z: f.z + oz * 0.15, sx: f.len + 0.3, sy: 1.5, sz: 0.3, yaw: f.yaw });
      s.box(goldMat(), { x: f.x + ox * 0.2, y: TY - 1.55, z: f.z + oz * 0.2, sx: f.len + 0.4, sy: 0.14, sz: 0.4, yaw: f.yaw }, { castShadow: false });
      const n = Math.floor(f.len / 6.5);
      for (let k = 1; k < n; k++) {
        const along = -f.len / 2 + (k * f.len) / n;
        const p = { x: f.x + (f.yaw === 0 ? along : 0) + ox * 0.3, z: f.z + (f.yaw === 0 ? 0 : -along) + oz * 0.3 };
        if (f.out[1] === 1 && Math.abs(p.x - C.cx) < 14) continue; // grand stair
        s.box('stone_tan', { x: p.x, y: (43.5 + TY - 1.6) / 2, z: p.z, sx: 1.3, sy: TY - 1.6 - 43.5, sz: 0.6, yaw: f.yaw });
      }
    }
    // Grand processional stair (with balustraded cheeks).
    flight(s, { from: new THREE.Vector3(C.cx, C.plaza.y, C.plaza.stairBase), to: new THREE.Vector3(C.cx, TY, t.z1), width: t.stairW, mat: 'stone_light', cheek: ivoryMat(), cheekH: 1.0, step: 0.2 });
    for (const sx of [-1, 1]) {
      const x = C.cx + sx * (t.stairW / 2 + 0.35);
      for (let k = 0; k <= 4; k++) {
        const zz = t.z1 + ((C.plaza.stairBase - t.z1) * k) / 4;
        const yy = TY + ((C.plaza.y - TY) * k) / 4;
        d.box(goldMat(), { x, y: yy + 1.1, z: zz, sx: 0.8, sy: 0.25, sz: 0.8 }, { castShadow: false });
        if (k % 2 === 0) d.cylinder('lantern_red', { x, y: yy + 1.2, z: zz, r: 0.28, h: 0.6, segments: 8 });
      }
    }
    // Parapets along the terrace edge (gap for the gate and garden overlooks).
    const py = TY, ph = 1.3;
    const gateHalf = C.gate.w / 2;
    parapet(s, [{ x: t.x0, z: t.z1 }, { x: C.cx - gateHalf, z: t.z1 }], { y: py, h: ph, thick: 0.8, mat: crimsonMat(), merlons: true });
    parapet(s, [{ x: C.cx + gateHalf, z: t.z1 }, { x: t.x1, z: t.z1 }, { x: t.x1, z: t.z0 }, { x: t.x0, z: t.z0 }, { x: t.x0, z: t.z1 }], { y: py, h: ph, thick: 0.8, mat: crimsonMat(), merlons: true });
    // Corner braziers on the parapet corners.
    for (const [x, z] of [[t.x0 + 1.5, t.z1 - 1.5], [t.x1 - 1.5, t.z1 - 1.5], [t.x0 + 1.5, t.z0 + 1.5], [t.x1 - 1.5, t.z0 + 1.5]]) {
      brazier(d, this.flames, { x, y: TY, z, size: 1.2 });
    }
  }

  // -------------------------------------------------------------------------
  // Palace buildings
  // -------------------------------------------------------------------------

  private buildPalace(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const TY = C.terrace.y;
    const g = C.gate;
    // --- Gate of Agni (gatehouse over the top of the stair) ---
    const gz = g.z;
    const towerW = (g.w - g.passage) / 2;
    for (const sx of [-1, 1]) {
      const tx = C.cx + sx * (g.passage / 2 + towerW / 2);
      s.block(basaltMat(), { x: tx, y: TY, z: gz, sx: towerW + 0.6, sy: 1.6, sz: g.d + 0.6 }, { collide: true, walkable: false });
      s.block(crimsonMat(), { x: tx, y: TY + 1.6, z: gz, sx: towerW, sy: g.h - 1.6, sz: g.d }, { collide: true, walkable: true });
      s.box(goldMat(), { x: tx, y: TY + g.h - 1.2, z: gz, sx: towerW + 0.15, sy: 0.15, sz: g.d + 0.15 }, { castShadow: false });
      s.box('black_lacquer', { x: tx, y: TY + g.h - 0.5, z: gz, sx: towerW + 0.1, sy: 1.0, sz: g.d + 0.1 });
      // Tall banner on each tower face.
      wallBanner(d, { x: tx, y: TY + g.h - 2, z: gz + g.d / 2 + 0.08, yaw: 0, w: 3.2, len: 8.5, mat: bannerDarkMat() });
      roof(s, { x: tx, y: TY + g.h, z: gz, w: towerW, d: g.d, h: 3.2, style: 'pyramid', mat: 'roof_dark', overhang: 1.6, curve: 0.9, tips: 1.1, finial: 2.4 });
    }
    // Bridge storey over the passage.
    const by = TY + g.passH;
    s.block(crimsonMat(), { x: C.cx, y: by, z: gz, sx: g.passage + 0.2, sy: g.h - g.passH, sz: g.d - 1 }, { collide: true, walkable: true });
    s.box('black_lacquer', { x: C.cx, y: by + 0.3, z: gz, sx: g.passage + 0.4, sy: 0.6, sz: g.d - 0.6 });
    crest(s, { x: C.cx, y: by + (g.h - g.passH) / 2 + 0.8, z: gz + (g.d - 1) / 2 + 0.12, yaw: 0, size: 3.0 });
    crest(s, { x: C.cx, y: by + (g.h - g.passH) / 2 + 0.8, z: gz - (g.d - 1) / 2 - 0.12, yaw: Math.PI, size: 2.4 });
    roof(s, { x: C.cx, y: TY + g.h + 1.6, z: gz, w: g.w - 6, d: g.d + 2, h: 5.5, mat: 'roof_dark', overhang: 2.2, curve: 1.3, horns: 2.6, tips: 1.4, crest: 2.0 });
    // Massive open gate leaves against the passage walls.
    for (const sx of [-1, 1]) {
      d.box('wood_red', { x: C.cx + sx * (g.passage / 2 - 0.4), y: TY + g.passH / 2 - 0.3, z: gz + g.d / 2 - 3.6, sx: 0.4, sy: g.passH - 0.8, sz: 6.4 });
      for (let k = 0; k < 5; k++) d.box(goldMat(), { x: C.cx + sx * (g.passage / 2 - 0.62), y: TY + 1.2 + k * 1.6, z: gz + g.d / 2 - 3.6, sx: 0.06, sy: 0.12, sz: 6.2 }, { castShadow: false });
    }
    for (const sx of [-1, 1]) {
      brazier(d, this.flames, { x: C.cx + sx * (g.w / 2 + 2.5), y: TY, z: gz + g.d / 2 + 2.5, size: 1.4 });
      this.ambient({ x: C.cx + sx * (g.w / 2 + 2.5), y: TY + 3, z: gz + g.d / 2 + 2.5, preset: 'embers', rate: 4, range: 50 });
    }

    // --- Forecourt galleries ---
    const fc = C.forecourt;
    for (const sx of [-1, 1]) {
      const x = sx < 0 ? fc.x0 - 3 : fc.x1 + 3;
      const z0 = fc.z0, z1 = gz - g.d / 2;
      for (let z = z0 + 1; z <= z1 - 0.5; z += 4.2) {
        s.mesh(lacquerRedMat(), P.column(), { x: x - sx * 2.2, y: TY, z, sx: 0.32, sy: 5.2, sz: 0.32 });
        s.collider({ shape: 'cylinder', x: x - sx * 2.2, y: TY + 2.6, z, r: 0.38, hy: 2.6, walkable: false, solid: true });
      }
      s.box(crimsonMat(), { x: x + sx * 2.4, y: TY + 2.6, z: (z0 + z1) / 2, sx: 0.8, sy: 5.2, sz: z1 - z0 }, { collide: true, walkable: false });
      roof(s, { x, y: TY + 5.2, z: (z0 + z1) / 2, w: z1 - z0, d: 6, h: 2.4, yaw: Math.PI / 2, mat: 'roof_dark', overhang: 1.0, curve: 0.5, horns: 0.9, tips: 0.6, segU: 6, segT: 3 });
      for (let z = z0 + 3; z < z1; z += 8) hangingLantern(d, { x, y: TY + 4.3, z });
    }
    // Forecourt braziers & banners (leave the landmark clear).
    for (const sx of [-1, 1]) {
      brazier(d, this.flames, { x: C.cx + sx * 14, y: TY, z: fc.z0 + 9, size: 1.3, style: 'tripod' });
      brazier(d, this.flames, { x: C.cx + sx * 22, y: TY, z: fc.z1 - 6, size: 1.3, style: 'tripod' });
      bannerPole(d, { x: C.cx + sx * 25, y: TY, z: fc.z0 + 2, yaw: 0, h: 11, w: 2, len: 6.5 });
    }

    // --- Throne hall on its podium ---
    const th = C.throne;
    s.block(basaltMat(), { x: C.cx, y: TY - 0.2, z: th.z, sx: th.podW, sy: th.y - TY + 0.2, sz: th.podD }, { collide: true, walkable: true });
    s.box(goldMat(), { x: C.cx, y: th.y - 0.05, z: th.z, sx: th.podW + 0.2, sy: 0.12, sz: th.podD + 0.2 }, { castShadow: false });
    s.box('paving', { x: C.cx, y: th.y - 0.08, z: th.z, sx: th.podW - 0.2, sy: 0.16, sz: th.podD - 0.2 }, { castShadow: false });
    flight(s, { from: new THREE.Vector3(C.cx, TY, th.z + th.podD / 2 + th.stairRun), to: new THREE.Vector3(C.cx, th.y, th.z + th.podD / 2), width: 20, mat: 'stone_light', cheek: basaltMat(), cheekH: 0.7 });
    const hallTop = hall(s, { x: C.cx, y: th.y, z: th.z, yaw: 0, w: th.w, d: th.d, h: th.h, veranda: 3, colSpacing: 4.6, wall: crimsonMat(), roofMat: 'roof_dark', colMat: lacquerRedMat(), upper: { h: 6.5, inset: 5, roofH: 6.8 }, horns: 3.4, crest: 2.8 });
    crest(s, { x: C.cx, y: th.y + th.h - 0.6, z: th.z + th.d / 2 + 3.4, yaw: 0, size: 2.2 });
    for (const sx of [-1, 1]) {
      wallBanner(d, { x: C.cx + sx * 9.5, y: th.y + th.h - 1.4, z: th.z + th.d / 2 + 0.12, yaw: 0, w: 2.6, len: 6.5 });
      brazier(d, this.flames, { x: C.cx + sx * 13, y: TY, z: th.z + th.podD / 2 + 2.5, size: 1.5 });
      dragonStatue(s, { x: C.cx + sx * 11.5, y: TY, z: th.z + th.podD / 2 + th.stairRun - 1, yaw: 0, s: 2.6, pedestalH: 1.1 });
    }
    void hallTop;

    // --- Central tower ---
    this.palaceTower(s, d, this.flames, C.tower.x, TY, C.tower.z);

    // --- Twin pagodas ---
    for (const p of C.pagodas) pagodaTower(s, { x: p.x, y: TY, z: p.z, size: 12, tiers: 5, tierH: 5.6, wall: crimsonMat(), roofMat: 'roof_dark', spire: 6 });

    // --- East wing (two storeys, facing the forecourt) ---
    const ew = C.eastWing;
    hall(s, { x: ew.x, y: TY + 0.6, z: ew.z, yaw: -Math.PI / 2, w: ew.len, d: 12, h: 7, veranda: 2.2, colSpacing: 4.4, wall: crimsonMat(), roofMat: 'roof_dark', upper: { h: 4.5, inset: 3, roofH: 4.2 }, horns: 2.0 });
    s.block(basaltMat(), { x: ew.x, y: TY - 0.2, z: ew.z, sx: 18.6, sy: 0.8, sz: ew.len + 6.4 }, { collide: true, walkable: true });
    // North residence halls behind the tower.
    for (const sx of [-1, 1]) {
      hall(s, { x: C.cx + sx * 38, y: TY, z: C.terrace.z0 + 12, yaw: 0, w: 26, d: 11, h: 6.5, veranda: 2, colSpacing: 4, wall: crimsonMat(), roofMat: 'roof_dark', horns: 1.6 });
    }
  }

  /** The tall central tower: three stages with gold ribs, skirt roofs, crown and eternal beacon. */
  private palaceTower(s: ContentBuilder, d: ContentBuilder, flames: FlameField, x: number, y0: number, z: number): void {
    const stages = C.tower.stages;
    s.block(basaltMat(), { x, y: y0 - 0.2, z, sx: stages[0].w + 4, sy: 1.6, sz: stages[0].d + 4 }, { collide: true, walkable: true });
    let y = y0 + 1.4;
    for (let i = 0; i < stages.length; i++) {
      const st = stages[i];
      s.block(crimsonMat(), { x, y, z, sx: st.w, sy: st.h, sz: st.d }, { collide: true, walkable: true });
      // Gold corner strips and vertical ribs.
      for (const cxs of [-1, 1]) for (const czs of [-1, 1]) s.box(goldMat(), { x: x + cxs * st.w / 2, y: y + st.h / 2, z: z + czs * st.d / 2, sx: 0.55, sy: st.h, sz: 0.55 }, { castShadow: false });
      const ribs = Math.max(2, Math.round(st.w / 3.4));
      for (let k = 1; k < ribs; k++) {
        const lx = -st.w / 2 + (k * st.w) / ribs;
        for (const czs of [-1, 1]) {
          s.box(goldMat(), { x: x + lx, y: y + st.h / 2, z: z + czs * (st.d / 2 + 0.06), sx: 0.16, sy: st.h, sz: 0.1 }, { castShadow: false });
          // Dark window slits between ribs.
          if (k < ribs) d.box('black_lacquer', { x: x + lx - st.w / ribs / 2, y: y + st.h * 0.55, z: z + czs * (st.d / 2 + 0.04), sx: 0.9, sy: st.h * 0.62, sz: 0.06 }, { castShadow: false });
        }
      }
      const sideRibs = Math.max(2, Math.round(st.d / 3.4));
      for (let k = 1; k < sideRibs; k++) {
        const lz = -st.d / 2 + (k * st.d) / sideRibs;
        for (const cxs of [-1, 1]) s.box(goldMat(), { x: x + cxs * (st.w / 2 + 0.06), y: y + st.h / 2, z: z + lz, sx: 0.1, sy: st.h, sz: 0.16 }, { castShadow: false });
      }
      for (let k = 1; k < Math.floor(st.h / 6); k++) s.box(goldMat(), { x, y: y + k * 6, z, sx: st.w + 0.12, sy: 0.14, sz: st.d + 0.12 }, { castShadow: false });
      // Frieze + skirt roof.
      s.box('black_lacquer', { x, y: y + st.h - 0.6, z, sx: st.w + 0.2, sy: 1.2, sz: st.d + 0.2 });
      roof(s, { x, y: y + st.h, z, w: st.w, d: st.d, h: 1.6 + i * 0.3, mat: 'roof_dark', overhang: 2.2 - i * 0.3, curve: 1.0, tips: 1.3 - i * 0.2, horns: 0, ridge: null, segU: 6, segT: 2 });
      y += st.h + 1.2;
    }
    // Crown.
    const top = stages[stages.length - 1];
    s.block('black_lacquer', { x, y: y - 0.4, z, sx: top.w + 2, sy: 1.6, sz: top.d + 2 }, { collide: true, walkable: true });
    s.box(goldMat(), { x, y: y + 1.25, z, sx: top.w + 2.2, sy: 0.2, sz: top.d + 2.2 }, { castShadow: false });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * (top.w / 2 + 0.6), pz = z + Math.sin(a) * (top.d / 2 + 0.6);
      s.mesh(goldMat(), P.finial(), { x: px, y: y + 1.2, z: pz, yaw: -a, sx: 2.2, sy: 2.2, sz: 2.2 });
    }
    s.cylinder(goldMat(), { x, y: y + 1.2, z, r: 2.4, rTop: 1.6, h: 2.0, segments: 12 });
    s.mesh('bronze', P.bowl(), { x, y: y + 3.1, z, sx: 2.4, sy: 1.6, sz: 2.4 });
    flames.add(x, y + 3.8, z, 4.5, 7.5);
    this.ambient({ x, y: y + 6, z, preset: 'embers', rate: 6, range: 140, essential: true, size: 1.6 });
    // Giant hanging banner on the tower front.
    wallBanner(d, { x, y: y0 + 1.4 + stages[0].h - 3, z: z + stages[0].d / 2 + 0.2, yaw: 0, w: 5, len: 14, mat: bannerDarkMat() });
    crest(s, { x, y: y - top.h * 0.5 - 1.2, z: z + top.d / 2 + 0.2, yaw: 0, size: 3 });
  }

  // -------------------------------------------------------------------------
  // Palace garden & turtle-duck pond
  // -------------------------------------------------------------------------

  private buildGarden(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const g = C.garden;
    const pond = C.pond;
    const TY = C.terrace.y;
    // Pond bed and water (blob outline).
    const shape = new THREE.Shape();
    const N = 40;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = pondR(a) + 0.5;
      // Shape Y = -world Z so that rotateX(-PI/2) (normal up) maps it back to +Z.
      const px = Math.cos(a) * r, py = -Math.sin(a) * r;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    const bedGeo = new THREE.ShapeGeometry(shape, 1);
    bedGeo.rotateX(-Math.PI / 2);
    const bed = new THREE.Mesh(bedGeo, pondBedMat());
    bed.position.set(pond.x, TY - 0.98, pond.z);
    this.own(bed);
    const waterGeo = new THREE.ShapeGeometry(shape, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, pondWaterMat());
    water.position.set(pond.x, pond.y, pond.z);
    water.renderOrder = 2;
    water.name = 'water_turtleduck_pond';
    this.own(water);
    this.pondWater = water;
    this.water({
      id: 'fire_capital:turtleduck_pond',
      type: 'pond',
      label: 'Turtle-Duck Pond',
      x: pond.x,
      y: pond.y,
      z: pond.z,
      r: pond.r,
      capacity: 160,
      regen: 2.5,
      size: 'medium',
      onChange: (amount, capacity) => {
        this.pondLevel = pond.y - 0.35 * (1 - Math.max(0, Math.min(1, amount / capacity)));
        if (this.pondWater) this.pondWater.position.y = this.pondLevel;
      },
    });
    // Rim stones hide the stepped edge of the walkable mask.
    const rr = mulberry(77);
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const r = pondR(a) + 0.35;
      rock(d, { x: pond.x + Math.cos(a) * r, y: TY - 0.35, z: pond.z + Math.sin(a) * r, s: 0.9 + rr() * 0.5, sy: 0.55 + rr() * 0.25, yaw: rr() * 6, variant: i, mat: 'stone_grey' });
    }
    // Arched red bridge across the west part of the pond.
    s.bridge({ a: new THREE.Vector3(pond.x - 5, TY, pond.z + 11.5), b: new THREE.Vector3(pond.x - 5, TY, pond.z - 11.5), width: 2.4, deck: 'wood_red', rail: lacquerRedMat(), arch: 1.3, surface: 'wood' });
    // Small red pagoda pavilion on the west bank, a three-tier red pagoda across the water.
    this.pavilion(s, d, g.pavilion.x, TY, g.pavilion.z);
    pagodaTower(s, { x: -1377, y: TY, z: 1061.5, size: 4.2, tiers: 3, tierH: 2.6, wall: crimsonMat(), roofMat: 'roof_red', spire: 2.2 });
    // Garden walls: east side (moon gate opening) and north side, with tiled coping.
    const wallH = 2.6;
    const gw = (pts: Array<{ x: number; z: number }>) => {
      parapet(s, pts, { y: TY, h: wallH, thick: 0.6, mat: crimsonMat(), cap: null });
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b2 = pts[i + 1];
        const len = Math.hypot(b2.x - a.x, b2.z - a.z);
        const yaw = Math.atan2(-(b2.z - a.z), b2.x - a.x);
        roof(s, { x: (a.x + b2.x) / 2, y: TY + wallH, z: (a.z + b2.z) / 2, w: len, d: 0.6, h: 0.5, yaw, style: 'gable', overhang: 0.45, curve: 0.15, mat: 'roof_dark', trim: null, ridge: 'black_lacquer', segU: 4, segT: 1 });
      }
    };
    gw([{ x: g.x1, z: g.z0 }, { x: g.x1, z: g.moonZ - 2.4 }]);
    gw([{ x: g.x1, z: g.moonZ + 2.4 }, { x: g.x1, z: g.z1 }]);
    gw([{ x: g.x0, z: g.z0 }, { x: g.x1, z: g.z0 }]);
    // Moon gate frame (ring) over the opening.
    s.mesh(crimsonMat(), P.crestRing(), { x: g.x1, y: TY + 2.3, z: g.moonZ, yaw: Math.PI / 2, sx: 4.4, sy: 4.4, sz: 6 });
    s.box(crimsonMat(), { x: g.x1, y: TY + 4.4, z: g.moonZ, sx: 0.6, sy: 0.9, sz: 4.8 }, { collide: true, walkable: false });
    // Paths (stepping-stone strips on the lawn).
    const paths: Array<[number, number, number, number]> = [
      [g.x1, g.moonZ, pond.x + 9, pond.z + 13],
      [pond.x + 9, pond.z + 13, pond.x - 5, pond.z + 12.5],
      [pond.x - 5, pond.z - 12.5, g.pavilion.x + 2, g.pavilion.z - 5],
      [pond.x + 9, pond.z + 13, C.landmarks.pond.x, C.landmarks.pond.z + 8],
    ];
    for (const [x0, z0, x1, z1] of paths) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(-(z1 - z0), x1 - x0);
      d.box('paving', { x: (x0 + x1) / 2, y: TY + 0.02, z: (z0 + z1) / 2, sx: len, sy: 0.04, sz: 2.2, yaw }, { castShadow: false });
    }
    // Viewing deck at the landmark (paved disc) with stone lanterns.
    const lm = C.landmarks.pond;
    d.cylinder('paving', { x: lm.x, y: TY - 0.02, z: lm.z, r: 5.5, h: 0.06, segments: 20 });
    stoneLantern(d, { x: lm.x + 5.2, y: TY, z: lm.z - 1.5 });
    stoneLantern(d, { x: lm.x - 5.4, y: TY, z: lm.z + 2.5 });
    // Trees: the great pine by the water, willows over the pond, red maples, pines along the walls.
    tree(d, 'pine', { x: pond.x + 10, y: TY, z: pond.z - 7, s: 10, variant: 0 });
    tree(d, 'willow', { x: pond.x + 11.5, y: TY, z: pond.z + 2, s: 9, variant: 0 });
    tree(d, 'willow', { x: pond.x - 2, y: TY, z: pond.z - 12.5, s: 8, variant: 0 });
    tree(d, 'maple', { x: g.x0 + 4, y: TY, z: g.z1 - 5, s: 7, variant: 0 });
    tree(d, 'maple', { x: g.x1 - 5, y: TY, z: g.z1 - 4, s: 6.5, variant: 0 });
    tree(d, 'maple', { x: g.x1 - 4, y: TY, z: g.z0 + 5, s: 7, variant: 0 });
    tree(d, 'pine', { x: g.x0 + 4, y: TY, z: g.z0 + 4, s: 9, variant: 0 });
    tree(d, 'pine', { x: g.x0 + 3.5, y: TY, z: g.z1 - 17, s: 8, variant: 0 });
    tree(d, 'pine', { x: (g.x0 + g.x1) / 2 + 6, y: TY, z: g.z0 + 3.5, s: 8.5, variant: 0 });
    for (let i = 0; i < 8; i++) tree(d, 'bush', { x: g.x0 + 2 + rr() * (g.x1 - g.x0 - 4), y: TY, z: g.z1 - 2 - rr() * 10, s: 1.6 + rr() * 0.8, variant: 0, collide: false });
    for (let i = 0; i < 6; i++) rock(d, { x: g.x0 + 3 + rr() * 8, y: TY - 0.1, z: g.z0 + 10 + rr() * 30, s: 1.0 + rr() * 1.2, variant: 0, mat: 'stone_grey', collide: true });
    // Turtle-ducks.
    const tdg = turtleDuckGeo();
    const shellMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: '#5a7a3a', roughness: 0.6 }));
    const bodyMat = this.ownMaterial(new THREE.MeshStandardMaterial({ color: '#e8c25a', roughness: 0.7 }));
    // Two instanced meshes (shell, body) for the whole family: 2 draw calls instead of 10.
    const shellIM = this.own(new THREE.InstancedMesh(tdg.shell, shellMat, 5));
    const bodyIM = this.own(new THREE.InstancedMesh(tdg.body, bodyMat, 5));
    shellIM.name = 'turtleducks_shell';
    bodyIM.name = 'turtleducks_body';
    shellIM.castShadow = bodyIM.castShadow = false;
    this.duckMeshes = [shellIM, bodyIM];
    for (let i = 0; i < 5; i++) {
      const obj = new THREE.Object3D();
      obj.scale.setScalar(i < 2 ? 1 : 0.55); // two parents, three ducklings
      const a0 = (i / 5) * Math.PI * 2, r0 = 3 + (i % 3) * 1.6;
      obj.position.set(pond.x + Math.cos(a0) * r0, pond.y, pond.z + Math.sin(a0) * r0);
      obj.updateMatrix();
      shellIM.setMatrixAt(i, obj.matrix);
      bodyIM.setMatrixAt(i, obj.matrix);
      this.ducks.push({ obj, a: a0, r: r0, speed: 0.12 + (i % 2) * 0.05, phase: i * 1.7 });
    }
    for (const m of this.duckMeshes) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
  }

  private pavilion(s: ContentBuilder, d: ContentBuilder, x: number, y: number, z: number): void {
    s.cylinder(basaltMat(), { x, y: y - 0.4, z, r: 4.2, h: 0.9, segments: 8 }, { collide: true, walkable: true });
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * 3.3, pz = z + Math.sin(a) * 3.3;
      s.mesh(lacquerRedMat(), P.column(), { x: px, y: y + 0.5, z: pz, sx: 0.22, sy: 3.4, sz: 0.22 });
      s.collider({ shape: 'cylinder', x: px, y: y + 2.2, z: pz, r: 0.25, hy: 1.7, walkable: false, solid: true });
      if (k !== 2) d.box(lacquerRedMat(), { x: x + Math.cos(a + Math.PI / 8) * 3.15, y: y + 1.0, z: z + Math.sin(a + Math.PI / 8) * 3.15, sx: 0.1, sy: 0.12, sz: 2.4, yaw: -(a + Math.PI / 8) });
    }
    roof(s, { x, y: y + 3.9, z, w: 6.6, d: 6.6, h: 2.2, style: 'pyramid', mat: 'roof_red', overhang: 1.1, curve: 0.8, tips: 0.8, ridge: null });
    s.block(crimsonMat(), { x, y: y + 5.0, z, sx: 2.8, sy: 1.4, sz: 2.8 });
    roof(s, { x, y: y + 6.4, z, w: 2.8, d: 2.8, h: 1.6, style: 'pyramid', mat: 'roof_red', overhang: 0.9, curve: 0.5, tips: 0.6, finial: 1.6, ridge: null });
    hangingLantern(d, { x, y: y + 3.2, z });
  }

  // -------------------------------------------------------------------------
  // Agni Kai Arena
  // -------------------------------------------------------------------------

  private buildArena(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const a = C.arena;
    const DY = a.y;
    // Dais (duel floor) with gold border and an inlaid emblem.
    s.block(basaltMat(), { x: a.x, y: 41.8, z: a.z, sx: a.dais, sy: DY - 41.8, sz: a.dais }, { collide: true, walkable: true });
    s.box('paving_dark', { x: a.x, y: DY - 0.03, z: a.z, sx: a.dais - 1.2, sy: 0.08, sz: a.dais - 1.2 }, { castShadow: false });
    s.box(goldMat(), { x: a.x, y: DY + 0.005, z: a.z, sx: a.dais - 0.6, sy: 0.02, sz: a.dais - 0.6 }, { castShadow: false });
    s.box('paving_dark', { x: a.x, y: DY + 0.01, z: a.z, sx: a.dais - 1.6, sy: 0.02, sz: a.dais - 1.6 }, { castShadow: false });
    d.mesh('stone_red', P.emblem(), { x: a.x, y: DY + 0.03, z: a.z - 5, pitch: -Math.PI / 2, sx: 9, sy: 9, sz: 0.4 }, { castShadow: false });
    // Steps on the west (plaza) and north (boulevard) sides.
    flight(s, { from: new THREE.Vector3(a.x - a.dais / 2 - 2.4, 41.9, a.z), to: new THREE.Vector3(a.x - a.dais / 2, DY, a.z), width: 12, mat: 'stone_light' });
    flight(s, { from: new THREE.Vector3(a.x, 41.9, a.z - a.dais / 2 - 2.4), to: new THREE.Vector3(a.x, DY, a.z - a.dais / 2), width: 10, mat: 'stone_light' });
    // Flame trenches along the south & east edges of the dais.
    for (const [tx, tz, w, dd] of [[a.x, a.z + a.dais / 2 + 1.6, a.dais, 1.2], [a.x + a.dais / 2 + 1.6, a.z, 1.2, a.dais]] as Array<[number, number, number, number]>) {
      s.block(basaltMat(), { x: tx, y: 41.8, z: tz, sx: w + 1.2, sy: DY - 41.8 + 0.3, sz: dd + 1.2 }, { collide: true, walkable: false });
      d.box('glow_fire', { x: tx, y: DY + 0.32, z: tz, sx: w, sy: 0.04, sz: dd }, { castShadow: false });
      const n = Math.round(Math.max(w, dd) / 2.6);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n - 0.5;
        this.flames.add(tx + (w > dd ? t * w : 0), DY + 0.3, tz + (w > dd ? 0 : t * dd), 1.5, 1.9);
      }
    }
    // Columns + great roof (open sides so duels stay readable).
    const H = a.colH;
    const half = a.hall / 2;
    for (let i = 0; i <= 4; i++) {
      for (const [lx, lz] of [[-half + (i * a.hall) / 4, -half], [-half + (i * a.hall) / 4, half], [-half, -half + (i * a.hall) / 4], [half, -half + (i * a.hall) / 4]]) {
        const x = a.x + lx, z = a.z + lz;
        const gy = 42;
        s.block(basaltMat(), { x, y: gy - 0.2, z, sx: 1.8, sy: 1.4, sz: 1.8 }, { collide: true, walkable: true });
        s.mesh(lacquerRedMat(), P.column(), { x, y: gy + 1.2, z, sx: 0.62, sy: H - 1.2, sz: 0.62 });
        for (const by of [3.5, H - 2.5]) s.cylinder(goldMat(), { x, y: gy + by, z, r: 0.72, h: 0.3, segments: 8 });
        s.collider({ shape: 'cylinder', x, y: gy + H / 2, z, r: 0.68, hy: H / 2, walkable: false, solid: true });
      }
    }
    for (const sd of [-1, 1]) {
      s.box('black_lacquer', { x: a.x, y: 42 + H - 0.5, z: a.z + sd * half, sx: a.hall + 1, sy: 1.0, sz: 0.8 });
      s.box('black_lacquer', { x: a.x + sd * half, y: 42 + H - 0.5, z: a.z, sx: 0.8, sy: 1.0, sz: a.hall + 1 });
      s.box(goldMat(), { x: a.x, y: 42 + H - 1.05, z: a.z + sd * half, sx: a.hall + 1.1, sy: 0.12, sz: 0.85 }, { castShadow: false });
      s.box(goldMat(), { x: a.x + sd * half, y: 42 + H - 1.05, z: a.z, sx: 0.85, sy: 0.12, sz: a.hall + 1.1 }, { castShadow: false });
    }
    roof(s, { x: a.x, y: 42 + H, z: a.z, w: a.hall, d: a.hall, h: 3.4, mat: 'roof_dark', overhang: 3, curve: 1.4, tips: 1.6, ridge: null, horns: 0, segU: 8, segT: 3 });
    s.block(crimsonMat(), { x: a.x, y: 42 + H + 2.4, z: a.z, sx: a.hall * 0.55, sy: 3.4, sz: a.hall * 0.55 });
    s.box(goldMat(), { x: a.x, y: 42 + H + 5.5, z: a.z, sx: a.hall * 0.55 + 0.2, sy: 0.15, sz: a.hall * 0.55 + 0.2 }, { castShadow: false });
    roof(s, { x: a.x, y: 42 + H + 5.8, z: a.z, w: a.hall * 0.55, d: a.hall * 0.55, h: 5.2, mat: 'roof_dark', overhang: 2.2, curve: 1.4, horns: 2.6, tips: 1.4, crest: 2.4, segU: 8, segT: 4 });
    // Spectator stands (three stepped rows) between the hall columns and the dais on the
    // west side, split around the west stair so the duel floor stays reachable.
    for (const [z0, z1] of [[a.z - a.dais / 2 + 1, a.z - 7.5], [a.z + 7.5, a.z + a.dais / 2 - 1]]) {
      for (let k = 0; k < 3; k++) {
        s.block('stone_light', { x: a.x - a.dais / 2 - 2.6 - k * 1.25, y: 41.8, z: (z0 + z1) / 2, sx: 1.25, sy: 0.75 + k * 0.5, sz: z1 - z0 }, { collide: true, walkable: true });
      }
    }
    // Braziers at the dais corners and banners.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      brazier(d, this.flames, { x: a.x + sx * (a.dais / 2 - 1.2), y: DY, z: a.z + sz * (a.dais / 2 - 1.2), size: 1.15, style: 'tripod' });
      wallBanner(d, { x: a.x + sx * half, y: 42 + H - 1.4, z: a.z + sz * (half - 6) , yaw: sx > 0 ? -Math.PI / 2 : Math.PI / 2, w: 2.2, len: 6, mat: bannerDarkMat() });
    }
    this.ambient({ x: a.x, y: DY + 2, z: a.z + a.dais / 2 + 1.6, preset: 'embers', rate: 6, range: 70, essential: false });
  }

  // -------------------------------------------------------------------------
  // Fire Sages' Temple
  // -------------------------------------------------------------------------

  private buildTemple(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const t = C.temple;
    const yaw = Math.PI / 2; // front faces +X (the plaza)
    // Training court (paved) in front.
    slab(s, 'paving', { x: t.court.x, z: t.court.z, w: t.court.w, d: t.court.d, top: 42.3, thick: 0.6 });
    s.box(goldMat(), { x: t.court.x, y: 42.31, z: t.court.z, sx: t.court.w - 3, sy: 0.02, sz: t.court.d - 3 }, { castShadow: false });
    s.box('paving_dark', { x: t.court.x, y: 42.32, z: t.court.z, sx: t.court.w - 3.6, sy: 0.02, sz: t.court.d - 3.6 }, { castShadow: false });
    // Stepped podium.
    for (let k = 0; k < 3; k++) {
      s.block(k === 2 ? 'paving' : basaltMat(), { x: t.x, y: 41.8 + k * 1.1, z: t.z, sx: t.podX - k * 3, sy: 1.1 + (k === 2 ? 0.1 : 0), sz: t.podZ - k * 3 }, { collide: true, walkable: true });
    }
    const topY = 41.8 + 3 * 1.1 + 0.1;
    flight(s, { from: new THREE.Vector3(t.x + t.podX / 2 + 3.6, 42.3, t.z), to: new THREE.Vector3(t.x + t.podX / 2 - 3, topY, t.z), width: 10, mat: 'stone_light', cheek: basaltMat(), cheekH: 0.6 });
    hall(s, { x: t.x - 2, y: topY, z: t.z, yaw, w: 22, d: 14, h: 8, veranda: 2.4, colSpacing: 4.4, wall: crimsonMat(), roofMat: 'roof_red', upper: { h: 4, inset: 3.5, roofH: 4.2 }, horns: 2.0, crest: 1.6 });
    // The sages' spire.
    const sp = t.spire;
    let y = topY;
    let w = 9;
    s.block(basaltMat(), { x: sp.x, y: y - 0.2, z: sp.z, sx: w + 2, sy: 1.2, sz: w + 2 }, { collide: true, walkable: true });
    y += 1;
    for (let i = 0; i < 6; i++) {
      const h = i === 0 ? 9 : 6.2 - i * 0.4;
      s.block(crimsonMat(), { x: sp.x, y, z: sp.z, sx: w, sy: h, sz: w }, { collide: true, walkable: true });
      s.box(goldMat(), { x: sp.x, y: y + h - 0.6, z: sp.z, sx: w + 0.12, sy: 0.14, sz: w + 0.12 }, { castShadow: false });
      for (let k = 0; k < 4; k++) {
        const aa = (k * Math.PI) / 2;
        const p = local(sp.x, sp.z, aa, 0, w / 2 + 0.05);
        d.box(paperMat(), { x: p.x, y: y + h * 0.5, z: p.z, sx: w * 0.3, sy: h * 0.45, sz: 0.05, yaw: aa }, { castShadow: false });
      }
      roof(s, { x: sp.x, y: y + h, z: sp.z, w, d: w, h: 1.4, style: 'pyramid', mat: 'roof_dark', overhang: 1.4 - i * 0.12, curve: 0.8, tips: 0.8 - i * 0.07, ridge: null, segU: 5, segT: 2 });
      y += h + 0.7;
      w *= 0.84;
    }
    s.cylinder(goldMat(), { x: sp.x, y: y - 0.2, z: sp.z, r: 1.1, rTop: 0.1, h: 9, segments: 6 });
    s.mesh(goldMat(), P.finial(), { x: sp.x, y: y + 8.4, z: sp.z, yaw: Math.PI / 2, sx: 2, sy: 2, sz: 2 });
    // Braziers flanking the steps and around the court; banners.
    for (const sz of [-1, 1]) {
      brazier(d, this.flames, { x: t.x + t.podX / 2 + 2.2, y: 42.3, z: t.z + sz * 7.5, size: 1.4 });
      bannerPole(d, { x: t.court.x + t.court.w / 2 - 1.5, y: 42.3, z: t.court.z + sz * (t.court.d / 2 - 1.5), yaw: -Math.PI / 2, h: 10, w: 1.8, len: 6 });
      brazier(d, this.flames, { x: t.court.x, y: 42.3, z: t.court.z + sz * (t.court.d / 2 - 1.2), size: 1.0, style: 'bowl' });
    }
    this.ambient({ x: t.x + t.podX / 2 + 2.2, y: 45.5, z: t.z, preset: 'embers', rate: 4, range: 50 });
  }

  // -------------------------------------------------------------------------
  // Boulevard from the rim gate road to the plaza, with market stalls
  // -------------------------------------------------------------------------

  private buildBoulevard(): void {
    const s = this.layer('core', { far: true });
    const d = this.layer('core_detail');
    const bv = C.boulevard;
    // Junction square between the plaza's north-east corner, the arena and the road end.
    slab(s, 'paving', { x: bv.square.x, z: bv.square.z, w: bv.square.w, d: bv.square.d, top: 42.25, thick: 0.5 });
    // Paved avenue over the terrain road.
    const a = bv.a, b2 = bv.b;
    const len = Math.hypot(b2.x - a.x, b2.z - a.z);
    const yaw = Math.atan2(-(b2.z - a.z), b2.x - a.x);
    const n = bv.segments;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const x0 = a.x + (b2.x - a.x) * t0, z0 = a.z + (b2.z - a.z) * t0;
      const x1 = a.x + (b2.x - a.x) * t1, z1 = a.z + (b2.z - a.z) * t1;
      const y0 = Math.max(heightAt(x0, z0), 42) + 0.22, y1 = Math.max(heightAt(x1, z1), 42) + 0.22;
      const top = Math.max(y0, y1);
      s.box('paving', { x: (x0 + x1) / 2, y: top - 0.3, z: (z0 + z1) / 2, sx: len / n + 0.1, sy: 0.6, sz: bv.width, yaw }, { collide: true, walkable: true, castShadow: false });
    }
    // Lantern posts and shopfronts along both sides.
    const r = mulberry(404);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const px = a.x + (b2.x - a.x) * t, pz = a.z + (b2.z - a.z) * t;
      for (const side of [-1, 1]) {
        // side +1 = north of the avenue, -1 = south.
        const off = (dist: number) => ({ x: px + Math.sin(yaw) * side * dist, z: pz + Math.cos(yaw) * side * dist });
        const lp = off(bv.width / 2 + 0.6);
        if (k % 2 === 0) lanternPost(d, { x: lp.x, y: Math.max(heightAt(lp.x, lp.z), 42), z: lp.z, yaw: yawTo(lp.x, lp.z, px, pz) });
        const hp = off(bv.width / 2 + 7.5);
        const gy = Math.max(heightAt(hp.x, hp.z), 42);
        if (side < 0 && (bv.stallSegments as readonly number[]).includes(k)) {
          // Market stalls on the south side (merchant spots, see spots.ts).
          const st = boulevardStall(k);
          stall(d, { x: st.x, y: Math.max(heightAt(st.x, st.z), 42), z: st.z, yaw: st.yaw, seed: 50 + k, w: 4.2 });
          continue;
        }
        if (Math.hypot(hp.x - C.arena.x, hp.z - C.arena.z) < C.arena.hall / 2 + 10) continue;
        if (hp.x < C.terrace.x1 + 6 && hp.z < C.terrace.z1 + 2) continue;
        house(s, { x: hp.x, y: gy, z: hp.z, yaw: yawTo(hp.x, hp.z, px, pz), w: 8 + r() * 2, d: 8, floors: r() < 0.6 ? 2 : 1, wall: r() < 0.5 ? crimsonMat() : 'plaster_cream', roofMat: r() < 0.5 ? 'roof_dark' : 'roof_red', seed: 900 + k * 3 + side, ornate: r() < 0.3 }, d);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Ambient life: palace guards, a parade formation, sages, citizens
  // -------------------------------------------------------------------------

  private ambientLife(): void {
    const R = 'fire_nation_capital';
    const TY = C.terrace.y;
    let seed = 9100;
    const add = (id: string, name: string, role: 'guard' | 'soldier' | 'villager' | 'elder' | 'noble' | 'student', x: number, z: number, y: number, yaw: number, behavior: { type: 'idle'; variant?: 'stand' | 'sit' | 'meditate' | 'kneel' | 'work' | 'guard' } | { type: 'wander'; radius: number } | { type: 'train' }) =>
      this.npc({ id: `fn_amb_${id}`, name, role, nation: 'fire', element: role === 'soldier' || role === 'guard' || role === 'student' ? 'fire' : undefined, appearanceSeed: seed++, x, z, y, yaw, behavior, region: R, marker: 'none' });
    // Gate of Agni guards (outside the passage, facing the stair).
    for (const sx of [-1, 1]) add(`gate_guard_${sx}`, 'Palace Guard', 'guard', C.cx + sx * (C.gate.passage / 2 - 1.1), C.gate.z + C.gate.d / 2 - 1.4, TY, 0, { type: 'idle', variant: 'guard' });
    // A parade formation drilling on the west side of the parade ground (facing the palace).
    for (let row = 0; row < 2; row++) for (let col = 0; col < 4; col++) {
      add(`parade_${row}_${col}`, 'Fire Nation Soldier', 'soldier', -1357 + col * 3.6, 1252 + row * 3.6, C.plaza.y, Math.PI, row === 0 && col === 0 ? { type: 'train' } : { type: 'idle', variant: 'guard' });
    }
    // Fire Sages meditating beside the temple steps.
    for (const sz of [-1, 1]) add(`sage_${sz}`, 'Fire Sage', 'elder', C.temple.x + C.temple.podX / 2 + 4.5, C.temple.z + sz * 11.5, 42.3, -Math.PI / 2, { type: 'idle', variant: 'meditate' });
    // Citizens: the boulevard square, the plaza's south steps, the terrace walkways.
    add('citizen_square', 'Capital Citizen', 'villager', C.boulevard.square.x, C.boulevard.square.z, 42.25, 0, { type: 'wander', radius: 9 });
    add('citizen_south', 'Capital Citizen', 'noble', -1300, 1300, 42, Math.PI, { type: 'wander', radius: 8 });
    add('citizen_garden', 'Palace Gardener', 'villager', C.garden.x0 + 8, C.garden.z1 - 8, TY, 0, { type: 'idle', variant: 'work' });
    // Rim gate sentries on the outer face of the gatehouse.
    for (const side of [-1, 1]) {
      const g = local(RIM_GATE.x, RIM_GATE.z, RIM_GATE.yaw, side * (RIM_GATE.passage / 2 + 3.4), -RIM_GATE.depth / 2 - 4.5);
      add(`rim_guard_${side}`, 'Gate Sentry', 'guard', g.x, g.z, heightAt(g.x, g.z), RIM_GATE.yaw + Math.PI, { type: 'idle', variant: 'guard' });
    }
    // Arena: two duellists practising on the north steps.
    add('duellist_a', 'Agni Kai Duellist', 'student', C.arena.x - 6, C.arena.z - C.arena.dais / 2 - 4, 42, 0, { type: 'train' });

    // Interactions: feeding the turtle-ducks pulls them to the bank for a while.
    const lm = C.landmarks.pond;
    this.interactable({
      id: 'fn_feed_turtleducks',
      position: new THREE.Vector3(lm.x - 2, TY + 1, lm.z - 4),
      radius: 4,
      label: 'Feed the turtle-ducks',
      enabled: () => this.ctx.time.elapsed > this.duckLureUntil,
      interact: (ctx) => {
        const p = ctx.player?.position;
        if (!p) return;
        this.duckLure.set(p.x, p.z);
        this.duckLureUntil = ctx.time.elapsed + 12;
        ctx.events.emit('ui:notify', { text: 'The turtle-ducks paddle over, quacking for bread.', kind: 'info', duration: 3 });
      },
    });
  }

  private duckLure = new THREE.Vector2();
  private duckLureUntil = -1;


  protected override animate(dt: number, ctx: GameContext): void {
    const p = C.pond;
    const t = ctx.time.elapsed;
    const lured = t < this.duckLureUntil;
    for (const dk of this.ducks) {
      dk.a += dk.speed * dt;
      const wob = Math.sin(t * 0.4 + dk.phase) * 0.8;
      let x = p.x + Math.cos(dk.a) * (dk.r + wob);
      let z = p.z + Math.sin(dk.a) * (dk.r + wob);
      if (lured) {
        // Gather near the bank closest to the feeder (stay inside the pond).
        const la = Math.atan2(this.duckLure.y - p.z, this.duckLure.x - p.x);
        const rr = pondR(la) - 1.6 - (dk.phase % 1.2);
        const tx = p.x + Math.cos(la + (dk.phase - 3) * 0.12) * rr, tz = p.z + Math.sin(la + (dk.phase - 3) * 0.12) * rr;
        const k = Math.min(1, (this.duckLureUntil - t) > 10 ? (12 - (this.duckLureUntil - t)) / 2 : 1);
        x += (tx - x) * k;
        z += (tz - z) * k;
      }
      const prev = dk.obj.position;
      const dx = x - prev.x, dz = z - prev.z;
      dk.obj.position.set(x, this.pondLevel + Math.sin(t * 2 + dk.phase) * 0.02, z);
      if (dx * dx + dz * dz > 1e-6) dk.obj.rotation.y = Math.atan2(dx, dz) + Math.PI;
      dk.obj.updateMatrix();
      const i = this.ducks.indexOf(dk);
      for (const m of this.duckMeshes) m.setMatrixAt(i, dk.obj.matrix);
    }
    for (const m of this.duckMeshes) m.instanceMatrix.needsUpdate = true;
  }
}

/** Pond outline radius at angle a (blob). */
function pondR(a: number): number {
  return C.pond.r * (1 + 0.12 * Math.sin(2 * a + 0.7) + 0.07 * Math.sin(3 * a + 2.1));
}

/** Signed distance-ish: negative inside the pond outline. */
function pondRadius(x: number, z: number): number {
  const dx = x - C.pond.x, dz = z - C.pond.z;
  return Math.hypot(dx, dz) - pondR(Math.atan2(dz, dx)) + 0.2;
}

export function createFireCapital(): FireCapital {
  return new FireCapital();
}

// Unused import guards for tree-shaking clarity.
void roofGeo;
