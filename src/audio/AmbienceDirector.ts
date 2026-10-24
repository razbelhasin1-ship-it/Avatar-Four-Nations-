import type { GameContext, GameSystem } from '../core/GameContext';
import type { Vec3Like } from '../core/types';
import { biomeAt, biomeWeights, forestFactor, getLakeRuntime, getRiverRuntime, heightAt, waterAt, type BiomeWeights } from '../world/Heightfield';
import { LANDMARKS, REGIONS, SEA_LEVEL } from '../world/WorldLayout';
import type { ReverbParams } from './dsp';
import type { LoopHandle } from './AudioEngine';

/**
 * Ambience director: context-aware layered ambience.
 *
 * Every ~0.25 s it samples the listener's surroundings (region, biome weights,
 * altitude, distance to the sea / rivers / waterfalls / lake shores, nearby
 * settlements, markets, harbours, temples, caves, time of day and the weather
 * system) into an `AmbienceContext`, turns that into target levels for ~25
 * looping beds (`ambienceTargets`, pure + unit-tested) and crossfades them.
 * A voice budget keeps only the strongest beds alive (fewer on the low preset);
 * silent beds are stopped. Positional one-shots (birds, gulls, hawks, owls,
 * frogs, temple bells/chimes, vendors, creaking wood, lava pops, drips,
 * thunder) are scattered around the listener at context-dependent rates
 * (`spotRates`). The environment reverb follows the space (cave, city, temple,
 * forest, mountains, open land).
 *
 * Runs on an engine ticker so it also plays behind the main menu (the menu
 * backdrop orbits the Air Temple) and keeps running while paused (muffled).
 * Debug: window.__game.debug.audio.ambience.
 */

export interface AmbienceContext {
  x: number;
  y: number;
  z: number;
  /** Terrain height under the listener. */
  ground: number;
  region: string | null;
  theme: string | null;
  biome: string;
  bw: BiomeWeights;
  /** Tree cover 0..1. */
  forest: number;
  hour: number;
  /** 0 = full day .. 1 = deep night. */
  night: number;
  /** Metres to open ocean (999 = none within range). */
  seaDist: number;
  seaFrozen: boolean;
  /** Metres to the nearest river edge, its width and frozen state. */
  riverDist: number;
  riverWidth: number;
  riverFrozen: boolean;
  /** Metres to the nearest waterfall lip and its drop (m). */
  fallDist: number;
  fallDrop: number;
  /** Metres to the shore of the nearest unfrozen lake / pond. */
  lakeDist: number;
  /** 0..1 presence of each kind of place. */
  settlement: number;
  market: number;
  harbor: number;
  temple: number;
  spirit: number;
  cave: number;
  weather: string;
  rain: number;
  snow: number;
  blizzard: number;
  sand: number;
  ash: number;
  /** Weather wind 0..~1.3. */
  wind: number;
  menu: boolean;
}

export interface SpotDef {
  id: string;
  /** Expected plays per second. */
  rate: number;
  /** Horizontal distance range (m) from the listener. */
  dist: readonly [number, number];
  /** Height above the ground (m). */
  up: readonly [number, number];
  vol: number;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);
/** Smoothstep from a to b (a > b gives a falling edge). */
const sm = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Day/night factor from the in-game hour: 0 by day, 1 at night, smooth at dawn/dusk. */
export function nightFactor(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const day = h < 12 ? sm(4.8, 7.2, h) : 1 - sm(18.8, 21.2, h);
  return clamp01(1 - day);
}

/** Bed loops the director may run (ids registered in recipes/ambience.ts and recipes/elements.ts). */
export const AMBIENCE_LAYERS = [
  'amb.wind',
  'amb.wind.high',
  'amb.surf',
  'loop.water.river',
  'loop.water.stream',
  'loop.water.waterfall',
  'loop.water.lake',
  'amb.city',
  'amb.market',
  'amb.harbor',
  'amb.forest',
  'amb.insects',
  'amb.night',
  'amb.swamp',
  'amb.desert',
  'amb.volcanic',
  'amb.polar',
  'amb.temple',
  'amb.spirit',
  'amb.cave',
  'amb.rain',
  'amb.snowfall',
  'amb.blizzard',
  'amb.sandstorm',
  'amb.ashfall',
] as const;

