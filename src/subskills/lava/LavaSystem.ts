import * as THREE from 'three';
import { Enemy } from '../../ai/Enemy';
import type { GameContext, GameSystem } from '../../core/GameContext';
import type { SurfaceType } from '../../core/types';
import { LAVA, REACTIONS } from '../../data/subskills';
import type { Entity } from '../../entities/Entity';

/**
 * Lava: the shared runtime behind lavabending and the world's lava (quest tunnels).
 *
 * A patch is one or more round cells of molten rock conformed to the ground. Patches:
 *  - spread a little (capped: LAVA.maxSpreadCells, downhill first, never onto water/ice/metal/wood),
 *  - burn anything standing in them (environment damage through CombatSystem.applyHit: you and
 *    your allies too),
 *  - melt ice and snow and ignite flammables nearby (bending:heat),
 *  - expire after a few seconds by crusting over into stone, or cool at once (Divert and Cool,
 *    or water: a burst of steam). Cooled stone lingers, is walkable and leaves a loose stone an
 *    earthbender can lift again.
 * At most LAVA.maxPlayerPatches player patches live at once (the oldest cools first). World lava
 * (source 'world') never expires on its own.
 *
 * Rendering: a fixed pool of cell meshes (one draw call each, no allocation after warm-up), a
 * shared animated lava shader (flowing crust plates over a glowing core; calm and non-flashing
 * with Settings > Reduce intense effects), embers and heat haze particles.
 * Enemies step out of lava and panic at a lava moat (Enemy.thinkHooks).
 */

export type LavaKind = 'melt' | 'pool' | 'stream' | 'moat' | 'eruption' | 'world';

export interface LavaCell {
  slot: number;
  x: number;
  z: number;
  y: number;
  r: number;
}

export interface LavaPatch {
  id: number;
  source: 'player' | 'world';
  kind: LavaKind;
  ownerId: number;
  cells: LavaCell[];
  age: number;
  life: number;
  /** Seconds of glowing cracks before it turns molten (Lava Pool's warning). */
  warm: number;
  state: 'warming' | 'molten' | 'stone';
  stoneLeft: number;
  /** 0 molten .. 1 cooled (animated). */
  cool: number;
  spreadT: number;
  spread: number;
  /** An earthbender walled it off: no more spreading. */
  blocked: boolean;
  tickT: number;
  ticks: number;
  /** World flows: direction the surface drifts. */
  flowX: number;
  flowZ: number;
  /** Quest tag (world lava). */
  tag: string | null;
  /** Walkable collider ids once cooled (world lava over channels). */
  colliders: number[];
  /** Surface height of a cooled world patch (bridges over channels). */
  floorY: number | null;
}

export interface SpawnOptions {
  x: number;
  z: number;
  r?: number;
  life?: number;
  source?: 'player' | 'world';
  kind?: LavaKind;
  ownerId?: number;
  warm?: number;
  flowX?: number;
  flowZ?: number;
  tag?: string;
  /** Extra cells (world rivers): absolute positions and radii. */
  cells?: Array<{ x: number; z: number; r: number }>;
  /** Height of the floor this lava lies on (overrides ground sampling). */
  y?: number;
  /** World lava in a channel: cooling raises walkable stone to this height. */
  floorY?: number;
  /** Max spreading cells (default LAVA.maxSpreadCells; world lava 0). */
  spread?: number;
  /** Counts against LAVA.maxPlayerPatches (default: player lava). The Avatar State's eruption does not. */
  capped?: boolean;
}

/** Moving head that leaves lava behind (Lava Stream, the quest's lava wave). */
export interface LavaFlow {
  id: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  left: number;
  every: number;
  acc: number;
  r: number;
  life: number;
  ownerId: number;
  source: 'player' | 'world';
  kind: LavaKind;
  chase: Entity | null;
  turnRate: number;
  patch: LavaPatch | null;
  /** Hit once per entity per flow (sweep). */
  swept: Set<number>;
  damage: number;
  tag: string | null;
}

const RINGS = 4;
const SEGS = 22;
const MAX_SLOTS = 72;
const NOT_EARTH = new Set<SurfaceType>(['snow', 'packedsnow', 'ice', 'wood', 'water', 'metal']);

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const scratch: Entity[] = [];
const tickHit = new Set<number>();

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute float aEdge;
varying vec2 vW;
varying float vEdge;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xz;
  vEdge = aEdge;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform float uCalm;
