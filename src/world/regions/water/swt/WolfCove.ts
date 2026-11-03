import * as THREE from 'three';
import type { LoopHandle } from '../../../../audio/AudioEngine';
import type { WaterSourceDef } from '../../../../combat/WaterSources';
import type { GameContext } from '../../../../core/GameContext';
import type { Emitter } from '../../../../vfx/VFX';
import type { EnvironmentSystem } from '../../../env/EnvironmentSystem';
import { WC, WC_GATE, WC_LANDING, WC_WRECK } from '../../../landforms/wolfCove';
import { SatOverlay } from '../../air/sat/overlay';
import { defineSpots } from '../../../Spots';
import { WaterRegion } from '../base';
import { wtMat, wtWater } from '../materials';
import { V, WaterSheets } from '../parts';
import { furnishInteriors } from './interiors';
import { Aurora, nightFactor, RaidMarks } from './atmosphere';
import './audio';
import { APUT_DOOR, C, CARVERS, CHIEF, dwellings, FLOOR, GREAT, HEARTH, PLAZA, POND, POND_HOLE, RI, TOWER_ANGLES, TRADER, TRAINING, WORKSHOP } from './layout';
import { WolfCoveLife } from './life';
import { buildShore, SHORE } from './shore';
import { buildVillage, type VillageInfo } from './village';
import { buildWall } from './wall';
import { WolfCoveWildlife } from './wildlife';

/**
 * Southern Water Tribe — Wolf Cove, the tribe's main village as it stood ~40 years into the war
 * (image 1): a circular village on a raised ice terrace inside a great ice wall, the gate facing the
 * shore to the north, the open tundra to the south. Terrain: landforms/wolfCove.ts; layout:
 * swt/layout.ts; the wall (wall.ts), village (village.ts), interiors (interiors.ts), the shore,
 * shipwreck, sled run and tundra (shore.ts).
 *
 * Gameplay hooks kept from the old village: the region content id `swt_village`, Hunter Akka on the
 * hunting ice (now the cove's shore ice), the water sources `swt:sea_ice` and `swt:fishing_hole_*`,
 * the spots the tribe's named NPCs stand at (chief, trader, canoe landing, watchtower, village fire,
 * the otter penguins' floes).
 */

const R = 'southern_water_tribe';
const R_TOWER = WC.R - WC.wallT / 2;
const towerAt = (a: number) => ({ x: C.x + Math.sin(a) * R_TOWER, z: C.z - Math.cos(a) * R_TOWER });

defineSpots({
  // The tribe's named people and services (data/npcs_life.ts, shop/stock.ts).
  giver_swt_chief: { x: CHIEF.x, z: CHIEF.z, y: FLOOR, yaw: Math.PI / 2, r: 2, label: 'Chief Hakoda', region: R },
  merchant_swt_1: { x: TRADER.x, z: TRADER.z, y: FLOOR, yaw: -Math.PI / 2, r: 2, label: 'Trader', region: R },
  shrine_swt_firepit: { x: HEARTH.x, z: HEARTH.z + 3.2, y: FLOOR, r: 4, label: 'Hearth Plaza', region: R },
  viewpoint_swt_tower: { x: towerAt(TOWER_ANGLES[0]).x, z: towerAt(TOWER_ANGLES[0]).z, y: WC.wallTop, r: 3, label: 'Wall Lookout', region: R },
  // Masters: Hunter Akka on the hunting ice (the cove's shore ice), Master Aput by the Frozen Pond.
  master_akka: { x: SHORE.akka.x, z: SHORE.akka.z + 11, y: SHORE.iceY, yaw: Math.PI, r: 2, label: 'Hunter Akka', region: R },
  training_akka: { x: SHORE.akka.x, z: SHORE.akka.z, y: SHORE.iceY, r: 12, label: 'Hunting Ice', region: R },
  master_aput: { x: TRAINING.x - TRAINING.r - 1.4, z: TRAINING.z, y: FLOOR, yaw: Math.PI / 2, r: 2, label: 'Master Aput', region: R },
  training_aput: { x: TRAINING.x, z: TRAINING.z, y: FLOOR, r: TRAINING.r, label: 'Training Circle', region: R },
  // The shore: canoe landing and the otter penguins' floes by the sled run.
  dock_swt_ice: { x: WC_LANDING.x, z: WC_LANDING.z, y: SHORE.beachY, yaw: Math.PI, r: 3, label: 'Canoe Landing', region: R },
  habitat_otter_penguin_2: { x: SHORE.penguins.x, z: SHORE.penguins.z, y: SHORE.penguins.y, r: 9, label: 'Penguin Slope', region: R },
  // Quest anchors.
  swt_great_igloo: { x: GREAT.x, z: GREAT.z, y: FLOOR, r: GREAT.r - 1, label: 'Great Igloo', region: R },
  swt_aput_door: { x: APUT_DOOR.x, z: APUT_DOOR.z, y: FLOOR, r: 2, label: 'Great Igloo entrance', region: R },
  swt_frozen_pond: { x: POND.x, z: POND.z, y: FLOOR, r: POND.r, label: 'Frozen Pond', region: R },
  swt_shipwreck: { x: WC_WRECK.x, z: WC_WRECK.z, y: 1, r: 12, label: 'Fire Navy Wreck', region: R },
});

