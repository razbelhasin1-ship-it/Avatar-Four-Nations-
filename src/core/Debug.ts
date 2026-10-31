import * as THREE from 'three';
import { DEFAULT_APPEARANCE, type Appearance } from '../character/Appearance';
import { allTechniques, getTechnique } from '../combat/CombatSystem';
import { TrainingDummy } from '../entities/TrainingDummy';
import { LANDMARKS, STARTS } from '../world/WorldLayout';
import type { Game } from './Game';
import type { Action } from './Input';
import { ELEMENTS, type Element } from './types';

/**
 * window.__game — automation & debugging API (used by Playwright tests and
 * dev tools). Always installed; it only exposes game-level operations.
 *
 * Modules may add their own helpers: (window as any).__game.debug.myThing = ...
 */
export function installDebug(game: Game): void {
  const ctx = game.ctx;
  const held = new Map<Action, number>();

  const api = {
    game,
    ctx,
    THREE,
    /** Snapshot of high-level state for assertions. */
    state() {
      const p = game.player;
      const pos = p.position;
      return {
        mode: game.mode,
        paused: game.paused,
        session: { ...ctx.session },
        ui: { screen: ctx.ui.currentScreen, blocks: ctx.ui.blocksGameplay },
        player: {
          name: p.characterName,
          x: +pos.x.toFixed(2),
          y: +pos.y.toFixed(2),
          z: +pos.z.toFixed(2),
          yaw: +p.yaw.toFixed(3),
          element: p.element,
          hp: p.health ? +p.health.hp.toFixed(1) : 0,
          maxHp: p.health?.maxHp ?? 0,
          chi: +p.chi.toFixed(1),
          water: +p.waterReserve.toFixed(1),
          grounded: p.body?.grounded ?? false,
          swimming: p.body?.swimming ?? false,
          surface: p.body?.surface,
          defeated: p.defeated,
          gliding: p.gliding,
          mounted: ctx.companions.mounted,
        },
        avatar: { active: ctx.avatar.active, sphere: ctx.avatar.sphereActive, spirit: +ctx.avatar.spirit.toFixed(1) },
        progression: {
          start: ctx.progression.startingElement,
          unlocked: [...ctx.progression.unlocked],
          learned: [...ctx.progression.learned.keys()],
          mastery: Object.fromEntries(ELEMENTS.map((e) => [e, { ...ctx.progression.mastery[e], progress: ctx.progression.masteryProgress(e) }])),
          sphereUnlocked: ctx.progression.elementsSphereUnlocked,
          level: ctx.progression.level,
        },
        quests: { active: [...ctx.quests.active.keys()], completed: [...ctx.quests.completed], tracked: ctx.quests.tracked, flags: [...ctx.quests.flags] },
        region: ctx.world.currentRegion?.id ?? null,
        discovered: [...ctx.world.discovered],
        entities: ctx.entities.count,
        projectiles: ctx.combat.projectileCount,
        particles: ctx.vfx.particleCount,
        companions: ctx.companions.bonded.map((c) => ({ id: c.id, species: c.speciesId, name: c.name, bond: c.bond })),
        inventory: { currency: ctx.inventory.currency, items: Object.fromEntries(ctx.inventory.items) },
        render: { ...ctx.render.stats },
        time: { elapsed: ctx.time.elapsed, hour: ctx.world.sky.timeOfDay },
        device: { ...ctx.settings.device, mobileDefaults: ctx.settings.mobileDefaultsApplied, touchUI: !!ctx.ui.touch?.shown },
      };
    },
    /** Start a new campaign without going through the UI. */
    async newGame(opts: { element?: Element; name?: string; slot?: string; appearance?: Partial<Appearance> } = {}) {
      const element = opts.element ?? 'water';
      const appearance = { ...structuredClone(DEFAULT_APPEARANCE[element]), ...(opts.appearance ?? {}) };
      await game.newGame({ element, name: opts.name ?? 'Test Avatar', appearance, slot: opts.slot ?? 'slot3' });
      game.cameraRig.setScripted(null);
      game.player.controlLock = 0;
      ctx.ui.closeAll();
      return api.state();
    },
    async loadGame(slot: string) {
      return game.loadGame(slot);
    },
    async startTutorial() {
      await game.startTutorial();
      return api.state();
    },
    save(slot?: string) {
      return game.saveGame(slot);
    },
    exitToMenu(saveFirst = false) {
      game.exitToMenu(saveFirst);
    },
    teleport(x: number, z: number, y?: number) {
      const g = ctx.world.groundAt(x, z, y !== undefined ? y + 1 : Infinity);
      game.player.teleport(new THREE.Vector3(x, y ?? g.y + 0.05, z));
      return api.state().player;
    },
    teleportTo(id: string) {
      const l = LANDMARKS.find((l) => l.id === id);
      if (!l) throw new Error('unknown landmark ' + id);
      return api.teleport(l.x, l.z);
    },
    startPoint(e: Element) {
      const s = STARTS[e];
      return api.teleport(s.spawn.x, s.spawn.z);
    },
    setElement(e: Element) {
      ctx.progression.unlockElement(e, true);
      return game.player.switchElement(e, true) || game.player.element === e;
    },
    unlockAllElements() {
      for (const e of ELEMENTS) ctx.progression.unlockElement(e, true);
    },
    learn(id: string) {
      return ctx.progression.learn(id, 'debug');
    },
    learnAll() {
      for (const t of allTechniques()) ctx.progression.learn(t.id, 'debug', true);
    },
    masterAll() {
      ctx.progression.debugMasterAll();
      return api.state().progression;
    },
    techniques() {
      return allTechniques().map((t) => ({ id: t.id, name: t.name, element: t.element, kind: t.kind, tier: t.tier, water: t.water?.amount ?? 0 }));
    },
    /** Cast a technique as the player toward a world point or yaw. */
    cast(id: string, aim?: { x: number; y: number; z: number } | null, charge = 1) {
      const p = game.player;
      const origin = p.castOrigin('chest', new THREE.Vector3());
      const aimPoint = aim ? new THREE.Vector3(aim.x, aim.y, aim.z) : origin.clone().add(new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw)).multiplyScalar(10));
      const def = getTechnique(id);
      const res = ctx.combat.tryCast(p, id, { aimPoint, aimDir: aimPoint.clone().sub(origin).normalize(), charge, force: false });
      return { ok: res.ok, reason: res.reason ?? null, message: res.message ?? null, water: res.cast?.water ? { amount: res.cast.water.amount, source: res.cast.water.sourceType, from: res.cast.water.from ? res.cast.water.from.toArray() : null } : null, kind: def?.kind ?? null };
    },
    /** Spawn a training dummy at an offset from the player (facing direction). */
    spawnDummy(dist = 6, side = 0, hp = 120) {
      const p = game.player;
      const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      const r = new THREE.Vector3(-f.z, 0, f.x);
      const pos = p.position.clone().addScaledVector(f, dist).addScaledVector(r, side);
      const d = new TrainingDummy(hp);
      pos.y = ctx.world.groundAt(pos.x, pos.z, pos.y + 5).y;
      d.position.copy(pos);
      ctx.entities.add(d);
      return { id: d.id, x: pos.x, y: pos.y, z: pos.z };
    },
    entityInfo(id: number) {
      const e = ctx.entities.get(id);
      if (!e) return null;
      const d = e as any;
      return { id: e.id, kind: e.kind, name: e.name, alive: e.alive, hp: e.health?.hp ?? null, x: e.position.x, y: e.position.y, z: e.position.z, totalDamage: d.totalDamage ?? null, hits: d.hits ?? null, tags: [...e.tags] };
    },
    entities(kind?: string) {
      return [...ctx.entities.all()].filter((e) => !kind || e.kind === kind).map((e) => ({ id: e.id, kind: e.kind, name: e.name, x: +e.position.x.toFixed(1), z: +e.position.z.toFixed(1), hp: e.health?.hp ?? null, tags: [...e.tags] }));
    },
    faceTowards(x: number, z: number) {
      const p = game.player;
      p.yaw = Math.atan2(x - p.position.x, z - p.position.z);
      p.root.rotation.y = p.yaw;
      game.cameraRig.snapBehind();
    },
    /** Hold a virtual input for N seconds (simulated time advances via the real loop). */
    press(action: Action, seconds = 0.1) {
      ctx.input.setVirtual(action, true);
      held.set(action, seconds);
      setTimeout(() => ctx.input.setVirtual(action, false), Math.max(16, seconds * 1000));
    },
    move(x: number, y: number) {
      ctx.input.setVirtualMove(x, y);
    },
    /** Advance the simulation synchronously by n fixed steps (for deterministic tests). */
    step(n = 1, dt = 1 / 30) {
      for (let i = 0; i < n; i++) game.frame(dt);
      return api.state();
    },
    waterNearby(range = 20) {
      const p = game.player;
      return ctx.water.findAll(p.position, range, { allowIce: true, allowSnow: true }).map((h) => ({ id: h.id, type: h.type, label: h.label, distance: +h.distance.toFixed(2), available: h.available, frozen: h.frozen }));
    },
    drawWater(amount = 30) {
      const hit = ctx.water.drawToReserve(game.player, amount, game.player.aimDir);
      return hit ? { id: hit.id, type: hit.type, reserve: game.player.waterReserve } : null;
    },
    avatarState(on = true) {
      if (on) return ctx.avatar.activate();
      ctx.avatar.deactivate();
      return false;
    },
    setTime(hour: number) {
      ctx.world.sky.timeOfDay = hour % 24;
    },
    freezeTime(on = true) {
      ctx.world.sky.secondsPerHour = on ? 0 : 90;
    },
    /** Orbit camera control for screenshots. */
    camera(yaw: number, pitch: number, distance?: number) {
      game.cameraRig.yaw = yaw;
      game.cameraRig.pitch = pitch;
      if (distance) game.cameraRig.distance = distance;
    },
    /** Free camera for screenshots: position + look target (null to restore follow cam). */
    freeCamera(pos: { x: number; y: number; z: number } | null, look?: { x: number; y: number; z: number }) {
      if (!pos) {
        game.cameraRig.setScripted(null);
        return;
      }
      game.cameraRig.setScripted((_dt, cam) => {
        cam.position.set(pos.x, pos.y, pos.z);
        if (look) cam.lookAt(look.x, look.y, look.z);
      });
    },
    hideUI(hide = true) {
      ctx.ui.setHidden(hide);
    },
    setting(path: string, value: unknown) {
      ctx.settings.set(path, value);
    },
    preset(p: 'low' | 'medium' | 'high' | 'ultra') {
      ctx.settings.applyPreset(p);
    },
    errors: [] as string[],
    debug: {} as Record<string, unknown>,
  };
  window.addEventListener('error', (e) => api.errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => api.errors.push(String((e as PromiseRejectionEvent).reason)));
  (window as any).__game = api;
}