/**
 * Per-layer loudness trim, calibrated from offline renders (loop RMS at
 * intensity 1, debug.audio.verifyAll → loopStats): gain = target RMS / measured
 * RMS, with beds ≈ 0.045, place cues (surf, rivers, towns) ≈ 0.065, weather ≈ 0.05-0.08.
 */
export const LAYER_GAIN: Readonly<Record<string, number>> = {
  'amb.wind': 0.64,
  'amb.wind.high': 1.0,
  'amb.surf': 0.53,
  'loop.water.river': 0.47,
  'loop.water.stream': 1.04,
  'loop.water.waterfall': 0.33,
  'loop.water.lake': 1.43,
  'amb.city': 1.06,
  'amb.market': 0.86,
  'amb.harbor': 1.9,
  'amb.forest': 2.2,
  'amb.insects': 3.5,
  'amb.night': 2.35,
  'amb.swamp': 1.29,
  'amb.desert': 0.83,
  'amb.volcanic': 0.5,
  'amb.polar': 1.32,
  'amb.temple': 2.67,
  'amb.spirit': 2.5,
  'amb.cave': 1.2,
  'amb.rain': 1.1,
  'amb.snowfall': 0.7,
  'amb.blizzard': 0.76,
  'amb.sandstorm': 0.76,
  'amb.ashfall': 0.85,
};

/** Target level (0..1) of every bed for a context. Pure; unit-tested. */
export function ambienceTargets(c: AmbienceContext): Record<string, number> {
  const day = 1 - c.night;
  const high = sm(140, 300, c.y);
  const exposed = 0.5 * sm(15, 130, c.y - SEA_LEVEL) + 0.5 * high;
  const town = clamp01(c.settlement);
  const precipQuiet = 1 - Math.min(1, c.rain * 0.6 + c.blizzard * 0.8 + c.sand * 0.8);
  const wild = 1 - Math.min(1, town * 1.2);
  const cold = c.bw.cold;
  const temperate = (1 - cold) * (1 - c.bw.desert * 0.85) * (1 - c.bw.volcanic * 0.8);
  const t: Record<string, number> = {};
  t['amb.wind'] = clamp01((0.22 + 0.32 * Math.min(1.2, c.wind) + 0.25 * exposed + 0.15 * cold) * (1 - 0.55 * town) * (1 - 0.65 * high) * (1 - 0.6 * c.cave));
  t['amb.wind.high'] = clamp01(high * (0.75 + 0.25 * Math.min(1, c.wind)) * (1 - c.cave));
  const coast = 1 - sm(20, 170, c.seaDist);
  t['amb.surf'] = clamp01(coast * (c.seaFrozen ? 0.3 : 1) * (1 - 0.85 * high) * (1 - 0.7 * c.cave));
  const rw = Math.max(2, c.riverWidth);
  const river = c.riverFrozen ? 0 : 1 - sm(rw * 0.5 + 4, rw * 0.5 + 75, c.riverDist);
  t['loop.water.river'] = rw >= 12 ? clamp01(river) : 0;
  t['loop.water.stream'] = rw < 12 ? clamp01(river * 0.9) : 0;
  t['loop.water.waterfall'] = clamp01((1 - sm(10, 150, c.fallDist)) * Math.min(1, c.fallDrop / 8));
  t['loop.water.lake'] = clamp01((1 - sm(3, 45, c.lakeDist)) * 0.8);
  t['amb.city'] = clamp01(town * (0.5 + 0.5 * day) * (1 - 0.4 * c.rain));
  t['amb.market'] = clamp01(c.market * day * precipQuiet);
  t['amb.harbor'] = clamp01(c.harbor);
  t['amb.forest'] = clamp01(c.forest * day * temperate * wild * precipQuiet * (1 - high));
  const warm = 1 - sm(0.2, 0.7, cold);
  t['amb.insects'] = clamp01(day * warm * wild * (0.18 + 0.5 * c.bw.tropical + 0.45 * c.bw.swamp + 0.3 * c.bw.dry + 0.2 * (1 - c.forest)) * (1 - 0.8 * c.bw.desert) * precipQuiet * (1 - high));
  t['amb.night'] = clamp01(c.night * temperate * (1 - 0.6 * town) * precipQuiet * (1 - high) * 0.85);
  t['amb.swamp'] = clamp01(sm(0.15, 0.6, c.bw.swamp));
  t['amb.desert'] = clamp01(sm(0.2, 0.7, c.bw.desert) * (1 - c.sand));
  t['amb.volcanic'] = clamp01(sm(0.2, 0.7, c.bw.volcanic) * (1 - 0.5 * town));
  t['amb.polar'] = clamp01(sm(0.25, 0.8, cold) * (1 - c.blizzard) * (1 - 0.4 * town));
  t['amb.temple'] = clamp01(c.temple);
  t['amb.spirit'] = clamp01(c.spirit);
  t['amb.cave'] = clamp01(c.cave);
  t['amb.rain'] = clamp01(c.rain * (1 - c.cave));
  t['amb.snowfall'] = clamp01(c.snow * (1 - c.blizzard) * 0.8 * (1 - c.cave));
  t['amb.blizzard'] = clamp01(c.blizzard * (1 - 0.7 * c.cave));
  t['amb.sandstorm'] = clamp01(c.sand * (1 - c.cave));
  t['amb.ashfall'] = clamp01(c.ash * (1 - c.cave));
  if (c.menu) for (const k of Object.keys(t)) t[k] *= 0.7;
  return t;
}

