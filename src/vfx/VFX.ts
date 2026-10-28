import * as THREE from 'three';
import type { EventBus } from '../core/EventBus';
import type { SettingsManager } from '../core/Settings';
import { ParticleLayer, type ParticleSpawn } from './Particles';

/**
 * Visual effects facade used by combat, movement, world and UI.
 *
 *   vfx.burst('fire', pos, { count: 20, dir, speed })
 *   const em = vfx.emitter('embers', { rate: 30 }); em.position.copy(...); em.stop();
 *   vfx.ring(pos, '#9fd8ff', 6, 0.5)
 *   vfx.flash(pos, '#ffaa55', 8, 0.25)
 *
 * Bending techniques build their bespoke meshes (water ribbons, rock geometry,
 * flame columns) themselves, and use this for particles/flashes/rings.
 * All particle counts are scaled by settings.graphics.particleDensity.
 */

export type ParticlePreset =
  | 'dust'
  | 'debris'
  | 'splash'
  | 'spray'
  | 'mist'
  | 'snow'
  | 'snowpuff'
  | 'fire'
  | 'flame'
  | 'fireball'
  | 'embers'
  | 'smoke'
  | 'air'
  | 'swirl'
  | 'sparks'
  | 'ice'
  | 'leaves'
  | 'steam'
  | 'glow'
  | 'sand'
  | 'ash'
  | 'spirit'
  | 'heal';

export interface BurstOptions {
  count?: number;
  /** Main direction (normalized not required). */
  dir?: THREE.Vector3;
  /** Cone spread 0 (laser) .. 1 (hemisphere) .. 2 (sphere). */
  spread?: number;
  speed?: number;
  /** Random position jitter radius. */
  radius?: number;
  color?: THREE.ColorRepresentation;
  color2?: THREE.ColorRepresentation;
  size?: number;
  life?: number;
  /** Swirl rate around the burst origin's vertical axis. */
  swirl?: number;
  gravity?: number;
}

interface PresetDef {
  additive: boolean;
  count: number;
  speed: [number, number];
  life: [number, number];
  size0: [number, number];
  size1: [number, number];
  color0: string;
  color1: string;
  alpha0: number;
  alpha1: number;
  gravity: number;
  drag: number;
  spread: number;
  up: number; // default upward bias
  soft: boolean;
  spin?: number;
  /** Flame tongue / smoke puff sprites (see Particles.ts). */
  shape?: 'flame' | 'smoke';
}