export class WolfCove extends WaterRegion {
  private village: VillageInfo | null = null;
  private interiorLight: THREE.PointLight | null = null;
  private lightTimer = 0;
  /** The villagers, the animals and boats, the aurora and the marks of a raid. */
  life: WolfCoveLife | null = null;
  wild: WolfCoveWildlife | null = null;
  private aurora: Aurora | null = null;
  private raid: RaidMarks | null = null;
  private lod: 'full' | 'far' | 'hidden' = 'full';
  private time = 0;
  /** Debug overrides: festival on/off (null = on clear nights), raided on/off (null = story flag). */
  festivalMode: boolean | null = null;
  raidMode: boolean | null = null;
  festival = false;
  raided = false;
  private clear = 1;
  private weatherTimer = 0;
  private raidFx: Emitter[] = [];
  private sootFall: Emitter | null = null;
  private loops: { murmur: LoopHandle | null; hearth: LoopHandle | null; shore: LoopHandle | null } = { murmur: null, hearth: null, shore: null };
  private loopGen = -1;
  private sfx = { creak: 6, boom: 30, carve: 3, drum: 0, drumStep: 0, breath: 1, drift: 0.5 };
  /** The spirits answering the elders on festival nights (the Great Igloo's smoke hole, the hearth). */
  private spiritFx: Emitter[] = [];
  /** F3 debug overlay (shared with the Southern Air Temple). */
  private overlay: SatOverlay | null = null;
  private fps = 60;
  private lastHour = -1;

  constructor() {
    super('swt_village', { x: C.x, z: C.z - 80 }, 480);
  }

  protected construct(ctx: GameContext): void {
    const low = ctx.vfx.quality === 'low';
    const b = this.builder(this.main);
    const p = this.builder(this.props);
    const sheets = new WaterSheets();
    const wall = buildWall(b, p, low);
    const list = dwellings();
    this.village = buildVillage(b, p, list, low);
    furnishInteriors(b, p, this.village, low);
    buildShore(this, b, p, sheets, low);
    this.waterSources(sheets);
    this.fires();
    sheets.flush(b);
    // One warm light for whichever interior the player is in (or near): fire inside the domes.
    if (ctx.settings.data.graphics.dynamicLights) {
      this.interiorLight = new THREE.PointLight('#ffb070', 0, 16, 1.6);
      this.interiorLight.name = 'swt_interior_light';
      this.main.add(this.interiorLight);
    }
    // People, animals and boats, the sky.
    const density = ctx.settings.data.graphics.preset === 'low' ? 0.7 : 1;
    this.life = new WolfCoveLife(this.main, { dwellings: list, village: this.village, wall }, density);
    this.wild = new WolfCoveWildlife(this.main, low);
    this.aurora = new Aurora(this.group);
    // The igloos nearest the gate are the ones a raid burns.
    const damaged = list
      .filter((d) => d.kind === 'igloo' && !d.home)
      .sort((a, b) => Math.hypot(a.x - WC_GATE.x, a.z - WC_GATE.z) - Math.hypot(b.x - WC_GATE.x, b.z - WC_GATE.z))
      .slice(0, 5);
    this.raid = new RaidMarks(this.main, damaged);
    this.overlay = new SatOverlay(
      () => this.overlayLines(),
      () => {
        const pp = this.ctx.player?.position;
        return !!pp && Math.hypot(pp.x - C.x, pp.z - C.z) < 600;
      },
    );
    current = this;
    installSwtDebug();
    const life = this.life;
    this.interactable({
      id: 'swt_talk',
      position: life.talkPos,
      radius: 3.2,
      get label() {
        const n = life.nearest;
        return n ? `Talk to ${n.name}` : 'Talk';
      },
      priority: 0,
      interact: (c: GameContext) => life.talk(c),
    });
  }

