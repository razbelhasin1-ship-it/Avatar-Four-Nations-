import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { AirRegion } from './AirRegion';
import { BASE, C, LEVEL_Y, SANCTUARY, place, polar, sanctuaryFace, shelf } from './sat/layout';
import { SITES, buildBisonTerrace, buildCourts, buildGatePlaza, buildHalls, buildOrchards, buildQuarters, buildSummit, meditationSpots } from './sat/levels';
import { buildMist } from './sat/mist';
import { buildRoad, buildEdges, roadInlayMaterial } from './sat/road';
import { buildTerraces, floorY, pinnacleGeometry, rockMaterial } from './sat/rock';
import './sat/audio';
import type { LoopHandle } from '../../../audio/AudioEngine';
import { Herd } from './sat/herd';
import { Lemurs } from './sat/lemurs';
import { Monks } from './sat/monks';
import { SatOverlay } from './sat/overlay';
import { Sanctuary, buildSanctuaryShell, sanctuaryMaterial } from './sat/sanctuary';
import { buildSpireRing } from './sat/spires';
import type { P2 } from './parts';

/**
 * The Southern Air Temple: a thriving monastery on one rock pinnacle above a
 * sea of cloud (master plan and every tunable constant in sat/layout.ts).
 * The pinnacle stands on the flat top of the temple mesa (L0); terraces L1–L6
 * stack up it, joined by one white switchback road; a ring of taller misty
 * spires stands round it. What stands on each level: sat/levels.ts; the Avatar
 * sanctuary under the summit: sat/sanctuary.ts.
 */
export class SouthernAirTemple extends AirRegion {
  readonly id = 'air_temple_summit';
  readonly center = C;
  readonly loadRadius = 900;

  /** One district for the temple itself (seen as a whole, merged per material); the spires apart. */
  protected override districtFor(name: string): string {
    return name === 'spires' ? 'spires' : 'temple';
  }

  protected parts(_ctx: GameContext): Array<[string, () => void]> {
    const k = (name: string) => this.zone(name, C, 110);
    return [
      ['pinnacle', () => this.buildPinnacle()],
      ['terraces', () => buildTerraces(k('terraces'), this.rock!)],
      ['road', () => buildRoad(k('road'), this.ownMaterial(roadInlayMaterial()))],
      ['edges', () => buildEdges(k('edges'))],
      ['gate', () => buildGatePlaza(k('gate'), this.rock!)],
      ['bison', () => buildBisonTerrace(k('bison'))],
      ['orchards', () => buildOrchards(k('orchards'))],
      ['quarters', () => buildQuarters(k('quarters'))],
      ['courts', () => buildCourts(k('courts'))],
      ['halls', () => buildHalls(k('halls'))],
      ['summit', () => buildSummit(k('summit'))],
      ['sanctuary', () => this.buildSanctuary()],
      ['herd', () => this.buildLife()],
      ['spires', () => buildSpireRing(this.zone('spires', C, 700, { far: true }))],
      ['mist', () => this.buildMistSheets()],
    ];
  }

  private rock: THREE.Material | null = null;
  /** The Avatar sanctuary (door, glow, the chamber built on approach); tests reach it through debug.air.region(). */
  sanctuary: Sanctuary | null = null;
  /** Sky bison and winged lemurs (tests reach them through debug.air.region()). */
  herd: Herd | null = null;
  lemurs: Lemurs | null = null;
  monks: Monks | null = null;
  /** F3 debug overlay (frame rate, draw calls, agents). */
  overlay: SatOverlay | null = null;
  private fps = 60;
  private session: GameContext | null = null;
  private loops: { wind: LoopHandle | null; hum: LoopHandle | null; chant: LoopHandle | null } = { wind: null, hum: null, chant: null };

  private buildPinnacle(): void {
    const k = this.zone('pinnacle', C, 110);
    this.rock = this.ownMaterial(rockMaterial());
    const g = pinnacleGeometry();
    k.main.mesh(this.rock, g, { x: C.x, y: 0, z: C.z });
    g.dispose();
  }

  private buildSanctuary(): void {
    const mat = this.ownMaterial(sanctuaryMaterial());
    const shell = buildSanctuaryShell(this.zone('sanctuary', C, 110), mat);
    this.sanctuary = new Sanctuary(this.group, mat, shell);
    if (this.session) this.sanctuary.sessionStart(this.session);
  }

  private buildLife(): void {
    const preset = this.ctx.settings.data.graphics.preset;
    const q = preset === 'low' ? 'low' : preset === 'medium' ? 'medium' : 'high';
    this.herd = new Herd(this.ctx, q);
    this.group.add(this.herd.group);
    this.lemurs = new Lemurs(q);
    this.group.add(this.lemurs.group);
    this.monks = new Monks(this.group, this.ctx, q, this.herd.restingPlaces());
    this.overlay?.dispose();
    this.overlay = new SatOverlay(
      () => this.overlayLines(),
      () => {
        const p = this.ctx.player?.root.position;
        return !!p && Math.hypot(p.x - C.x, p.z - C.z) < 650;
      },
    );
    if (this.session) {
      this.herd.sessionStart(this.session);
      this.monks.sessionStart(this.session);
    }
  }