/** Positional one-shots scattered around the listener (rates per second). Pure. */
export function spotRates(c: AmbienceContext): SpotDef[] {
  const day = 1 - c.night;
  const quiet = 1 - Math.min(1, c.rain * 0.7 + c.blizzard + c.sand);
  const temperate = (1 - c.bw.cold) * (1 - c.bw.desert * 0.85) * (1 - c.bw.volcanic * 0.8);
  const wild = 1 - Math.min(1, c.settlement * 1.2);
  const forestDay = c.forest * day * temperate * quiet * (0.35 + 0.65 * wild);
  const coast = 1 - sm(20, 150, c.seaDist);
  const mountains = Math.max(sm(60, 220, c.y), c.biome === 'alpine' ? 1 : 0);
  const lakeNear = 1 - sm(5, 40, c.lakeDist);
  const swamp = sm(0.15, 0.6, c.bw.swamp);
  const storm = c.weather === 'rain' || c.weather === 'blizzard' ? Math.max(0, c.rain - 0.45) * 2 : 0;
  return [
    { id: 'amb.bird.chirp', rate: 0.22 * forestDay, dist: [6, 26], up: [3, 12], vol: 1.6 },
    { id: 'amb.bird.song', rate: 0.1 * forestDay, dist: [8, 30], up: [4, 14], vol: 1.6 },
    { id: 'amb.bird.warble', rate: 0.06 * forestDay, dist: [8, 30], up: [4, 14], vol: 1.5 },
    { id: 'amb.hawk', rate: 0.03 * day * mountains * quiet, dist: [40, 90], up: [25, 60], vol: 2.2 },
    { id: 'amb.gull', rate: (0.07 * coast * (1 - c.bw.cold * 0.6) + 0.06 * c.harbor) * day * quiet, dist: [12, 45], up: [8, 22], vol: 1.6 },
    { id: 'amb.owl', rate: 0.035 * c.forest * c.night * temperate * quiet, dist: [15, 40], up: [5, 14], vol: 1.6 },
    { id: 'amb.frog', rate: (0.16 * swamp * (0.45 + 0.55 * c.night) + 0.08 * lakeNear * c.night * temperate) * quiet, dist: [5, 22], up: [0, 0.3], vol: 1.4 },
    { id: 'amb.cricket', rate: 0.12 * c.night * temperate * quiet * (1 - 0.6 * c.settlement), dist: [3, 14], up: [0, 0.4], vol: 1.2 },
    { id: 'amb.bell', rate: 0.022 * c.temple, dist: [20, 50], up: [6, 16], vol: 1.4 },
    { id: 'amb.chime', rate: 0.07 * c.temple * (0.5 + 0.5 * Math.min(1, c.wind)), dist: [6, 22], up: [2, 6], vol: 1.4 },
    { id: 'amb.vendor', rate: 0.07 * c.market * day, dist: [6, 22], up: [1.4, 1.8], vol: 1.6 },
    { id: 'amb.wood.creak', rate: 0.07 * c.harbor, dist: [5, 20], up: [0, 2], vol: 1.4 },
    { id: 'amb.lava.pop', rate: 0.1 * sm(0.5, 0.9, c.bw.volcanic) * (1 - c.settlement), dist: [8, 30], up: [0, 1], vol: 1.6 },
    { id: 'amb.drip', rate: 0.6 * c.cave + 0.08 * swamp, dist: [2, 10], up: [0, 3], vol: 1.3 },
    { id: 'amb.thunder', rate: 0.025 * storm, dist: [300, 600], up: [120, 250], vol: 2.5 },
  ];
}

