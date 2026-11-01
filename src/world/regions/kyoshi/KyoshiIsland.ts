import * as THREE from 'three';
import type { LoopHandle } from '../../../audio/AudioEngine';
import type { GameContext } from '../../../core/GameContext';
import { KYOSHI_ARRIVALS, KYOSHI_STAFF } from '../../../data/travel';
import { heightAt } from '../../Heightfield';
import { A, KI } from '../../landforms/kyoshiIsland';
import { EarthRegion } from '../earth/EarthRegion';
import { Pose } from '../earth/bssFigures';
import type { BuildEnv, InteractableSpec } from '../earth/env';
import './audio';
import { KyoshiLife } from './life';
import { BaySea } from './sea';
import { buildBay, type BayOut } from './bay';
import { buildDojo, type DojoOut } from './dojo';
import { buildHarbor, type HarborOut } from './harbor';
import { kyoshiLook } from './people';
import { buildShrine, type ShrineOut } from './shrine';
import './spots';
import { buildVillage, type VillageOut } from './village';

/**
 * Kyoshi Island (zone `kyoshi_island`, its own map): Suki's village, the Kyoshi Dojo and Shrine,
 * Koi Bay, Crystal Falls and the Crescent Bridge, Koi Harbor. Ground and layout come from
 * landforms/kyoshiIsland.ts; content is authored on the EarthRegion chunk framework (distance LOD,
 * time-sliced construction). The whole island is freed when the player travels away
 * (`unloadRadius`) and rebuilt on the next visit.
 */
export class KyoshiIsland extends EarthRegion {
  readonly id = 'kyoshi_isle';
  readonly center = KI.B;
  readonly loadRadius = 1000;
  readonly unloadRadius = 1800;
  protected readonly seed = KI.seed;
  protected override readonly cell = 96;
  private complete = false;
  /** Painted textures / materials owned by the island (fans, mural, swirl paving). */
  private owned: Array<THREE.Material | THREE.Texture> = [];
  /** Built outputs (crowd and life read them). */
  village: VillageOut | null = null;
  dojo: DojoOut | null = null;
  shrine: ShrineOut | null = null;
  harbor: HarborOut | null = null;
  bay: BayOut | null = null;
  /** The islanders (all in the Kyoshi Warrior outfit) and the bay's life. */
  life: KyoshiLife | null = null;
  sea: BaySea | null = null;
  private loops: { harbor: LoopHandle | null; market: LoopHandle | null } = { harbor: null, market: null };
  private loopGen = -1;
  private sfx = { bell: 12, hammer: 2, call: 8, drill: -1 };
  /** Where the harbor's and the market's sound beds are centred. */
  private readonly harborEar = A(0.82, 236);
  private readonly marketEar = A(KI.village.u, 292);

  /** Built and finished (travel waits for this before anyone steps ashore). */
  get ready(): boolean {
    return this.complete && !this.building;
  }

