import * as THREE from 'three';
import { createModel, modelDetail } from '../companions/models';
import { defaultAnim, type CreatureModel } from '../companions/models/CreatureModel';
import type { GameContext } from '../core/GameContext';
import type { CityId, PlaceId, RouteDef } from '../data/travel';
import { kitMaterial } from '../world/kit/Materials';
import { atAxis } from '../world/landforms/fireCapital';
import { heightAt } from '../world/Heightfield';
import { A, atBearing, KI } from '../world/landforms/kyoshiIsland';
import { polar as satPolar, yawOut as satYawOut } from '../world/regions/air/sat/layout';
import { shipParts, type ShipStyle } from './kit';

/**
 * Journey cutscenes: four short shots (≈ 9 s, skippable) built from the game's own assets —
 *   1. departure at the origin (the real vehicle pulls away: ship, monorail train or sky bison),
 *   2. the open sea / the clouds / the coast while the destination streams in,
 *   3. an aerial reveal of the crescent island (or of the home city on the way back),
 *   4. arrival at Koi Harbor's passenger pier / the meadow above Koi Bay / the city's travel point.
 * Island trips stream the island in while the traveller is held offshore (time-sliced building,
 * no long freeze); the vehicle models are created per trip and disposed afterwards.
 */

type Vec = { x: number; y: number; z: number };
interface Place {
  /** Vehicle at rest (docked / landed) and its heading (bow / head forward). */
  dock: Vec;
  yaw: number;
  /** Where the vehicle goes as it leaves (and comes from when it arrives). */
  away: Vec;
  /** Camera for departure / arrival shots. */
  cam: Vec;
  /** Aerial reveal camera and its target. */
  revealCam: Vec;
  revealLook: Vec;
  /** Open water (or sky) near the place for the cruise shot. */
  sea: Vec;
}

const fnc = (t: number, s: number, y: number): Vec => ({ ...atAxis(t, s), y });
const v3 = (p: { x: number; z: number }, y: number): Vec => ({ x: p.x, y, z: p.z });
/** `up` metres above the island's ground (the meadow's height follows the terrain). */
const onGround = (p: { x: number; z: number }, up: number): Vec => ({ x: p.x, y: Math.max(0, heightAt(p.x, p.z)) + up, z: p.z });

const PLACES: Record<CityId | 'ki_pier' | 'ki_meadow', Place> = {
  nwt: { dock: { x: -242.2, y: 4.55, z: -1865.8 }, yaw: Math.PI, away: { x: -236, y: 4.55, z: -1990 }, cam: { x: -262, y: 12, z: -1846 }, revealCam: { x: -170, y: 85, z: -2130 }, revealLook: { x: -220, y: 18, z: -1780 }, sea: { x: -260, y: 0, z: -2160 } },
  fnc: { dock: fnc(-151.2, 824, 0), yaw: 0, away: fnc(-140, 930, 0), cam: fnc(-176, 790, 18), revealCam: fnc(60, 1050, 95), revealLook: fnc(0, 640, 25), sea: fnc(-90, 1120, 0) },
  bss: { dock: { x: 528, y: 56.6, z: -156 }, yaw: -Math.PI / 2, away: { x: 380, y: 56.6, z: -160 }, cam: { x: 536, y: 61, z: -146 }, revealCam: { x: 330, y: 190, z: -330 }, revealLook: { x: 640, y: 40, z: -60 }, sea: { x: 1960, y: 0, z: -820 } },
  sat: { dock: v3(satPolar(268.4, 70.2), 348.2), yaw: satYawOut(268.4), away: v3(satPolar(268.4, 170), 395), cam: v3(satPolar(276, 88), 354), revealCam: v3(satPolar(250, 420), 470), revealLook: { x: 1450, y: 360, z: 1250 }, sea: v3(satPolar(250, 600), 380) },
  ki_pier: { dock: v3(A(0.835, 186), 0), yaw: Math.atan2(A(0.82, 168).x - A(0.82, 210).x, A(0.82, 168).z - A(0.82, 210).z) + Math.PI / 2, away: v3(atBearing(222, 420), 0), cam: v3(A(0.81, 214), 6), revealCam: v3(atBearing(215, 760), 420), revealLook: v3(A(0.45, 120), 20), sea: v3(atBearing(225, 860), 0) },
  ki_meadow: { dock: onGround(A(KI.meadow.u, KI.meadow.r + 6), 0), yaw: 0, away: v3(atBearing(285, 700), 160), cam: onGround(A(KI.meadow.u + 0.03, KI.meadow.r - 14), 6), revealCam: v3(atBearing(215, 760), 420), revealLook: v3(A(0.45, 120), 20), sea: v3(atBearing(300, 860), 180) },
};