/** Environment reverb for the space around the listener. Pure. */
export function reverbFor(c: AmbienceContext): ReverbParams & { space: string } {
  if (c.cave > 0.5) return { space: 'cave', decay: 2.8, damping: 3600, mix: 0.5 };
  if (c.temple > 0.5) return { space: 'temple', decay: 1.9, damping: 6000, mix: 0.32 };
  if (c.settlement > 0.5) return { space: 'city', decay: 1.3, damping: 5200, mix: 0.3 };
  if (c.y > 160) return { space: 'mountain', decay: 2.2, damping: 6500, mix: 0.24 };
  if (c.forest > 0.55) return { space: 'forest', decay: 0.9, damping: 4200, mix: 0.2 };
  if (c.bw.cold > 0.6) return { space: 'snowfield', decay: 0.8, damping: 7000, mix: 0.16 };
  return { space: 'open', decay: 0.7, damping: 5000, mix: 0.14 };
}

interface Layer {
  id: string;
  handle: LoopHandle | null;
  generation: number;
  gain: number;
  target: number;
}

const SETTLEMENT_W: Record<string, number> = { capital: 1, city: 0.9, village: 0.65, dock: 0.55, camp: 0.25, training: 0.3, temple: 0.25 };
const MARKET_W: Record<string, number> = { capital: 1, city: 0.8, village: 0.35 };
const tmpS = new Float64Array(2);

/** Sample the world around (x, y, z) into an ambience context (no audio involved). */
export function sampleContext(x: number, y: number, z: number, o: { hour: number; region: { id: string; theme: string } | null; weather?: WeatherSample; menu?: boolean; heavy?: Partial<AmbienceContext> | null }): AmbienceContext {
  const ground = heightAt(x, z);
  const bw = biomeWeights(x, z);
  const biome = biomeAt(x, z, ground);
  const forest = biome === 'ocean' ? 0 : forestFactor(x, z, bw) * (biome === 'farmland' || biome === 'savanna' ? 0.4 : biome === 'desert' ? 0.1 : 1);
  let settlement = 0, market = 0, harbor = 0, temple = 0, spirit = 0, cave = 0;
  for (const l of LANDMARKS) {
    const R = l.discoverRadius;
    const d = Math.hypot(x - l.x, z - l.z);
    if (d > R * 2.5 + 40) continue;
    const sw = SETTLEMENT_W[l.kind];
    if (sw) settlement = Math.max(settlement, sw * (1 - sm(R * 0.55, R * 1.7, d)));
    const mw = MARKET_W[l.kind];
    if (mw) market = Math.max(market, mw * (1 - sm(R * 0.3, R * 1.1, d)));
    if (l.kind === 'dock') harbor = Math.max(harbor, 1 - sm(R * 0.6, R * 1.8, d));
    if (l.kind === 'temple' || l.kind === 'shrine') temple = Math.max(temple, 1 - sm(R * 0.6, R * 2.2, d));
    if (l.kind === 'cave' || l.id.includes('cave')) cave = Math.max(cave, 1 - sm(R * 0.35, R * 0.9, d));
    if (l.id.startsWith('spirit')) spirit = Math.max(spirit, 1 - sm(R * 0.8, R * 2.5, d));
  }
  const region = o.region;
  if (region?.theme === 'spirit') spirit = Math.max(spirit, 0.8);
  if (region?.theme === 'air') temple = Math.max(temple, 0.2 * sm(120, 260, y));
  const w = o.weather ?? { type: 'clear', rain: 0, snow: 0, blizzard: 0, sand: 0, ash: 0, wind: 0.3 };
  const hv = o.heavy ?? {};
  return {
    x,
    y,
    z,
    ground,
    region: region?.id ?? null,
    theme: region?.theme ?? null,
    biome,
    bw,
    forest: clamp01(forest),
    hour: o.hour,
    night: nightFactor(o.hour),
    seaDist: hv.seaDist ?? 999,
    seaFrozen: hv.seaFrozen ?? false,
    riverDist: hv.riverDist ?? 999,
    riverWidth: hv.riverWidth ?? 0,
    riverFrozen: hv.riverFrozen ?? false,
    fallDist: hv.fallDist ?? 999,
    fallDrop: hv.fallDrop ?? 0,
    lakeDist: hv.lakeDist ?? 999,
    settlement: clamp01(settlement),
    market: clamp01(market),
    harbor: clamp01(harbor),
    temple: clamp01(temple),
    spirit: clamp01(spirit),
    cave: clamp01(cave),
    weather: w.type,
    rain: clamp01(w.rain),
    snow: clamp01(w.snow),
    blizzard: clamp01(w.blizzard),
    sand: clamp01(w.sand),
    ash: clamp01(w.ash),
    wind: Math.max(0, Math.min(1.5, Number.isFinite(w.wind) ? w.wind : 0.3)),
    menu: !!o.menu,
  };
}