  private buildMistSheets(): void {
    const low = this.ctx.settings.data.graphics.effectsQuality === 'low';
    const holder = new THREE.Group();
    holder.name = 'sat_mist';
    const { materials } = buildMist(holder, low ? 2 : 4);
    for (const m of materials) this.ownMaterial(m);
    this.own(holder);
  }

  protected override animate(dt: number, ctx: GameContext): void {
    this.sanctuary?.update(dt, ctx);
    this.herd?.update(dt, ctx);
    this.lemurs?.update(dt);
    this.monks?.update(dt, ctx);
    this.soundscape(ctx);
    if (dt > 0) this.fps += (1 / dt - this.fps) * Math.min(1, dt * 2);
    this.overlay?.update(dt);
  }

  private overlayLines(): string[] {
    const info = this.ctx.render.renderer.info.render;
    const m = this.monks?.stats, h = this.herd?.state, s = this.sanctuary?.state;
    return [
      'Southern Air Temple',
      `fps ${this.fps.toFixed(0)}  draw calls ${info.calls}  triangles ${(info.triangles / 1000).toFixed(0)}k`,
      m ? `monks ${m.total}: visible ${m.visible}, walking ${m.walking}, at work ${m.acting}, indoors ${m.inside}, gliding ${m.gliding}` : 'monks —',
      h ? `sky bison ${h.total} (${h.calves} calves): flying ${h.flying}, grounded ${h.grounded}, near LOD ${h.near}, riders ${h.riders}` : 'sky bison —',
      `lemurs ${this.lemurs?.count ?? 0} (perched ${this.lemurs?.perched ?? 0})`,
      s ? `sanctuary: door ${s.open >= 1 ? 'open' : 'shut'}, chamber ${s.built ? 'built' : 'not built'}, eyes ${s.glow.toFixed(2)}` : 'sanctuary —',
      `hour ${this.ctx.world.sky.timeOfDay.toFixed(2)}`,
    ];
  }

  /** Wind stronger the higher you climb, the sanctuary's hum inside it, the monks' chant at dusk and dawn. */
  private soundscape(ctx: GameContext): void {
    const pl = ctx.player;
    if (!pl || !this.session) return;
    if (!this.loops.wind && ctx.audio.ready) {
      // Started once the audio is unlocked (a session can begin before the first gesture).
      const med = meditationSpots()[1];
      this.loops = {
        wind: ctx.audio.loop('sat_wind', { volume: 0 }),
        hum: ctx.audio.loop('sat_sanctuary', { volume: 0 }),
        chant: med ? ctx.audio.loop('sat_chant', { volume: 0, position: new THREE.Vector3(med.x, med.y + 1, med.z), range: 110 }) : null,
      };
    }
    const p = pl.root.position;
    const d = Math.hypot(p.x - C.x, p.z - C.z);
    const inside = d < SANCTUARY.r + 0.5 && p.y < BASE + SANCTUARY.ceil && p.y > BASE + SANCTUARY.floor - 1;
    const tunnel = !inside && this.sanctuary?.state.open === 1 && d < sanctuaryFace() + 3 && Math.abs(p.y - (BASE + 66)) < 6 && Math.abs(((Math.atan2(p.z - C.z, p.x - C.x) * 180) / Math.PI + 360 - SANCTUARY.th + 540) % 360 - 180) < 12;
    const near = Math.max(0, Math.min(1, (420 - d) / 200));
    // The world's ambience already carries a base wind: this one adds the high whistle as you climb.
    const height = Math.max(0, Math.min(1, (p.y - BASE - 10) / 110));
    this.loops.wind?.setVolume(inside ? 0.03 : tunnel ? 0.12 : near * height * 0.5);
    this.loops.hum?.setVolume(inside ? 0.9 : tunnel ? 0.35 : 0);
    const chanters = this.monks?.chanting ?? 0;
    this.loops.chant?.setVolume(Math.min(1, chanters / 10) * 0.9);
  }

  // ---------------------------------------------------------------------------
  // Session content: interactions with real effects
  // ---------------------------------------------------------------------------

  private unregister: Array<() => void> = [];
  private cooldowns = new Map<string, number>();