const CAPTIONS: Record<string, string> = {
  ship: 'Sailing to',
  bison: 'Flying to',
  rail_ferry: 'Monorail and ferry to',
};

type ShotFn = (k: number, dt: number, cam: THREE.PerspectiveCamera) => void;

/** A ship model (merged parts, shared kit materials) owned by one trip. */
function shipModel(style: ShipStyle): THREE.Group {
  const g = new THREE.Group();
  for (const p of shipParts(style).parts) {
    const m = new THREE.Mesh(p.geo, kitMaterial(p.mat));
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Three monorail cars (Earth Kingdom green and cream). */
function trainModel(): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.4, 9), kitMaterial('plaster_cream'));
    body.position.set(0, 1.4, -i * 9.6);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.35, 9.3), kitMaterial('roof_green'));
    roof.position.set(0, 2.75, -i * 9.6);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.5, 9.05), kitMaterial('wood_dark'));
    band.position.set(0, 0.6, -i * 9.6);
    g.add(body, roof, band);
  }
  return g;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) m.geometry.dispose();
  });
  o.removeFromParent();
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => k * k * (3 - 2 * k);

export class JourneyDirector {
  private fn: ShotFn | null = null;
  private t = 0;
  private dur = 1;
  private resolve: (() => void) | null = null;
  private until: (() => boolean) | null = null;
  private skipped = false;
  private overlay: HTMLDivElement | null = null;
  private fadeEl: HTMLDivElement | null = null;
  private vehicle: THREE.Object3D | null = null;
  private bison: CreatureModel | null = null;
  private readonly anim = defaultAnim();
  private savedDraw = 0;
  private fogFar: number | null = null;
  private fogColor: THREE.Color | null = null;
  phase = 'idle';

  /** True once the traveller asked to skip (the remaining shots run in a blink). */
  get skipping(): boolean {
    return this.skipped;
  }

  skip(): void {
    this.skipped = true;
  }

  /**
   * Run the trip. `load` places the traveller at the destination and waits for it; for trips to the
   * island it runs only after the island has been built offshore (`islandReady`).
   */
  async run(ctx: GameContext, route: RouteDef, title: string, load: () => Promise<void>, islandReady: () => boolean): Promise<void> {
    const toIsland = route.to === 'kyoshi_island';
    const from = PLACES[toIsland ? (route.from as CityId) : (route.arrival === 'ki_meadow' || route.transport === 'bison' ? 'ki_meadow' : 'ki_pier')];
    const to = PLACES[toIsland ? (route.arrival as 'ki_pier' | 'ki_meadow') : (route.to as CityId)];
    const p = ctx.player!;
    this.skipped = false;
    // The city's docked ship / waiting bison steps aside for the moving copy.
    const point = (id: string) => ctx.world.getRegionContent('travel_' + id) as { setVehicleVisible?: (v: boolean) => void } | undefined;
    const cityId = toIsland ? route.from : route.to;
    const hidePoint = (v: boolean) => point(cityId)?.setVehicleVisible?.(v);
    hidePoint(false);
    this.begin(ctx, `${CAPTIONS[route.transport] ?? 'Travelling to'} ${title}`);
    p.root.visible = false;
    const rig = ctx.cameraRig;
    rig.setScripted((dt, cam) => this.frame(ctx, dt, cam));
    try {
      // 1. Departure.
      this.phase = 'depart';
      this.spawnVehicle(ctx, route, from, toIsland ? (route.from as PlaceId) : 'kyoshi_island');
      await this.shot(2.6, (k, dt, cam) => {
        const e = ease(k);
        this.placeVehicle(ctx, lerp3(from.dock, from.away, e * 0.35), from.yaw, dt, route.transport === 'bison' ? e : 0);
        cam.position.set(from.cam.x, from.cam.y, from.cam.z);
        const v = this.vehicle?.position ?? this.bison?.root.position;
        if (v) cam.lookAt(v.x, v.y + 3, v.z);
      });
      await this.fade(ctx, true);
      // 2. Cruise while the destination streams in.
      this.phase = 'cruise';
      const sea = to.sea;
      if (toIsland) {
        // Hold offshore: the island builds a little every frame while we watch the sea.
        p.teleport(new THREE.Vector3(sea.x, 0.5, sea.z), 0);
      }
      const loading = toIsland ? null : load();
      let loaded = !toIsland;
      if (loading) loading.then(() => (loaded = true), () => (loaded = true));
      const flying = route.transport === 'bison';
      void this.fade(ctx, false);
      const heading = Math.atan2(to.dock.x - sea.x, to.dock.z - sea.z);
      const t0 = performance.now();
      await this.shot(
        2.8,
        (k, dt, cam) => {
          const fwd = { x: Math.sin(heading), z: Math.cos(heading) };
          const pos = { x: sea.x + fwd.x * k * 40, y: flying ? sea.y : 0, z: sea.z + fwd.z * k * 40 };
          this.placeVehicle(ctx, pos, heading, dt, flying ? 1 : 0);
          const side = { x: -fwd.z, z: fwd.x };
          cam.position.set(pos.x + side.x * 22 - fwd.x * 18, pos.y + (flying ? 9 : 6), pos.z + side.z * 22 - fwd.z * 18);
          cam.lookAt(pos.x + fwd.x * 30, pos.y + 2, pos.z + fwd.z * 30);
          if (flying) this.haze(ctx, 0.85);
          // Keep the island streaming quickly while we sail.
          if (toIsland) ctx.world.terrain.update(ctx.player!.position, 6);
        },
        () => (toIsland ? islandReady() : loaded) || performance.now() - t0 > 45000,
      );
      if (toIsland && !islandReady()) throw new Error('Kyoshi Island did not load');
      if (toIsland) await load();
      else await loading;
      this.haze(ctx, 0);
      // 3. Aerial reveal of the destination.
      this.phase = 'reveal';
      await this.shot(2.8, (k, dt, cam) => {
        const e = ease(k);
        const c = to.revealCam, l = to.revealLook;
        cam.position.set(c.x + (l.x - c.x) * 0.18 * e, c.y - 40 * e, c.z + (l.z - c.z) * 0.18 * e);
        cam.lookAt(l.x, l.y, l.z);
        this.wideView(ctx);
        const vpos = lerp3(to.away, to.dock, 0.25 + 0.4 * e);
        this.placeVehicle(ctx, vpos, Math.atan2(to.dock.x - to.away.x, to.dock.z - to.away.z), dt, flying ? 1 : 0);
      });
      // 4. Arrival.
      this.phase = 'arrive';
      await this.shot(2.2, (k, dt, cam) => {
        const e = ease(k);
        const vpos = lerp3(to.away, to.dock, 0.65 + 0.35 * e);
        if (flying) vpos.y = lerp(to.away.y, to.dock.y, Math.min(1, 0.65 + 0.35 * e)) + (1 - e) * 12;
        this.placeVehicle(ctx, vpos, lerpAngle(Math.atan2(to.dock.x - to.away.x, to.dock.z - to.away.z), to.yaw, e), dt, flying ? 1 - e : 0);
        cam.position.set(to.cam.x, to.cam.y, to.cam.z);
        cam.lookAt(vpos.x, vpos.y + 3, vpos.z);
      });
    } finally {
      hidePoint(true);
      this.end(ctx);
      p.root.visible = true;
      rig.setScripted(null);
      rig.snapBehind();
    }
  }

