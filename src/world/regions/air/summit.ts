import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { AirRegion } from './AirRegion';
import { BASE, C, LEVEL_Y, place, polar } from './sat/layout';
import { SITES, buildBisonTerrace, buildCourts, buildGatePlaza, buildHalls, buildOrchards, buildQuarters, buildSummit, meditationSpots } from './sat/levels';
import { buildMist } from './sat/mist';
import { buildRoad, buildEdges, roadInlayMaterial } from './sat/road';
import { buildTerraces, floorY, pinnacleGeometry, rockMaterial } from './sat/rock';
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
      ['spires', () => buildSpireRing(this.zone('spires', C, 700, { far: true }))],
      ['mist', () => this.buildMistSheets()],
    ];
  }

  private rock: THREE.Material | null = null;
  /** The Avatar sanctuary (door, glow, the chamber built on approach); tests reach it through debug.air.region(). */
  sanctuary: Sanctuary | null = null;
  private session: GameContext | null = null;

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
    this.session = null;
  }

  override dispose(ctx: GameContext): void {
    this.sanctuary?.dispose();
    this.sanctuary = null;
    super.dispose(ctx);
  }

  /** Height of the floor the temple offers at the base of the mesa (tests). */
  static readonly BASE_Y = BASE;
}