  /** Register a source (the shore module calls this too). */
  addWater(def: WaterSourceDef): void {
    this.registerWater(def);
  }

  /** Track a material made by a builder module (disposed with the region). */
  ownMaterial<T extends THREE.Material>(m: T): T {
    return this.own(m);
  }

  private waterSources(sheets: WaterSheets): void {
    // The Frozen Pond: the ice sheet and its one thawed hole (liquid).
    sheets.disc(wtWater('pond'), POND_HOLE.x, POND_HOLE.z, POND_HOLE.r, FLOOR - 0.12, 20);
    this.registerWater({ id: 'swt:pond_hole', type: 'pond', label: 'Frozen Pond (thawed hole)', x: POND_HOLE.x, y: FLOOR - 0.12, z: POND_HOLE.z, r: POND_HOLE.r, capacity: 160, regen: 6, size: 'small' });
    this.registerWater({ id: 'swt:pond_ice', type: 'ice', label: 'Frozen Pond', x: POND.x, y: FLOOR + 0.03, z: POND.z, r: POND.r, capacity: 220, regen: 4, frozen: true });
    // Melt barrels by the hearth: water within reach of the start.
    const barrels = [
      [HEARTH.x + 3.6, HEARTH.z - 3.9],
      [HEARTH.x + 4.4, HEARTH.z - 3.1],
      [HEARTH.x - 3.9, HEARTH.z - 3.6],
    ];
    barrels.forEach(([x, z], i) => {
      sheets.disc(wtWater('pool'), x, z, 0.36, FLOOR + 0.98, 12);
      this.registerWater({ id: `swt:melt_barrel_${i}`, type: 'fountain', label: 'Melt Barrel', x, y: FLOOR + 0.98, z, r: 0.4, capacity: 45, regen: 2.5, size: 'small' });
    });
  }

  private fires(): void {
    if (!this.village) return;
    for (const f of this.village.fires) {
      this.ambientEmitter('flame', f.big ? 10 : 5, V(f.x, f.y + 0.35, f.z), { radius: f.big ? 0.35 : 0.2, size: f.big ? 1.1 : 0.75 }, 90, false);
      this.ambientEmitter('embers', f.big ? 3 : 1.5, V(f.x, f.y + 0.8, f.z), { radius: 0.3 }, 70, true);
      this.ambientEmitter('smoke', f.big ? 1.2 : 0.6, V(f.x, f.y + 2, f.z), { radius: 0.3, size: 0.8, speed: 0.6 }, 90, true);
    }
  }