  /** Skip every shot (tests / instant travel): just load. */
  async instant(load: () => Promise<void>): Promise<void> {
    this.phase = 'instant';
    try {
      await load();
    } finally {
      this.phase = 'idle';
    }
  }

  private shot(dur: number, fn: ShotFn, until?: () => boolean): Promise<void> {
    return new Promise((res) => {
      this.fn = fn;
      this.t = 0;
      this.dur = dur;
      this.until = until ?? null;
      this.resolve = res;
    });
  }

  private frame(ctx: GameContext, dt: number, cam: THREE.PerspectiveCamera): void {
    if (ctx.input.wasPressed('jump') || ctx.input.wasPressed('interact') || ctx.input.wasPressed('attack') || ctx.input.wasPressed('pause')) this.skipped = true;
    if (!this.fn) return;
    this.t += this.skipped ? dt * 8 : dt;
    const k = Math.min(1, this.t / this.dur);
    this.fn(k, dt, cam);
    cam.updateMatrixWorld();
    // The sky dome is placed from last frame's camera: at a cut (or while a city streams in and
    // frames are slow) the camera would sit far outside it and the sky would render black.
    ctx.world.sky.dome.position.copy(cam.position);
    if (k >= 1 && (!this.until || this.until())) {
      const r = this.resolve;
      this.fn = null;
      this.resolve = null;
      r?.();
    }
  }

  private spawnVehicle(ctx: GameContext, route: RouteDef, at: Place, _place: PlaceId): void {
    this.clearVehicle();
    if (route.transport === 'bison') {
      const b = createModel('sky_bison', 0, modelDetail(ctx.settings.data.graphics.preset), 0.92);
      if (b) {
        b.setSaddle(true);
        b.setShadows(ctx.settings.data.graphics.shadows !== 'off');
        b.root.position.set(at.dock.x, at.dock.y, at.dock.z);
        ctx.scene.add(b.root);
        this.bison = b;
      }
      return;
    }
    const isTrain = route.transport === 'rail_ferry' && route.from === 'bss';
    const g = isTrain ? trainModel() : shipModel(route.transport === 'rail_ferry' ? 'earth' : route.from === 'nwt' || route.to === 'nwt' ? 'water' : route.from === 'fnc' || route.to === 'fnc' ? 'fire' : 'earth');
    g.position.set(at.dock.x, at.dock.y, at.dock.z);
    ctx.scene.add(g);
    this.vehicle = g;
  }