const PRESETS: Record<ParticlePreset, PresetDef> = {
  dust: { additive: false, count: 14, speed: [1, 4], life: [0.7, 1.6], size0: [0.4, 0.8], size1: [1.6, 2.8], color0: '#a89070', color1: '#8a7a66', alpha0: 0.55, alpha1: 0, gravity: -0.4, drag: 2.2, spread: 1.6, up: 0.4, soft: true },
  debris: { additive: false, count: 10, speed: [4, 9], life: [0.6, 1.2], size0: [0.12, 0.25], size1: [0.1, 0.2], color0: '#6d6052', color1: '#5a4e42', alpha0: 1, alpha1: 1, gravity: 18, drag: 0.4, spread: 1.0, up: 1.0, soft: false, spin: 6 },
  splash: { additive: false, count: 18, speed: [3, 8], life: [0.4, 0.9], size0: [0.15, 0.35], size1: [0.35, 0.6], color0: '#d8f2ff', color1: '#7fc4ee', alpha0: 0.85, alpha1: 0, gravity: 14, drag: 0.8, spread: 0.9, up: 1.0, soft: true },
  spray: { additive: false, count: 26, speed: [2, 6], life: [0.5, 1.1], size0: [0.2, 0.4], size1: [0.8, 1.4], color0: '#eaf8ff', color1: '#bfe3f7', alpha0: 0.5, alpha1: 0, gravity: 3, drag: 2.5, spread: 1.3, up: 0.6, soft: true },
  mist: { additive: false, count: 10, speed: [0.3, 1.2], life: [1.4, 2.8], size0: [1.5, 2.5], size1: [3, 5], color0: '#e8f4fa', color1: '#d0e6f2', alpha0: 0.25, alpha1: 0, gravity: -0.2, drag: 1.5, spread: 2, up: 0.2, soft: true },
  snow: { additive: false, count: 14, speed: [1, 3.5], life: [0.6, 1.4], size0: [0.12, 0.25], size1: [0.2, 0.35], color0: '#ffffff', color1: '#e6f2fb', alpha0: 0.95, alpha1: 0, gravity: 4, drag: 1.5, spread: 1.2, up: 0.8, soft: true },
  snowpuff: { additive: false, count: 12, speed: [0.8, 2.5], life: [0.6, 1.2], size0: [0.3, 0.6], size1: [1.0, 1.8], color0: '#f6fbff', color1: '#e3eff8', alpha0: 0.7, alpha1: 0, gravity: 0.5, drag: 2.5, spread: 1.8, up: 0.5, soft: true },
  fire: { additive: false, count: 16, speed: [1.5, 4], life: [0.35, 0.7], size0: [0.55, 0.95], size1: [0.15, 0.3], color0: '#ffc65a', color1: '#d42e08', alpha0: 1, alpha1: 0, gravity: -5, drag: 2, spread: 0.8, up: 0.6, soft: true, shape: 'flame', spin: 0.4 },
  flame: { additive: false, count: 10, speed: [0.5, 1.5], life: [0.25, 0.5], size0: [0.65, 1.05], size1: [0.2, 0.35], color0: '#ffd36e', color1: '#e2400a', alpha0: 1, alpha1: 0, gravity: -8, drag: 3, spread: 0.6, up: 1.0, soft: true, shape: 'flame', spin: 0.3 },
  /** Billowing fireball puffs (explosions): swell, rise and cool from yellow-white to deep red. */
  fireball: { additive: false, count: 12, speed: [1.5, 4.5], life: [0.45, 0.85], size0: [0.8, 1.3], size1: [1.7, 2.5], color0: '#ffe39a', color1: '#a8240a', alpha0: 1, alpha1: 0, gravity: -3.5, drag: 4, spread: 2, up: 0.3, soft: true, shape: 'flame', spin: 0.6 },
  embers: { additive: true, count: 12, speed: [1, 4], life: [0.8, 1.8], size0: [0.05, 0.1], size1: [0.02, 0.05], color0: '#ffb347', color1: '#ff4010', alpha0: 1, alpha1: 0, gravity: -1.5, drag: 0.8, spread: 1.4, up: 0.8, soft: false },
  smoke: { additive: false, count: 8, speed: [0.5, 1.6], life: [1.2, 2.6], size0: [0.6, 1.0], size1: [2.2, 3.6], color0: '#5a5450', color1: '#3a3634', alpha0: 0.45, alpha1: 0, gravity: -1.2, drag: 1.2, spread: 1.0, up: 1.0, soft: true, shape: 'smoke', spin: 0.3 },
  air: { additive: false, count: 14, speed: [3, 7], life: [0.35, 0.7], size0: [0.3, 0.6], size1: [1.2, 2.0], color0: '#f4f8ff', color1: '#e2ecf8', alpha0: 0.38, alpha1: 0, gravity: 0, drag: 3, spread: 0.7, up: 0.0, soft: true },
  swirl: { additive: false, count: 20, speed: [1, 3], life: [0.6, 1.2], size0: [0.25, 0.5], size1: [0.6, 1.2], color0: '#ffffff', color1: '#dfe9f6', alpha0: 0.45, alpha1: 0, gravity: -0.5, drag: 1.0, spread: 2, up: 0.3, soft: true },
  sparks: { additive: true, count: 14, speed: [5, 11], life: [0.2, 0.5], size0: [0.05, 0.1], size1: [0.01, 0.03], color0: '#fff4c0', color1: '#ff8a20', alpha0: 1, alpha1: 0, gravity: 9, drag: 1, spread: 1.4, up: 0.6, soft: false },
  ice: { additive: false, count: 14, speed: [3, 8], life: [0.4, 0.9], size0: [0.1, 0.22], size1: [0.06, 0.12], color0: '#e6f8ff', color1: '#9fd8ff', alpha0: 0.95, alpha1: 0.3, gravity: 14, drag: 0.6, spread: 1.2, up: 0.8, soft: false, spin: 8 },
  leaves: { additive: false, count: 8, speed: [1, 3], life: [1.5, 3], size0: [0.12, 0.2], size1: [0.12, 0.2], color0: '#6a9a3a', color1: '#a8a03a', alpha0: 1, alpha1: 0, gravity: 1.2, drag: 1.5, spread: 1.6, up: 0.8, soft: false, spin: 4 },
  steam: { additive: false, count: 10, speed: [0.6, 1.8], life: [0.9, 1.8], size0: [0.4, 0.7], size1: [1.6, 2.6], color0: '#f2f2f2', color1: '#dadada', alpha0: 0.4, alpha1: 0, gravity: -2, drag: 1.4, spread: 0.8, up: 1.0, soft: true },
  glow: { additive: true, count: 1, speed: [0, 0], life: [0.3, 0.3], size0: [2, 2], size1: [3, 3], color0: '#ffffff', color1: '#ffffff', alpha0: 0.9, alpha1: 0, gravity: 0, drag: 0, spread: 0, up: 0, soft: true },
  sand: { additive: false, count: 14, speed: [1.5, 5], life: [0.6, 1.4], size0: [0.3, 0.6], size1: [1.2, 2.0], color0: '#e4cf9a', color1: '#cdb27a', alpha0: 0.55, alpha1: 0, gravity: 1, drag: 2, spread: 1.4, up: 0.5, soft: true },
  ash: { additive: false, count: 10, speed: [0.2, 1], life: [2, 4], size0: [0.05, 0.1], size1: [0.05, 0.1], color0: '#6a6060', color1: '#4a4444', alpha0: 0.8, alpha1: 0, gravity: 0.6, drag: 0.6, spread: 2, up: 0.2, soft: false, spin: 2 },
  spirit: { additive: true, count: 16, speed: [0.5, 2], life: [0.8, 1.6], size0: [0.15, 0.3], size1: [0.02, 0.06], color0: '#cfefff', color1: '#7fb8ff', alpha0: 0.9, alpha1: 0, gravity: -1.5, drag: 1, spread: 2, up: 0.6, soft: true },
  heal: { additive: true, count: 14, speed: [0.4, 1.4], life: [0.8, 1.4], size0: [0.15, 0.3], size1: [0.05, 0.1], color0: '#b6f0ff', color1: '#4fb8ff', alpha0: 0.9, alpha1: 0, gravity: -2, drag: 1, spread: 2, up: 1, soft: true },
};

