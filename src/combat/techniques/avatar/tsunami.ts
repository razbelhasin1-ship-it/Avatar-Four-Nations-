import * as THREE from 'three';
import { createWaterMaterial } from '../../water/WaterMaterials';
import type { GameContext } from '../../../core/GameContext';
import { effect } from '../../../vfx/effects/loop';
import { registerTechnique } from '../../CombatSystem';
import { aimFlat, anim, enemiesNear, push, shake } from '../bending/util';
import { beginUltimate, bigObstacleAt, spiritPrecheck, surfaceY } from './common';

/**
 * Tsunami — an advancing wall of water with a clear breaking front.
 * Water comes from the environment through ctx.water.acquire (reserve → the
 * nearest real source within the Avatar's draw range); as an ultimate it may
 * conjure the remainder (`canConjure`). The wall rises, rolls forward ~30 m
 * following terrain or the sea, knocks down and soaks everything its front
 * meets (once per enemy), crashes into solid walls, and leaves wet ground and
 * bendable puddles behind (ctx.water.release).
 */

const WIDTH = 15;
const HEIGHT = 4.3;
const SPEED = 12;
const DIST = 30;

/** Breaking-wave cross-section (forward z, up y) for unit height, back toe → crest → lip → front toe. */
const PROFILE: Array<[number, number]> = [
  [-1.5, 0.0],
  [-1.0, 0.36],
  [-0.45, 0.8],
  [0.0, 1.0],
  [0.42, 0.95],
  [0.66, 0.72],
  [0.44, 0.56],
  [0.24, 0.32],
  [0.3, 0.0],
];

function sampleProfile(n: number): Array<[number, number]> {
  const curve = new THREE.SplineCurve(PROFILE.map(([z, y]) => new THREE.Vector2(z, y)));
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const p = curve.getPoint(i / n);
    out.push([p.x, p.y]);
  }
  return out;
}

const tA = new THREE.Vector3();
const tB = new THREE.Vector3();

/** Dynamic wave sheet rewritten in world space each frame (columns follow the ground). */
class WaveMesh {
  readonly mesh: THREE.Mesh;
  readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly pos: Float32Array;
  private readonly prof: Array<[number, number]>;
  readonly crest: THREE.Vector3[] = [];
  readonly toes: THREE.Vector3[] = [];