  /** Swap the train for the ferry once the trip reaches the sea. */
  private placeVehicle(ctx: GameContext, p: Vec, yaw: number, dt: number, fly: number): void {
    if (this.bison) {
      const b = this.bison;
      b.root.position.set(p.x, p.y + fly * 6, p.z);
      b.root.rotation.y = yaw;
      const a = this.anim;
      a.dt = dt;
      a.time = ctx.time.elapsed;
      a.grounded = fly < 0.05;
      a.flying = fly > 0.05;
      a.speed = fly > 0.05 ? 12 : 0;
      b.update(a);
      return;
    }
    const v = this.vehicle;
    if (!v) return;
    const t = ctx.time.elapsed;
    v.position.set(p.x, p.y + Math.sin(t * 1.3) * 0.12, p.z);
    v.rotation.set(Math.sin(t * 0.9) * 0.02, yaw, Math.sin(t * 1.1) * 0.03);
  }

  private clearVehicle(): void {
    if (this.vehicle) disposeTree(this.vehicle);
    this.vehicle = null;
    if (this.bison) {
      this.bison.root.removeFromParent();
      this.bison.dispose();
    }
    this.bison = null;
  }

  /** See the whole island / city: far terrain and a thin fog for the aerial shot. */
  private wideView(ctx: GameContext): void {
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) {
      if (this.fogFar === null) this.fogFar = fog.far;
      fog.near = 900;
      fog.far = 5200;
    }
  }

  /** White haze (flying through cloud). */
  private haze(ctx: GameContext, k: number): void {
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (!fog) return;
    if (k > 0) {
      if (!this.fogColor) this.fogColor = fog.color.clone();
      fog.color.lerp(new THREE.Color('#f4f6fa'), k);
      fog.near = 10;
      fog.far = 260;
    }
  }

  private begin(ctx: GameContext, caption: string): void {
    this.savedDraw = ctx.world.terrain.drawDistance;
    ctx.world.terrain.drawDistance = Math.max(this.savedDraw, 1300);
    // The game's own cinematic letterbox (as on arrival in a new game): the HUD fades out meanwhile.
    const o = document.createElement('div');
    o.className = 'cine journey-cine';
    const top = document.createElement('div');
    top.className = 'cine-bar top';
    const bottom = document.createElement('div');
    bottom.className = 'cine-bar bottom';
    const cap = document.createElement('div');
    cap.textContent = caption;
    cap.style.cssText = 'margin-right:auto;font-size:clamp(15px,2.2vw,24px);letter-spacing:0.08em;color:#f3e7c9;text-shadow:0 2px 6px #000a';
    const skip = document.createElement('button');
    skip.className = 'cine-skip';
    skip.dataset.action = 'skip-journey';
    const touch = ctx.settings.device.mobile || ctx.input.lastDevice === 'touch' || !!ctx.ui.touch?.shown;
    if (touch) skip.textContent = 'Skip ›';
    else {
      const k = document.createElement('span');
      k.className = 'kbd';
      k.textContent = ctx.input.label('jump');
      skip.append(k, ' Skip');
    }
    skip.onclick = () => this.skip();
    bottom.append(cap, skip);
    const fade = document.createElement('div');
    fade.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;transition:opacity 0.35s';
    o.append(fade, top, bottom);
    ctx.ui.layers.overlay.appendChild(o);
    ctx.ui.root.classList.add('cinematic');
    this.overlay = o;
    this.fadeEl = fade;
  }

  private fade(_ctx: GameContext, on: boolean): Promise<void> {
    if (this.fadeEl) this.fadeEl.style.opacity = on ? '0.9' : '0';
    return new Promise((r) => setTimeout(r, this.skipped ? 30 : 360));
  }

  private end(ctx: GameContext): void {
    this.clearVehicle();
    ctx.ui.root.classList.remove('cinematic');
    const o = this.overlay;
    if (o) {
      o.classList.add('out');
      setTimeout(() => o.remove(), 700);
    }
    this.overlay = null;
    this.fadeEl = null;
    this.fn = null;
    ctx.world.terrain.drawDistance = this.savedDraw || ctx.world.terrain.drawDistance;
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog && this.fogColor) fog.color.copy(this.fogColor);
    this.fogFar = null;
    this.fogColor = null;
    this.phase = 'idle';
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  /** Abort (session ended mid-trip). */
  cancel(ctx: GameContext): void {
    if (this.phase === 'idle') return;
    this.end(ctx);
  }
}

function lerp3(a: Vec, b: Vec, k: number): Vec {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) };
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