  protected override sessionStart(ctx: GameContext): void {
    this.sessionEnd(ctx);
    this.session = ctx;
    this.sanctuary?.sessionStart(ctx);
    this.herd?.sessionStart(ctx);
    this.monks?.sessionStart(ctx);

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
    const gong = polar(SITES.gong.th, SITES.gong.r);
    const gy = floorY(LEVEL_Y[4]);
    reg('air_gong', gong, gy + 1.4, 2.8, 'Strike the temple gong', 4, () => {
      ctx.audio.play('amb.bell', { position: { x: gong.x, y: gy + 1.8, z: gong.z }, volume: 1, range: 220 });
      ctx.events.emit('ui:notify', { text: "The gong's note rolls out over the sea of clouds.", kind: 'info', duration: 3 });
    });
    const bell = place('bellPavilion');
    reg('air_great_bell', bell, bell.y + 1.2, 3.4, 'Ring the great bell', 6, () => {
      ctx.audio.play('amb.bell', { position: { x: bell.x, y: bell.y + 3, z: bell.z }, volume: 1, range: 260 });
      ctx.events.emit('ui:notify', { text: 'The great bell sounds across the pinnacle. Somewhere below, a sky bison answers.', kind: 'info', duration: 3 });
    });
    const wheels = polar(SITES.wheels.th, SITES.wheels.r + 0.9);
    reg('air_prayer_wheels', wheels, gy + 1, 3.4, 'Spin the prayer wheels', 60, () => {
      ctx.audio.play('amb.chime', { position: { x: wheels.x, y: gy + 1.2, z: wheels.z } });
      ctx.player?.addStatus('regen', 20, 1);
      ctx.events.emit('ui:notify', { text: 'The prayer wheels whirl — a gentle warmth mends your wounds.', kind: 'success', duration: 4 });
    });
    // Whistle at a landing ledge: your own bison if you have one, else a temple bison glides down.
    for (const [i, id] of (['landing_main', 'landing_ne'] as const).entries()) {
      const s = shelf(id);
      const w = polar(s.a, s.r0 + 2.5);
      reg(`air_whistle_${i}`, w, place('arrival').y + 1, 3.6, 'Whistle for a sky bison', 8, () => this.whistle(ctx, i));
      const ride = polar(s.a, (s.r0 + s.r1) / 2);
      this.unregister.push(
        ctx.interactions.register({
          id: `air_bison_ride_${i}`,
          position: new THREE.Vector3(ride.x, place('arrival').y + 1.5, ride.z),
          radius: 6.5,
          label: 'Fly with the temple bison (travel)',
          enabled: () => !!this.herd?.waitingAt(i),
          interact: () => {
            const b = this.herd?.waitingAt(i);
            if (b) this.herd!.release(b);
            ctx.events.emit('ui:notify', { text: 'The herders help you up. Choose where the bison should carry you.', kind: 'info', duration: 3 });
            ctx.ui.open('map');
          },
        }),
      );
    }
    for (const [i, m] of meditationSpots().entries()) {
      reg(`air_meditate_${i + 1}`, m, m.y + 0.2, 2.8, 'Meditate above the clouds', 30, () => {
        const pl = ctx.player;
        if (pl) pl.chi = pl.maxChi;
        ctx.audio.play('amb.chime', { position: { x: m.x, y: m.y + 0.4, z: m.z } });
        ctx.events.emit('ui:notify', { text: 'You breathe with the wind. Chi fully restored.', kind: 'success', duration: 3 });
      });
    }
  }

  protected override sessionEnd(_ctx: GameContext): void {
    for (const u of this.unregister) u();
    this.unregister = [];
    this.cooldowns.clear();
    this.sanctuary?.sessionEnd();
    this.herd?.sessionEnd();
    this.monks?.sessionEnd();
    for (const l of Object.values(this.loops)) l?.stop(0.5);
    this.loops = { wind: null, hum: null, chant: null };
    this.session = null;
  }

  /** Whistle at landing ledge i (0 main, 1 north-east). */
  whistle(ctx: GameContext, i: number): void {
    const own = ctx.companions.bonded.find((r) => r.speciesId === 'sky_bison');
    if (own) {
      ctx.companions.summon(own.id);
      return;
    }
    const b = this.herd?.call(i) ?? null;
    if (b) {
      ctx.audio.play('creature.skybison.groan', { position: b.pos, volume: 1, range: 500 });
      ctx.events.emit('ui:notify', { text: 'You whistle. A temple bison peels away from the herd and glides down to the ledge.', kind: 'info', duration: 3.5 });
    } else ctx.events.emit('ui:notify', { text: 'You whistle, but every bison nearby is busy. Try again in a moment.', kind: 'info', duration: 3 });
  }

  override dispose(ctx: GameContext): void {
    this.sanctuary?.dispose();
    this.sanctuary = null;
    this.herd?.dispose();
    this.herd = null;
    this.lemurs?.dispose();
    this.lemurs = null;
    this.monks?.dispose();
    this.monks = null;
    this.overlay?.dispose();
    this.overlay = null;
    super.dispose(ctx);
  }

  /** Height of the floor the temple offers at the base of the mesa (tests). */
  static readonly BASE_Y = BASE;
}