uniform float uCool;
uniform float uWarm;
uniform float uSeed;
uniform vec2 uFlow;
varying vec2 vW;
varying float vEdge;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
void main() {
  float t = uTime * (1.0 - 0.5 * uCalm);
  vec2 p = vW * 0.62 + uFlow * t * 0.45 + uSeed;
  vec2 warp = vec2(fbm(p * 1.3 + t * 0.06), fbm(p * 1.1 - t * 0.05 + 3.1));
  float n = fbm(p + warp * 1.4);
  // Dark crust plates drifting over the glowing core; bright seams between them.
  float crust = smoothstep(0.5, 0.64, n);
  float seam = 1.0 - smoothstep(0.0, 0.06, abs(n - 0.52));
  vec3 core = mix(vec3(1.0, 0.86, 0.32), vec3(1.0, 0.36, 0.05), smoothstep(0.18, 0.5, n));
  float pulse = 1.0 + (1.0 - uCalm) * 0.1 * sin(uTime * 2.1 + uSeed * 9.0);
  vec3 molten = mix(core * 2.3 * pulse, vec3(0.09, 0.05, 0.04) + vec3(0.9, 0.22, 0.03) * seam * 0.9, crust * 0.9);
  // Cooled: dark basalt with embers in the cracks fading out.
  vec3 stone = mix(vec3(0.17, 0.16, 0.16), vec3(0.3, 0.28, 0.26), vnoise(vW * 2.7)) * (0.85 + 0.3 * n);
  stone += vec3(1.0, 0.32, 0.05) * seam * smoothstep(1.0, 0.55, uCool) * 1.4;
  vec3 col = mix(molten, stone, smoothstep(0.0, 1.0, uCool));
  // Warming (a pool about to open): ground with glowing cracks.
  vec3 warm = vec3(0.16, 0.1, 0.08) + vec3(1.0, 0.35, 0.05) * seam * (0.6 + 0.6 * (1.0 - uCalm) * (0.5 + 0.5 * sin(uTime * 9.0)));
  col = mix(col, warm, uWarm);
  float a = 1.0 - smoothstep(0.78, 1.0, vEdge + (n - 0.5) * 0.35);
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}
`;

interface Slot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  pos: THREE.BufferAttribute;
  used: boolean;
}

export class LavaSystem implements GameSystem {
  private ctx!: GameContext;
  readonly patches: LavaPatch[] = [];
  readonly flows: LavaFlow[] = [];
  private slots: Slot[] = [];
  private readonly group = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly uCalm = { value: 0 };
  private nextId = 1;
  private fxT = 0;
  private panicT = 0;
  private baseGeo: THREE.BufferGeometry | null = null;
  private stoneGeo: THREE.BufferGeometry | null = null;
  /** Hooks for quest scripts: cooled patches (by tag). */
  readonly onCooled: Array<(p: LavaPatch, byWater: boolean) => void> = [];
  /**
   * Divert and Cool: quest scripts that own a moving lava wave or river register here. Called with
   * the aimed point and the caster; return true when a flow there was turned aside.
   */
  readonly diverters: Array<{ near(x: number, z: number): boolean; divert(x: number, z: number, casterX: number, casterZ: number): boolean }> = [];
  /** Game-time jobs (paused with the game; cleared with the session). */
  private readonly jobs: Array<{ t: number; fn: () => void }> = [];
  private readonly moatPanic = new WeakMap<Entity, number>();
  /** Debug counters. */
  readonly stats = { spawned: 0, cooled: 0, steam: 0, ticks: 0, refused: 0 };

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.group.name = 'lava';
    const applyCalm = () => (this.uCalm.value = ctx.settings.data.gameplay.reduceIntenseEffects ? 1 : 0);
    applyCalm();
    ctx.events.on('settings:changed', applyCalm);
    ctx.events.on('technique:cast', (e) => this.onCast(e.id, e.casterId, e.element));
    Enemy.thinkHooks.push((en, dt) => this.enemyThink(en, dt));
    this.installDebug();
  }

  onSessionEnd(): void {
    this.clear();
  }

  /** Remove every patch and flow (zone change, session end). */
  clear(): void {
    for (const p of [...this.patches]) this.removePatch(p);
    this.flows.length = 0;
    this.jobs.length = 0;
  }

  /** Run `fn` after `seconds` of game time. */
  after(seconds: number, fn: () => void): void {
    this.jobs.push({ t: seconds, fn });
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Can earth be melted here? Earth within reach, or (ice/snow/metal floors) a loose stone nearby. */
  meltable(x: number, z: number, nearY = Infinity): { ok: boolean; surface: SurfaceType; y: number; reason?: string; stone?: { x: number; z: number; take(): void } } {
    const ctx = this.ctx;
    const g = ctx.world.groundAt(x, z, nearY + 1.5);
    const water = ctx.world.liquidAt(x, z);
    if (water && water.level > g.y + 0.05) return { ok: false, surface: 'water', y: g.y, reason: 'Water cannot be melted into lava.' };
    if (!NOT_EARTH.has(g.surface)) return { ok: true, surface: g.surface, y: g.y };
    // Ice, snow, wood or metal underfoot: a loose stone or a liftable rock close by will do.
    const loose = this.looseStoneNear(x, z, LAVA.looseStoneReach);
    if (loose) return { ok: true, surface: g.surface, y: g.y, stone: loose };
    const what = g.surface === 'metal' ? 'metal' : g.surface === 'wood' ? 'wood' : g.surface === 'water' ? 'water' : g.surface.includes('snow') ? 'snow' : 'ice';
    return { ok: false, surface: g.surface, y: g.y, reason: `There is no earth here to melt — ${what} will not become lava. Find loose stone or bare ground.` };
  }

  private looseStoneNear(x: number, z: number, r: number): { x: number; z: number; take(): void } | null {
    const ctx = this.ctx;
    const stones = ctx.player?.play?.stones;
    const s = stones?.nearest(x, z, r, (st) => !st.lifted) ?? null;
    if (s && stones) return { x: s.x, z: s.z, take: () => stones.take(s) };
    const rock = ctx.world.rocks?.nearest(x, z, r) ?? null;
    if (rock) return { x: rock.center.x, z: rock.center.z, take: () => void ctx.world.rocks.take(rock) };
    return null;
  }

  /** The molten cell under (x, z), if any (pad widens the test). */
  lavaAt(x: number, z: number, pad = 0, y?: number): LavaCell | null {
    for (const p of this.patches) {
      if (p.state !== 'molten') continue;
      for (const c of p.cells) {
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < c.r * 0.92 + pad && (y === undefined || Math.abs(y - c.y) < 1.2)) return c;
      }
    }
    return null;
  }

  patchOf(cell: LavaCell): LavaPatch | null {
    for (const p of this.patches) if (p.cells.includes(cell)) return p;
    return null;
  }

  moltenCount(source?: 'player' | 'world'): number {
    let n = 0;
    for (const p of this.patches) if (p.state !== 'stone' && (!source || p.source === source)) n++;
    return n;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------

  spawnPatch(o: SpawnOptions): LavaPatch | null {
    const ctx = this.ctx;
    const source = o.source ?? 'player';
    const r = o.r ?? LAVA.melt.radius;
    if (source === 'player' && o.capped !== false) {
      // Cap: the oldest player lava crusts over first.
      const live = this.patches.filter((p) => p.source === 'player' && p.state !== 'stone' && p.kind !== 'eruption');
      while (live.length >= LAVA.maxPlayerPatches) {
        const oldest = live.shift()!;
        this.cool(oldest, false, false);
      }
    }
    const baseY = o.y ?? ctx.world.groundAt(o.x, o.z, Infinity).y;
    const patch: LavaPatch = {
      id: this.nextId++,
      source,
      kind: o.kind ?? 'melt',
      ownerId: o.ownerId ?? 0,
      cells: [],
      age: 0,
      life: o.life ?? (source === 'world' ? Infinity : LAVA.patchLife),
      warm: o.warm ?? 0,
      state: (o.warm ?? 0) > 0 ? 'warming' : 'molten',
      stoneLeft: LAVA.stoneLife,
      cool: 0,
      spreadT: LAVA.spreadEvery,
      spread: o.spread ?? (source === 'world' ? 0 : LAVA.maxSpreadCells),
      blocked: false,
      tickT: 0.15,
      ticks: 0,
      flowX: o.flowX ?? 0,
      flowZ: o.flowZ ?? 0,
      tag: o.tag ?? null,
      colliders: [],
      floorY: o.floorY ?? null,
    };
    const cells = o.cells ?? [{ x: o.x, z: o.z, r }];
    for (const c of cells) this.addCell(patch, c.x, c.z, c.r, o.y);
    if (!patch.cells.length) {
      this.stats.refused++;
      return null;
    }
    this.patches.push(patch);
    this.stats.spawned++;
    if (!this.group.parent) ctx.scene.add(this.group);
    ctx.events.emit('lava:formed', { x: o.x, z: o.z, radius: r, source });
    // Lava melts ice and snow and ignites what burns.
    ctx.events.emit('bending:heat', { position: { x: o.x, y: baseY + 0.3, z: o.z }, radius: r + 2, intensity: 1, casterId: patch.ownerId });
    if (source === 'player') this.reactNPCs(o.x, o.z);
    return patch;
  }

  /** Add a cell to a patch (conformed to the ground); false when no mesh slot is free. */
  private addCell(p: LavaPatch, x: number, z: number, r: number, y?: number): boolean {
    const slot = this.takeSlot();
    if (slot < 0) return false;
    const s = this.slots[slot];
    const ctx = this.ctx;
    const cy = y ?? ctx.world.groundAt(x, z, Infinity).y;
    // Conform the disc: centre + rings, each vertex sampled from the ground near the centre height.
    const pos = s.pos;
    let k = 0;
    const sample = (vx: number, vz: number) => (y !== undefined ? y : ctx.world.groundAt(vx, vz, cy + 1.2).y) + 0.11;
    pos.setXYZ(k++, x, sample(x, z), z);
    for (let ri = 1; ri <= RINGS; ri++) {
      const rr = (r * ri) / RINGS;
      for (let si = 0; si < SEGS; si++) {
        const a = (si / SEGS) * Math.PI * 2;
        const vx = x + Math.cos(a) * rr, vz = z + Math.sin(a) * rr;
        pos.setXYZ(k++, vx, sample(vx, vz), vz);
      }
    }
    pos.needsUpdate = true;
    s.mesh.geometry.computeBoundingSphere();
    s.mat.uniforms.uCool.value = 0;
    s.mat.uniforms.uWarm.value = p.state === 'warming' ? 1 : 0;
    s.mat.uniforms.uSeed.value = Math.random() * 50;
    s.mat.uniforms.uFlow.value.set(p.flowX, p.flowZ);
    s.mesh.visible = true;
    p.cells.push({ slot, x, z, y: cy, r });
    return true;
  }

  private takeSlot(): number {
    for (let i = 0; i < this.slots.length; i++) if (!this.slots[i].used) return this.claim(i);
    if (this.slots.length >= MAX_SLOTS) return -1;
    this.slots.push(this.makeSlot());
    return this.claim(this.slots.length - 1);
  }

  private claim(i: number): number {
    this.slots[i].used = true;
    return i;
  }

  private makeSlot(): Slot {
    if (!this.baseGeo) {
      // Index buffer + edge attribute are shared; each slot owns its positions.
      const n = 1 + RINGS * SEGS;
      const edge = new Float32Array(n);
      for (let ri = 1, k = 1; ri <= RINGS; ri++) for (let si = 0; si < SEGS; si++, k++) edge[k] = ri / RINGS;
      const idx: number[] = [];
      for (let si = 0; si < SEGS; si++) idx.push(0, 1 + ((si + 1) % SEGS), 1 + si);
      for (let ri = 1; ri < RINGS; ri++) {
        const a0 = 1 + (ri - 1) * SEGS, b0 = 1 + ri * SEGS;
        for (let si = 0; si < SEGS; si++) {
          const s1 = (si + 1) % SEGS;
          idx.push(a0 + si, a0 + s1, b0 + si, a0 + s1, b0 + s1, b0 + si);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setIndex(idx);
      g.setAttribute('aEdge', new THREE.BufferAttribute(edge, 1));
      this.baseGeo = g;
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(this.baseGeo.getIndex());
    geo.setAttribute('aEdge', this.baseGeo.getAttribute('aEdge'));
    const pos = new THREE.BufferAttribute(new Float32Array((1 + RINGS * SEGS) * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCool: { value: 0 }, uWarm: { value: 0 }, uSeed: { value: 0 }, uFlow: { value: new THREE.Vector2() } }]),
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    // Shared animated uniforms (same objects in every slot).
    mat.uniforms.uTime = this.uTime;
    mat.uniforms.uCalm = this.uCalm;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'lava_cell';
    mesh.frustumCulled = true;
    mesh.renderOrder = 2;
    mesh.visible = false;
    this.group.add(mesh);
    return { mesh, mat, pos, used: false };
  }

  private releaseCell(c: LavaCell): void {
    const s = this.slots[c.slot];
    if (!s) return;
    s.used = false;
    s.mesh.visible = false;
  }

  private removePatch(p: LavaPatch): void {
    for (const c of p.cells) this.releaseCell(c);
    for (const id of p.colliders) this.ctx.world.collision.remove(id);
    p.colliders.length = 0;
    const i = this.patches.indexOf(p);
    if (i >= 0) this.patches.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Cooling
  // ---------------------------------------------------------------------------

  /** Cool every molten cell within `radius` of (x, z). Returns the patches cooled. */
  coolAt(x: number, z: number, radius: number, byWater = false): LavaPatch[] {
    const out: LavaPatch[] = [];
    for (const p of [...this.patches]) {
      if (p.state === 'stone') continue;
      if (p.cells.some((c) => Math.hypot(c.x - x, c.z - z) < radius + c.r)) {
        this.cool(p, byWater, true);
        out.push(p);
      }
    }
    return out;
  }

  /** Turn a patch into stone (with a hiss; a burst of steam when water did it). */
  cool(p: LavaPatch, byWater: boolean, loud: boolean): void {
    if (p.state === 'stone') return;
    const ctx = this.ctx;
    p.state = 'stone';
    p.stoneLeft = p.source === 'world' ? Infinity : LAVA.stoneLife;
    this.stats.cooled++;
    const c0 = p.cells[0];
    for (const c of p.cells) this.slots[c.slot].mat.uniforms.uWarm.value = 0;
    if (loud && c0) {
      tmpV.set(c0.x, c0.y + 0.3, c0.z);
      ctx.audio.play('sub.lava.cool', { position: tmpV, volume: byWater ? 0.9 : 0.7 });
      for (const c of p.cells) {
        tmpV.set(c.x, c.y + 0.2, c.z);
        ctx.vfx.burst('steam', tmpV, { count: byWater ? 14 : 7, radius: c.r * 0.7, speed: byWater ? 2.6 : 1.4, size: byWater ? 1.6 : 1.1 });
      }
      if (byWater) this.stats.steam++;
    }
    // World lava over a channel: cooled rock becomes a walkable floor (a bridge).
    if (p.floorY !== null) {
      for (const c of p.cells) {
        const id = ctx.world.collision.add({ shape: 'cylinder', x: c.x, y: p.floorY - 0.5, z: c.z, r: c.r * 0.95, hy: 0.5, walkable: true, solid: false, surface: 'rock', tag: 'lava_stone' });
        p.colliders.push(id);
      }
    }
    // A loose stone to lift again (player lava).
    if (p.source === 'player' && c0) this.leaveStone(c0.x, c0.z, c0.y);
    ctx.events.emit('lava:cooled', { x: c0?.x ?? 0, z: c0?.z ?? 0, radius: c0?.r ?? 0, byWater });
    for (const fn of this.onCooled) fn(p, byWater);
  }

  private leaveStone(x: number, z: number, y: number): void {
    const stones = this.ctx.player?.play?.stones;
    if (!stones) return;
    if (!this.stoneGeo) this.stoneGeo = new THREE.DodecahedronGeometry(0.42, 0);
    const m = new THREE.Matrix4().compose(tmpV.set(x + 0.6, y + 0.22, z + 0.3), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, Math.random() * 6, 0.2)), tmpV2.set(1, 0.7, 1));
    try {
      stones.add(this.stoneGeo, m, 0.42, 0.3, [0.32, 0.29, 0.27]);
    } catch {
      /* stones unavailable (tutorial) */
    }
  }

  /** Remove world lava/stone by quest tag (scripts rebuild their lava on session start). */
  removeTag(tag: string): void {
    for (const p of [...this.patches]) if (p.tag === tag) this.removePatch(p);
    for (let i = this.flows.length - 1; i >= 0; i--) if (this.flows[i].tag === tag) this.flows.splice(i, 1);
  }

  // ---------------------------------------------------------------------------
  // Flows (Lava Stream, lava waves)
  // ---------------------------------------------------------------------------

  startFlow(o: { x: number; z: number; dirX: number; dirZ: number; speed: number; length: number; r: number; life: number; ownerId: number; source?: 'player' | 'world'; kind?: LavaKind; chase?: Entity | null; damage?: number; tag?: string; every?: number }): LavaFlow {
    const l = Math.hypot(o.dirX, o.dirZ) || 1;
    const f: LavaFlow = {
      id: this.nextId++,
      x: o.x,
      z: o.z,
      dirX: o.dirX / l,
      dirZ: o.dirZ / l,
      speed: o.speed,
      left: o.length,
      every: o.every ?? o.r * 1.15,
      acc: o.r * 1.15,
      r: o.r,
      life: o.life,
      ownerId: o.ownerId,
      source: o.source ?? 'player',
      kind: o.kind ?? 'stream',
      chase: o.chase ?? null,
      turnRate: 1.6,
      patch: null,
      swept: new Set(),
      damage: o.damage ?? 0,
      tag: o.tag ?? null,
    };
    this.flows.push(f);
    return f;
  }

  private updateFlows(dt: number): void {
    const ctx = this.ctx;
    for (let i = this.flows.length - 1; i >= 0; i--) {
      const f = this.flows[i];
      if (f.chase && f.chase.alive) {
        const want = Math.atan2(f.chase.position.x - f.x, f.chase.position.z - f.z);
        const cur = Math.atan2(f.dirX, f.dirZ);
        let d = want - cur;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        const a = cur + Math.max(-f.turnRate * dt, Math.min(f.turnRate * dt, d));
        f.dirX = Math.sin(a);
        f.dirZ = Math.cos(a);
      }
      const step = f.speed * dt;
      f.x += f.dirX * step;
      f.z += f.dirZ * step;
      f.left -= step;
      f.acc += step;
      // Water ahead: the flow hisses into stone and stops.
      const w = ctx.world.liquidAt(f.x, f.z);
      const g = ctx.world.groundAt(f.x, f.z, Infinity);
      if (w && w.level > g.y + 0.05) {
        tmpV.set(f.x, w.level + 0.2, f.z);
        ctx.vfx.burst('steam', tmpV, { count: 12, radius: f.r, speed: 2.4, size: 1.5 });
        ctx.audio.play('sub.lava.cool', { position: tmpV, volume: 0.6 });
        f.left = 0;
      }
      if (f.acc >= f.every && f.left > 0) {
        f.acc = 0;
        if (!this.meltable(f.x, f.z, g.y).ok && f.source === 'player') f.left = 0;
        else if (!f.patch || f.patch.state === 'stone' || !this.patches.includes(f.patch)) {
          f.patch = this.spawnPatch({ x: f.x, z: f.z, r: f.r, life: f.life, source: f.source, kind: f.kind, ownerId: f.ownerId, spread: 0, tag: f.tag ?? undefined, flowX: f.dirX, flowZ: f.dirZ });
        } else if (!this.addCell(f.patch, f.x, f.z, f.r)) f.left = 0;
        else f.patch.age = Math.max(0, f.patch.age - 0.25);
      }
      // Sweep: the head shoves and burns what it touches (once per flow).
      if (f.damage > 0) {
        tmpV.set(f.x, g.y, f.z);
        for (const e of ctx.entities.queryRadius(tmpV, f.r + 0.6, undefined, scratch)) {
          if (f.swept.has(e.id) || !e.health || Math.abs(e.position.y - g.y) > 1.6) continue;
          const owner = ctx.entities.get(f.ownerId) ?? null;
          if (owner && !ctx.combat.canHarm(owner, e)) continue;
          f.swept.add(e.id);
          const side = tmpV2.set(-f.dirZ, 0, f.dirX);
          if (side.dot(tmpV.set(e.position.x - f.x, 0, e.position.z - f.z)) < 0) side.negate();
          ctx.combat.applyHit(owner, e, { attacker: owner, damage: f.damage, element: 'earth', techniqueId: 'lava_stream', knockback: side.multiplyScalar(5).add(tmpV.set(f.dirX * 2, 0, f.dirZ * 2)), stagger: 20, status: [{ type: 'burn', duration: 2, magnitude: 1 }], hitId: f.id * 1000 + e.id });
        }
      }
      if (f.left <= 0) this.flows.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    this.uTime.value += dt;
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      const j = this.jobs[i];
      j.t -= dt;
      if (j.t > 0) continue;
      this.jobs.splice(i, 1);
      try {
        j.fn();
      } catch (err) {
        console.error('[Lava] job error', err);
      }
    }
    if (!this.patches.length && !this.flows.length) return;
    this.updateFlows(dt);
    this.fxT -= dt;
    const fx = this.fxT <= 0;
    if (fx) this.fxT = 0.12;
    const density = ctx.settings.data.graphics.particleDensity;
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const p = this.patches[i];
      p.age += dt;
      if (p.state === 'warming') {
        p.warm -= dt;
        if (p.warm <= 0) {
          p.state = 'molten';
          for (const c of p.cells) this.slots[c.slot].mat.uniforms.uWarm.value = 0;
          const c0 = p.cells[0];
          tmpV.set(c0.x, c0.y + 0.2, c0.z);
          ctx.audio.play('sub.lava.melt', { position: tmpV, volume: 0.8 });
          ctx.vfx.burst('embers', tmpV, { count: 10, radius: c0.r * 0.6, speed: 3 });
        } else {
          const k = Math.min(1, p.warm / 0.6);
          for (const c of p.cells) this.slots[c.slot].mat.uniforms.uWarm.value = k;
        }
        continue;
      }
      if (p.state === 'molten') {
        if (p.age >= p.life) {
          this.cool(p, false, true);
          continue;
        }
        // Crust thickens over the last second and a half.
        const left = p.life - p.age;
        const crust = Number.isFinite(left) ? Math.max(0, 1 - left / 1.5) * 0.35 : 0;
        for (const c of p.cells) this.slots[c.slot].mat.uniforms.uCool.value = crust;
        this.spreadStep(p, dt);
        this.burnStep(p, dt);
        if (fx && density > 0) this.patchFX(p, density);
      } else {
        // Stone: cool the last embers, then fade away.
        p.cool = Math.min(1, p.cool + dt * 1.2);
        for (const c of p.cells) this.slots[c.slot].mat.uniforms.uCool.value = p.cool;
        p.stoneLeft -= dt;
        if (p.stoneLeft <= 0) this.removePatch(p);
      }
    }
  }

  private spreadStep(p: LavaPatch, dt: number): void {
    if (p.blocked || p.spread <= 0) return;
    p.spreadT -= dt;
    if (p.spreadT > 0) return;
    p.spreadT = LAVA.spreadEvery;
    const ctx = this.ctx;
    const src = p.cells[Math.floor(Math.random() * p.cells.length)];
    const r = Math.max(0.7, src.r * 0.7);
    let best: { x: number; z: number; score: number } | null = null;
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = src.r * 0.85;
      const x = src.x + Math.sin(a) * d, z = src.z + Math.cos(a) * d;
      if (p.cells.some((c) => Math.hypot(c.x - x, c.z - z) < c.r * 0.55)) continue;
      const w = ctx.world.liquidAt(x, z);
      const g = ctx.world.groundAt(x, z, src.y + 1.2);
      if (w && w.level > g.y + 0.05) {
        // Lava meets water: steam, a crust at the edge, no spreading that way.
        tmpV.set(x, w.level + 0.2, z);
        ctx.vfx.burst('steam', tmpV, { count: 8, radius: 0.8, speed: 2.2, size: 1.3 });
        ctx.audio.play('sub.lava.cool', { position: tmpV, volume: 0.45, pitch: 1.2 });
        continue;
      }
      if (NOT_EARTH.has(g.surface) && g.surface !== 'ice' && g.surface !== 'snow' && g.surface !== 'packedsnow') continue;
      if (Math.abs(g.y - src.y) > 1.2) continue;
      const score = src.y - g.y + Math.random() * 0.3;
      if (!best || score > best.score) best = { x, z, score };
      if (g.surface === 'ice' || g.surface === 'snow' || g.surface === 'packedsnow') {
        // It melts ice and snow as it creeps.
        ctx.events.emit('bending:heat', { position: { x, y: g.y + 0.3, z }, radius: 2.5, intensity: 1, casterId: p.ownerId });
      }
    }
    if (best && this.addCell(p, best.x, best.z, r)) p.spread--;
  }

  private burnStep(p: LavaPatch, dt: number): void {
    p.tickT -= dt;
    if (p.tickT > 0) return;
    p.tickT = LAVA.tickEvery;
    p.ticks++;
    const ctx = this.ctx;
    const hit = tickHit;
    hit.clear();
    for (const c of p.cells) {
      tmpV.set(c.x, c.y, c.z);
      for (const e of ctx.entities.queryRadius(tmpV, c.r + 0.4, undefined, scratch)) {
        if (hit.has(e.id) || !e.health || !e.alive) continue;
        const d = Math.hypot(e.position.x - c.x, e.position.z - c.z);
        if (d > c.r * 0.9 + e.radius * 0.5) continue;
        // Feet in the lava (not flying over it, not on a bridge above it).
        if (e.position.y - c.y > 0.7 || c.y - e.position.y > 1.0) continue;
        if (e.body && !e.body.grounded && e.position.y - c.y > 0.25) continue;
        hit.add(e.id);
        this.stats.ticks++;
        // Like burning, standing in lava never finishes anyone off (no deaths from these arts).
        const dmg = Math.min(LAVA.tickDamage, e.health.hp - 1);
        if (dmg <= 0) continue;
        ctx.combat.applyHit(null, e, { attacker: null, damage: dmg, element: 'earth', techniqueId: 'lava_melt', status: [{ type: 'burn', duration: 1.2, magnitude: 1 }], stagger: 6, point: tmpV2.set(e.position.x, c.y + 0.3, e.position.z) });
      }
    }
  }

  private patchFX(p: LavaPatch, density: number): void {
    const ctx = this.ctx;
    const calm = this.uCalm.value > 0;
    const c = p.cells[Math.floor(Math.random() * p.cells.length)];
    tmpV.set(c.x + (Math.random() - 0.5) * c.r, c.y + 0.15, c.z + (Math.random() - 0.5) * c.r);
    if (Math.random() < 0.5 * density) ctx.vfx.burst('embers', tmpV, { count: 1, speed: calm ? 0.8 : 1.6, size: 0.6, life: 1.2 });
    // Heat haze: faint rising wisps.
    if (Math.random() < 0.2 * density) ctx.vfx.burst('smoke', tmpV, { count: 1, speed: 0.7, size: 0.8, color: '#a39488', life: 1.3 });
  }

  // ---------------------------------------------------------------------------
  // Water douses lava; earthbending walls it off
  // ---------------------------------------------------------------------------

  private onCast(id: string, casterId: number, element: string): void {
    if (!this.patches.length) return;
    if (id.startsWith('lava_')) return;
    const ctx = this.ctx;
    const caster = ctx.entities.get(casterId);
    if (!caster) return;
    const cast = ctx.combat.activeCast(caster as never);
    const aim = cast ? cast.aimPoint : caster.position;
    if (element === 'water') {
      // Water thrown at lava cools it into stone, with steam (after the water lands).
      const x = aim.x, z = aim.z;
      this.after(0.35, () => {
        if (!this.ctx.session.active) return;
        const near = this.lavaAt(x, z, 2.5) ?? this.lavaAt(caster.position.x + (x - caster.position.x) * 0.5, caster.position.z + (z - caster.position.z) * 0.5, 2.5);
        if (!near) return;
        const p = this.patchOf(near);
        if (p) this.cool(p, true, true);
      });
    } else if (element === 'earth') {
      // An earthbender raising earth beside lava walls it off.
      for (const p of this.patches) if (p.state === 'molten' && p.cells.some((c) => Math.hypot(c.x - aim.x, c.z - aim.z) < c.r + 4)) p.blocked = true;
    }
  }

  // ---------------------------------------------------------------------------
  // Reactions
  // ---------------------------------------------------------------------------

  private enemyThink(e: Enemy, dt: number): void {
    if (!this.patches.length) return;
    const pos = e.position;
    // Panic at a lava moat: fall back and stop attacking for a moment.
    const until = this.moatPanic.get(e) ?? 0;
    const now = this.ctx.time.elapsed;
    if (until > now) {
      const m = this.nearestMolten(pos.x, pos.z, 12, 'moat');
      if (m) {
        e.moveMode = 'flee';
        e.moveGoal.set(m.x, pos.y, m.z);
        e.moveSpeed = Math.max(e.moveSpeed, 4.5);
        e.attackToken = false;
      }
      return;
    }
    const near = this.nearestMolten(pos.x, pos.z, LAVA.enemyAvoid + 5);
    if (!near) return;
    const d = Math.hypot(near.cell.x - pos.x, near.cell.z - pos.z) - near.cell.r;
    if (near.patch.kind === 'moat' && d < 3.5 && Math.abs(pos.y - near.cell.y) < 1.5) {
      this.moatPanic.set(e, now + 2.2 + Math.random());
      const rx = REACTIONS.find((r) => r.trigger === 'lavaMoat' && r.who === 'enemy');
      if (rx?.lines?.length && (this.panicT -= dt) <= 0) {
        this.panicT = 6;
        this.ctx.events.emit('ui:notify', { text: `“${rx.lines[Math.floor(Math.random() * rx.lines.length)]}”`, kind: 'info', duration: 2 });
      }
      return;
    }
    if (d > LAVA.enemyAvoid) {
      // Do not walk into it: if the goal lies across the lava, hold short.
      const g = e.moveGoal;
      if (e.moveMode === 'seek' && Math.hypot(g.x - near.cell.x, g.z - near.cell.z) < near.cell.r + 0.5) e.moveMode = 'stop';
      return;
    }
    // Standing in it or right at the edge: step out.
    e.moveMode = 'flee';
    e.moveGoal.set(near.cell.x, pos.y, near.cell.z);
    e.moveSpeed = Math.max(e.moveSpeed, 4);
  }

  private nearestMolten(x: number, z: number, within: number, kind?: LavaKind): { cell: LavaCell; patch: LavaPatch; x: number; z: number } | null {
    let best: { cell: LavaCell; patch: LavaPatch; x: number; z: number } | null = null;
    let bd = within;
    for (const p of this.patches) {
      if (p.state !== 'molten' || (kind && p.kind !== kind)) continue;
      for (const c of p.cells) {
        const d = Math.hypot(c.x - x, c.z - z) - c.r;
        if (d < bd) {
          bd = d;
          best = { cell: c, patch: p, x: c.x, z: c.z };
        }
      }
    }
    return best;
  }

  /** Civilians nearby flee from fresh lava. */
  private reactNPCs(x: number, z: number): void {
    const rx = REACTIONS.find((r) => r.trigger === 'lava' && r.who === 'npc');
    if (!rx) return;
    let any = false;
    for (const n of this.ctx.npcs.liveNPCs()) if (Math.hypot(n.position.x - x, n.position.z - z) < rx.radius) any = true;
    if (!any) return;
    this.ctx.npcs.alarm(x, z, rx.radius);
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = (): boolean => {
      if (!w.__game) return false;
      w.__game.debug.lava = {
        sys: this,
        /** Spawn a lava patch at (x, z) (default: in front of the player). */
        spawn: (x?: number, z?: number, r = LAVA.melt.radius, life?: number, source: 'player' | 'world' = 'player') => {
          const p = this.ctx.player;
          const px = x ?? (p ? p.position.x + Math.sin(p.yaw) * 5 : 0);
          const pz = z ?? (p ? p.position.z + Math.cos(p.yaw) * 5 : 0);
          const patch = this.spawnPatch({ x: px, z: pz, r, life, source, ownerId: p?.id ?? 0 });
          return patch ? { id: patch.id, cells: patch.cells.length, x: px, z: pz } : null;
        },
        meltable: (x: number, z: number) => {
          const m = this.meltable(x, z);
          return { ok: m.ok, surface: m.surface, reason: m.reason ?? null, stone: !!m.stone };
        },
        cool: (x: number, z: number, r = 4, byWater = false) => this.coolAt(x, z, r, byWater).length,
        lavaAt: (x: number, z: number) => !!this.lavaAt(x, z),
        state: () => ({
          patches: this.patches.map((p) => ({ id: p.id, kind: p.kind, source: p.source, state: p.state, cells: p.cells.length, age: +p.age.toFixed(2), life: Number.isFinite(p.life) ? p.life : -1, x: +p.cells[0].x.toFixed(1), z: +p.cells[0].z.toFixed(1), tag: p.tag, blocked: p.blocked })),
          flows: this.flows.length,
          slots: this.slots.length,
          slotsUsed: this.slots.filter((s) => s.used).length,
          stats: { ...this.stats },
        }),
        clear: () => this.clear(),
      };
      return true;
    };
    if (!install()) {
      const t = setInterval(() => {
        if (install()) clearInterval(t);
      }, 200);
    }
  }
}