  protected *construct(env: BuildEnv): Generator<unknown, void, unknown> {
    this.anchors();
    yield;
    const v: VillageOut = { marks: {}, doors: [], stalls: [], kitchens: [], fields: [], wells: [], lanterns: [], owned: [] };
    yield* buildVillage(env, v);
    const d: DojoOut = { marks: {}, yard: { x: 0, y: 0, z: 0, yaw: 0, w: 0, d: 0 }, posts: [], owned: [] };
    yield* buildDojo(env, d);
    const s: ShrineOut = { marks: {}, owned: [], lanterns: [] };
    yield* buildShrine(env, s);
    const h: HarborOut = { marks: {}, piers: [], stalls: [], doors: [], lanterns: [] };
    yield* buildHarbor(env, h);
    const b: BayOut = { marks: {}, lanterns: [] };
    yield* buildBay(env, b);
    for (const out of [v, d, s, h, b]) for (const [k, m] of Object.entries(out.marks)) this.mark(k, m.x, m.y, m.z);
    for (const out of [v, d, s]) this.owned.push(...out.owned);
    this.village = v;
    this.dojo = d;
    this.shrine = s;
    this.harbor = h;
    this.bay = b;
    yield;
    // People and the bay's life.
    const ground = (x: number, z: number) => this.ctx.world.groundAt(x, z, heightAt(x, z) + 8).y;
    const density = this.ctx.settings.data.graphics.preset === 'low' ? 0.7 : 1;
    this.life?.dispose();
    this.life = new KyoshiLife(
      this.group,
      {
        doors: [...v.doors, ...h.doors.map((x) => ({ ...x, harbor: true }))],
        stalls: [...v.stalls, ...h.stalls.map((x) => ({ ...x, harbor: true }))],
        kitchens: v.kitchens,
        fields: v.fields,
        wells: v.wells,
        piers: h.piers,
        yard: d.yard,
        posts: d.posts,
        marks: this.marks,
        ground,
      },
      density,
    );
    this.sea?.dispose();
    this.sea = new BaySea(this.group, h.piers, v.doors.map((x) => ({ x: x.x, z: x.z })), ground);
    const life = this.life;
    const talk: InteractableSpec = {
      id: 'ki_talk',
      position: life.talkPos,
      radius: 3.2,
      get label() {
        const n = life.nearest;
        return n ? `Talk to ${n.name}` : 'Talk';
      },
      priority: 0,
      interact: (ctx: GameContext) => life.talk(ctx),
    };
    env.interactables.push(talk);
    this.staff();
    this.installDebug();
    this.complete = true;
  }

  override update(dt: number, ctx: GameContext): void {
    super.update(dt, ctx);
    const full = this.detailLevel === 'full' && !this.building;
    if (this.life) {
      this.life.group.visible = full;
      if (full) this.life.update(dt, ctx, ctx.camera);
    }
    if (this.sea) {
      const vis = this.detailLevel !== 'hidden';
      this.sea.group.visible = vis;
      if (vis) this.sea.update(dt, ctx, full);
    }
    if (full) this.sounds(dt, ctx);
    else this.quiet();
  }

  /** Harbor and market beds, the shrine bell, the dojo's shouts and fan snaps, mallets and calls. */
  private sounds(dt: number, ctx: GameContext): void {
    const p = ctx.player?.position;
    if (!p) return;
    const audio = ctx.audio;
    if (audio.ready && this.loopGen !== audio.generation) {
      this.quiet();
      this.loops.harbor = audio.loop('amb.harbor', { volume: 0 });
      this.loops.market = audio.loop('amb.market', { volume: 0 });
      this.loopGen = audio.generation;
    }
    const hour = ctx.world.sky.timeOfDay;
    const day = hour > 6 && hour < 20.5;
    const hc = this.harborEar, vc = this.marketEar;
    const dh = Math.hypot(p.x - hc.x, p.z - hc.z), dv = Math.hypot(p.x - vc.x, p.z - vc.z);
    const fall = (d: number, r: number) => Math.max(0, Math.min(1, 1 - d / r));
    this.loops.harbor?.setVolume(fall(dh, 150) * 0.9);
    this.loops.market?.setVolume(day ? fall(dv, 120) * 0.75 : 0);
    const s = this.sfx;
    s.bell -= dt;
    const sh = this.marks.shrine;
    if (s.bell <= 0) {
      s.bell = 45 + Math.random() * 50;
      if (sh && Math.hypot(p.x - sh.x, p.z - sh.z) < 240) audio.play('ki_bell', { position: new THREE.Vector3(sh.x, sh.y + 4, sh.z) });
    }
    const yard = this.dojo?.yard;
    if (this.life && yard && Math.hypot(p.x - yard.x, p.z - yard.z) < 120 && this.life.stats.drilling > 3) {
      const dp = this.life.drillPose();
      if (dp.pose !== s.drill) {
        s.drill = dp.pose;
        if (dp.pose !== Pose.idle) audio.play(dp.pose === Pose.raise ? 'ki_fan' : 'ki_shout', { position: new THREE.Vector3(yard.x, yard.y + 1.6, yard.z), volume: 0.9 });
      }
    }
    if (day && dh < 160) {
      s.hammer -= dt;
      if (s.hammer <= 0) {
        s.hammer = 0.6 + Math.random() * 3;
        const w = A(0.79 + Math.random() * 0.06, 250);
        audio.play('ki_hammer', { position: new THREE.Vector3(w.x, heightAt(w.x, w.z) + 1, w.z), volume: 0.7 });
      }
      s.call -= dt;
      if (s.call <= 0) {
        s.call = 14 + Math.random() * 22;
        const c = A(0.78 + Math.random() * 0.1, 175);
        audio.play('ki_call', { position: new THREE.Vector3(c.x, 2, c.z), volume: 0.8 });
      }
    }
  }