export interface Emitter {
  readonly position: THREE.Vector3;
  readonly direction: THREE.Vector3;
  rate: number;
  options: BurstOptions;
  active: boolean;
  stop(): void;
}

interface EmitterImpl extends Emitter {
  preset: ParticlePreset;
  accum: number;
  ttl: number;
}

interface Transient {
  obj: THREE.Object3D;
  age: number;
  life: number;
  update(t: number): void;
  dispose(): void;
}

const c0 = new THREE.Color();
const c1 = new THREE.Color();
const tmpDir = new THREE.Vector3();

export class VFXSystem {
  readonly group = new THREE.Group();
  private readonly add: ParticleLayer;
  private readonly alpha: ParticleLayer;
  private emitters: EmitterImpl[] = [];
  private transients: Transient[] = [];
  private density = 1;
  private dynamicLights = false;
  private lightPool: THREE.PointLight[] = [];
  private readonly ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private readonly sphereGeo = new THREE.SphereGeometry(1, 16, 12);

  constructor(private readonly settings: SettingsManager, events: EventBus) {
    this.group.name = 'vfx';
    this.add = new ParticleLayer(3000, true);
    this.alpha = new ParticleLayer(3000, false);
    this.group.add(this.alpha.mesh, this.add.mesh);
    this.applySettings();
    events.on('settings:changed', () => this.applySettings());
  }

