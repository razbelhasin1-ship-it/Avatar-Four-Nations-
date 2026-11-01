import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import type { Persistable } from '../core/Save';
import {
  ALLOW_ONWARD_TRAVEL,
  KYOSHI_ARRIVALS,
  KYOSHI_STAFF,
  ROUTES,
  routeById,
  TRAVEL_POINTS,
  TRAVEL_REQUIRES_UNLOCK,
  type CityId,
  type Placement,
  type RouteDef,
  type Transport,
} from '../data/travel';
import type { EnvironmentSystem } from '../world/env/EnvironmentSystem';
import { KYOSHI_ZONE, offMainland, zoneAt } from '../world/Zones';
import { WORLD_HALF } from '../world/WorldLayout';
import { Journey } from './Journey';

/** Where a route ends: a placement plus the arrival card. */
export interface Destination extends Placement {
  title: string;
  subtitle: string;
}

const CITY_TITLES: Record<CityId, { title: string; subtitle: string }> = {
  nwt: { title: 'Northern Water Tribe', subtitle: 'Harbor Quays' },
  fnc: { title: 'Fire Nation Capital', subtitle: 'First Lord’s Harbor' },
  bss: { title: 'Ba Sing Se', subtitle: 'Outer Wall Station' },
  sat: { title: 'Southern Air Temple', subtitle: 'The bison terrace' },
};

/** How far past the mainland's edge the open sea lets you go before the currents turn you back. */
const MAINLAND_MARGIN = 170;

/**
 * Travel between the four cities and Kyoshi Island (its own map; src/data/travel.ts).
 *
 *  - Staff at each city travel point (and the island's harbormaster / bison keeper) open the travel
 *    dialog; the point's sign is a trigger too (src/travel/points.ts registers them).
 *  - travel(route): guards → journey (src/travel/Journey.ts: departure, cruise while the destination
 *    streams in, arrival) → placement, a few minutes on the shared clock, the arrival card.
 *  - Remembers the origin city and transport (saveKey `travel`); returning puts you back at that
 *    city's travel point with its weather as you left it.
 *  - Open sea between the maps: currents and winds turn swimmers and riders back.
 *  - `__game.debug.travel`: status, routes, go(routeId), toIsland(), back(), roundTrips(n).
 */
export class TravelSystem implements GameSystem, Persistable {
  readonly saveKey = 'travel';
  origin: CityId | null = null;
  transport: Transport | null = null;
  trips = 0;
  /** A journey is running. */
  busy = false;
  /** Last travel failure (tests / debug). */
  lastError: string | null = null;
  private ctx!: GameContext;
  private readonly journey = new Journey();
  private weatherBefore: string | null = null;
  private boundaryCooldown = 0;
  private readonly tmp = new THREE.Vector3();

  init(ctx: GameContext): void {
    this.ctx = ctx;
    for (const p of Object.values(TRAVEL_POINTS)) ctx.npcs.onTalk(p.staff.id, () => this.offerFromCity(p.id, true));
    ctx.npcs.onTalk(KYOSHI_STAFF.harbormaster.id, () => this.offerFromIsland('harbor', true));
    ctx.npcs.onTalk(KYOSHI_STAFF.keeper.id, () => this.offerFromIsland('meadow', true));
  }

  onSessionStart(): void {
    // `__game` exists once the Game is constructed (after module init).
    this.installDebug();
  }

  // ---------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------

