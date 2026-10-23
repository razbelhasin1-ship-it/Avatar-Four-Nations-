import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { matrixFor } from '../../kit/Builder';
import { heightAt } from '../../Heightfield';
import { AirRegion } from './AirRegion';
import * as G from './geom';
import * as P from './parts';
import { am, type Frame, type Kit, type P2 } from './parts';
import { AIR_SPOTS, SUMMIT, Y0, sl, polar } from './layout';
import { BELL_PAVILION, buildGrounds } from './grounds';

/**
 * The Southern Air Temple summit (plateau 'air_temple', flat at y = 330 out to
 * r = 95, then sheer cliffs down to the sea of clouds).
 *
 * Layout (offsets from the plateau centre, +x east, +z south):
 *   (0, 0)        labyrinth courtyard, pines, teal pavilion to the north-west
 *   (0, -58)      spire terrace (+6 m) with the great spire and four towers
 *   (52, -48)     summit sanctum drum (+9 m) — Abbot Pasang, glide ledge
 *   (38, -9)      training courtyard: moon gate, curved double stairs, walkway
 *   (78, -9)      east cliff balcony behind the moon gate: spring, falls, ledge
 *   (51, 35)      air-ball arena (+0.9 m) with poles and goal hoops
 *   (-10, 40)     south plaza (Air start spawn), fountain; meditation balconies
 *   (-64, 44)     sky bison stables (open-front hall)
 *   (-76, -35)    entrance gate where the switchback trail arrives
 *   (-44, -59)    hall of the Avatars (statue gallery)
 *   (-50, -4)     meditation garden pond, canal and the west falls
 * A balustrade runs around the rim (r = 91.5) with openings only at the
 * entrance, the balconies, the outlook bridges and the glide-launch ledges.
 */

const deg = Math.PI / 180;
const T = Y0 + 6; // spire terrace top
const S = Y0 + 9; // sanctum top
const RIM = 91.5;

export class SouthernAirTemple extends AirRegion {
  readonly id = 'air_temple_summit';
  readonly center = SUMMIT;
  readonly loadRadius = 700;

  /**
   * One district for the whole summit: the temple is nearly always seen as a
   * whole, so merging everything per material keeps draw calls low (the merge
   * itself is still time-sliced builder by builder).
   */
  protected override districtFor(): string {
    return 'summit';
  }

  protected parts(_ctx: GameContext): Array<[string, () => void]> {
    return [
      ['court', () => this.buildCourt()],
      ['spire', () => this.buildSpireTerrace()],
      ['sanctum', () => this.buildSanctum()],
      ['training', () => this.buildTraining()],
      ['east', () => this.buildEastBalcony()],
      ['arena', () => this.buildArena()],
      ['plaza', () => this.buildPlaza()],
      ['stables', () => this.buildStables()],
      ['entrance', () => this.buildEntrance()],
      ['hall', () => this.buildStatueHall()],
      ['garden', () => this.buildGarden()],
      ['rim', () => this.buildRim()],
      ['quarters', () => this.buildQuarters()],
      ['grounds', () => buildGrounds((name, c, r, o) => this.zone(name, c, r, o))],
    ];
  }

  // ---------------------------------------------------------------------------
  // Session content: resident monks and small interactions
  // ---------------------------------------------------------------------------

  private unregister: Array<() => void> = [];
  private cooldowns = new Map<string, number>();

  protected override sessionStart(ctx: GameContext): void {
    this.sessionEnd(ctx);
    // Resident monks and novices (ambient; no dialogue). The NPC system streams them by distance.
    const monk = (id: string, x: number, z: number, y: number, behavior: any, seed: number, yaw = 0, role: 'monk' | 'student' = 'monk') =>
      ctx.npcs.addDef({ id: `air_res_${id}`, name: role === 'monk' ? 'Air Nomad Monk' : 'Air Nomad Novice', role, nation: 'air', element: 'air', appearanceSeed: seed, x, z, y, yaw, behavior, region: 'southern_air_temple' });
    const b1 = polar(70, 90.4), b2 = polar(120, 90.4);
    monk('balcony_1', b1.x, b1.z, Y0 + 0.3, { type: 'idle', variant: 'meditate' }, 7101, (70 * deg) as number);
    monk('balcony_2', b2.x, b2.z, Y0 + 0.3, { type: 'idle', variant: 'meditate' }, 7102);
    const g = sl(-50, -12.5);
    monk('garden', g.x, g.z, Y0 + 0.02, { type: 'idle', variant: 'meditate' }, 7103, Math.PI);
    const t1 = sl(28, -16), t2 = sl(29, -1);
    monk('novice_1', t1.x, t1.z, Y0 + 0.15, { type: 'train' }, 7104, Math.PI / 2, 'student');
    monk('novice_2', t2.x, t2.z, Y0 + 0.15, { type: 'train' }, 7105, Math.PI / 2, 'student');
    const pl = sl(-6, 52);
    monk('plaza', pl.x, pl.z, Y0 + 0.15, { type: 'wander', radius: 9 }, 7106);
    const st = P.fp({ ...sl(-64.3, 44.3), yaw: P.faceYaw(0.823, -0.567) }, -9, 4);
    monk('stables', st.x, st.z, Y0 + 0.3, { type: 'idle', variant: 'work' }, 7107, P.faceYaw(0.823, -0.567) + Math.PI);
    const hl = polar(228, 71.6);
    monk('hall', hl.x, hl.z, Y0 + 1.2, { type: 'idle', variant: 'kneel' }, 7108, P.faceYaw(-Math.cos(48 * deg), -Math.sin(48 * deg)));
    const ar = sl(38, 22);
    monk('arena', ar.x, ar.z, Y0 + 0.9, { type: 'train' }, 7109, 0, 'student');

    // Interactions with real effects.
    const reg = (id: string, pos: P2, y: number, radius: number, label: string, cooldown: number, fn: () => void) => {
      this.unregister.push(
        ctx.interactions.register({
          id,
          position: new THREE.Vector3(pos.x, y, pos.z),
          radius,
          label,
          enabled: () => (this.cooldowns.get(id) ?? 0) <= ctx.time.elapsed,
          interact: () => {
            this.cooldowns.set(id, ctx.time.elapsed + cooldown);
            fn();
          },
        }),
      );
    };
    const gong = sl(52, 6.5);
    reg('air_gong', gong, Y0 + 1.6, 2.6, 'Strike the temple gong', 4, () => {
      ctx.audio.play('amb.bell', { position: { x: gong.x, y: Y0 + 1.8, z: gong.z }, volume: 1, range: 160 });
      ctx.events.emit('ui:notify', { text: 'The gong\'s note rolls out over the sea of clouds.', kind: 'info', duration: 3 });
    });
    reg('air_great_bell', BELL_PAVILION, Y0 + 1.2, 3.0, 'Ring the great bell', 6, () => {
      ctx.audio.play('amb.bell', { position: { x: BELL_PAVILION.x, y: Y0 + 2.5, z: BELL_PAVILION.z }, volume: 1, range: 220 });
      ctx.events.emit('ui:notify', { text: 'The great bell sounds across the summit. Somewhere below, a sky bison answers.', kind: 'info', duration: 3 });
    });
    const wheels = sl(-27.6, 44);
    reg('air_prayer_wheels', wheels, Y0 + 1, 3.2, 'Spin the prayer wheels', 60, () => {
      ctx.audio.play('amb.chime', { position: { x: wheels.x, y: Y0 + 1.2, z: wheels.z } });
      ctx.player?.addStatus('regen', 20, 1);
      ctx.events.emit('ui:notify', { text: 'The prayer wheels whirl — a gentle warmth mends your wounds.', kind: 'success', duration: 4 });
    });
    for (const [i, a] of [70, 95, 120].entries()) {
      const p = polar(a, 92.5);
      reg(`air_meditate_${i + 1}`, p, Y0 + 0.8, 2.6, 'Meditate above the clouds', 30, () => {
        const pl = ctx.player;
        if (pl) pl.chi = pl.maxChi;
        ctx.audio.play('amb.chime', { position: { x: p.x, y: Y0 + 1, z: p.z } });
        ctx.events.emit('ui:notify', { text: 'You breathe with the wind. Chi fully restored.', kind: 'success', duration: 3 });
      });
    }
  }

  protected override sessionEnd(_ctx: GameContext): void {
    for (const u of this.unregister) u();
    this.unregister = [];
    this.cooldowns.clear();
  }