/** Water proximity (the "heavy" part of the context): sea rings, river lines, falls, lake shores. */
export function sampleWater(x: number, z: number): Pick<AmbienceContext, 'seaDist' | 'seaFrozen' | 'riverDist' | 'riverWidth' | 'riverFrozen' | 'fallDist' | 'fallDrop' | 'lakeDist'> {
  let seaDist = 999;
  let seaFrozen = false;
  const radii = [0, 10, 24, 42, 66, 96, 132, 175];
  outer: for (const r of radii) {
    const n = r === 0 ? 1 : r < 40 ? 8 : 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r * 0.013;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      const w = waterAt(px, pz);
      if (w && w.kind === 'ocean') {
        seaDist = r;
        seaFrozen = w.frozen;
        break outer;
      }
    }
  }
  let riverDist = 999, riverWidth = 0, riverFrozen = false, fallDist = 999, fallDrop = 0;
  for (const r of getRiverRuntime()) {
    const L = r.line;
    const bx = Math.max(L.minX - x, 0, x - L.maxX);
    const bz = Math.max(L.minZ - z, 0, z - L.maxZ);
    if (bx > 160 || bz > 160) continue;
    const d = L.distance(x, z, tmpS);
    const s = tmpS[0];
    const width = r.width(s);
    const edge = Math.max(0, d - width * 0.5);
    if (edge < riverDist) {
      riverDist = edge;
      riverWidth = width;
      riverFrozen = r.frozen;
    }
    for (const f of r.falls) {
      if (r.frozen) continue;
      const p = L.pointAt(f.s);
      const fd = Math.hypot(x - p.x, z - p.z);
      if (fd < fallDist) {
        fallDist = fd;
        fallDrop = f.drop;
      }
    }
  }
  let lakeDist = 999;
  for (const l of getLakeRuntime()) {
    if (l.def.frozen) continue;
    const d = Math.hypot(x - l.def.x, z - l.def.z) - l.def.r;
    lakeDist = Math.min(lakeDist, Math.max(0, d));
  }
  return { seaDist, seaFrozen, riverDist, riverWidth, riverFrozen, fallDist, fallDrop, lakeDist };
}

export interface WeatherSample {
  type: string;
  rain: number;
  snow: number;
  blizzard: number;
  sand: number;
  ash: number;
  wind: number;
}

/** Fallback weather intensities when the environment module is absent (from 'weather:changed'). */
function weatherFromType(type: string): WeatherSample {
  const w: WeatherSample = { type, rain: 0, snow: 0, blizzard: 0, sand: 0, ash: 0, wind: 0.3 };
  if (type === 'rain') (w.rain = 0.8), (w.wind = 0.5);
  else if (type === 'snow') w.snow = 0.7;
  else if (type === 'blizzard') (w.snow = 1), (w.blizzard = 1), (w.wind = 1.2);
  else if (type === 'sandstorm') (w.sand = 1), (w.wind = 1.1);
  else if (type === 'ashfall') w.ash = 0.8;
  else if (type === 'wind') w.wind = 1;
  return w;
}

