import * as THREE from 'three';
import type { GameContext, GameSystem } from '../../core/GameContext';
import { AmbientSystem } from './Ambient';
import { CloudSeaSystem } from './CloudSea';
import { EnvFXSystem } from './EnvFX';
import { GrassSystem } from './Grass';
import { HorizonSystem } from './Horizon';
import { VegetationSystem } from './Vegetation';
import { WaterfallFXSystem } from './WaterfallFX';
import { WEATHER_TYPES, WeatherSystem, type WeatherType } from './Weather';

/**
 * World environment module: owns the streamed vegetation, grass, ground decals
 * (EnvironmentFX), weather, cloud sea and ambient life, registers them as world
 * updatables (so they also animate behind menus) and installs world.fx.
 *
 * Debug: window.__game.debug.env
 */
export class EnvironmentSystem implements GameSystem {
  vegetation!: VegetationSystem;
  grass!: GrassSystem;
  fx!: EnvFXSystem;
  weather!: WeatherSystem;
  cloudSea!: CloudSeaSystem;
  horizon!: HorizonSystem;
  ambient!: AmbientSystem;
  waterfalls!: WaterfallFXSystem;
  private ctx!: GameContext;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.vegetation = new VegetationSystem(ctx);
    this.grass = new GrassSystem(ctx);
    this.fx = new EnvFXSystem(ctx, this.vegetation);
    this.weather = new WeatherSystem(ctx);
    this.cloudSea = new CloudSeaSystem(ctx, ctx.world.sky.noiseTexture);
    this.horizon = new HorizonSystem(ctx);
    this.ambient = new AmbientSystem(ctx);
    this.waterfalls = new WaterfallFXSystem(ctx);
    ctx.world.addUpdatable(this.cloudSea);
    ctx.world.addUpdatable({
      update: () => {
        this.weather.fogBoost = this.cloudSea.mist;
        this.weather.fogClear = this.cloudSea.above;
      },
    });
    ctx.world.addUpdatable(this.weather);
    ctx.world.addUpdatable(this.horizon);
    ctx.world.addUpdatable(this.ambient);
    ctx.world.addUpdatable(this.waterfalls);
    ctx.world.addUpdatable(this.vegetation);
    ctx.world.addUpdatable(this.grass);
    ctx.world.addUpdatable(this.fx);
    ctx.world.fx = this.fx;
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
    this.installDebug();
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    // Footprints and ambient puffs belong to "ambient effects"; combat decals (scorch, frost...) always show.
    this.fx.footprintsEnabled = g.ambientEffects;
  }

  onSessionStart(): void {
    this.fx.clear();
    this.weather.resetForSession();
  }

  onSessionEnd(): void {
    this.fx.clear();
  }

  private installDebug(): void {
    if (typeof window === 'undefined') return;
    if (this.tryInstallDebug()) return;
    // window.__game is installed after every system's init: retry shortly.
    const iv = setInterval(() => {
      if (this.tryInstallDebug()) clearInterval(iv);
    }, 30);
    setTimeout(() => clearInterval(iv), 15000);
  }

  private tryInstallDebug(): boolean {
    const g = (window as any).__game;
    if (!g) return false;
    g.debug = g.debug ?? {};
    const ctx = this.ctx;
    const v3 = (p: { x: number; y?: number; z: number }) => new THREE.Vector3(p.x, p.y ?? ctx.world.groundAt(p.x, p.z).y, p.z);
    g.debug.env = {
      /** Teleport the player and synchronously stream terrain, regions and vegetation around them. */
      preload: async (x: number, z: number, y?: number) => {
        g.teleport(x, z, y);
        await ctx.world.preload(ctx.player!.position.clone());
        g.teleport(x, z, y);
        return g.state().player;
      },
      vegetation: () => this.vegetation.stats(),
      vegetationNear: (x: number, z: number, r = 20) => this.vegetation.query(x, z, r),
      setVegetation: (on: boolean) => {
        this.vegetation.enabled = on;
      },
      grass: () => this.grass.stats(),
      decals: () => ({ ...this.fx.liveCounts(), counts: { ...this.fx.counts } }),
      clearDecals: () => this.fx.clear(),
      /** Call an EnvironmentFX hook directly: fx('scorch', {x,z}, 2). */
      fx: (kind: 'scorch' | 'wet' | 'frost' | 'crack' | 'disturb', p: { x: number; y?: number; z: number }, radius = 2, strength = 1) => {
        const pos = v3(p);
        if (kind === 'disturb') ctx.world.fx.disturb(pos, radius, strength);
        else if (kind === 'crack') ctx.world.fx.crack(pos, radius);
        else ctx.world.fx[kind](pos, radius);
        return this.fx.liveCounts();
      },
      footprint: (p: { x: number; y?: number; z: number }, yaw: number, kind: 'walk' | 'run' | 'land' | 'slide' = 'walk', foot: 'L' | 'R' = 'L') => {
        const pos = v3(p);
        ctx.world.fx.footprint(pos, yaw, foot, kind, ctx.world.surfaceAt(pos.x, pos.z, pos.y));
        return this.fx.liveCounts();
      },
      colliderCount: () => ctx.world.collision.count,
      /** Force a weather type ('clear' | 'cloudy' | 'snow' | 'blizzard' | 'rain' | 'fog' | 'ashfall' | 'sandstorm' | 'wind'); null = regional cycle. */
      weather: (type: WeatherType | null, snap = true) => {
        if (type && !WEATHER_TYPES.includes(type)) throw new Error('unknown weather ' + type);
        this.weather.force(type, snap);
        return this.weather.state();
      },
      weatherState: () => this.weather.state(),
      ambient: () => this.ambient.state(),
      cloudSeaBand: () => this.cloudSea.band,
      /** Cloud sea state: mist (camera inside the deck) and above (on the massif over the deck). */
      cloudSea: () => ({ band: this.cloudSea.band, mist: this.cloudSea.mist, above: this.cloudSea.above, visible: this.cloudSea.group.visible }),
      /** River waterfall sites (spray / mist emitters) near a point, or all of them. */
      waterfalls: (x?: number, z?: number, r = 400) =>
        (x === undefined || z === undefined ? this.waterfalls.sites : this.waterfalls.near(x, z, r)).map((s) => ({ river: s.riverId, x: +s.base.x.toFixed(1), y: +s.base.y.toFixed(1), z: +s.base.z.toFixed(1), drop: +s.drop.toFixed(1), width: +s.width.toFixed(1) })),
      /** Toggle subsystems for A/B screenshots: toggle('grass' | 'vegetation' | 'cloudSea' | 'horizon' | 'ambient' | 'decals', on). */
      toggle: (what: 'grass' | 'vegetation' | 'cloudSea' | 'horizon' | 'ambient' | 'decals' | 'waterfalls', on: boolean) => {
        const m = { grass: this.grass, vegetation: this.vegetation, cloudSea: this.cloudSea, horizon: this.horizon, ambient: this.ambient, decals: this.fx, waterfalls: this.waterfalls } as const;
        m[what].enabled = on;
      },
    };
    return true;
  }
}