  // ---------------------------------------------------------------------------
  // Labyrinth courtyard + teal pavilion
  // ---------------------------------------------------------------------------

  private buildCourt(): void {
    const c = sl(0, 0);
    const k = this.zone('court', c, 40, { district: 'core' });
    // Lawn over the whole summit (hugs the ground, visual only).
    // Lawn: own mesh (vertex-coloured patches break up the green), a small polygon offset keeps it
    // 3 cm above the terrain without z-fighting while paths and paving (>= 9 cm higher) draw on top.
    const lawn = P.lawnGeometry(c.x, c.z, RIM + 0.4, heightAt, 0.03, 3);
    const lp = lawn.getAttribute('position');
    const col = new Float32Array(lp.count * 3);
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i), z = lp.getZ(i);
      const nse = 0.5 + 0.25 * Math.sin(x * 0.13 + Math.cos(z * 0.09) * 2.1) + 0.25 * Math.sin(z * 0.17 - Math.cos(x * 0.07) * 1.7);
      const dry = Math.max(0, Math.sin(x * 0.045 + z * 0.06) * 0.5 + Math.sin(x * 0.21 - z * 0.15) * 0.25);
      col[i * 3] = 0.7 + 0.18 * nse + 0.12 * dry;
      col[i * 3 + 1] = 0.74 + 0.16 * nse + 0.04 * dry;
      col[i * 3 + 2] = 0.58 + 0.12 * nse - 0.06 * dry;
    }
    lawn.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const lawnMat = this.ownMaterial(
      new THREE.MeshStandardMaterial({ map: (am('grass') as THREE.MeshStandardMaterial).map, vertexColors: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    const lawnMesh = new THREE.Mesh(lawn, lawnMat);
    lawnMesh.receiveShadow = true;
    lawnMesh.name = 'air_lawn';
    k.addMesh(lawnMesh, 'main');
    P.disc(k, c.x, c.z, Y0 + 0.15, 27, 'paving', 0.7, 64);
    P.disc(k, c.x, c.z, Y0 + 0.3, 17, am('labyrinth'), 0.3, 72);
    // Curb ring around the labyrinth.
    const curb = G.annulusSector(17, 17.5, 0, Math.PI * 2, Y0 + 0.1, Y0 + 0.33, 48);
    k.main.mesh('stone_light', curb, { x: c.x, y: 0, z: c.z });
    curb.dispose();
    // Pines around the labyrinth, leaving the four axes open.
    [30, 60, 120, 150, 210, 240, 300, 330].forEach((a, i) => {
      const p = polar(a, 21.8);
      P.pine(k, p.x, Y0 + 0.15, p.z, i % 3, 1.05 + (i % 2) * 0.15, a * deg);
    });
    // Stone lanterns flanking each entrance.
    for (const a of [0, 90, 180, 270]) {
      for (const s of [-7, 7]) {
        const p = polar(a + s, 19.2);
        P.stoneLantern(k, p.x, Y0 + 0.15, p.z);
      }
    }
    // The teal pavilion (north-west of the labyrinth).
    const pv = sl(-24, -24);
    P.pavilion(k, { x: pv.x, z: pv.z, y: Y0, r: 4.4, h: 4.4, roofH: 5.6, steps: 3, entrances: [P.faceYaw(1, 1), P.faceYaw(-1, -1)], finial: 0.8 });
    P.hangingLantern(k, pv.x, Y0 + 0.9 + 3.7, pv.z, 'warm');
    // Paths from the pavilion steps into the court.
    const pa = sl(-19.5, -19.5);
    P.slab(k, pa.x, pa.z, Y0 + 0.12, 4, 3.2, P.alongYaw(1, 1), 'paving', 0.4);
  }

  // ---------------------------------------------------------------------------
  // Spire terrace (+6 m): the great spire, four towers, grand stair
  // ---------------------------------------------------------------------------

  private buildSpireTerrace(): void {
    const c = sl(0, -58);
    const k = this.zone('spire', c, 48, { district: 'north' });
    const W = 56, D = 44;
    // Terrace mass with a paving skin, cornice and plinth.
    k.main.box('stone_white', { x: c.x, y: (Y0 - 1 + T) / 2, z: c.z, sx: W, sy: T - Y0 + 1, sz: D }, { collide: true, walkable: true });
    k.main.box('paving', { x: c.x, y: T - 0.02, z: c.z, sx: W - 0.4, sy: 0.06, sz: D - 0.4 });
    k.main.box('stone_light', { x: c.x, y: T - 0.3, z: c.z, sx: W + 0.7, sy: 0.6, sz: D + 0.7 });
    k.main.box('stone_light', { x: c.x, y: Y0 + 0.4, z: c.z, sx: W + 0.9, sy: 0.8, sz: D + 0.9 });
    // Pilasters and blind arches on the four faces.
    const faces: Array<{ a: P2; b: P2; yaw: number }> = [
      { a: sl(-28, -36), b: sl(28, -36), yaw: 0 },
      { a: sl(28, -80), b: sl(-28, -80), yaw: Math.PI },
      { a: sl(28, -36), b: sl(28, -80), yaw: Math.PI / 2 },
      { a: sl(-28, -80), b: sl(-28, -36), yaw: -Math.PI / 2 },
    ];
    for (const f of faces) {
      const L = Math.hypot(f.b.x - f.a.x, f.b.z - f.a.z);
      const n = Math.round(L / 7);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = f.a.x + (f.b.x - f.a.x) * t + fx * 0.2, z = f.a.z + (f.b.z - f.a.z) * t + fz * 0.2;
        k.main.box('stone_light', { x, y: (Y0 + T) / 2, z, sx: 0.9, sy: T - Y0, sz: 0.45, yaw: f.yaw });
        if (i < n) {
          const t2 = (i + 0.5) / n;
          const mx = f.a.x + (f.b.x - f.a.x) * t2 + fx * 0.05, mz = f.a.z + (f.b.z - f.a.z) * t2 + fz * 0.05;
          k.main.instance('terr_arch', () => P.archedWindowGeo(), am('shadow'), matrixFor({ x: mx, y: Y0 + 2.4, z: mz, yaw: f.yaw, sx: 2.2, sy: 2.2, sz: 0.6 }), false);
        }
      }
    }
    // Banners on the south face.
    for (const x of [-17, -10, 10, 17]) {
      const p = sl(x, -35.75);
      P.banner(k, p.x, T - 0.7, p.z, 0, 1.7, 4.4, x % 2 ? 'bannerYellow' : 'banner');
    }
    // Balustrade around the terrace (openings: grand stair S, bridge E, stair W).
    const rail = (pts: Array<[number, number]>) => P.balustrade(k, pts.map(([x, z]) => sl(x, z)), { y: T });
    rail([[-27.7, -36.3], [-5.6, -36.3]]);
    rail([[5.6, -36.3], [27.7, -36.3], [27.7, -45.4]]);
    rail([[27.7, -50.6], [27.7, -79.7], [-27.7, -79.7], [-27.7, -36.3]]);
    // Grand stair from the labyrinth court.
    P.flight(k, { a: sl(0, -24.6), b: sl(0, -36.05), y0: Y0 + 0.15, y1: T, width: 10.2, walls: { h: 0.95, t: 0.6, material: 'stone_white' } });
    for (const s of [-1, 1]) {
      const p = sl(s * 8.6, -22.5);
      k.main.box('stone_white', { x: p.x, y: Y0 + 0.15 + 0.4, z: p.z, sx: 3.2, sy: 0.8, sz: 6.2 }, { collide: true, walkable: true });
      P.bisonStatue(k, p.x, Y0 + 0.95, p.z, 0, 0.62);
    }
    // The great spire.
    const sp = sl(0, -60);
    P.spire(k, {
      x: sp.x,
      z: sp.z,
      y: T,
      tiers: [
        { r: 9, h: 10, skirt: true },
        { r: 7.6, h: 9, skirt: true },
        { r: 6.4, h: 8.5 },
        { r: 5.3, h: 8, skirt: true },
        { r: 4.3, h: 7, belfry: true, skirt: true },
        { r: 3.3, h: 6.5 },
      ],
      roofH: 16,
      finial: 2.4,
      door: 0,
    });
    // Secondary towers.
    for (const s of [-1, 1]) {
      const a = sl(s * 20, -44);
      P.roundTower(k, { x: a.x, z: a.z, y: T, r: 3.4, h: 16, roofH: 8.6, balcony: true, door: 0 });
      const b = sl(s * 21, -71.5);
      P.roundTower(k, { x: b.x, z: b.z, y: T, r: 3.0, h: 11, roofH: 7.2, door: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    // Lanterns and a pair of pines on the terrace.
    for (const [x, z] of [[-7, -40], [7, -40], [-12, -50], [12, -50]] as Array<[number, number]>) {
      const p = sl(x, z);
      P.lanternPost(k, p.x, T, p.z, 'warm');
    }
    for (const [x, z, v] of [[-16, -58, 0], [16, -58, 1], [-14, -76, 2], [14, -76, 0]] as Array<[number, number, number]>) {
      const p = sl(x, z);
      P.pine(k, p.x, T, p.z, v, 1.0, x * 0.1);
    }
    // Prayer flags between the front towers and the spire.
    const fa = sl(-20, -44), fb = sl(20, -44), top = sl(0, -51);
    P.prayerFlags(k, new THREE.Vector3(fa.x, T + 13, fa.z), new THREE.Vector3(top.x, T + 19, top.z), 1.2);
    P.prayerFlags(k, new THREE.Vector3(top.x, T + 19, top.z), new THREE.Vector3(fb.x, T + 13, fb.z), 1.2);
  }

  // ---------------------------------------------------------------------------
  // Summit sanctum (+9 m): Abbot Pasang's round terrace with a shrine
  // ---------------------------------------------------------------------------

  private buildSanctum(): void {
    const c = sl(52, -48);
    const k = this.zone('sanctum', c, 24, { district: 'north' });
    const R = 16;
    k.main.cylinder('stone_white', { x: c.x, z: c.z, y: Y0 - 1, r: R, h: S - Y0 + 1, segments: 56 }, { collide: true, walkable: true });
    k.main.cylinder('paving', { x: c.x, z: c.z, y: S - 0.05, r: R - 0.15, h: 0.07, segments: 56 });
    k.main.cylinder('stone_light', { x: c.x, z: c.z, y: S - 0.55, r: R + 0.4, h: 0.55, segments: 56 });
    k.main.cylinder('stone_light', { x: c.x, z: c.z, y: Y0, r: R + 0.5, h: 0.9, segments: 56 });
    // Inlaid ring and emblem disc on the floor.
    const inlay = G.annulusSector(5.6, 6.2, 0, Math.PI * 2, S - 0.03, S + 0.025, 40);
    k.main.mesh(am('paintTeal'), inlay, { x: c.x, y: 0, z: c.z });
    inlay.dispose();
    k.main.cylinder('gold', { x: c.x, z: c.z, y: S - 0.03, r: 1.1, h: 0.055, segments: 24 });
    // Pilasters and blind arches round the drum.
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const px = c.x + Math.cos(a) * (R + 0.15), pz = c.z + Math.sin(a) * (R + 0.15);
      k.main.box('stone_light', { x: px, y: (Y0 + S) / 2, z: pz, sx: 0.9, sy: S - Y0, sz: 0.4, yaw: P.faceYaw(Math.cos(a), Math.sin(a)) });
      const b = a + Math.PI / 18;
      k.main.instance('drum_arch', () => P.archedWindowGeo(), am('shadow'), matrixFor({ x: c.x + Math.cos(b) * (R + 0.02), y: Y0 + 3.4, z: c.z + Math.sin(b) * (R + 0.02), yaw: P.faceYaw(Math.cos(b), Math.sin(b)), sx: 2, sy: 2.6, sz: 0.5 }), false);
    }
    // Rim balustrade with openings: bridge (W, 180°), walkway stair (60°), glide ledge (300°).
    const gaps: Array<[number, number]> = [
      [170, 190],
      [49, 71],
      [294, 306],
    ];
    let a0 = 0;
    const sorted = gaps.sort((p, q) => p[0] - q[0]);
    for (const [g0, g1] of sorted) {
      if (g0 > a0) P.arcRail(k, c.x, c.z, R - 0.4, a0 * deg, g0 * deg, S, { seg: 3 });
      a0 = g1;
    }
    if (a0 < 360) P.arcRail(k, c.x, c.z, R - 0.4, a0 * deg, 360 * deg, S, { seg: 3 });
    // Glide-launch ledge (open end) pointing north-east over the clouds.
    const la = 300 * deg;
    const lm = { x: c.x + Math.cos(la) * (R + 2.6), z: c.z + Math.sin(la) * (R + 2.6) };
    k.main.box('stone_white', { x: lm.x, y: S - 0.35, z: lm.z, sx: 6.2, sy: 0.7, sz: 3.6, yaw: P.alongYaw(Math.cos(la), Math.sin(la)) }, { collide: true, walkable: true });
    k.main.box('stone_light', { x: lm.x + Math.cos(la) * 0.4, y: S - 1.2, z: lm.z + Math.sin(la) * 0.4, sx: 4.6, sy: 1.0, sz: 3.0, yaw: P.alongYaw(Math.cos(la), Math.sin(la)) });
    for (const s of [-1, 1]) {
      // Short side rails along the ledge (the far end stays open).
      const nx = -Math.sin(la), nz = Math.cos(la);
      const p0 = { x: c.x + Math.cos(la) * (R - 0.4) + nx * 1.65 * s, z: c.z + Math.sin(la) * (R - 0.4) + nz * 1.65 * s };
      const p1 = { x: c.x + Math.cos(la) * (R + 3.2) + nx * 1.65 * s, z: c.z + Math.sin(la) * (R + 3.2) + nz * 1.65 * s };
      P.balustrade(k, [p0, p1], { y: S, h: 0.9 });
    }
    // Shrine pavilion of the grandmaster at the north edge.
    const sh = sl(52, -60.5);
    P.pavilion(k, { x: sh.x, z: sh.z, y: S, r: 2.3, h: 3.4, roofH: 3.6, steps: 2, entrances: [0], finial: 0.55 });
    P.monkStatue(k, sh.x, S + 0.6, sh.z, 0, 0.8);
    // Bridge stair from the spire terrace (+6) up to the sanctum (+9), on an arch.
    P.flight(k, { a: sl(27.9, -48), b: sl(36.3, -48), y0: T, y1: S, width: 4.8, walls: { h: 1.0, t: 0.45 } });
    P.arcade(k, { a: sl(28, -48), b: sl(36.1, -48), y: Y0, arches: 1, pier: 1.1, spring: 2.2, top: T - Y0 - 0.55, depth: 4.4 });
    // Stair from the training court's north walkway (+5) up to the sanctum.
    P.flight(k, { a: sl(63.5, -28.1), b: sl(59.7, -34.6), y0: Y0 + 5, y1: S, width: 3.1, walls: { h: 1.0, t: 0.4 } });
    // Lanterns around the floor.
    for (const a of [20, 100, 140, 220, 250, 340]) {
      const p = { x: c.x + Math.cos(a * deg) * 13.4, z: c.z + Math.sin(a * deg) * 13.4 };
      P.stoneLantern(k, p.x, S, p.z);
    }
    // Prayer flags radiating from the shrine finial to the rim.
    const apex = new THREE.Vector3(sh.x, S + 0.6 + 3.4 + 3.6 + 0.6, sh.z);
    for (const a of [200, 235, 305, 340]) {
      const p = { x: c.x + Math.cos(a * deg) * (R - 0.4), z: c.z + Math.sin(a * deg) * (R - 0.4) };
      P.prayerFlags(k, apex, new THREE.Vector3(p.x, S + 1.1, p.z), 0.7);
    }
  }

  // ---------------------------------------------------------------------------
  // Training courtyard (Monk Tenzo): moon gate, curved double stairs, walkway
  // ---------------------------------------------------------------------------

  private buildTraining(): void {
    const c = sl(43, -9);
    const k = this.zone('training', c, 30, { district: 'east' });
    const F = Y0 + 0.15;
    P.slab(k, c.x, c.z, F, 38, 34, 0, 'paving', 0.7);
    // Inlaid training circle.
    const tc = sl(38, -9);
    const ring = G.annulusSector(11.6, 12.1, 0, Math.PI * 2, F - 0.02, F + 0.02, 48);
    k.main.mesh('stone_light', ring, { x: tc.x, y: 0, z: tc.z });
    ring.dispose();
    k.main.cylinder(am('paintTeal'), { x: tc.x, z: tc.z, y: F - 0.02, r: 1.6, h: 0.05, segments: 24 });
    // East wall with a walkway on top (+5), moon gate block in the middle.
    const WT = Y0 + 5;
    for (const [z0, z1] of [[-28, -14.5], [-3.5, 10]] as Array<[number, number]>) {
      const m = sl(63.5, (z0 + z1) / 2);
      k.main.box('plaster_white', { x: m.x, y: (Y0 - 0.5 + WT) / 2, z: m.z, sx: 3, sy: WT - Y0 + 0.5, sz: z1 - z0 }, { collide: true, walkable: true });
      k.main.box('paving', { x: m.x, y: WT - 0.02, z: m.z, sx: 2.9, sy: 0.06, sz: z1 - z0 - 0.1 });
      k.main.box('stone_light', { x: m.x, y: WT - 0.2, z: m.z, sx: 3.4, sy: 0.4, sz: z1 - z0 + 0.2 });
      // Painted frieze band with round medallions (as in the temple courtyards).
      k.main.box(am('paintTeal'), { x: m.x - 1.52, y: WT - 1.1, z: m.z, sx: 0.06, sy: 0.6, sz: z1 - z0 - 0.4 });
      P.balustrade(k, [sl(64.85, z0), sl(64.85, z1)], { y: WT });
    }
    P.moonGate(k, { x: sl(63.5, -9).x, z: sl(63.5, -9).z, y: Y0, yaw: Math.PI / 2, w: 11, h: 8.6, depth: 3, r: 3.3, cy: 3.6 });
    k.main.box('stone_white', { x: sl(63.5, -9).x, y: Y0 + 0.15, z: sl(63.5, -9).z, sx: 3.2, sy: 0.3, sz: 4.4 }, { collide: true, walkable: true });
    // Small teal roof over the gate block.
    k.main.roof(am('roof'), { x: sl(63.5, -9).x, y: Y0 + 8.85, z: sl(63.5, -9).z, w: 12.4, d: 4.4, height: 2.0, yaw: Math.PI / 2, style: 'hip', overhang: 0.5, curve: 0.3, ridge: am('roofTrim') });
    // Curved double stairs flanking the gate (horseshoe), rising to the walkway.
    const cc = sl(62, -9);
    P.curvedStair(k, { cx: cc.x, cz: cc.z, rIn: 8, rOut: 11, a0: 205 * deg, a1: 262 * deg, y0: F, y1: WT, walls: { h: 1.0, t: 0.4 } });
    P.curvedStair(k, { cx: cc.x, cz: cc.z, rIn: 8, rOut: 11, a0: 155 * deg, a1: 98 * deg, y0: F, y1: WT, walls: { h: 1.0, t: 0.4 } });
    // Landings joining the stair tops to the walkway.
    for (const [z0, z1] of [[-20.3, -16.5], [-1.5, 2.3]] as Array<[number, number]>) {
      const m = sl(61.4, (z0 + z1) / 2);
      k.main.box('stone_white', { x: m.x, y: (Y0 + WT) / 2, z: m.z, sx: 2.6, sy: WT - Y0, sz: z1 - z0 }, { collide: true, walkable: true });
    }
    // Inner walkway rails except where the stairs land.
    for (const [z0, z1] of [[-28, -20.3], [-16.5, -14.5], [-3.5, -1.5], [2.3, 10]] as Array<[number, number]>) {
      P.balustrade(k, [sl(62.15, z0), sl(62.15, z1)], { y: WT });
    }
    P.balustrade(k, [sl(62.15, 10), sl(64.85, 10)], { y: WT });
    // North walkway end: rails beside the sanctum stair foot.
    // Airbending gates: frames of tall panels in the south-west corner.
    for (let f = 0; f < 3; f++) {
      const x0 = 27 + f * 5.2;
      const zc = 5.6;
      for (const s of [-1, 1]) {
        const p = sl(x0 + s * 2.2, zc);
        k.main.box('wood_dark', { x: p.x, y: F + 1.6, z: p.z, sx: 0.22, sy: 3.2, sz: 0.22 }, { collide: true, walkable: false });
      }
      const top = sl(x0, zc);
      k.main.box('wood_red', { x: top.x, y: F + 3.25, z: top.z, sx: 4.8, sy: 0.22, sz: 0.3 });
      for (let i = 0; i < 4; i++) {
        const p = sl(x0 - 1.5 + i, zc);
        const yaw = ((i * 37 + f * 23) % 90) * deg;
        k.props.box(am('paintTeal'), { x: p.x, y: F + 1.65, z: p.z, sx: 0.06, sy: 2.6, sz: 0.85, yaw });
        k.main.collider({ shape: 'box', x: p.x, y: F + 1.65, z: p.z, hx: 0.08, hy: 1.3, hz: 0.43, yaw, walkable: false, solid: true });
      }
    }
    // Pines, lanterns and a gong around the edges.
    for (const [x, z, v] of [[26.5, -23.5, 1], [49, -23.5, 2], [57.5, 6, 0]] as Array<[number, number, number]>) {
      const p = sl(x, z);
      P.pine(k, p.x, F, p.z, v, 0.95);
    }
    for (const [x, z] of [[30, -24.5], [44, -24.5], [27, -1], [27, -17]] as Array<[number, number]>) {
      const p = sl(x, z);
      P.stoneLantern(k, p.x, F, p.z);
    }
    const gong = sl(52, 6.5);
    for (const s of [-1, 1]) k.main.box('wood_dark', { x: gong.x + s * 1.3, y: F + 1.4, z: gong.z, sx: 0.2, sy: 2.8, sz: 0.2 }, { collide: true, walkable: false });
    k.main.box('wood_dark', { x: gong.x, y: F + 2.85, z: gong.z, sx: 3, sy: 0.2, sz: 0.24 });
    k.props.mesh('bronze', new THREE.CylinderGeometry(0.95, 0.95, 0.08, 24).rotateX(Math.PI / 2), { x: gong.x, y: F + 1.75, z: gong.z });
    // Banners on the walkway wall facing the court.
    for (const z of [-25.5, -22.5, 5, 8]) {
      const p = sl(61.9, z);
      P.banner(k, p.x, WT - 0.5, p.z, -Math.PI / 2, 1.3, 3.2, z > 0 ? 'bannerYellow' : 'banner');
    }
  }

  // ---------------------------------------------------------------------------
  // East cliff balcony behind the moon gate: spring pool, falls, glide ledge
  // ---------------------------------------------------------------------------

  private buildEastBalcony(): void {
    const c = sl(77, -9);
    const k = this.zone('east', c, 26, { district: 'east' });
    const F = Y0 + 0.15;
    P.slab(k, c.x, c.z, F, 23, 26, 0, 'paving', 0.6);
    const pool = sl(76, 1.5);
    P.roundPool(k, { id: 'air_east_spring', label: 'Cloud Spring', x: pool.x, z: pool.z, y: F, r: 2.6, rimH: 0.6, capacity: 120, regen: 3 });
    // Spout channel from the spring to the cliff edge, then the falls.
    P.canal(k, { id: 'air_east_runnel', label: 'Spring Runnel', a: sl(79.2, 1.5), b: sl(92.4, 1.5), y: F, width: 1.0, wallH: 0.5, register: false });
    P.cascade(k, { id: 'air_east_falls', label: 'East Cloudfall', x: sl(92.6, 1.5).x, z: sl(92.6, 1.5).z, y: F + 0.35, dirX: 1, dirZ: 0.05, width: 3.4, length: 85, heightAt });
    // Glide-launch ledge projecting over the cliff (open end).
    const la = -5 * deg;
    const lm = polar(-5, 94.5);
    k.main.box('stone_white', { x: lm.x, y: F - 0.3, z: lm.z, sx: 8, sy: 0.6, sz: 3.8, yaw: P.alongYaw(Math.cos(la), Math.sin(la)) }, { collide: true, walkable: true });
    k.main.box('stone_light', { x: lm.x - Math.cos(la) * 0.5, y: F - 1.4, z: lm.z - Math.sin(la) * 0.5, sx: 6, sy: 1.6, sz: 3.2, yaw: P.alongYaw(Math.cos(la), Math.sin(la)) });
    for (const s of [-1, 1]) {
      const nx = -Math.sin(la), nz = Math.cos(la);
      const p0 = polar(-5, RIM), p1 = polar(-5, 97.5);
      P.balustrade(k, [{ x: p0.x + nx * 1.75 * s, z: p0.z + nz * 1.75 * s }, { x: p1.x + nx * 1.75 * s, z: p1.z + nz * 1.75 * s }], { y: F, h: 0.9 });
    }
    // Meditation cushions and lanterns.
    const med = sl(74, -16);
    P.cushions(k, med.x, F, med.z, 2.6, 6);
    for (const [x, z] of [[67, -20], [67, 2], [84, -18], [84, 8]] as Array<[number, number]>) {
      const p = sl(x, z);
      P.stoneLantern(k, p.x, F, p.z);
    }
    const pn = sl(70, 7);
    P.pine(k, pn.x, F, pn.z, 2, 0.9);
  }

  // ---------------------------------------------------------------------------
  // Air-ball arena (Sister Iio)
  // ---------------------------------------------------------------------------

  private buildArena(): void {
    const c = sl(51, 35);
    const k = this.zone('arena', c, 28, { district: 'east' });
    const F = Y0 + 0.9;
    k.main.box('stone_white', { x: c.x, y: Y0 - 0.3 + 0.375, z: c.z, sx: 36, sy: 0.75 + 0.0, sz: 36 }, { collide: true, walkable: true });
    k.main.box(am('mosaic'), { x: c.x, y: (Y0 - 0.3 + F) / 2, z: c.z, sx: 33.6, sy: F - Y0 + 0.3, sz: 33.6 }, { collide: true, walkable: true });
    // Pitch markings: centre circle and half line.
    const ring = G.annulusSector(5.6, 6.0, 0, Math.PI * 2, F - 0.02, F + 0.02, 40);
    k.main.mesh('stone_white', ring, { x: c.x, y: 0, z: c.z });
    ring.dispose();
    k.main.box('stone_white', { x: c.x, y: F, z: c.z, sx: 0.4, sy: 0.04, sz: 31 });
    // Ring of poles (heights vary) just outside the open training circle.
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.1;
      const r = 13.6 + (i % 2) * 1.0;
      const h = [1.6, 2.6, 3.4, 2.2][i % 4];
      P.pole(k, c.x + Math.cos(a) * r, F, c.z + Math.sin(a) * r, h);
    }
    // Goal hoops at both ends.
    for (const s of [-1, 1]) {
      const p = sl(51 + s * 15.2, 35);
      k.main.cylinder('wood_dark', { x: p.x, z: p.z, y: F, r: 0.18, h: 4.6, segments: 8 }, { collide: true, walkable: false });
      const hg = G.hoop(1.15, 0.09);
      k.main.mesh('gold', hg, { x: p.x, y: F + 4.6 + 1.15, z: p.z, yaw: Math.PI / 2 });
      hg.dispose();
    }
    // Railing on the rim sides (east and south), entrances west and north.
    P.balustrade(k, [sl(67.6, 18.6), sl(67.6, 51.6), sl(34.4, 51.6)], { y: F });
    // Flag masts at the corners with flags strung across the arena.
    const masts = [sl(34.6, 18.6), sl(67.4, 18.6), sl(67.4, 51.4), sl(34.6, 51.4)];
    for (const m of masts) k.main.cylinder('wood_red', { x: m.x, z: m.z, y: F, r: 0.16, h: 9, segments: 8 }, { collide: true, walkable: false });
    for (let i = 0; i < 4; i++) {
      const a = masts[i], b = masts[(i + 1) % 4];
      P.prayerFlags(k, new THREE.Vector3(a.x, F + 8.7, a.z), new THREE.Vector3(b.x, F + 8.7, b.z), 1.6);
    }
    P.prayerFlags(k, new THREE.Vector3(masts[0].x, F + 8.7, masts[0].z), new THREE.Vector3(masts[2].x, F + 8.7, masts[2].z), 2.4);
    for (const m of [sl(33.4, 30), sl(33.4, 40)]) P.stoneLantern(k, m.x, Y0 + 0.45, m.z);
  }

  // ---------------------------------------------------------------------------
  // South plaza (spawn), fountain, meditation balconies
  // ---------------------------------------------------------------------------

  private buildPlaza(): void {
    const c = sl(-1, 44);
    const k = this.zone('plaza', c, 45, { district: 'core' });
    const F = Y0 + 0.15;
    P.slab(k, c.x, c.z, F, 58, 35, 0, 'paving', 0.6);
    const fo = sl(14, 38);
    P.fountain(k, { id: 'air_plaza_fountain', label: 'Plaza Fountain', x: fo.x, z: fo.z, y: F, r: 3.4 });
    // Pines and lanterns along the plaza edges (spawn at (-10, 40) stays open).
    for (const [x, z, v] of [[-26, 58, 0], [-14, 59.5, 1], [6, 59.5, 2], [22, 58, 0], [25, 30, 1], [-27, 30, 2]] as Array<[number, number, number]>) {
      const p = sl(x, z);
      P.pine(k, p.x, F, p.z, v, 1.0 + (v % 2) * 0.15, x);
    }
    for (const [x, z] of [[-20, 34], [0, 34], [-20, 54], [0, 54], [24, 46]] as Array<[number, number]>) {
      const p = sl(x, z);
      P.lanternPost(k, p.x, F, p.z, 'warm');
    }
    // Prayer wheels along the west side.
    P.prayerWheels(k, sl(-28.5, 38), sl(-28.5, 50), F, 8);
    // Meditation balconies over the clouds (cliff edge), with paths.
    for (const a of [70, 95, 120]) {
      const b = polar(a, 93);
      const k2 = k;
      P.disc(k2, b.x, b.z, Y0 + 0.3, 6.5, 'paving', 1.2, 40);
      k2.main.cylinder('stone_white', { x: b.x, z: b.z, y: Y0 - 10, r: 2.6, rTop: 6.2, h: 9.1, segments: 24 });
      k2.main.cylinder('stone_light', { x: b.x, z: b.z, y: Y0 - 1.05, r: 6.75, h: 0.5, segments: 40 });
      P.arcRail(k2, b.x, b.z, 6.15, (a - 112) * deg, (a + 112) * deg, Y0 + 0.3, { seg: 2.6 });
      P.cushions(k2, b.x, Y0 + 0.3, b.z, 3.1, 7);
      k2.main.cylinder('bronze', { x: b.x, z: b.z, y: Y0 + 0.3, r: 0.35, rTop: 0.25, h: 0.7, segments: 10 }, { collide: true, walkable: false });
      // Path from the plaza / lawn to the balcony.
      const p0 = polar(a, 62), p1 = polar(a, 87.5);
      const m = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
      P.slab(k2, m.x, m.z, Y0 + 0.12, Math.hypot(p1.x - p0.x, p1.z - p0.z), 3, P.alongYaw(p1.x - p0.x, p1.z - p0.z), 'paving', 0.4);
      const l = polar(a + 4.5, 86), r = polar(a - 4.5, 86);
      P.stoneLantern(k2, l.x, Y0, l.z);
      P.stoneLantern(k2, r.x, Y0, r.z);
    }
    // Lawn pines between the balconies.
    for (const [a, rr, v] of [[82, 76, 1], [108, 74, 2], [58, 74, 0], [132, 72, 1]] as Array<[number, number, number]>) {
      const p = polar(a, rr);
      P.pine(k, p.x, Y0, p.z, v, 1.25, a, false);
    }
    // A nomad merchant's stall at the plaza's west side.
    const st = sl(-25, 48);
    k.main.box('wood', { x: st.x, y: F + 0.5, z: st.z, sx: 1.4, sy: 1.0, sz: 3.2 }, { collide: true, walkable: false });
    for (const [dx, dz] of [[-0.6, -1.5], [-0.6, 1.5], [0.6, -1.5], [0.6, 1.5]] as Array<[number, number]>) k.props.box('wood_dark', { x: st.x + dx, y: F + 1.3, z: st.z + dz, sx: 0.1, sy: 2.6, sz: 0.1 });
    k.props.box('cloth_orange', { x: st.x, y: F + 2.65, z: st.z, sx: 2.2, sy: 0.08, sz: 3.8, roll: 0.15 });
  }

  // ---------------------------------------------------------------------------
  // Sky bison stables (open-front stone hall at the south-west rim)
  // ---------------------------------------------------------------------------

  private buildStables(): void {
    const o = sl(-64.3, 44.3);
    const F: Frame = { x: o.x, z: o.z, yaw: P.faceYaw(0.823, -0.567) };
    const k = this.zone('stables', o, 26, { district: 'west' });
    const fl = Y0 + 0.3;
    const at = (u: number, v: number) => P.fp(F, u, v);
    P.slab(k, o.x, o.z, fl, 37, 17, F.yaw, 'paving', 1.0);
    // Front and back arcades (bison-sized arches); the back opens to the sky.
    P.arcade(k, { a: at(-18, 7.6), b: at(18, 7.6), y: fl, arches: 4, pier: 1.6, spring: 6, top: 9.6, depth: 1.4 });
    P.arcade(k, { a: at(18, -7.6), b: at(-18, -7.6), y: fl, arches: 4, pier: 1.6, spring: 6, top: 9.6, depth: 1.4 });
    P.balustrade(k, [at(-17.2, -6.7), at(17.2, -6.7)], { y: fl, h: 1.1 });
    // End walls with round windows.
    for (const s of [-1, 1]) {
      const p = at(s * 17.6, 0);
      k.main.box('plaster_cream', { x: p.x, y: fl + 4.9, z: p.z, sx: 0.9, sy: 9.8, sz: 16.6, yaw: F.yaw }, { collide: true, walkable: false });
      const w = at(s * 18.06, 0);
      k.main.mesh(am('shadow'), new THREE.CylinderGeometry(1.4, 1.4, 0.1, 20).rotateZ(Math.PI / 2), { x: w.x, y: fl + 6.2, z: w.z, yaw: F.yaw });
      P.banner(k, w.x + Math.cos(F.yaw) * s * 0.02, fl + 4.6, w.z - Math.sin(F.yaw) * s * 0.02, F.yaw + (s * Math.PI) / 2, 1.5, 3.6, 'banner');
    }
    // Roof with a walkable collider so gliders can land on it.
    k.main.roof(am('roof'), { x: o.x, y: fl + 9.9, z: o.z, w: 39, d: 19, height: 5.6, yaw: F.yaw, style: 'hip', overhang: 0.8, curve: 0.3, ridge: am('roofTrim') });
    k.main.collider({ shape: 'box', x: o.x, y: fl + 9.9 + 1.4, z: o.z, hx: 19, hy: 1.4, hz: 9, yaw: F.yaw, walkable: true, solid: true });
    // Stall partitions, hay, a drinking basin and the feeding ring.
    for (const u of [-6, 6]) {
      const p = at(u, -3.8);
      k.main.box('wood', { x: p.x, y: fl + 1.1, z: p.z, sx: 0.35, sy: 2.2, sz: 5.6, yaw: F.yaw }, { collide: true, walkable: false });
    }
    for (const u of [-12, 12]) {
      const p = at(u, -4.2);
      P.hayStack(k, p.x, fl, p.z, F.yaw, 2);
      const b1 = at(u - 3, 1.5), b2 = at(u + 2.5, 2.2);
      P.hayBale(k, b1.x, fl, b1.z, F.yaw + 0.4);
      P.hayBale(k, b2.x, fl, b2.z, F.yaw - 0.3);
    }
    const basin = at(0, -4.4);
    P.roundPool(k, { id: 'air_stable_trough', label: 'Bison Drinking Basin', x: basin.x, z: basin.z, y: fl, r: 1.9, rimH: 0.8, capacity: 80, regen: 2 });
    const ring = at(0, 3.2);
    k.props.mesh('bronze', new THREE.TorusGeometry(2.2, 0.08, 6, 32).rotateX(Math.PI / 2), { x: ring.x, y: fl + 1.25, z: ring.z });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.props.box('bronze', { x: ring.x + Math.cos(a) * 2.2, y: fl + 0.62, z: ring.z + Math.sin(a) * 2.2, sx: 0.08, sy: 1.25, sz: 0.08, roll: 0.2 });
    }
    k.main.cylinder('bronze', { x: ring.x, z: ring.z, y: fl, r: 0.45, rTop: 0.6, h: 1.3, segments: 12 }, { collide: true, walkable: false });
    // Hanging lanterns under the front arches.
    for (let i = 0; i < 4; i++) {
      const p = at(-13.4 + i * 8.9, 7.6);
      P.hangingLantern(k, p.x, fl + 6.9, p.z, 'warm');
    }
    // Hay yard beside the hall.
    for (const [u, v] of [[-22, 4], [-24.5, 0.5]] as Array<[number, number]>) {
      const p = at(u, v);
      P.hayBale(k, p.x, Y0, p.z, F.yaw + u * 0.1);
    }
    const hs = at(22.5, 3);
    P.hayStack(k, hs.x, Y0, hs.z, F.yaw + 0.3, 2);
  }

  // ---------------------------------------------------------------------------
  // Entrance gate (top of the switchback trail) and the processional avenue
  // ---------------------------------------------------------------------------

  private buildEntrance(): void {
    const g = sl(-76.2, -35.4);
    const k = this.zone('entrance', sl(-52, -22), 36, { district: 'west' });
    const Fg: Frame = { x: g.x, z: g.z, yaw: P.faceYaw(-0.949, -0.316) };
    const at = (u: number, v: number) => P.fp(Fg, u, v);
    // Gate towers.
    for (const s of [-1, 1]) {
      const p = at(s * 6.6, 0);
      P.roundTower(k, { x: p.x, z: p.z, y: Y0, r: 2.6, h: 12, roofH: 6.4, bands: 2, windows: 1 });
      const bp = at(s * 6.6, 2.62);
      P.banner(k, bp.x, Y0 + 9.4, bp.z, Fg.yaw, 1.4, 4.2, 'banner');
    }
    // Gateway: piers, arch, roof.
    for (const s of [-1, 1]) {
      const p = at(s * 3.6, 0);
      k.main.box('stone_white', { x: p.x, y: Y0 + 3.3, z: p.z, sx: 1.4, sy: 6.6, sz: 2.4, yaw: Fg.yaw }, { collide: true, walkable: false });
    }
    const sp = G.archSpandrel(5.8, 3.8, 7.0, 2.2);
    k.main.mesh('plaster_white', sp, { x: g.x, y: Y0, z: g.z, yaw: Fg.yaw });
    sp.dispose();
    k.main.box('stone_light', { x: g.x, y: Y0 + 7.2, z: g.z, sx: 9.6, sy: 0.45, sz: 2.8, yaw: Fg.yaw }, { collide: true, walkable: true });
    k.main.collider({ shape: 'box', x: g.x, y: Y0 + 6.3, z: g.z, hx: 2.95, hy: 0.6, hz: 1.1, yaw: Fg.yaw, walkable: true, solid: true });
    k.main.roof(am('roof'), { x: g.x, y: Y0 + 7.4, z: g.z, w: 11, d: 4, height: 2.4, yaw: Fg.yaw, style: 'hip', overhang: 0.6, curve: 0.35, ridge: am('roofTrim') });
    const fin = G.finialGeometry(0.6);
    k.main.mesh('gold', fin, { x: g.x, y: Y0 + 9.6, z: g.z });
    fin.dispose();
    P.hangingLantern(k, g.x, Y0 + 5.2, g.z, 'warm');
    // Walls closing the rim between the gate towers and the cliff rail.
    P.wallLine(k, [at(6.6, 0), polar(196, RIM)], { y: Y0, h: 2.6, t: 1.1, material: 'plaster_white' });
    P.wallLine(k, [at(-6.6, 0), polar(214, RIM)], { y: Y0, h: 2.6, t: 1.1, material: 'plaster_white' });
    // Processional avenue to the labyrinth court.
    const a = at(0, -1.6), b = polar(200, 26.5);
    const dx = b.x - a.x, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len, nx = -uz, nz = ux;
    P.slab(k, (a.x + b.x) / 2, (a.z + b.z) / 2, Y0 + 0.12, len, 7, P.alongYaw(dx, dz), 'paving', 0.4);
    for (let i = 0; i < 6; i++) {
      const t = (i + 0.5) / 6;
      for (const s of [-1, 1]) {
        const x = a.x + dx * t + nx * 4.6 * s, z = a.z + dz * t + nz * 4.6 * s;
        if (i % 2 === 0) P.stoneLantern(k, x, Y0, z);
        else P.pine(k, x, Y0, z, (i + (s > 0 ? 1 : 0)) % 3, 0.85, i, false);
      }
    }
    // Flag poles with prayer flags strung across the avenue.
    for (const t of [0.22, 0.55, 0.88]) {
      const l = { x: a.x + dx * t + nx * 4.4, z: a.z + dz * t + nz * 4.4 };
      const r = { x: a.x + dx * t - nx * 4.4, z: a.z + dz * t - nz * 4.4 };
      for (const p of [l, r]) k.main.cylinder('wood_red', { x: p.x, z: p.z, y: Y0, r: 0.13, h: 6.4, segments: 8 }, { collide: true, walkable: false });
      P.prayerFlags(k, new THREE.Vector3(l.x, Y0 + 6.2, l.z), new THREE.Vector3(r.x, Y0 + 6.2, r.z), 0.9);
    }
  }

  // ---------------------------------------------------------------------------
  // Hall of the Avatars (statue gallery)
  // ---------------------------------------------------------------------------

  private buildStatueHall(): void {
    const o = polar(228, 70);
    const F: Frame = { x: o.x, z: o.z, yaw: P.faceYaw(Math.cos(48 * deg), Math.sin(48 * deg)) };
    const k = this.zone('hall', o, 22, { district: 'north' });
    const at = (u: number, v: number) => P.fp(F, u, v);
    const fl = Y0 + 1.2;
    P.slab(k, o.x, o.z, fl, 26, 12.4, F.yaw, 'paving', 1.8);
    const s1 = at(0, 6.7), s2 = at(0, 7.5);
    P.slab(k, s1.x, s1.z, Y0 + 0.8, 26, 1.0, F.yaw, 'stone_white', 1.2);
    P.slab(k, s2.x, s2.z, Y0 + 0.4, 26, 0.8, F.yaw, 'stone_white', 0.8);
    // Back and side walls.
    const bw = at(0, -5.8);
    k.main.box('plaster_cream', { x: bw.x, y: fl + 3.8, z: bw.z, sx: 26, sy: 7.6, sz: 0.8, yaw: F.yaw }, { collide: true, walkable: false });
    for (const s of [-1, 1]) {
      const p = at(s * 12.6, 0);
      k.main.box('plaster_cream', { x: p.x, y: fl + 3.8, z: p.z, sx: 0.8, sy: 7.6, sz: 12.4, yaw: F.yaw }, { collide: true, walkable: false });
    }
    // Front colonnade and architrave.
    for (let i = 0; i < 7; i++) {
      const p = at(-12 + i * 4, 5.3);
      k.main.cylinder('plaster_white', { x: p.x, z: p.z, y: fl, r: 0.42, rTop: 0.36, h: 6.6, segments: 12 }, { collide: true, walkable: false });
      k.main.cylinder('stone_light', { x: p.x, z: p.z, y: fl, r: 0.6, h: 0.4, segments: 12 });
      k.main.cylinder('stone_light', { x: p.x, z: p.z, y: fl + 6.3, r: 0.36, rTop: 0.62, h: 0.4, segments: 12 });
    }
    const ar = at(0, 5.3);
    k.main.box('stone_white', { x: ar.x, y: fl + 7.2, z: ar.z, sx: 26.4, sy: 1.0, sz: 1.1, yaw: F.yaw });
    k.main.box(am('paintTeal'), { x: ar.x + Math.sin(F.yaw) * 0.57, y: fl + 7.2, z: ar.z + Math.cos(F.yaw) * 0.57, sx: 25, sy: 0.45, sz: 0.04, yaw: F.yaw });
    k.main.roof(am('roof'), { x: o.x, y: fl + 7.7, z: o.z, w: 28.6, d: 14.6, height: 5.2, yaw: F.yaw, style: 'hip', overhang: 0.6, curve: 0.3, ridge: am('roofTrim') });
    k.main.collider({ shape: 'box', x: o.x, y: fl + 7.7 + 1.3, z: o.z, hx: 13.5, hy: 1.3, hz: 6.8, yaw: F.yaw, walkable: true, solid: true });
    // Statues of past Avatars on plinths, banners between them.
    for (let i = 0; i < 6; i++) {
      const u = -10 + i * 4;
      const p = at(u, -4.1);
      k.main.box('stone_light', { x: p.x, y: fl + 0.5, z: p.z, sx: 1.7, sy: 1.0, sz: 1.7, yaw: F.yaw }, { collide: true, walkable: false });
      P.monkStatue(k, p.x, fl + 1.0, p.z, F.yaw, 1.2);
      if (i < 5) {
        const bp = at(u + 2, -5.38);
        P.banner(k, bp.x, fl + 6.4, bp.z, F.yaw, 1.1, 3.4, i % 2 ? 'bannerYellow' : 'banner');
      }
    }
    for (let i = 0; i < 6; i++) {
      const p = at(-10 + i * 4, 5.3);
      P.hangingLantern(k, p.x, fl + 5.6, p.z, 'warm');
    }
    // Great statue in front of the hall.
    const gs = at(0, 14.5);
    P.steppedDisc(k, { x: gs.x, z: gs.z, y: Y0, r: 1.8, steps: 2, stepH: 0.4, stepW: 0.6 });
    k.main.box('stone_light', { x: gs.x, y: Y0 + 1.6, z: gs.z, sx: 1.8, sy: 0.8, sz: 1.8, yaw: F.yaw }, { collide: true, walkable: false });
    P.monkStatue(k, gs.x, Y0 + 2.0, gs.z, F.yaw, 2.1);
    for (const s of [-1, 1]) {
      const p = at(s * 9, 12);
      P.pine(k, p.x, Y0, p.z, s > 0 ? 1 : 2, 1.1);
    }
  }

  // ---------------------------------------------------------------------------
  // Meditation garden: pond, canal to the cliff and the west falls
  // ---------------------------------------------------------------------------

  private buildGarden(): void {
    const c = sl(-58, -4);
    const k = this.zone('garden', c, 30, { district: 'west' });
    const pd = sl(-50, -4);
    P.roundPool(k, { id: 'air_garden_pond', label: 'Garden Pond', x: pd.x, z: pd.z, y: Y0, r: 5.4, rimH: 0.5, capacity: 180, regen: 4 });
    // Stepping stones around and a lotus-like gold ornament.
    P.canal(k, { id: 'air_garden_canal', label: 'Garden Canal', a: sl(-55.6, -4), b: sl(-91.9, -4), y: Y0, width: 1.3, wallH: 0.5 });
    P.cascade(k, { id: 'air_west_falls', label: 'West Cloudfall', x: sl(-92.2, -4).x, z: sl(-92.2, -4).z, y: Y0 + 0.3, dirX: -1, dirZ: -0.03, width: 3.6, length: 90, heightAt });
    // Pines and stone lanterns around the pond.
    for (const [x, z, v] of [[-38, -1, 0], [-58, -14, 1], [-40, 8, 2], [-60, 7, 0], [-70, -12, 1], [-70, 6, 2]] as Array<[number, number, number]>) {
      const p = sl(x, z);
      P.pine(k, p.x, Y0, p.z, v, 1.05, x + z);
    }
    for (const [x, z] of [[-44, -10], [-56, 2], [-44, 3], [-79, -8.5], [-79, 0.5]] as Array<[number, number]>) {
      const p = sl(x, z);
      P.stoneLantern(k, p.x, Y0, p.z);
    }
    // Cushions for meditation beside the water.
    const cu = sl(-50, -14.5);
    P.cushions(k, cu.x, Y0, cu.z, 2.2, 5);
    // Small humped footbridge over the canal.
    P.flight(k, { a: sl(-74, -6.6), b: sl(-74, -4), y0: Y0, y1: Y0 + 0.75, width: 1.8, material: 'wood', stepH: 0.15, surface: 'wood' });
    P.flight(k, { a: sl(-74, -1.4), b: sl(-74, -4), y0: Y0, y1: Y0 + 0.75, width: 1.8, material: 'wood', stepH: 0.15, surface: 'wood' });
  }

  // ---------------------------------------------------------------------------
  // Monks' quarters, refectory and scriptorium
  // ---------------------------------------------------------------------------

  private buildQuarters(): void {
    const houses: Array<{ x: number; z: number; w: number; d: number; floors: number; yaw: number; district: string }> = [
      { x: -66, z: 16, w: 16, d: 7.5, floors: 2, yaw: P.faceYaw(66, -16), district: 'west' },
      { x: -42, z: 26, w: 12, d: 8, floors: 1, yaw: P.faceYaw(42, -26), district: 'core' },
      { x: 74, z: -34, w: 12, d: 8, floors: 2, yaw: P.faceYaw(-74, 34), district: 'east' },
      { x: -40, z: -30, w: 14, d: 7, floors: 2, yaw: P.faceYaw(-0.461, 0.887), district: 'north' },
    ];
    for (const h of houses) {
      const c = sl(h.x, h.z);
      const k = this.zone(`house_${h.x}_${h.z}`, c, Math.max(h.w, h.d), { district: h.district });
      P.quarters(k, { x: c.x, z: c.z, y: Y0, w: h.w, d: h.d, floors: h.floors, yaw: h.yaw });
      // A lantern by the door and a pine at one corner.
      const fx = Math.sin(h.yaw), fz = Math.cos(h.yaw), ux = Math.cos(h.yaw), uz = -Math.sin(h.yaw);
      P.lanternPost(k, c.x + fx * (h.d / 2 + 2.2) + ux * 2.2, Y0, c.z + fz * (h.d / 2 + 2.2) + uz * 2.2, 'warm');
      P.pine(k, c.x + fx * (h.d / 2 + 2.6) - ux * (h.w / 2 - 0.5), Y0, c.z + fz * (h.d / 2 + 2.6) - uz * (h.w / 2 - 0.5), (h.w | 0) % 3, 0.9, h.yaw, false);
    }
    // Inlaid air emblem in the south plaza (three swirling arms).
    const e = sl(4, 46);
    const k = this.zone('plaza_emblem', e, 8, { district: 'core' });
    const ring = G.annulusSector(6.6, 7.1, 0, Math.PI * 2, Y0 + 0.13, Y0 + 0.17, 48);
    k.main.mesh('stone_light', ring, { x: e.x, y: 0, z: e.z });
    ring.dispose();
    for (let arm = 0; arm < 3; arm++) {
      for (let i = 0; i < 16; i++) {
        const t = i / 16;
        const a = arm * ((Math.PI * 2) / 3) + t * 2.6;
        const r = 0.6 + t * 5.4;
        k.main.box(am('paintTeal'), { x: e.x + Math.cos(a) * r, y: Y0 + 0.155, z: e.z + Math.sin(a) * r, sx: 0.55 + t * 0.5, sy: 0.03, sz: 0.3 + t * 0.25, yaw: P.alongYaw(-Math.sin(a), Math.cos(a)) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rim balustrade, cliff towers and the two outlook towers on their bridges
  // ---------------------------------------------------------------------------

  private buildRim(): void {
    const c = sl(0, 0);
    // Two halves so each zone's props can be culled separately.
    const kN = this.zone('rim_north', sl(0, -60), 70);
    const kS = this.zone('rim_south', sl(0, 60), 70);
    const gaps: Array<[number, number]> = [
      [196, 214], // entrance
      [66.3, 73.7],
      [91.3, 98.7],
      [116.3, 123.7], // meditation balconies
      [299.05, 300.95], // north outlook bridge
      [44.05, 45.95], // south-east outlook bridge
      [353.7, 356.3], // east glide ledge
    ].sort((p, q) => p[0] - q[0]) as Array<[number, number]>;
    let a0 = -3.7; // continues past 356.3 (wraps through 0°)
    const spans: Array<[number, number]> = [];
    for (const [g0, g1] of gaps) {
      if (g0 > a0) spans.push([a0, g0]);
      a0 = g1;
    }
    for (const [s0, s1] of spans) {
      // Split each span at 0°/180° so north/south halves go to their zones.
      const cuts = [s0, ...[0, 180].filter((x) => x > s0 && x < s1), s1];
      for (let i = 0; i < cuts.length - 1; i++) {
        const mid = (cuts[i] + cuts[i + 1]) / 2;
        const k = Math.sin(mid * deg) < 0 ? kN : kS;
        P.arcRail(k, c.x, c.z, RIM, cuts[i] * deg, cuts[i + 1] * deg, Y0, { seg: 4 });
      }
    }
    // Decorative towers clinging to the cliffs below the rim.
    const cliffTowers: Array<{ a: number; r: number; dy: number; rt: number; h: number }> = [
      { a: 245, r: 104, dy: -12, rt: 3.2, h: 16 },
      { a: 268, r: 109, dy: -20, rt: 3.8, h: 23 },
      { a: 320, r: 104, dy: -10, rt: 3.0, h: 14 },
      { a: 22, r: 106, dy: -14, rt: 3.4, h: 18 },
      { a: 140, r: 105, dy: -13, rt: 3.3, h: 16 },
      { a: 166, r: 109, dy: -21, rt: 3.6, h: 20 },
      { a: 82, r: 112, dy: -26, rt: 3.4, h: 18 },
    ];
    for (const t of cliffTowers) {
      const p = polar(t.a, t.r);
      const k = Math.sin(t.a * deg) < 0 ? kN : kS;
      const y = Math.min(Y0 + t.dy, heightAt(p.x, p.z) + 1.5);
      P.roundTower(k, { x: p.x, z: p.z, y, r: t.rt, h: t.h, base: 48, balcony: t.h > 17, roofH: t.rt * 2.5 });
    }
    // Outlook towers on bridges (viewpoints over the sea of clouds).
    for (const a of [300, 45]) {
      const k = Math.sin(a * deg) < 0 ? kN : kS;
      const tc = polar(a, 112);
      const fl = Y0 + 0.3;
      const ty = Math.min(fl, heightAt(tc.x, tc.z) + 2);
      // Round platform around the tower, corbelled out of the cliff.
      k.main.cylinder('stone_white', { x: tc.x, z: tc.z, y: fl - 0.8, r: 6.4, h: 0.8, segments: 36 }, { collide: true, walkable: true });
      k.main.cylinder('stone_light', { x: tc.x, z: tc.z, y: fl - 1.3, r: 6.6, h: 0.5, segments: 36 });
      k.main.cylinder('stone_white', { x: tc.x, z: tc.z, y: ty - 40, r: 3.4, rTop: 5.4, h: fl - 1.3 - (ty - 40), segments: 24 });
      P.roundTower(k, { x: tc.x, z: tc.z, y: fl, r: 2.9, h: 14, roofH: 7.6, balcony: true, door: P.faceYaw(Math.cos((a + 180) * deg), Math.sin((a + 180) * deg)) });
      P.arcRail(k, tc.x, tc.z, 6.0, (a + 180 + 16) * deg, (a + 180 + 344) * deg, fl, { seg: 2.4 });
      // Bridge from the rim to the platform.
      const b0 = polar(a, RIM - 0.6), b1 = polar(a, 106.2);
      const dx = b1.x - b0.x, dz = b1.z - b0.z;
      const len = Math.hypot(dx, dz);
      const yaw = P.alongYaw(dx, dz);
      const mid = { x: (b0.x + b1.x) / 2, z: (b0.z + b1.z) / 2 };
      k.main.box('stone_white', { x: mid.x, y: fl - 0.35, z: mid.z, sx: len, sy: 0.7, sz: 3.2, yaw }, { collide: true, walkable: true });
      const nx = -dz / len, nz = dx / len;
      for (const s of [-1, 1]) {
        P.balustrade(k, [{ x: b0.x + nx * 1.45 * s, z: b0.z + nz * 1.45 * s }, { x: b1.x + nx * 1.45 * s, z: b1.z + nz * 1.45 * s }], { y: fl, h: 1.0 });
      }
      // Arch under the bridge down to the cliff.
      const pier = { x: b0.x + dx * 0.55, z: b0.z + dz * 0.55 };
      const py = heightAt(pier.x, pier.z);
      if (py < fl - 2) k.main.box('stone_white', { x: pier.x, y: (py - 4 + fl - 0.7) / 2, z: pier.z, sx: 1.6, sy: fl - 0.7 - (py - 4), sz: 2.6, yaw });
      P.banner(k, b1.x - nx * 1.7, fl + 2.6, b1.z - nz * 1.7, yaw + Math.PI / 2, 1.0, 2.4, 'bannerYellow');
    }
    // Rising wisps where the wind climbs the cliffs (updraft spots), spray at the falls.
    const up = new THREE.Vector3(0, 1, 0);
    for (const [id, sp] of Object.entries(AIR_SPOTS)) {
      if (!id.startsWith('updraft_') || Math.hypot(sp.x - SUMMIT.x, sp.z - SUMMIT.z) > 140) continue;
      this.ambient({ x: sp.x, y: (sp.y ?? Y0 - 30) + 6, z: sp.z, preset: 'mist', rate: 5, range: 170, dir: up, speed: 4, radius: (sp.r ?? 8) * 0.6, swirl: 0.8, size: 1.4 });
    }
    for (const [x, z, dx] of [[92.8, 1.5, 1], [-92.6, -4, -1]] as Array<[number, number, number]>) {
      const p = sl(x, z);
      this.ambient({ x: p.x + dx * 2, y: Y0 - 1.5, z: p.z, preset: 'spray', rate: 7, range: 90, dir: new THREE.Vector3(dx, -0.6, 0), speed: 2.5, radius: 1.0 });
    }
  }
}