  override setDetail(level: 'full' | 'far' | 'hidden'): void {
    this.lod = level;
    super.setDetail(level);
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    this.time += dt;
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    this.overlay?.update(dt);
    this.updateInteriorLight(dt, ctx);
    const hour = ctx.world.sky.timeOfDay;
    const p = ctx.player?.position ?? ctx.camera.position;
    const dist = Math.hypot(p.x - C.x, p.z - C.z);
    // Weather (sampled now and then): the aurora wants a clear sky, the festival a clear night.
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = 2;
      const env = ctx.extra.get('environment') as EnvironmentSystem | undefined;
      const w = env?.weather.state().weather ?? 'clear';
      this.clear = w === 'clear' ? 1 : w === 'cloudy' ? 0.3 : 0;
      this.raided = this.raidMode ?? (ctx.quests.hasFlag('swt_raided') && !ctx.quests.hasFlag('swt_rebuilt'));
    }
    // Festival evenings start at dusk (the village fasts instead of the communal meal).
    const night = hour >= 18 || hour < 1;
    this.festival = !this.raided && (this.festivalMode ?? (night && this.clear >= 1));
    const full = this.lod === 'full';
    if (this.life) {
      this.life.group.visible = full;
      this.life.festival = this.festival;
      this.life.raided = this.raided;
      if (full) this.life.update(dt, ctx, ctx.camera, this.wild?.riders ?? []);
    }
    if (this.wild) {
      this.wild.group.visible = this.lod !== 'hidden';
      if (this.lod !== 'hidden') this.wild.update(dt, ctx, full, this.life?.pets ?? []);
    }
    const jumped = this.lastHour >= 0 && Math.min(Math.abs(hour - this.lastHour), 24 - Math.abs(hour - this.lastHour)) > 0.25;
    this.lastHour = hour;
    this.aurora?.update(dt, this.time, dist < 1600 ? nightFactor(hour) * this.clear * (this.festival ? 1 : 0.6) : 0, jumped);
    this.updateRaid(ctx, full && dist < 260);
    this.updateSpirits(ctx, full && dist < 320 && this.festival && (hour >= 19 || hour < 1));
    if (full && dist < 420) {
      this.sounds(dt, ctx, p, hour);
      this.air(dt, ctx, p, dist);
    } else this.quiet();
  }

  private updateInteriorLight(dt: number, ctx: GameContext): void {
    const light = this.interiorLight;
    if (!light || !this.village) return;
    this.lightTimer -= dt;
    if (this.lightTimer > 0) return;
    this.lightTimer = 0.25;
    const p = ctx.player?.position;
    if (!p) return;
    // The nearest interior within reach gets the warm firelight (off when nobody is near).
    let best: VillageInfo['interiors'][number] | null = null;
    let bd = 1e9;
    for (const it of this.village.interiors) {
      const d = Math.hypot(p.x - it.x, p.z - it.z) - it.r;
      if (d < bd) {
        bd = d;
        best = it;
      }
    }
    if (best && bd < 6 && Math.abs(p.y - FLOOR) < 4) {
      light.position.set(best.x, FLOOR + Math.min(2.6, best.r * 0.55), best.z);
      light.distance = best.r * 2.6;
      light.intensity = best.kind === 'great' ? 26 : 10;
    } else light.intensity = 0;
  }

  /** Soot on the snow, igloos smoking and dark flakes falling while the village is raided. */
  private updateRaid(ctx: GameContext, near: boolean): void {
    const on = this.raided && !!this.raid;
    if (this.raid) this.raid.group.visible = on;
    if (on && near && !this.raidFx.length && this.raid) {
      for (const s of this.raid.smoke) {
        const em = ctx.vfx.emitter('smoke', 2.2, { radius: 0.8, size: 1.6, speed: 0.9, color: '#3a3836', color2: '#77736e' });
        em.position.copy(s);
        this.raidFx.push(em);
      }
      this.sootFall = ctx.vfx.emitter('ash', 26, { radius: 16, color: '#1e1c1b', color2: '#3a3735', gravity: 0.5, life: 4 });
    }
    if ((!on || !near) && this.raidFx.length) this.stopRaidFx();
    const p = ctx.player?.position;
    if (this.sootFall && p) this.sootFall.position.set(p.x, p.y + 9, p.z);
  }

  /** Festival nights: spirit lights rising from the Great Igloo, where the elders commune, and at the hearth. */
  private updateSpirits(ctx: GameContext, on: boolean): void {
    if (on && !this.spiritFx.length && ctx.settings.data.graphics.ambientEffects) {
      const top = ctx.vfx.emitter('spirit', 5, { radius: 1.6, size: 0.55, speed: 0.7, color: '#c8f4ff', color2: '#7fd8c8' });
      top.position.set(GREAT.x, FLOOR + GREAT.h - 0.6, GREAT.z);
      const hearth = ctx.vfx.emitter('spirit', 3, { radius: 1.1, size: 0.4, speed: 0.5, color: '#d4f7ff', color2: '#8fd0ff' });
      hearth.position.set(HEARTH.x, FLOOR + 1.4, HEARTH.z);
      this.spiritFx.push(top, hearth);
    } else if (!on && this.spiritFx.length) this.stopSpirits();
  }

  private stopSpirits(): void {
    for (const e of this.spiritFx) e.stop();
    this.spiritFx.length = 0;
  }

  private overlayLines(): string[] {
    const info = this.ctx.render.renderer.info.render;
    const l = this.life?.stats, w = this.wild?.stats;
    return [
      'Wolf Cove — Southern Water Tribe',
      `fps ${this.fps.toFixed(0)}  draw calls ${info.calls}  triangles ${(info.triangles / 1000).toFixed(0)}k`,
      l ? `people ${l.total}: drawn ${l.drawn}, walking ${l.walking}, indoors ${l.home}, village ${l.village}, shore ${l.shore}, hall ${l.hall}, wall ${l.wall}, sledding ${l.sledding}  (${l.ms.toFixed(2)} ms)` : 'people —',
      w ? `animals: penguins ${w.penguins}, seals ${w.seals}, dogs ${w.dogs}, gulls ${w.gulls}, polar bear dog ${w.bear}; boats out ${w.boatsOut}/${w.boats}` : 'animals —',
      `festival ${this.festival ? 'yes' : 'no'}  raided ${this.raided ? 'yes' : 'no'}  aurora ${(this.aurora?.intensity ?? 0).toFixed(2)}  detail ${this.lod}`,
    ];
  }

  private stopRaidFx(): void {
    for (const e of this.raidFx) e.stop();
    this.raidFx.length = 0;
    this.sootFall?.stop();
    this.sootFall = null;
  }

  /** Breath in the cold (the player and the villagers close by), snow blowing across the open ground. */
  private air(dt: number, ctx: GameContext, p: THREE.Vector3, dist: number): void {
    if (!ctx.settings.data.graphics.ambientEffects) return;
    const s = this.sfx;
    s.breath -= dt;
    if (s.breath <= 0) {
      s.breath = 1.1 + Math.random() * 0.9;
      const pl = ctx.player;
      const puff = (x: number, y: number, z: number, yaw: number) =>
        ctx.vfx.burst('steam', V(x, y, z), { count: 2, size: 0.32, speed: 0.35, life: 1, spread: 0.3, dir: V(Math.sin(yaw), 0.25, Math.cos(yaw)), color: '#f5f8fc', color2: '#e4ebf2' });
      if (pl && Math.random() < 0.45) puff(pl.position.x + Math.sin(pl.yaw) * 0.25, pl.position.y + 1.6, pl.position.z + Math.cos(pl.yaw) * 0.25, pl.yaw);
      const life = this.life;
      if (life && life.breathN) {
        const i = Math.floor(Math.random() * life.breathN);
        const b = life.breathers[i];
        puff(b.x, b.y, b.z, Math.atan2(b.x - p.x, b.z - p.z));
      }
    }
    // Spindrift: outside the wall and on the wall walk, low gusts of snow skate over the ground.
    const exposed = dist > RI - 2 || p.y > WC.wallTop - 0.5;
    s.drift -= dt;
    if (exposed && s.drift <= 0) {
      s.drift = 0.35 + Math.random() * 0.5;
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 10;
      const x = p.x + Math.sin(a) * r, z = p.z + Math.cos(a) * r;
      ctx.vfx.burst('snow', V(x, ctx.world.groundAt(x, z, p.y + 3).y + 0.15, z), { count: 6, speed: 3.2, spread: 0.35, dir: V(0.9, 0.05, -0.4), gravity: 0.2, life: 1.4, size: 0.12 });
    }
  }

  /** The crowd's murmur, the hearth, the shore; ice creaks and booms, animal calls, workshops, drums. */
  private sounds(dt: number, ctx: GameContext, p: THREE.Vector3, hour: number): void {
    const audio = ctx.audio;
    if (audio.ready && this.loopGen !== audio.generation) {
      this.quiet();
      this.loops.murmur = audio.loop('amb.market', { volume: 0 });
      this.loops.hearth = audio.loop('fire_crackle', { position: V(HEARTH.x, FLOOR + 0.6, HEARTH.z), volume: 0 });
      this.loops.shore = audio.loop('amb.harbor', { volume: 0 });
      this.loopGen = audio.generation;
    }
    const fall = (d: number, r: number) => Math.max(0, Math.min(1, 1 - d / r));
    const dPlaza = Math.hypot(p.x - PLAZA.x, p.z - PLAZA.z);
    const people = this.life ? this.life.stats.village - (this.life.stats.home > 150 ? 20 : 0) : 0;
    const busy = Math.min(1, Math.max(0, people) / 70);
    const inside = Math.hypot(p.x - C.x, p.z - C.z) < RI + 4 && Math.abs(p.y - FLOOR) < 4;
    this.loops.murmur?.setVolume((inside ? 0.55 : 0.18) * busy * fall(dPlaza, 110));
    this.loops.hearth?.setVolume(0.5 * fall(dPlaza, 26));
    const dShore = Math.hypot(p.x - WC_LANDING.x, p.z - WC_LANDING.z);
    this.loops.shore?.setVolume(0.7 * fall(dShore, 140));
    const s = this.sfx;
    // The sea ice talks: creaks near the shore, now and then a boom far out on the pack.
    s.creak -= dt;
    if (s.creak <= 0) {
      s.creak = 9 + Math.random() * 16;
      if (dShore < 200) audio.play('swt_ice_creak', { position: V(WC_LANDING.x + (Math.random() - 0.3) * 80, 0.2, WC_LANDING.z - 10 - Math.random() * 40), volume: 0.8 });
    }
    s.boom -= dt;
    if (s.boom <= 0) {
      s.boom = 40 + Math.random() * 60;
      audio.play('swt_ice_boom', { position: V(330 + Math.random() * 120, 0, 1380 + Math.random() * 60), volume: 0.9 });
    }
    // Animal calls the wildlife raised this frame.
    for (const c of this.wild?.calls ?? []) audio.play(c.kind === 'seal' ? 'swt_seal' : c.kind === 'dog' ? 'swt_dog' : 'swt_penguin', { position: V(c.x, c.y, c.z) });
    // Workshops by day.
    const day = hour > 7 && hour < 17.5;
    s.carve -= dt;
    if (day && s.carve <= 0) {
      s.carve = 3.5 + Math.random() * 5;
      const w = Math.random() < 0.5 ? WORKSHOP : CARVERS;
      if (Math.hypot(p.x - w.x, p.z - w.z) < 45) audio.play('swt_carve', { position: V(w.x, FLOOR + 1, w.z), volume: 0.8 });
    }
    // Festival nights: one slow drum beat for the meditation, like a heartbeat under the lights.
    if (this.festival && dPlaza < 160 && (hour >= 19 || hour < 1)) {
      s.drum -= dt;
      if (s.drum <= 0) {
        s.drum = 2.4;
        s.drumStep++;
        audio.play('swt_drum', { position: V(GREAT.x, FLOOR + 1, GREAT.z - GREAT.r - 1), volume: s.drumStep % 4 === 0 ? 0.6 : 0.42 });
      }
    }
  }

  private quiet(): void {
    this.loops.murmur?.stop(0.5);
    this.loops.hearth?.stop(0.5);
    this.loops.shore?.stop(0.5);
    this.loops = { murmur: null, hearth: null, shore: null };
    this.loopGen = -1;
  }

  protected override offSession(_ctx: GameContext): void {
    this.quiet();
    this.stopRaidFx();
    this.stopSpirits();
  }

  /** Debug / tests: crowd, animals and boats counts and the area's state. */
  debugState(): Record<string, unknown> {
    return {
      life: this.life?.counts() ?? null,
      wild: this.wild?.counts() ?? null,
      festival: this.festival,
      raided: this.raided,
      aurora: +(this.aurora?.intensity ?? 0).toFixed(2),
      lod: this.lod,
    };
  }

  override dispose(ctx: GameContext): void {
    if (this.interiorLight) {
      this.interiorLight.removeFromParent();
      this.interiorLight.dispose();
      this.interiorLight = null;
    }
    this.quiet();
    this.stopRaidFx();
    this.stopSpirits();
    this.overlay?.dispose();
    this.overlay = null;
    this.life?.dispose();
    this.life = null;
    this.wild?.dispose();
    this.wild = null;
    this.aurora?.dispose();
    this.aurora = null;
    this.raid?.dispose();
    this.raid = null;
    if (current === this) current = null;
    super.dispose(ctx);
  }
}

let current: WolfCove | null = null;

/** `__game.debug.swt`: the area's live state, and festival / raid switches (null = automatic). */
function installSwtDebug(): void {
  const g = typeof window !== 'undefined' ? (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game : undefined;
  if (!g?.debug || g.debug.swt) return;
  g.debug.swt = {
    state: () => current?.debugState() ?? null,
    festival: (on: boolean | null) => {
      if (current) current.festivalMode = on;
      return current?.festivalMode ?? null;
    },
    raid: (on: boolean | null) => {
      if (current) current.raidMode = on;
      return current?.raidMode ?? null;
    },
    stairs: () => current?.life?.stairs() ?? null,
    crowd: () => current?.life?.debugCrowd() ?? null,
    find: (kind: 'carrier' | 'waver' | 'form' | 'talk' | 'work', x: number, z: number) => current?.life?.debugFind(kind, x, z) ?? null,
    places: () => (current?.life ? { stairs: current.life.stairs(), tents: current.life.tentClusters() } : null),
  };
}

export function createSouthernWaterTribe(): WolfCove {
  return new WolfCove();
}

void wtMat;
