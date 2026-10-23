import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { Random } from '../../../core/Random';
import { heightAt } from '../../Heightfield';
import { defineSpots } from '../../Spots';
import { TUTORIAL_SPAWN } from '../../WorldLayout';
import { WaterRegion } from './base';
import { boulder, brazier as brazierGeo, conifer, crystalCluster, flatDisc, flatRing, mergeParts, pillow, roundTree } from './geometry';
import { wtMat, wtWater } from './materials';
import { drift, iceSpikes, V, WaterSheets, waterfall } from './parts';

/**
 * Meditation Isle — the tutorial's serene training ground "between the worlds".
 *
 *   spawn (-1800,-1775) on the south shore of the Spirit Pond (heightfield
 *   lake, centre (-1790,-1790) r 14), facing north across the water to a
 *   rocky outcrop with a small waterfall; the meditation pavilion to the
 *   north-west; the stone training circle south-east of the spawn; element
 *   stations around it (ice sheet, snow patch, raked sand garden, earth
 *   patch with bendable boulders, braziers); a brook flowing out of the pond
 *   to a little rock pool; floating spirit lanterns; a lookout on the north
 *   shore over the frozen sea.
 *
 * The 18 m around the spawn and the corridor to the training circle are kept
 * free of solid colliders so the movement lessons never get blocked.
 */

const C = { x: -1800, z: -1800 };
const G = 4.0; // plateau height
const POND = { x: -1790, z: -1790, r: 14, level: 3.2 };
const CIRCLE = { x: -1788, z: -1750, r: 16 };
const FALL = { x: -1793, z: -1802.6, top: 10.4 };
const PAVILION = { x: -1823, z: -1808, size: 9 };
const ICE = { x: -1838, z: -1774, r: 6.5 };
const SNOW = { x: -1842, z: -1748, r: 7 };
const SAND = { x: -1752, z: -1748, w: 13, d: 9 };
const EARTH = { x: -1746, z: -1808, r: 6.5 };
const LOOKOUT = { x: -1800, z: -1858 };
const STREAM: Array<{ x: number; z: number }> = [
  { x: -1777.5, z: -1787 },
  { x: -1769, z: -1784 },
  { x: -1761, z: -1789 },
  { x: -1752, z: -1787 },
  { x: -1744, z: -1780 },
  { x: -1738, z: -1771 },
];
const STREAM_POOL = { x: -1735, z: -1765, r: 3.4 };

const CIRCLE_TOP = G + 0.14;

