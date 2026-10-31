import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { AirRegion } from './AirRegion';
import { BASE, C, LEVEL_Y, polar } from './sat/layout';
import { buildMist } from './sat/mist';
import { buildRoad, buildEdges, roadInlayMaterial } from './sat/road';
import { buildTerraces, floorY, pinnacleGeometry, rockMaterial } from './sat/rock';
import { buildSpireRing } from './sat/spires';
import type { P2 } from './parts';

/**
 * The Southern Air Temple: a thriving monastery on one rock pinnacle above a
 * sea of cloud (master plan and every tunable constant in sat/layout.ts).
 * The pinnacle stands on the flat top of the temple mesa (L0); terraces L1–L6
 * stack up it, joined by one white switchback road; a ring of taller misty
 * spires stands round it.
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
    return [
      ['pinnacle', () => this.buildPinnacle()],
      ['terraces', () => buildTerraces(this.zone('terraces', C, 110), this.rock!)],
      ['road', () => buildRoad(this.zone('road', C, 110), this.ownMaterial(roadInlayMaterial()))],
      ['edges', () => buildEdges(this.zone('edges', C, 110))],
      ['spires', () => buildSpireRing(this.zone('spires', C, 700, { far: true }))],
      ['mist', () => this.buildMistSheets()],
    ];
  }

  private rock: THREE.Material | null = null;

  private buildPinnacle(): void {
    const k = this.zone('pinnacle', C, 110);
    this.rock = this.ownMaterial(rockMaterial());
    const g = pinnacleGeometry();
    k.main.mesh(this.rock, g, { x: C.x, y: 0, z: C.z });
    g.dispose();
  }

  private buildMistSheets(): void {
    const low = this.ctx.settings.data.graphics.effectsQuality === 'low';
    const holder = new THREE.Group();
    holder.name = 'sat_mist';
    const { materials } = buildMist(holder, low ? 2 : 4);
    for (const m of materials) this.ownMaterial(m);
    this.own(holder);
  }

  // ---------------------------------------------------------------------------
  // Session content: interactions with real effects
  // ---------------------------------------------------------------------------

  private unregister: Array<() => void> = [];
  private cooldowns = new Map<string, number>();

  protected override sessionStart(ctx: GameContext): void {
    this.sessionEnd(ctx);
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
    const gong = polar(200, 50);
    const gy = floorY(LEVEL_Y[4]);
    reg('air_gong', gong, gy + 1.4, 2.6, 'Strike the temple gong', 4, () => {
      ctx.audio.play('amb.bell', { position: { x: gong.x, y: gy + 1.8, z: gong.z }, volume: 1, range: 220 });
      ctx.events.emit('ui:notify', { text: "The gong's note rolls out over the sea of clouds.", kind: 'info', duration: 3 });
    });
    const bell = polar(20, 38);
    const by = floorY(LEVEL_Y[5]);
    reg('air_great_bell', bell, by + 1.2, 3.0, 'Ring the great bell', 6, () => {
      ctx.audio.play('amb.bell', { position: { x: bell.x, y: by + 2.5, z: bell.z }, volume: 1, range: 260 });
      ctx.events.emit('ui:notify', { text: 'The great bell sounds across the pinnacle. Somewhere below, a sky bison answers.', kind: 'info', duration: 3 });
    });
    const wheels = polar(236, 54);
    reg('air_prayer_wheels', wheels, gy + 1, 3.2, 'Spin the prayer wheels', 60, () => {
      ctx.audio.play('amb.chime', { position: { x: wheels.x, y: gy + 1.2, z: wheels.z } });
      ctx.player?.addStatus('regen', 20, 1);
      ctx.events.emit('ui:notify', { text: 'The prayer wheels whirl — a gentle warmth mends your wounds.', kind: 'success', duration: 4 });
    });
    for (const [i, a] of [356, 14, 32].entries()) {
      const p = polar(a, 47);
      reg(`air_meditate_${i + 1}`, p, by + 0.8, 2.6, 'Meditate above the clouds', 30, () => {
        const pl = ctx.player;
        if (pl) pl.chi = pl.maxChi;
        ctx.audio.play('amb.chime', { position: { x: p.x, y: by + 1, z: p.z } });
        ctx.events.emit('ui:notify', { text: 'You breathe with the wind. Chi fully restored.', kind: 'success', duration: 3 });
      });
    }
  }

  protected override sessionEnd(_ctx: GameContext): void {
    for (const u of this.unregister) u();
    this.unregister = [];
    this.cooldowns.clear();
  }

  /** Height of the floor the temple offers at the base of the mesa (tests). */
  static readonly BASE_Y = BASE;
}