  private applySettings(): void {
    const g = this.settings.data.graphics;
    this.density = g.particleDensity;
    this.dynamicLights = g.dynamicLights;
  }

  get quality(): 'low' | 'medium' | 'high' {
    return this.settings.data.graphics.effectsQuality;
  }

  get particleCount(): number {
    return this.add.live + this.alpha.live;
  }

  /** Spawn a one-shot burst of a preset. */
  burst(preset: ParticlePreset, pos: THREE.Vector3, o: BurstOptions = {}): void {
    const p = PRESETS[preset];
    const n = Math.max(o.count === 0 ? 0 : 1, Math.round((o.count ?? p.count) * this.density));
    const layer = p.additive ? this.add : this.alpha;
    const spread = o.spread ?? p.spread;
    const dir = tmpDir.set(0, 1, 0);
    if (o.dir) dir.copy(o.dir).normalize();
    c0.set(o.color ?? p.color0);
    c1.set(o.color2 ?? (o.color ? o.color : p.color1));
    const sizeMul = o.size ?? 1;
    for (let i = 0; i < n; i++) {
      // random direction within cone around dir
      let rx = Math.random() * 2 - 1, ry = Math.random() * 2 - 1, rz = Math.random() * 2 - 1;
      const rl = Math.hypot(rx, ry, rz) || 1;
      rx /= rl; ry /= rl; rz /= rl;
      let dx = dir.x + rx * spread, dy = dir.y + ry * spread + (o.dir ? 0 : p.up), dz = dir.z + rz * spread;
      const dl = Math.hypot(dx, dy, dz) || 1;
      dx /= dl; dy /= dl; dz /= dl;
      const sp = (o.speed ?? 1) * (p.speed[0] + Math.random() * (p.speed[1] - p.speed[0]));
      const jr = o.radius ?? 0;
      const life = (o.life ?? 1) * (p.life[0] + Math.random() * (p.life[1] - p.life[0]));
      const sp0: ParticleSpawn = {
        x: pos.x + (Math.random() - 0.5) * 2 * jr,
        y: pos.y + (Math.random() - 0.5) * 2 * jr * 0.5,
        z: pos.z + (Math.random() - 0.5) * 2 * jr,
        vx: dx * sp,
        vy: dy * sp,
        vz: dz * sp,
        life,
        size0: sizeMul * (p.size0[0] + Math.random() * (p.size0[1] - p.size0[0])),
        size1: sizeMul * (p.size1[0] + Math.random() * (p.size1[1] - p.size1[0])),
        color0: c0,
        color1: c1,
        alpha0: p.alpha0,
        alpha1: p.alpha1,
        gravity: o.gravity ?? p.gravity,
        drag: p.drag,
        spin: (p.spin ?? 0.5) * (Math.random() - 0.5) * 2,
        soft: p.soft,
        shape: p.shape,
        swirl: o.swirl,
        cx: pos.x,
        cz: pos.z,
      };
      layer.spawn(sp0);
    }
  }

  /** Continuous emitter; call stop() when done. Auto-stops after ttl seconds if given. */
  emitter(preset: ParticlePreset, rate: number, options: BurstOptions = {}, ttl = Infinity): Emitter {
    const e: EmitterImpl = {
      preset,
      rate,
      options,
      position: new THREE.Vector3(),
      direction: new THREE.Vector3(0, 1, 0),
      active: true,
      accum: 0,
      ttl,
      stop() {
        this.active = false;
      },
    };
    this.emitters.push(e);
    return e;
  }