  constructor(private readonly ctx: GameContext, readonly cols: number, readonly rows: number) {
    this.prof = sampleProfile(rows);
    const nv = (cols + 1) * (rows + 1);
    this.pos = new Float32Array(nv * 3);
    const uv = new Float32Array(nv * 2);
    const idx: number[] = [];
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j <= rows; j++) {
        const k = i * (rows + 1) + j;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = (j / rows) * 3.5;
        if (i < cols && j < rows) {
          const a = k, b = k + rows + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    this.mat = createWaterMaterial({ opacity: 0.93, flow: 4.2, foam: 2.2, glow: 0.08, deep: '#0f4f8a', shallow: '#86d4f2' });
    this.mat.side = THREE.DoubleSide;
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    for (let i = 0; i <= cols; i++) {
      this.crest.push(new THREE.Vector3());
      this.toes.push(new THREE.Vector3());
    }
    ctx.vfx.group.add(this.mesh);
  }

  /** Rebuild around the front centre `front` moving along `dir`, height h (m). */
  update(front: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, h: number, t: number): void {
    const { cols, rows, pos, prof } = this;
    for (let i = 0; i <= cols; i++) {
      const u = i / cols;
      const s = (u - 0.5) * 2;
      const taper = 1 - Math.pow(Math.abs(s), 3);
      const lateral = s * WIDTH * 0.5;
      // The ends trail behind the centre (curved front) and ripple.
      const back = -1.6 * s * s + 0.25 * Math.sin(t * 3 + u * 9);
      const cx = front.x + side.x * lateral + dir.x * back;
      const cz = front.z + side.z * lateral + dir.z * back;
      const gy = surfaceY(this.ctx, cx, cz, front.y);
      const hh = Math.max(0.05, h * (0.25 + 0.75 * taper) * (1 + 0.06 * Math.sin(t * 5 + u * 13)));
      const thick = Math.max(0.6, hh * 0.8);
      for (let j = 0; j <= rows; j++) {
        const [pz, py] = prof[j];
        const k = (i * (rows + 1) + j) * 3;
        pos[k] = cx + dir.x * pz * thick;
        pos[k + 1] = gy + py * hh - 0.05;
        pos[k + 2] = cz + dir.z * pz * thick;
      }
      this.crest[i].set(cx + dir.x * 0.55 * thick, gy + hh * 0.85, cz + dir.z * 0.55 * thick);
      this.toes[i].set(cx + dir.x * 0.3 * thick, gy, cz + dir.z * 0.3 * thick);
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

registerTechnique({
  id: 'ult_tsunami',
  name: 'Tsunami',
  element: 'avatar',
  kind: 'ultimate',
  tier: 4,
  requires: 'elementsSphere',
  description: 'Heave the nearest sea, river or lake into a towering wall of water and drive it across the battlefield, knocking down and soaking everything in its path.',
  usage: 'Elements Sphere only. Draws 50 water from nearby sources (the Avatar may conjure what is missing). The wave rolls ~30 m forward, 15 m wide, and leaves puddles you can bend again. Costs 15 spirit.',
  icon: 'water',
  chiCost: 30,
  cooldown: 9,
  water: { amount: 50, canConjure: true },
  windup: 0.6,
  recovery: 0.5,
  movement: 'root',
  airborne: false,
  interruptible: false,
  range: 26,
  precheck: spiritPrecheck('ult_tsunami'),
  begin(cast) {
    beginUltimate(cast);
    const ctx = cast.ctx;
    const c = cast.caster;
    anim(c, 'ult_tsunami_cast', { fadeIn: 0.05 });
    ctx.audio.play('ult.tsunami', { position: c.position, volume: 1 });
    ctx.events.emit('camera:impulse', { pullback: 3.5, fovKick: 5, duration: 1.6 });
    // Water visibly rushes in from its real source (or condenses around the Avatar when conjured).
    const from = cast.water.from ? cast.water.from.clone() : null;
    const dest = c.position.clone().addScaledVector(aimFlat(cast), 2).setY(c.position.y + 0.6);
    let age = 0;
    effect((dt) => {
      age += dt;
      if (age > 0.6 || !cast.caster.alive) return false;
      if (from) {
        for (let i = 0; i < 3; i++) {
          const k = Math.min(1, age / 0.6 + Math.random() * 0.4);
          const p = tA.lerpVectors(from, dest, k);
          p.y += Math.sin(k * Math.PI) * 2.5;
          ctx.vfx.burst('spray', p, { count: 2, radius: 0.4, speed: 0.6 });
          ctx.vfx.burst('splash', p, { count: 1, radius: 0.3, speed: 1 });
        }
        if (age < dt * 1.5) ctx.vfx.burst('splash', from, { count: 16, radius: 1.5, speed: 2 });
      } else {
        const p = tA.copy(dest).add(tB.randomDirection().multiplyScalar(2.5));
        ctx.vfx.burst('mist', p, { count: 1, dir: tB.subVectors(dest, p), speed: 1.5, spread: 0.2 });
        ctx.vfx.burst('spray', dest, { count: 2, radius: 1, speed: 0.6 });
      }
      return true;
    });
  },
  release(cast) {
    const ctx = cast.ctx;
    const c = cast.caster;
    const dir = aimFlat(cast);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const start = c.position.clone().addScaledVector(dir, 2.2);
    start.y = surfaceY(ctx, start.x, start.z, c.position.y);
    const q = ctx.vfx.quality;
    const wave = new WaveMesh(ctx, q === 'low' ? 12 : q === 'medium' ? 18 : 24, q === 'low' ? 8 : 12);
    const front = start.clone();
    let traveled = 0;
    let age = 0;
    let collapse = -1;
    let lastWet = -99;
    const path: THREE.Vector3[] = [];
    const amount = cast.water.amount;
    const surfaceAt = (p: THREE.Vector3) => surfaceY(ctx, p.x, p.z, p.y);
    const finish = () => {
      // Water returns to the world: wet ground + bendable puddles along the last stretch.
      path.push(front.clone());
      const n = Math.min(3, path.length);
      for (let i = 0; i < n; i++) {
        const p = path[path.length - 1 - i * 2] ?? path[path.length - 1];
        ctx.water.release(p, (amount * 0.6) / Math.max(1, n));
      }
    };
    effect(
      (dt) => {
        age += dt;
        const rise = Math.min(1, age / 0.35);
        if (collapse < 0) {
          const step = SPEED * dt;
          const nx = front.x + dir.x * step, nz = front.z + dir.z * step;
          const ny = surfaceAt(tA.set(nx, front.y, nz));
          // A cliff or a wall stops the wave: it crashes there (it flows around trees and posts).
          const blocked = ny - front.y > 3.5 || bigObstacleAt(ctx, tA.set(nx, ny + 1.6, nz), 1.2, 1.4) !== null;
          if (blocked || traveled >= DIST) collapse = 0;
          else {
            front.set(nx, ny, nz);
            traveled += step;
          }
        } else collapse += dt;
        const fall = collapse < 0 ? 1 : Math.max(0, 1 - collapse / 0.45);
        const h = HEIGHT * rise * fall * (1 - 0.25 * Math.min(1, traveled / DIST));
        wave.update(front, dir, side, h, age);
        // Front hits: knockdown + soak, once per enemy; then the body carries them along.
        for (const e of enemiesNear(cast, front, WIDTH * 0.5 + 3)) {
          const rel = tA.subVectors(e.position, front);
          const along = rel.dot(dir);
          const lat = Math.abs(rel.dot(side));
          if (lat > WIDTH * 0.5 + 0.5 || along > 1.4 || along < -3.2) continue;
          if (e.position.y - surfaceAt(e.position) > h + 0.5) continue;
          const b = e.body;
          if (b && collapse < 0) b.external.addScaledVector(dir, 26 * dt);
          cast.hit(e, { damage: 34, knockback: push(dir, 20), launch: 3.5, knockdown: true, stagger: 90, status: [{ type: 'soaked', duration: 8 }], point: e.aimPoint(tB).clone() });
        }
        // Spray off the crest, foam at the toe, mist behind.
        const cols = wave.cols;
        const rate = q === 'low' ? 0.35 : 0.65;
        for (let i = 0; i <= cols; i += 2) {
          if (Math.random() > rate || h < 0.3) continue;
          ctx.vfx.burst('spray', wave.crest[i], { count: 2, dir: tB.copy(dir).setY(0.8), spread: 0.5, speed: 1.8 });
          if (Math.random() < 0.4) ctx.vfx.burst('splash', wave.toes[i], { count: 2, dir: tB.copy(dir).setY(1), spread: 0.6, speed: 2.2 });
        }
        if (Math.random() < dt * 8) ctx.vfx.burst('mist', tA.copy(front).addScaledVector(dir, -3).setY(front.y + 1), { count: 2, radius: WIDTH * 0.3 });
        if (traveled - lastWet > 2.5 && collapse < 0) {
          lastWet = traveled;
          path.push(front.clone());
          for (const s of [-0.33, 0, 0.33]) ctx.world.fx.wet(tA.copy(front).addScaledVector(side, (s + (Math.random() - 0.5) * 0.2) * WIDTH).addScaledVector(dir, (Math.random() - 0.5) * 2), 2.4 + Math.random() * 1.4);
          ctx.world.fx.disturb(front, 7, 1.2);
        }
        if (collapse === 0) {
          ctx.vfx.burst('splash', tA.copy(front).setY(front.y + 1.5), { count: 40, radius: WIDTH * 0.35, speed: 3 });
          ctx.vfx.burst('spray', tA.copy(front).setY(front.y + 2), { count: 30, radius: WIDTH * 0.3, speed: 2 });
          ctx.audio.play('water.splash.big', { position: front, volume: 1 });
          shake(ctx, front, 0.25, 0.4);
        }
        if (collapse >= 0.45) {
          finish(); // puddles only when the wave really broke (not when cleared at session end)
          return false;
        }
        return true;
      },
      () => wave.dispose(),
    );
    ctx.vfx.burst('splash', start.clone().setY(start.y + 1), { count: 30, radius: 4, speed: 3 });
    shake(ctx, start, 0.3, 0.5);
  },
});