export class AmbienceDirector implements GameSystem {
  private ctx!: GameContext;
  private readonly layers = new Map<string, Layer>();
  private acc = 0;
  private heavyAt = { x: NaN, z: NaN, t: -99 };
  private heavy: ReturnType<typeof sampleWater> | null = null;
  private clock = 0;
  private snapUntil = 0;
  private weatherType = 'clear';
  private lastReverb = '';
  private spotCooldown = 0;
  /** Latest sampled context and targets (debug/tests). */
  context: AmbienceContext | null = null;
  targets: Record<string, number> = {};
  /** Debug: force context fields (e.g. { hour: 23 } or { weather/rain }). */
  override: Partial<AmbienceContext> | null = null;
  /** Master scale for the whole director (0 mutes ambience without touching the settings). */
  level = 1;
  readonly stats = { started: 0, stopped: 0, spots: 0, spotIds: {} as Record<string, number>, updates: 0 };

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.audio.addTicker((dt) => this.tick(dt));
    ctx.events.on('weather:changed', (e) => {
      this.weatherType = e.weather;
    });
    ctx.events.on('session:started', () => this.snap());
    ctx.events.on('game:mode', () => this.snap());
  }

  /** Crossfade quickly to the new surroundings (travel, session start, teleport). */
  snap(): void {
    this.snapUntil = this.clock + 2.5;
    this.heavyAt.t = -99;
    this.acc = 1;
  }

  private listener(): (Vec3Like & { menu: boolean }) | null {
    const g = this.ctx.game;
    if (g.mode === 'play' && this.ctx.session.active && this.ctx.player) {
      const p = this.ctx.player.position;
      return { x: p.x, y: p.y, z: p.z, menu: false };
    }
    if (g.mode === 'menu') {
      const c = this.ctx.camera.position;
      return { x: c.x, y: c.y, z: c.z, menu: true };
    }
    return null;
  }

  private weatherSample(): WeatherSample {
    const env = this.ctx.extra.get('environment') as { weather?: { state(): { weather: string; wind: number; particles: Record<string, number> } } } | undefined;
    try {
      const st = env?.weather?.state();
      if (st) {
        const p = st.particles ?? {};
        const blizzard = st.weather === 'blizzard' ? Math.max(p.snow ?? 0, p.drift ?? 0) : p.drift ?? 0;
        return { type: st.weather, rain: p.rain ?? 0, snow: p.snow ?? 0, blizzard, sand: p.sand ?? 0, ash: p.ash ?? 0, wind: st.wind ?? 0.3 };
      }
    } catch {
      /* fall back to the last event */
    }
    return weatherFromType(this.weatherType);
  }

  private tick(dt: number): void {
    this.clock += dt;
    this.acc += dt;
    if (this.acc < 0.25) return;
    const step = Math.min(1, this.acc);
    this.acc = 0;
    this.stats.updates++;
    const L = this.listener();
    const audio = this.ctx.audio;
    let scale = 0;
    if (L) {
      const moved = Math.hypot(L.x - this.heavyAt.x, L.z - this.heavyAt.z);
      if (!(moved < 22) || this.clock - this.heavyAt.t > 1.2) {
        this.heavy = sampleWater(L.x, L.z);
        this.heavyAt = { x: L.x, z: L.z, t: this.clock };
        if (moved > 150) this.snapUntil = this.clock + 2;
      }
      const reg = this.ctx.world.regionAt(L.x, L.z);
      const c = sampleContext(L.x, L.y, L.z, {
        hour: this.ctx.world.sky?.timeOfDay ?? 12,
        region: reg ? { id: reg.id, theme: reg.theme } : null,
        weather: this.weatherSample(),
        menu: L.menu,
        heavy: this.heavy,
      });
      if (this.override) Object.assign(c, this.override, this.override.hour !== undefined ? { night: nightFactor(this.override.hour) } : {});
      this.context = c;
      this.targets = ambienceTargets(c);
      scale = this.level;
      // Environment reverb follows the space.
      const rv = reverbFor(c);
      if (rv.space !== this.lastReverb) {
        this.lastReverb = rv.space;
        audio.setEnvironment({ decay: rv.decay, damping: rv.damping, mix: rv.mix });
      }
      if (audio.ready) this.spots(c, step);
    } else {
      this.context = null;
      for (const k of Object.keys(this.targets)) this.targets[k] = 0;
    }
    this.mix(step, scale);
  }

  /** Voice budget + crossfades + lazy loop start/stop. */
  private mix(dt: number, scale: number): void {
    const audio = this.ctx.audio;
    const lowPreset = this.ctx.settings.data.graphics.preset === 'low';
    const budget = lowPreset ? 7 : 10;
    const ranked = Object.entries(this.targets)
      .filter(([, v]) => v > 0.02)
      .sort((a, b) => b[1] - a[1])
      .slice(0, budget);
    const keep = new Map(ranked);
    const snapping = this.clock < this.snapUntil;
    for (const id of AMBIENCE_LAYERS) {
      let layer = this.layers.get(id);
      const target = (keep.get(id) ?? 0) * scale;
      if (!layer) {
        if (target <= 0) continue;
        layer = { id, handle: null, generation: -1, gain: 0, target: 0 };
        this.layers.set(id, layer);
      }
      layer.target = target;
      const tau = snapping ? 0.5 : target > layer.gain ? 2.2 : 3;
      layer.gain += (target - layer.gain) * (1 - Math.exp(-dt / tau));
      if (layer.gain < 0.0015 && target === 0) layer.gain = 0;
      // A rebuilt AudioContext invalidates old handles.
      if (layer.handle && layer.generation !== audio.generation) layer.handle = null;
      const vol = layer.gain * (LAYER_GAIN[id] ?? 1);
      if (!layer.handle && audio.ready && target > 0.01) {
        layer.handle = audio.loop(id, { volume: 0, bus: 'ambient' });
        layer.generation = audio.generation;
        this.stats.started++;
      }
      if (layer.handle) {
        if (layer.gain === 0 && target === 0) {
          layer.handle.stop(0.4);
          layer.handle = null;
          this.stats.stopped++;
        } else {
          layer.handle.setVolume(vol);
          const k = Math.max(0.05, Math.min(1, layer.target / Math.max(0.05, scale)));
          layer.handle.setParam('intensity', k);
          layer.handle.setParam('density', k);
        }
      }
      if (!layer.handle && layer.gain === 0 && target === 0) this.layers.delete(id);
    }
  }

  private spots(c: AmbienceContext, dt: number): void {
    this.spotCooldown -= dt;
    if (this.spotCooldown > 0) return;
    const audio = this.ctx.audio;
    const lowPreset = this.ctx.settings.data.graphics.preset === 'low';
    const k = (lowPreset ? 0.7 : 1) * (c.menu ? 0.6 : 1) * this.level;
    for (const s of spotRates(c)) {
      if (!(s.rate > 0) || Math.random() >= s.rate * dt * k) continue;
      const a = Math.random() * Math.PI * 2;
      const d = s.dist[0] + Math.random() * (s.dist[1] - s.dist[0]);
      const px = c.x + Math.cos(a) * d, pz = c.z + Math.sin(a) * d;
      const py = Math.max(c.ground, heightAt(px, pz)) + s.up[0] + Math.random() * (s.up[1] - s.up[0]);
      const h = audio.play(s.id, { position: { x: px, y: py, z: pz }, volume: s.vol, bus: 'ambient', range: Math.max(60, s.dist[1] * 1.6) });
      if (h) {
        this.stats.spots++;
        this.stats.spotIds[s.id] = (this.stats.spotIds[s.id] ?? 0) + 1;
        this.spotCooldown = 0.12;
        return;
      }
    }
  }

  /** Snapshot for debug/tests. */
  state(): Record<string, unknown> {
    const c = this.context;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const active: Record<string, { gain: number; target: number; playing: boolean }> = {};
    for (const l of this.layers.values()) active[l.id] = { gain: r2(l.gain), target: r2(l.target), playing: !!l.handle };
    const targets: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.targets)) if (v > 0.005) targets[k] = r2(v);
    return {
      context: c
        ? {
            x: r2(c.x), y: r2(c.y), z: r2(c.z), region: c.region, theme: c.theme, biome: c.biome, forest: r2(c.forest), hour: r2(c.hour), night: r2(c.night),
            seaDist: r2(c.seaDist), riverDist: r2(c.riverDist), riverWidth: r2(c.riverWidth), fallDist: r2(c.fallDist), lakeDist: r2(c.lakeDist),
            settlement: r2(c.settlement), market: r2(c.market), harbor: r2(c.harbor), temple: r2(c.temple), spirit: r2(c.spirit), cave: r2(c.cave),
            weather: c.weather, rain: r2(c.rain), snow: r2(c.snow), blizzard: r2(c.blizzard), sand: r2(c.sand), ash: r2(c.ash), wind: r2(c.wind),
            cold: r2(c.bw.cold), desert: r2(c.bw.desert), volcanic: r2(c.bw.volcanic), swamp: r2(c.bw.swamp), menu: c.menu,
          }
        : null,
      targets,
      active,
      playing: [...this.layers.values()].filter((l) => l.handle).map((l) => l.id),
      reverb: this.lastReverb,
      stats: { ...this.stats, spotIds: { ...this.stats.spotIds } },
      regions: REGIONS.length,
    };
  }
}