  /** Expanding ground/air ring (shockwave). */
  ring(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, duration = 0.5, opts: { vertical?: boolean; normal?: THREE.Vector3; opacity?: number } = {}): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opts.opacity ?? 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.position.copy(pos);
    if (opts.normal) mesh.lookAt(pos.clone().add(opts.normal));
    else if (!opts.vertical) mesh.rotation.x = -Math.PI / 2;
    this.group.add(mesh);
    const startOpacity = mat.opacity;
    this.transients.push({
      obj: mesh,
      age: 0,
      life: duration,
      update: (t) => {
        const s = 0.2 + radius * (1 - Math.pow(1 - t, 2));
        mesh.scale.setScalar(s);
        mat.opacity = startOpacity * (1 - t);
      },
      dispose: () => {
        this.group.remove(mesh);
        mat.dispose();
      },
    });
  }

  /** Expanding translucent sphere (energy wave). */
  sphereWave(pos: THREE.Vector3, color: THREE.ColorRepresentation, radius: number, duration = 0.6, opacity = 0.35): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(this.sphereGeo, mat);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.transients.push({
      obj: mesh,
      age: 0,
      life: duration,
      update: (t) => {
        mesh.scale.setScalar(0.3 + radius * Math.sqrt(t));
        mat.opacity = opacity * (1 - t) * (1 - t);
      },
      dispose: () => {
        this.group.remove(mesh);
        mat.dispose();
      },
    });
  }

  /** Brief light flash (point light if dynamic lights enabled, else a glow particle). */
  flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity = 6, duration = 0.2, range = 12): void {
    this.burst('glow', pos, { color, size: Math.min(4, 0.6 + intensity * 0.2), life: duration });
    if (!this.dynamicLights) return;
    let light = this.lightPool.pop();
    if (!light) {
      light = new THREE.PointLight(0xffffff, 0, range, 2);
    }
    light.color.set(color);
    light.distance = range;
    light.position.copy(pos);
    this.group.add(light);
    const l = light;
    const peak = intensity * 30;
    this.transients.push({
      obj: l,
      age: 0,
      life: duration,
      update: (t) => {
        l.intensity = peak * (1 - t);
      },
      dispose: () => {
        this.group.remove(l);
        l.intensity = 0;
        if (this.lightPool.length < 6) this.lightPool.push(l);
      },
    });
  }

  /** Track an arbitrary object for timed fade/cleanup (bespoke technique meshes). */
  addTransient(obj: THREE.Object3D, life: number, update: (t: number) => void, dispose: () => void): void {
    this.group.add(obj);
    this.transients.push({ obj, age: 0, life, update, dispose: () => { this.group.remove(obj); dispose(); } });
  }

  update(dt: number): void {
    for (const e of this.emitters) {
      if (!e.active) continue;
      e.ttl -= dt;
      if (e.ttl <= 0) {
        e.active = false;
        continue;
      }
      e.accum += e.rate * this.density * dt;
      const n = Math.floor(e.accum);
      if (n > 0) {
        e.accum -= n;
        this.burst(e.preset, e.position, { ...e.options, count: n / Math.max(0.01, this.density), dir: e.options.dir ?? e.direction });
      }
    }
    this.emitters = this.emitters.filter((e) => e.active);
    for (const t of this.transients) {
      t.age += dt;
      t.update(Math.min(1, t.age / t.life));
    }
    const done = this.transients.filter((t) => t.age >= t.life);
    if (done.length) {
      for (const t of done) t.dispose();
      this.transients = this.transients.filter((t) => t.age < t.life);
    }
    this.add.update(dt);
    this.alpha.update(dt);
  }

  /** Remove everything (session end). */
  clear(): void {
    for (const t of this.transients) t.dispose();
    this.transients = [];
    this.emitters = [];
    this.add.clear();
    this.alpha.clear();
  }

  dispose(): void {
    this.clear();
    this.add.dispose();
    this.alpha.dispose();
    this.ringGeo.dispose();
    this.sphereGeo.dispose();
  }
}