defineSpots({
  training_tutorial: { x: CIRCLE.x, z: CIRCLE.z, y: CIRCLE_TOP, r: 14, yaw: Math.PI, label: 'Training Circle', region: 'meditation_isle' },
  // tutorial_dummy_1 sits where the lessons leave a player who walked south-east from the spawn.
  tutorial_dummy_1: { x: -1784, z: -1753, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_dummy_2: { x: -1796, z: -1744, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_dummy_3: { x: -1777, z: -1742, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_dummy_4: { x: -1799, z: -1756, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_dummy_5: { x: -1775, z: -1755, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_dummy_6: { x: -1789, z: -1738, y: CIRCLE_TOP, r: 2, label: 'Training Dummy', region: 'meditation_isle' },
  tutorial_companion: { x: -1814, z: -1764, y: G, r: 5, yaw: Math.PI * 0.75, label: 'Companion Meadow', region: 'meditation_isle' },
  shrine_meditation_pavilion: { x: PAVILION.x, z: PAVILION.z, y: G + 0.62, r: 3, yaw: Math.PI / 2, label: 'Meditation Pavilion', region: 'meditation_isle' },
  viewpoint_meditation_isle: { x: LOOKOUT.x, z: LOOKOUT.z, y: G + 0.42, r: 3, yaw: Math.PI, label: 'North Lookout', region: 'meditation_isle' },
  habitat_spirit_koi_1: { x: POND.x, z: POND.z, y: POND.level, r: 10, label: 'Spirit Pond', region: 'meditation_isle' },
});

export class MeditationIsle extends WaterRegion {
  private lanterns: THREE.InstancedMesh | null = null;
  private lanternBase: Array<{ x: number; y: number; z: number; ph: number }> = [];
  private readonly m4 = new THREE.Matrix4();

  constructor() {
    super('meditation_isle', C, 320);
  }

  protected construct(ctx: GameContext): void {
    const b = this.builder(this.main);
    const p = this.builder(this.props);
    const sheets = new WaterSheets();
    const rnd = new Random(1801);

    this.trainingCircle(b, p);
    this.waterfallOutcrop(b, p, sheets);
    this.stream(b, p, sheets);
    this.pavilion(b, p);
    this.stations(b, p, rnd);
    this.lookout(b, p);
    this.paths(p);
    this.trees(b, p, rnd);
    this.stoneLanterns(p);
    this.floatingLanterns();
    sheets.flush(b);
    void ctx;
  }

  // -------------------------------------------------------------------------

  private trainingCircle(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>): void {
    const { x, z, r } = CIRCLE;
    // Raised stone floor (walkable disc) with an inlaid ring pattern.
    const floor = new THREE.CylinderGeometry(r, r + 0.15, 0.5, 48);
    b.mesh(wtMat('stone_floor'), floor, { x, y: CIRCLE_TOP - 0.25, z });
    floor.dispose();
    b.collider({ shape: 'cylinder', x, y: CIRCLE_TOP - 0.25, z, r: r + 0.1, hy: 0.25, walkable: true, solid: true, surface: 'stone' });
    for (const [r0, r1, mat] of [
      [r - 0.9, r - 0.35, 'rock_dark'],
      [5.6, 6.1, 'rock_dark'],
      [1.2, 1.6, 'rock_dark'],
    ] as const) {
      const ring = flatRing(r0, r1, 56);
      b.mesh(wtMat(mat), ring, { x, y: CIRCLE_TOP + 0.01, z }, { castShadow: false });
      ring.dispose();
    }
    // Yin-yang-like spiral of the four elements: four coloured inlays at the centre ring.
    const cols = ['ice_trim', 'earth', 'sand', 'grass'] as const;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.RingGeometry(1.7, 5.4, 10, 1, (i / 4) * Math.PI * 2 + 0.06, Math.PI / 2 - 0.12);
      seg.rotateX(-Math.PI / 2);
      b.mesh(wtMat(cols[i]), seg, { x, y: CIRCLE_TOP + 0.008, z }, { castShadow: false });
      seg.dispose();
    }
    // Rim posts with spirit flames (low, solid) — none on the north-west side facing the spawn path.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.31;
      const px = x + Math.cos(a) * (r + 0.9), pz = z + Math.sin(a) * (r + 0.9);
      // keep the side facing the spawn open
      if (Math.hypot(px - TUTORIAL_SPAWN.x, pz - TUTORIAL_SPAWN.z) < 18.5) continue;
      p.cylinder(wtMat('rock'), { x: px, y: G - 0.1, z: pz, r: 0.38, rTop: 0.3, h: 1.25, segments: 7 }, { collide: true, walkable: false });
      p.instance('isle_post_glow', () => {
        const g = new THREE.SphereGeometry(0.17, 8, 6);
        return g;
      }, wtMat('spirit'), new THREE.Matrix4().makeTranslation(px, G + 1.32, pz), false);
    }
    // Braziers at the four diagonals.
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = x + Math.cos(a) * (r + 2.6), bz = z + Math.sin(a) * (r + 2.6);
      if (Math.hypot(bx - TUTORIAL_SPAWN.x, bz - TUTORIAL_SPAWN.z) < 18.5) continue;
      this.brazier(p, bx, G, bz);
    }
  }

  private brazier(p: ReturnType<WaterRegion['builder']>, x: number, y: number, z: number): void {
    p.instance('isle_brazier', () => brazierGeo(0.55, 1.15), wtMat('rock_dark'), new THREE.Matrix4().makeTranslation(x, y, z));
    p.instance('isle_brazier_fire', () => {
      const g = new THREE.ConeGeometry(0.42, 0.7, 7, 1);
      g.translate(0, 1.35, 0);
      return g;
    }, wtMat('fire'), new THREE.Matrix4().makeTranslation(x, y, z), false);
    p.collider({ shape: 'cylinder', x, y: y + 0.6, z, r: 0.55, hy: 0.6, walkable: false, solid: true });
    this.ambientEmitter('flame', 7, V(x, y + 1.3, z), { radius: 0.18, size: 0.9 }, 80, true);
    this.ambientEmitter('embers', 2.5, V(x, y + 1.5, z), { radius: 0.2 }, 60, true);
  }

  private waterfallOutcrop(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, sheets: WaterSheets): void {
    // Stacked boulders forming a small cliff on the pond's north shore; the fall pours from a notch at the top.
    const rocks: Array<[number, number, number, number, number, number]> = [
      // x, z, rx, ry, rz, seed
      [-1801.5, -1808, 4.2, 5.4, 3.6, 11],
      [-1785, -1808.5, 4.4, 5.0, 3.8, 12],
      [-1793, -1812, 6.2, 7.4, 4.6, 13],
      [-1797.5, -1804.6, 2.4, 3.2, 2.2, 14],
      [-1788.6, -1804.8, 2.4, 3.0, 2.2, 15],
      [-1779, -1806, 2.8, 2.6, 2.6, 16],
      [-1807, -1804, 2.6, 2.2, 2.4, 17],
      [-1793, -1817, 5.0, 5.5, 3.6, 18],
    ];
    const parts: THREE.BufferGeometry[] = [];
    const dark: THREE.BufferGeometry[] = [];
    for (const [x, z, rx, ry, rz, seed] of rocks) {
      const base = Math.min(heightAt(x, z), G) - 0.6;
      const g = boulder(seed, rx, ry, rz, 1);
      g.translate(x, base, z);
      (seed % 2 ? parts : dark).push(g);
      b.collider({ shape: 'cylinder', x, y: base + ry * 0.55, z, r: Math.min(rx, rz) * 0.85, hy: ry * 0.55, walkable: true, solid: true, surface: 'rock' });
    }
    const gm = mergeParts(parts);
    b.mesh(wtMat('rock'), gm, { x: 0, y: 0, z: 0 });
    gm.dispose();
    const gd = mergeParts(dark);
    b.mesh(wtMat('rock_dark'), gd, { x: 0, y: 0, z: 0 });
    gd.dispose();
    // Moss on top of the outcrop.
    const moss = pillow(9, 4.5, 0.5, 0.25);
    b.mesh(wtMat('moss'), moss, { x: -1793, y: FALL.top - 0.55, z: -1811.5 }, { castShadow: false });
    moss.dispose();
    // Spring pool on top + the fall + foam where it meets the pond.
    sheets.disc(wtWater('pool'), FALL.x, FALL.z - 4.4, 2.2, FALL.top - 0.05, 20);
    const fall = waterfall(b, FALL.x, FALL.z, 0, FALL.top, POND.level, 3.0, 0.55);
    const fall2 = waterfall(b, FALL.x - 0.9, FALL.z + 0.25, 0.05, FALL.top - 1.2, POND.level, 1.2, 0.3, false);
    void fall2;
    this.registerWater({ id: 'isle:waterfall', type: 'waterfall', label: 'Spirit Falls', x: fall.x, y: (fall.topY + fall.bottomY) / 2, z: fall.z + 0.5, r: 1.6, capacity: 220, regen: 12, size: 'medium' });
    this.registerWater({ id: 'isle:spring', type: 'pond', label: 'Spring Pool', x: FALL.x, y: FALL.top - 0.05, z: FALL.z - 4.4, r: 2.2, capacity: 40, regen: 2, size: 'small' });
    this.ambientEmitter('mist', 3, V(fall.x, POND.level + 0.6, fall.z + 1.2), { radius: 1.4 }, 70, true);
    this.ambientEmitter('spray', 2, V(fall.x, POND.level + 0.3, fall.z + 0.8), { radius: 0.8, speed: 1.5 }, 50, true);
    // Lily pads on the pond.
    const r = new Random(9);
    for (let i = 0; i < 14; i++) {
      const a = r.range(0, Math.PI * 2), d = r.range(6, 12.5);
      const x = POND.x + Math.cos(a) * d, z = POND.z + Math.sin(a) * d;
      if (z < -1798 && Math.abs(x - FALL.x) < 6) continue;
      p.instance('isle_lily', () => {
        const g = new THREE.CircleGeometry(0.55, 10, 0.3, Math.PI * 2 - 0.6);
        g.rotateX(-Math.PI / 2);
        return g;
      }, wtMat('leaf'), new THREE.Matrix4().compose(V(x, POND.level + 0.03, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.range(0, 6.28), 0)), V(r.range(0.7, 1.3), 1, r.range(0.7, 1.3))), false);
    }
  }

  private stream(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, sheets: WaterSheets): void {
    // Ribbon following the ground (+6 cm), with a pebble bed and bank stones.
    const pts: THREE.Vector2[] = STREAM.map((q) => new THREE.Vector2(q.x, q.z));
    const curve = new THREE.SplineCurve(pts);
    const n = 40;
    const half = 1.15;
    const pos: number[] = [];
    const bed: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const c = curve.getPoint(t);
      const tg = curve.getTangent(t);
      const nx = -tg.y, nz = tg.x;
      const w = half * (0.85 + 0.25 * Math.sin(t * 9));
      for (const s of [-1, 1]) {
        const x = c.x + nx * w * s, z = c.y + nz * w * s;
        const y = Math.max(POND.level + 0.02, heightAt(x, z) + 0.07);
        pos.push(x, y, z);
        const bx = c.x + nx * (w + 0.35) * s, bz = c.y + nz * (w + 0.35) * s;
        bed.push(bx, Math.max(POND.level - 0.05, heightAt(bx, bz) + 0.035), bz);
      }
    }
    for (let i = 0; i < n; i++) {
      const a = i * 2, c = a + 2;
      idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
    const water = new THREE.BufferGeometry();
    water.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    water.setIndex(idx);
    water.computeVertexNormals();
    sheets.add(wtWater('pond'), water);
    const bedG = new THREE.BufferGeometry();
    bedG.setAttribute('position', new THREE.Float32BufferAttribute(bed, 3));
    bedG.setIndex(idx.slice());
    bedG.computeVertexNormals();
    b.mesh(wtMat('rock_dark'), bedG, { x: 0, y: 0, z: 0 }, { castShadow: false });
    bedG.dispose();
    // Bank stones.
    const r = new Random(44);
    for (let i = 1; i < n; i += 2) {
      const t = i / n;
      const c = curve.getPoint(t);
      const tg = curve.getTangent(t);
      for (const s of [-1, 1]) {
        if (r.chance(0.35)) continue;
        const d = half + r.range(0.3, 0.8);
        const x = c.x - tg.y * d * s, z = c.y + tg.x * d * s;
        p.instance('isle_pebble', () => boulder(5, 0.32, 0.22, 0.28, 0), wtMat('rock'), new THREE.Matrix4().compose(V(x, heightAt(x, z) - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.range(0, 6), 0)), V(r.range(0.7, 1.6), r.range(0.7, 1.3), r.range(0.7, 1.6))));
      }
    }
    // Rock pool at the end of the brook.
    const pg = STREAM_POOL;
    sheets.disc(wtWater('pond'), pg.x, pg.z, pg.r, heightAt(pg.x, pg.z) + 0.1, 24);
    const pb = flatDisc(pg.r + 0.4, 24);
    b.mesh(wtMat('rock_dark'), pb, { x: pg.x, y: heightAt(pg.x, pg.z) + 0.04, z: pg.z }, { castShadow: false });
    pb.dispose();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = pg.x + Math.cos(a) * (pg.r + 0.5), z = pg.z + Math.sin(a) * (pg.r + 0.5);
      p.instance('isle_pebble', () => boulder(5, 0.32, 0.22, 0.28, 0), wtMat('rock'), new THREE.Matrix4().compose(V(x, heightAt(x, z) - 0.05, z), new THREE.Quaternion(), V(1.6, 1.3, 1.6)));
    }
    this.registerWater({ id: 'isle:stream', type: 'stream', label: 'Spirit Brook', x: STREAM[2].x, y: G + 0.07, z: STREAM[2].z, r: half, path: STREAM.map((q) => ({ x: q.x, z: q.z })), capacity: Infinity, regen: 0, size: 'medium' });
    this.registerWater({ id: 'isle:rock_pool', type: 'pond', label: 'Rock Pool', x: pg.x, y: heightAt(pg.x, pg.z) + 0.1, z: pg.z, r: pg.r, capacity: 60, regen: 3, size: 'small' });
    // A plank footbridge over the brook (walkable deck, very low).
    const bx = -1756.5, bz = -1788.3;
    for (let i = -2; i <= 2; i++) {
      p.box(wtMat('wood'), { x: bx + i * 0.45, y: G + 0.22, z: bz, sx: 0.4, sy: 0.1, sz: 3.6, yaw: 0.25 });
    }
    p.collider({ shape: 'box', x: bx, y: G + 0.12, z: bz, hx: 1.2, hy: 0.15, hz: 1.8, yaw: 0.25, walkable: true, solid: false, surface: 'wood' });
  }

  private pavilion(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>): void {
    const { x, z, size } = PAVILION;
    const top = G + 0.62;
    // Platform with steps on the pond side (east).
    b.box(wtMat('stone_floor'), { x, y: G - 0.3 + 0.46, z, sx: size + 1.2, sy: 0.92, sz: size + 1.2 }, { collide: true, walkable: true, surface: 'stone' });
    b.box(wtMat('rock'), { x, y: top - 0.04, z, sx: size + 1.4, sy: 0.12, sz: size + 1.4 });
    for (let s = 0; s < 2; s++) {
      b.box(wtMat('stone_floor'), { x: x + (size + 1.2) / 2 + 0.4 + s * 0.55, y: G + 0.2 - s * 0.2, z, sx: 0.6, sy: 0.4 - s * 0.2 + 0.2, sz: 3.6 }, { collide: true, walkable: true, surface: 'stone' });
    }
    // Lacquered pillars and lintels.
    const hp = 3.3;
    const posts: Array<[number, number]> = [];
    for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) if (sx !== 0 || sz !== 0) posts.push([x + sx * (size / 2 - 0.4), z + sz * (size / 2 - 0.4)]);
    for (const [px, pz] of posts) {
      b.cylinder(wtMat('lacquer'), { x: px, y: top, z: pz, r: 0.22, h: hp, segments: 10 }, { collide: true, walkable: false });
      b.cylinder(wtMat('rock_dark'), { x: px, y: top, z: pz, r: 0.32, h: 0.3, segments: 8 });
    }
    for (const s of [-1, 1]) {
      b.box(wtMat('lacquer'), { x, y: top + hp - 0.15, z: z + s * (size / 2 - 0.4), sx: size - 0.4, sy: 0.32, sz: 0.3 });
      b.box(wtMat('lacquer'), { x: x + s * (size / 2 - 0.4), y: top + hp - 0.15, z, sx: 0.3, sy: 0.32, sz: size - 0.4 });
    }
    // Pagoda roof (kit) with a gold finial.
    b.roof('roof_teal', { x, y: top + hp, z, w: size - 0.2, d: size - 0.2, height: 2.6, style: 'pagoda', overhang: 1.3, ridge: null });
    b.cylinder('gold', { x, y: top + hp + 2.4, z, r: 0.12, rTop: 0.02, h: 1.3, segments: 8 });
    // Meditation cushion, incense bowl, hanging spirit lantern.
    const cushion = pillow(1.3, 1.3, 0.28, 0.12);
    p.mesh(wtMatCushion(), cushion, { x: x + 0.6, y: top, z });
    cushion.dispose();
    p.cylinder(wtMat('rock_dark'), { x: x - 1.2, y: top, z, r: 0.28, rTop: 0.34, h: 0.35, segments: 10 });
    p.instance('isle_hang_lantern', () => {
      const g = new THREE.SphereGeometry(0.32, 12, 8);
      g.scale(1, 1.25, 1);
      return g;
    }, wtMat('spirit'), new THREE.Matrix4().makeTranslation(x, top + hp - 0.9, z), false);
    this.ambientEmitter('smoke', 0.8, V(x - 1.2, top + 0.45, z), { radius: 0.05, size: 0.3, speed: 0.3 }, 40, true);
    this.ambientEmitter('spirit', 1.5, V(x, top + 1.2, z), { radius: 3.5 }, 60, true);
    // Meditation: restores body, chi and spirit — a real, usable rest spot.
    this.interactable({
      id: 'isle:meditate',
      position: V(x + 0.6, top, z),
      radius: 3.2,
      label: 'Meditate in the pavilion',
      priority: 1,
      interact: (ctx) => {
        const pl = ctx.player;
        if (!pl) return;
        if (pl.health) pl.health.heal(pl.health.maxHp);
        pl.chi = pl.maxChi;
        ctx.avatar.spirit = ctx.avatar.maxSpirit;
        ctx.vfx.burst('spirit', pl.position.clone().setY(pl.position.y + 1.2), { count: 30, radius: 1.2 });
        ctx.events.emit('ui:notify', { text: 'You breathe with the isle. Body, chi and spirit are restored.', kind: 'success', duration: 3 });
      },
    });
  }

  private stations(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    // ICE: a frozen sheet ringed by crystals (walkable; an ice source).
    {
      const { x, z, r } = ICE;
      const top = G + 0.16;
      const sheet = new THREE.CylinderGeometry(r, r + 0.3, 0.42, 36);
      b.mesh(wtMat('ice_clear'), sheet, { x, y: top - 0.21, z });
      sheet.dispose();
      b.collider({ shape: 'cylinder', x, y: top - 0.21, z, r: r + 0.15, hy: 0.21, walkable: true, solid: true, surface: 'ice' });
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const cx = x + Math.cos(a) * (r + 0.9), cz = z + Math.sin(a) * (r + 0.9);
        if (Math.hypot(cx - TUTORIAL_SPAWN.x, cz - TUTORIAL_SPAWN.z) < 18) continue;
        const g = crystalCluster(70 + i, 1.4 + (i % 3) * 0.5, 4);
        b.mesh(wtMat('ice_clear'), g, { x: cx, y: G - 0.05, z: cz, yaw: a });
        g.dispose();
        b.collider({ shape: 'cylinder', x: cx, y: G + 0.6, z: cz, r: 0.45, hy: 0.6, walkable: false, solid: true });
      }
      this.registerWater({ id: 'isle:ice', type: 'ice', label: 'Ice Sheet', x, y: top, z, r, capacity: 180, regen: 4, frozen: true, size: 'medium' });
    }
    // SNOW: a soft snowfield with drifts (snow source for Snow Gathering).
    {
      const { x, z, r } = SNOW;
      const top = G + 0.22;
      const mound = new THREE.CylinderGeometry(r - 0.4, r + 0.6, 0.44, 32);
      b.mesh(wtMat('snow'), mound, { x, y: top - 0.22, z });
      mound.dispose();
      b.collider({ shape: 'cylinder', x, y: top - 0.22, z, r: r + 0.2, hy: 0.22, walkable: true, solid: true, surface: 'snow' });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.2;
        drift(p, x + Math.cos(a) * (r - 1.5), top, z + Math.sin(a) * (r - 1.5), rnd.range(2, 3.6), rnd.range(1.4, 2.4), rnd.range(0.3, 0.6), a);
      }
      // a little snow-capped rock and a snow lantern
      const sr = boulder(31, 1.0, 0.8, 0.9, 1);
      b.mesh(wtMat('rock'), sr, { x: x - 2.5, y: top - 0.2, z: z + 1.5 });
      sr.dispose();
      const cap = pillow(1.7, 1.5, 0.35, 0.15);
      b.mesh(wtMat('snow'), cap, { x: x - 2.5, y: top + 0.65, z: z + 1.5 }, { castShadow: false });
      cap.dispose();
      b.collider({ shape: 'cylinder', x: x - 2.5, y: top + 0.35, z: z + 1.5, r: 0.85, hy: 0.6, walkable: true, solid: true, surface: 'rock' });
      this.registerWater({ id: 'isle:snow', type: 'snow', label: 'Snowfield', x, y: top, z, r, capacity: Infinity, regen: 0, frozen: true, size: 'small' });
    }
    // SAND: a raked sand garden with three smooth stones.
    {
      const { x, z, w, d } = SAND;
      const top = G + 0.12;
      b.box(wtMat('rock_dark'), { x, y: top - 0.15, z, sx: w + 0.8, sy: 0.3, sz: d + 0.8 }, { collide: true, walkable: true, surface: 'stone' });
      b.box(wtMat('sand'), { x, y: top - 0.1, z, sx: w, sy: 0.24, sz: d }, { collide: true, walkable: true, surface: 'sand' });
      // raked lines
      for (let i = 0; i < 7; i++) {
        const lz = z - d / 2 + 0.8 + i * ((d - 1.6) / 6);
        p.box(wtMat('sand'), { x, y: top + 0.03, z: lz, sx: w - 0.6, sy: 0.05, sz: 0.12 }, { castShadow: false });
      }
      for (const [sx, sz, s] of [[-3.2, -1.2, 1.0], [2.6, 1.6, 0.8], [3.8, -2.0, 0.55]] as const) {
        const g = boulder(40 + sx, s, s * 0.7, s * 0.9, 1);
        b.mesh(wtMat('rock'), g, { x: x + sx, y: top - 0.1, z: z + sz });
        g.dispose();
        b.collider({ shape: 'cylinder', x: x + sx, y: top + s * 0.35, z: z + sz, r: s * 0.85, hy: s * 0.4, walkable: true, solid: true, surface: 'rock' });
        const ring = flatRing(s * 1.15, s * 1.3, 24);
        p.mesh(wtMat('sand'), ring, { x: x + sx, y: top + 0.04, z: z + sz }, { castShadow: false });
        ring.dispose();
      }
    }
    // EARTH: packed earth patch with bendable boulders.
    {
      const { x, z, r } = EARTH;
      const g = new THREE.CylinderGeometry(r, r + 0.4, 0.3, 30);
      b.mesh(wtMat('earth'), g, { x, y: G - 0.05, z });
      g.dispose();
      b.collider({ shape: 'cylinder', x, y: G - 0.05, z, r: r + 0.2, hy: 0.15, walkable: true, solid: true, surface: 'dirt' });
      const rocks: Array<[number, number, number]> = [[-3.5, -2.0, 1.1], [3.0, -2.6, 0.9], [0.5, 3.4, 1.3], [-2.6, 2.8, 0.7], [3.6, 1.8, 0.75]];
      for (const [ox, oz, s] of rocks) {
        const bg = boulder(60 + ox * 3, s, s * 0.85, s * 0.95, 1);
        b.mesh(wtMat('rock_dark'), bg, { x: x + ox, y: G, z: z + oz, yaw: ox });
        bg.dispose();
        b.collider({ shape: 'cylinder', x: x + ox, y: G + s * 0.45, z: z + oz, r: s * 0.9, hy: s * 0.5, walkable: true, solid: true, surface: 'rock' });
      }
    }
  }

  private lookout(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>): void {
    const { x, z } = LOOKOUT;
    const ground = Math.min(heightAt(x, z), G);
    const top = G + 0.42;
    const g = new THREE.CylinderGeometry(4.2, 4.6, top - ground + 0.6, 10);
    b.mesh(wtMat('stone_floor'), g, { x, y: ground - 0.6 + (top - ground + 0.6) / 2, z });
    g.dispose();
    b.collider({ shape: 'cylinder', x, y: (top + ground - 0.6) / 2, z, r: 4.4, hy: (top - ground + 0.6) / 2, walkable: true, solid: true, surface: 'stone' });
    for (const s of [-1, 1]) {
      p.cylinder(wtMat('rock'), { x: x + s * 3.2, y: top, z: z - 2.2, r: 0.32, h: 1.1, segments: 6 }, { collide: true, walkable: false });
      p.instance('isle_post_glow', () => new THREE.SphereGeometry(0.17, 8, 6), wtMat('spirit'), new THREE.Matrix4().makeTranslation(x + s * 3.2, top + 1.18, z - 2.2), false);
    }
  }

  private paths(p: ReturnType<WaterRegion['builder']>): void {
    // Stepping-stone paths (visual only; the ground is flat).
    const routes: Array<Array<[number, number]>> = [
      [[-1800, -1771], [-1796, -1766], [-1793, -1760]], // spawn -> circle
      [[-1803, -1779], [-1810, -1786], [-1815, -1795], [-1818, -1803]], // spawn -> pavilion
      [[-1805, -1756], [-1818, -1752], [-1832, -1750]], // circle -> snow
      [[-1806, -1766], [-1822, -1772], [-1830, -1774]], // -> ice
      [[-1771, -1752], [-1762, -1750]], // circle -> sand
      [[-1772, -1776], [-1760, -1796], [-1752, -1804]], // -> earth
      [[-1812, -1820], [-1806, -1836], [-1801, -1851]], // pavilion -> lookout
    ];
    const r = new Random(5);
    for (const route of routes) {
      for (let i = 0; i < route.length - 1; i++) {
        const [ax, az] = route[i], [bx, bz] = route[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const n = Math.max(1, Math.round(len / 1.35));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          const x = ax + (bx - ax) * t + r.range(-0.25, 0.25), z = az + (bz - az) * t + r.range(-0.25, 0.25);
          const y = heightAt(x, z);
          p.instance('isle_step', () => {
            const g = new THREE.CylinderGeometry(0.5, 0.55, 0.12, 8);
            g.translate(0, 0.02, 0);
            return g;
          }, wtMat('stone_floor'), new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r.range(0, 3), 0)), V(r.range(0.8, 1.15), 1, r.range(0.75, 1.0))), false);
        }
      }
    }
  }

  private trees(b: ReturnType<WaterRegion['builder']>, p: ReturnType<WaterRegion['builder']>, rnd: Random): void {
    const spots: Array<[number, number, 'pine' | 'round', number]> = [
      [-1858, -1812, 'pine', 9],
      [-1852, -1826, 'pine', 11],
      [-1840, -1836, 'round', 7],
      [-1772, -1828, 'pine', 10],
      [-1760, -1840, 'pine', 8],
      [-1826, -1840, 'pine', 9.5],
      [-1862, -1782, 'round', 6.5],
      [-1745, -1768, 'round', 6],
      [-1732, -1795, 'pine', 9],
      [-1815, -1728, 'pine', 8],
      [-1768, -1728, 'round', 6.5],
      [-1860, -1745, 'pine', 10],
    ];
    const trunks: THREE.BufferGeometry[] = [];
    const fol: THREE.BufferGeometry[] = [];
    const round: THREE.BufferGeometry[] = [];
    for (const [x, z, kind, h] of spots) {
      const y = heightAt(x, z) - 0.1;
      const [t, f] = kind === 'pine' ? conifer(Math.round(x * 7 + z), h) : roundTree(Math.round(x + z * 3), h);
      t.translate(x, y, z);
      f.translate(x, y, z);
      trunks.push(t);
      (kind === 'pine' ? fol : round).push(f);
      b.collider({ shape: 'cylinder', x, y: y + 1.5, z, r: 0.45, hy: 1.5, walkable: false, solid: true });
    }
    const tg = mergeParts(trunks);
    b.mesh(wtMat('wood'), tg, { x: 0, y: 0, z: 0 });
    tg.dispose();
    const fg = mergeParts(fol);
    b.mesh(wtMatPine(), fg, { x: 0, y: 0, z: 0 });
    fg.dispose();
    const rg = mergeParts(round);
    b.mesh(wtMat('leaf'), rg, { x: 0, y: 0, z: 0 });
    rg.dispose();
    // Scattered small rocks and grass tufts around the meadows (decor, density follows foliage setting).
    const dens = Math.max(0.3, Math.min(1.5, this.ctx.settings.data.graphics.foliageDensity));
    const count = Math.round(40 * dens);
    for (let i = 0; i < count; i++) {
      const a = rnd.range(0, Math.PI * 2), d = rnd.range(30, 68);
      const x = C.x + Math.cos(a) * d, z = C.z + Math.sin(a) * d;
      if (Math.hypot(x - CIRCLE.x, z - CIRCLE.z) < CIRCLE.r + 3) continue;
      if (Math.hypot(x - TUTORIAL_SPAWN.x, z - TUTORIAL_SPAWN.z) < 20) continue;
      p.instance('isle_rock_small', () => boulder(77, 0.5, 0.35, 0.45, 0), wtMat('rock'), new THREE.Matrix4().compose(V(x, heightAt(x, z) - 0.08, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rnd.range(0, 6), 0)), V(rnd.range(0.6, 1.8), rnd.range(0.6, 1.5), rnd.range(0.6, 1.8))));
    }
  }

  private stoneLanterns(p: ReturnType<WaterRegion['builder']>): void {
    const spots: Array<[number, number]> = [
      [-1805, -1781], // hm: kept outside the 6 m spawn radius
      [-1781, -1779],
      [-1813, -1793],
      [-1770, -1801],
      [-1809, -1823],
      [-1832, -1797],
      [-1797, -1846],
      [-1777, -1770],
    ];
    for (const [x, z] of spots) {
      if (Math.hypot(x - TUTORIAL_SPAWN.x, z - TUTORIAL_SPAWN.z) < 6.5) continue;
      const y = heightAt(x, z) - 0.05;
      p.instance('isle_toro', () => {
        const parts: THREE.BufferGeometry[] = [];
        const base = new THREE.CylinderGeometry(0.35, 0.45, 0.3, 6);
        base.translate(0, 0.15, 0);
        const post = new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6);
        post.translate(0, 0.75, 0);
        const box = new THREE.BoxGeometry(0.6, 0.12, 0.6);
        box.translate(0, 1.26, 0);
        const roof = new THREE.ConeGeometry(0.55, 0.38, 4);
        roof.rotateY(Math.PI / 4);
        roof.translate(0, 1.82, 0);
        parts.push(base, post, box, roof);
        return mergeParts(parts);
      }, wtMat('rock'), new THREE.Matrix4().makeTranslation(x, y, z));
      p.instance('isle_toro_light', () => {
        const g = new THREE.BoxGeometry(0.36, 0.34, 0.36);
        g.translate(0, 1.48, 0);
        return g;
      }, wtMat('spirit'), new THREE.Matrix4().makeTranslation(x, y, z), false);
      p.collider({ shape: 'cylinder', x, y: y + 0.9, z, r: 0.38, hy: 0.9, walkable: false, solid: true });
    }
  }

  private floatingLanterns(): void {
    const n = 9;
    const geo = this.own(new THREE.SphereGeometry(0.26, 10, 8));
    geo.scale(1, 1.3, 1);
    const im = new THREE.InstancedMesh(geo, wtMat('spirit'), n);
    im.frustumCulled = false;
    const r = new Random(321);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
      const d = i < 6 ? r.range(4, 11) : r.range(14, 22);
      const cx = i < 6 ? POND.x : PAVILION.x + 12, cz = i < 6 ? POND.z : PAVILION.z + 4;
      this.lanternBase.push({ x: cx + Math.cos(a) * d, y: (i < 6 ? POND.level + 1.6 : G + 2.4) + r.range(0, 1.2), z: cz + Math.sin(a) * d, ph: r.range(0, 6.28) });
    }
    this.lanterns = im;
    this.props.add(im);
    this.updateLanterns(0);
  }

  private updateLanterns(t: number): void {
    if (!this.lanterns) return;
    for (let i = 0; i < this.lanternBase.length; i++) {
      const l = this.lanternBase[i];
      this.m4.makeTranslation(l.x + Math.sin(t * 0.21 + l.ph) * 0.6, l.y + Math.sin(t * 0.8 + l.ph) * 0.25, l.z + Math.cos(t * 0.17 + l.ph) * 0.6);
      this.lanterns.setMatrixAt(i, this.m4);
    }
    this.lanterns.instanceMatrix.needsUpdate = true;
  }

  protected override tick(_dt: number, ctx: GameContext): void {
    this.updateLanterns(ctx.time.elapsed);
  }

  override dispose(ctx: GameContext): void {
    this.lanterns?.removeFromParent();
    this.lanterns?.dispose();
    this.lanterns = null;
    this.lanternBase = [];
    super.dispose(ctx);
  }
}

let cushionMat: THREE.MeshStandardMaterial | null = null;
function wtMatCushion(): THREE.MeshStandardMaterial {
  cushionMat ??= new THREE.MeshStandardMaterial({ color: '#2f5f9e', roughness: 0.95 });
  return cushionMat;
}

let pineMat: THREE.MeshStandardMaterial | null = null;
function wtMatPine(): THREE.MeshStandardMaterial {
  pineMat ??= new THREE.MeshStandardMaterial({ color: '#2f5a33', roughness: 0.9, flatShading: true });
  return pineMat;
}

export function createMeditationIsle(): MeditationIsle {
  return new MeditationIsle();
}