  /** Why travelling is not possible right now, or null. */
  blockReason(): string | null {
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p || !ctx.session.active) return 'No traveller.';
    if (this.busy) return 'You are already travelling.';
    if (ctx.session.kind === 'tutorial') return 'Not while training on Meditation Isle.';
    if (p.defeated) return 'You cannot travel while defeated.';
    if (ctx.cameraRig.isScripted) return 'Not now.';
    if (ctx.entities.queryRadius(p.position, 35, { teams: ['hostile'], aliveOnly: true }).length > 0) return 'You cannot travel while enemies are near.';
    const training = ctx.extra.get('training') as { run?: unknown } | undefined;
    if (training?.run) return 'Finish your lesson first.';
    return null;
  }

  private routeOpen(r: RouteDef): boolean {
    if (!TRAVEL_REQUIRES_UNLOCK) return true;
    const city = r.from === 'kyoshi_island' ? r.to : r.from;
    return this.ctx.quests.hasFlag(`travel_unlocked_${city}`);
  }

  /** Staff or sign at a city travel point: "Travel to Kyoshi Island?" */
  offerFromCity(city: CityId, fromNpc = false): void {
    const ctx = this.ctx;
    const pt = TRAVEL_POINTS[city];
    const route = ROUTES.find((r) => r.from === city && r.to === 'kyoshi_island');
    const end = () => {
      ctx.ui.hideDialogue();
      if (fromNpc) ctx.npcs.endConversation();
    };
    const block = this.blockReason();
    if (!route || block || !this.routeOpen(route)) {
      if (fromNpc) end();
      ctx.ui.notify(block ?? 'This passage is not open to you yet.', 'warning');
      return;
    }
    ctx.ui.showDialogue({
      speaker: fromNpc ? pt.staff.name : pt.staff.title,
      text: `Travel to Kyoshi Island? ${pt.blurb} No cost.`,
      choices: [
        { text: 'Travel', onSelect: () => (end(), void this.travel(route)) },
        { text: 'Not now', onSelect: end },
      ],
    });
  }

  /** The island's harbormaster (ships, ferry) or bison keeper: "Return to <origin>". */
  offerFromIsland(post: 'harbor' | 'meadow', fromNpc = false): void {
    const ctx = this.ctx;
    const staff = post === 'harbor' ? KYOSHI_STAFF.harbormaster : KYOSHI_STAFF.keeper;
    const end = () => {
      ctx.ui.hideDialogue();
      if (fromNpc) ctx.npcs.endConversation();
    };
    const block = this.blockReason();
    if (block) {
      if (fromNpc) end();
      ctx.ui.notify(block, 'warning');
      return;
    }
    const mine = ROUTES.filter((r) => r.from === 'kyoshi_island' && staff.transports.includes(r.transport) && this.routeOpen(r));
    const home = mine.find((r) => r.to === this.origin);
    // Your way home first; the other cities only with onward travel (or when the island is all you know).
    const offer = home ? [home] : [];
    if (ALLOW_ONWARD_TRAVEL || !this.origin) for (const r of mine) if (!offer.includes(r)) offer.push(r);
    if (!offer.length) {
      const other = post === 'harbor' ? 'the bison keeper on the meadow above the bay' : 'the harbormaster at Koi Harbor';
      ctx.ui.showDialogue({
        speaker: staff.name,
        text: `You came on another road — ${other} will see you home.`,
        choices: [{ text: 'Thank you', onSelect: end }],
      });
      return;
    }
    ctx.ui.showDialogue({
      speaker: staff.name,
      text: post === 'harbor' ? 'The tide is with us. Where shall we take you? No cost to friends of the island.' : 'Ready when you are. The bison knows the way. No cost.',
      choices: [
        ...offer.map((r) => ({ text: `${r === home ? 'Return to' : 'Travel to'} ${TRAVEL_POINTS[r.to as CityId].city}`, onSelect: () => (end(), void this.travel(r)) })),
        { text: 'Not now', onSelect: end },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // Journey
  // ---------------------------------------------------------------------------

  destinationOf(route: RouteDef): Destination {
    if (route.to === 'kyoshi_island') {
      const a = KYOSHI_ARRIVALS[route.arrival as 'ki_pier' | 'ki_meadow'];
      return { ...a };
    }
    const city = route.to as CityId;
    return { ...TRAVEL_POINTS[city].stand, ...CITY_TITLES[city] };
  }

  /**
   * Run a route: journey, placement, clock, arrival card. Resolves true on arrival; on failure the
   * traveller stays (or is put back) where they were and an error is shown.
   */
  async travel(route: RouteDef, opts: { instant?: boolean } = {}): Promise<boolean> {
    const ctx = this.ctx;
    const p = ctx.player;
    const block = this.blockReason();
    if (!p || block) {
      if (block) ctx.ui.notify(block, 'warning');
      return false;
    }
    this.busy = true;
    this.lastError = null;
    const toIsland = route.to === 'kyoshi_island';
    const dest = this.destinationOf(route);
    const from = p.position.clone();
    const fromYaw = p.yaw;
    const env = ctx.extra.get('environment') as EnvironmentSystem | undefined;
    if (toIsland) this.weatherBefore = env?.weather.state().weather ?? null;
    ctx.ui.closeAll();
    if (ctx.companions.mounted) ctx.companions.dismount();
    p.controlLock = 1e6;
    ctx.events.emit('travel:started', { route: route.id, from: route.from, to: route.to, transport: route.transport });
    let ok = false;
    try {
      await this.journey.run(ctx, route, dest, opts.instant === true, async () => {
        // Stand at the destination so the world streams around it, then wait for it to be there.
        this.place(dest);
        await ctx.world.preload(this.tmp.set(dest.x, 0, dest.z));
        if (toIsland) this.checkIsland();
        this.place(dest);
      });
      ok = true;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      console.error('[Travel] journey failed', err);
      // Stay put: back to where the journey started, streamed in again.
      try {
        p.teleport(from, fromYaw);
        await ctx.world.preload(from);
        p.teleport(from, fromYaw);
      } catch (e) {
        console.error('[Travel] could not restore the origin', e);
      }
      ctx.ui.notify('The journey could not set out. You stay where you are.', 'error', 5);
    } finally {
      p.controlLock = 0;
      this.busy = false;
    }
    if (!ok) {
      ctx.events.emit('travel:failed', { route: route.id, error: this.lastError ?? '' });
      return false;
    }
    // The shared clock moves on a few minutes.
    const sky = ctx.world.sky;
    sky.timeOfDay = (sky.timeOfDay + route.minutes / 60) % 24;
    if (toIsland) {
      this.origin = route.from as CityId;
      this.transport = route.transport;
    } else {
      // Home again: the city's weather as you left it.
      if (this.weatherBefore && env) env.weather.resume(this.weatherBefore as Parameters<typeof env.weather.resume>[0]);
      this.weatherBefore = null;
      this.origin = null;
      this.transport = null;
    }
    this.trips++;
    ctx.ui.showBanner(dest.title, dest.subtitle);
    ctx.events.emit('travel:arrived', { route: route.id, to: route.to });
    ctx.game.requestAutosave(true);
    return true;
  }

  private place(d: Placement): void {
    const ctx = this.ctx;
    const g = ctx.world.groundAt(d.x, d.z, d.y !== undefined ? d.y + 1.5 : Infinity);
    ctx.player?.teleport(this.tmp.set(d.x, g.y + 0.05, d.z), d.yaw);
    ctx.cameraRig.snapBehind();
  }

  /** The island must really be there before anyone steps off the boat. */
  private checkIsland(): void {
    const r = this.ctx.world.getRegionContent('kyoshi_isle') as { ready?: boolean } | undefined;
    if (!r?.ready) throw new Error('Kyoshi Island did not load');
  }

  // ---------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------

  update(dt: number, ctx: GameContext): void {
    this.journey.update(dt, ctx);
    this.boundary(dt);
  }

  /**
   * Open sea between the maps: past the mainland's edge, or far out from a zone's island, currents
   * and winds turn the traveller (and a ridden mount) back. Nothing to see out there anyway.
   */
  private boundary(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    this.boundaryCooldown = Math.max(0, this.boundaryCooldown - dt);
    if (!p || this.busy || ctx.session.kind !== 'campaign') return;
    const pos = p.position;
    const zone = zoneAt(pos.x, pos.z);
    let push: { x: number; z: number } | null = null;
    let msg = '';
    if (zone) {
      const dx = pos.x - zone.cx, dz = pos.z - zone.cz;
      const d = Math.hypot(dx, dz);
      if (d > zone.seaLimit) {
        push = { x: zone.cx + (dx / d) * (zone.seaLimit - 6), z: zone.cz + (dz / d) * (zone.seaLimit - 6) };
        msg = `Strong currents carry you back toward ${zone.name}.`;
      }
    } else if (offMainland(pos.x, pos.z)) {
      const lim = WORLD_HALF + MAINLAND_MARGIN;
      if (Math.abs(pos.x) > lim || Math.abs(pos.z) > lim) {
        const c = lim - 6;
        push = { x: Math.max(-c, Math.min(c, pos.x)), z: Math.max(-c, Math.min(c, pos.z)) };
        msg = 'The open sea grows wild. Currents and winds turn you back toward the coast.';
      }
    }
    if (!push) return;
    const mount = (ctx.companions as unknown as { riding?: { mount?: { root: THREE.Object3D } | null } }).riding?.mount;
    if (mount) {
      mount.root.position.x = push.x;
      mount.root.position.z = push.z;
    }
    p.teleport(this.tmp.set(push.x, pos.y, push.z), p.yaw);
    if (this.boundaryCooldown <= 0) {
      this.boundaryCooldown = 6;
      ctx.ui.notify(msg, 'info', 4);
    }
  }

  onSessionEnd(): void {
    this.journey.cancel(this.ctx);
    this.busy = false;
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  serialize(): unknown {
    return { v: 1, origin: this.origin, transport: this.transport, trips: this.trips };
  }

  deserialize(data: unknown): void {
    const d = data as { origin?: unknown; transport?: unknown; trips?: unknown } | undefined;
    if (!d || typeof d !== 'object') return;
    this.origin = typeof d.origin === 'string' && d.origin in TRAVEL_POINTS ? (d.origin as CityId) : null;
    this.transport = d.transport === 'ship' || d.transport === 'bison' || d.transport === 'rail_ferry' ? d.transport : null;
    this.trips = typeof d.trips === 'number' && Number.isFinite(d.trips) ? Math.max(0, Math.floor(d.trips)) : 0;
  }

  reset(): void {
    this.origin = null;
    this.transport = null;
    this.trips = 0;
    this.weatherBefore = null;
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    const g = (globalThis as { __game?: { debug?: Record<string, unknown> } }).__game;
    if (!g?.debug || g.debug.travel) return;
    g.debug.travel = {
      status: () => ({ origin: this.origin, transport: this.transport, trips: this.trips, busy: this.busy, lastError: this.lastError, onIsland: !!zoneAt(this.ctx.player?.position.x ?? 0, this.ctx.player?.position.z ?? 0), journey: this.journey.state() }),
      routes: () => ROUTES.map((r) => r.id),
      points: () => TRAVEL_POINTS,
      block: () => this.blockReason(),
      go: (id: string, instant = true) => {
        const r = routeById(id);
        return r ? this.travel(r, { instant }) : Promise.resolve(false);
      },
      /** Teleport straight to Kyoshi Island (debug): the harbor pier or the meadow. */
      toIsland: async (where: 'ki_pier' | 'ki_meadow' = 'ki_pier') => {
        const d = KYOSHI_ARRIVALS[where];
        this.place(d);
        await this.ctx.world.preload(this.tmp.set(d.x, 0, d.z));
        this.place(d);
        return { x: d.x, z: d.z, zone: KYOSHI_ZONE.id };
      },
      back: (instant = true) => {
        const r = ROUTES.find((x) => x.from === 'kyoshi_island' && x.to === (this.origin ?? 'fnc'));
        return r ? this.travel(r, { instant }) : Promise.resolve(false);
      },
      offer: (where: CityId | 'harbor' | 'meadow') => (where === 'harbor' || where === 'meadow' ? this.offerFromIsland(where) : this.offerFromCity(where)),
      skip: () => this.journey.skip(),
    };
  }
}