  private quiet(): void {
    this.loops.harbor?.stop(0.5);
    this.loops.market?.stop(0.5);
    this.loops = { harbor: null, market: null };
    this.loopGen = -1;
  }

  override onSessionEnd(ctx: GameContext): void {
    super.onSessionEnd(ctx);
    this.quiet();
  }

  /** The island's travel staff: the harbormaster at the passenger pier, the bison keeper on the meadow. */
  private staff(): void {
    const pier = KYOSHI_ARRIVALS.ki_pier, meadow = KYOSHI_ARRIVALS.ki_meadow;
    const hm = KYOSHI_STAFF.harbormaster, kp = KYOSHI_STAFF.keeper;
    const side = (p: { x: number; z: number; yaw: number }, dd: number) => ({ x: p.x + Math.cos(p.yaw) * dd, z: p.z - Math.sin(p.yaw) * dd });
    const a = side(pier, 3.2), b = side(meadow, -3.4);
    this.npc({ id: hm.id, name: hm.name, title: hm.title, role: 'merchant', nation: 'earth', appearance: kyoshiLook(4101), x: a.x, z: a.z, yaw: pier.yaw + Math.PI, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', region: 'kyoshi_isle', marker: 'none', schedule: 'always' });
    this.npc({ id: kp.id, name: kp.name, title: kp.title, role: 'villager', nation: 'earth', appearance: kyoshiLook(4102), x: b.x, z: b.z, yaw: meadow.yaw + Math.PI, behavior: { type: 'idle', variant: 'stand' }, dialogue: 'travel_staff', region: 'kyoshi_isle', marker: 'none', schedule: 'always' });
  }

  /** Named anchors (quest markers, tests, journeys). */
  private anchors(): void {
    const at = (id: string, u: number, r: number) => {
      const p = A(u, r);
      this.mark(id, p.x, heightAt(p.x, p.z), p.z);
    };
    at('village_entrance', KI.village.u, KI.village.gateR - 10);
    at('meeting_hall', KI.village.u, KI.village.hallR);
    at('dojo', KI.dojo.u, KI.dojo.r);
    at('shrine', KI.shrine.u, KI.shrine.r);
    at('bay_beach', 0.22, KI.Ri + 8);
    at('meadow', KI.meadow.u, KI.meadow.r);
    at('bridge', KI.falls.u, 268);
    at('harbor_pier', 0.82, KI.harbor.quayR);
    at('west_trail', 0.06, 306);
    at('east_headland', 0.965, 298);
  }

  override dispose(ctx: GameContext): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (g?.debug && (g.debug.kyoshi as { owner?: unknown } | undefined)?.owner === this) delete g.debug.kyoshi;
    this.quiet();
    this.life?.dispose();
    this.life = null;
    this.sea?.dispose();
    this.sea = null;
    super.dispose(ctx);
    for (const o of this.owned) o.dispose();
    this.owned = [];
    this.village = this.dojo = this.shrine = null;
    this.harbor = this.bay = null;
    // Rebuilt from scratch on the next visit.
    this.npcDefs.length = 0;
    this.complete = false;
  }

  /** `__game.debug.kyoshi`: anchors, stats and a teleport to them. */
  private installDebug(): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!g?.debug) return;
    g.debug.kyoshi = {
      owner: this,
      marks: () => this.marks,
      stats: () => this.stats(),
      life: () => this.life?.counts() ?? null,
      sea: () => this.sea?.counts() ?? null,
      unagi: () => this.sea?.summonUnagi(),
      go: (id: string) => {
        const m = this.marks[id];
        if (!m) return false;
        this.ctx.player?.teleport(new THREE.Vector3(m.x, this.ctx.world.groundAt(m.x, m.z, m.y + 30).y + 0.05, m.z));
        return true;
      },
    };
  }
}
