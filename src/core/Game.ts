import * as THREE from 'three';
import '../character/clips';
import '../combat/techniques';
import { AudioEngine } from '../audio/AudioEngine';
import { AvatarStateSystem } from '../avatar/AvatarStateSystem';
import { DEFAULT_APPEARANCE, type Appearance } from '../character/Appearance';
import { CombatSystem } from '../combat/CombatSystem';
import { WaterSourceSystem } from '../combat/WaterSources';
import { CompanionSystem } from '../companions/CompanionSystem';
import { EntityManager } from '../entities/EntityManager';
import { Inventory } from '../inventory/Inventory';
import { MODULES } from '../modules';
import { NPCSystem } from '../npc/NPCSystem';
import { CameraRig } from '../player/CameraRig';
import { Player } from '../player/Player';
import { Progression } from '../progression/Progression';
import { QuestSystem } from '../quests/QuestSystem';
import { RenderPipeline } from '../render/Renderer';
import { arrivalOverlay } from '../ui/screens/NewGameFlow';
import { UIManager } from '../ui/UIManager';
import { VFXSystem } from '../vfx/VFX';
import { InteractionSystem } from '../world/Interactables';
import { World } from '../world/World';
import { regionById, STARTS, TUTORIAL_SPAWN, WORLD_HALF } from '../world/WorldLayout';
import { installDebug } from './Debug';
import { EventBus } from './EventBus';
import type { GameContext, GameSystem, GameTime, SessionInfo } from './GameContext';
import { Input } from './Input';
import { SaveManager } from './Save';
import { SettingsManager } from './Settings';
import type { Element, GameMode, SessionKind } from './types';

export interface NewGameConfig {
  element: Element;
  name: string;
  appearance: Appearance;
  slot: string;
}

interface OrderedSystem {
  name: string;
  order: number;
  sys: GameSystem;
}

/**
 * Main-menu backdrop: a slow golden-hour camera tour over real world locations
 * (the Air Temple and the capitals), cross-faded by the main menu on 'menu:tour'.
 * `az` is the direction from the focus to the camera (sin, cos), swept by `sweep`.
 */
interface MenuShot {
  id: Element;
  name: string;
  subtitle: string;
  x: number;
  z: number;
  /** Look-at height above the terrain at the focus. */
  lookY: number;
  az: number;
  sweep: number;
  radius: number;
  height: number;
  duration: number;
}
const MENU_SHOTS: MenuShot[] = [
  { id: 'air', name: 'Southern Air Temple', subtitle: 'Above the sea of clouds', x: 1450, z: 1250, lookY: -8, az: Math.PI / 2, sweep: 0.5, radius: 330, height: 75, duration: 16 },
  // In over the harbour, between the cove's ice cliffs (the old arc started inside the west cliff).
  { id: 'water', name: 'Northern Water Tribe', subtitle: 'The city of ice and canals', x: -220, z: -1550, lookY: 6, az: 2.95, sweep: 0.4, radius: 260, height: 80, duration: 15 },
  { id: 'earth', name: 'Ba Sing Se', subtitle: 'The impenetrable city', x: 850, z: -50, lookY: 12, az: -1.25, sweep: -0.3, radius: 240, height: 95, duration: 15 },
  { id: 'fire', name: 'Fire Nation Capital', subtitle: 'The caldera city', x: -1330, z: 1110, lookY: 12, az: 0.75, sweep: 0.4, radius: 150, height: 100, duration: 15 },
];
const MENU_FOCUS = new THREE.Vector3(MENU_SHOTS[0].x, 0, MENU_SHOTS[0].z);
/** Golden hour for the menu tour (sun low in the west). */
const MENU_HOUR = 17.3;

/**
 * Top-level orchestrator: owns every system, runs the frame loop, and manages
 * sessions (campaign / tutorial) and the menu backdrop.
 */
export class Game {
  readonly events = new EventBus();
  readonly input = new Input();
  readonly settings: SettingsManager;
  readonly save: SaveManager;
  readonly render: RenderPipeline;
  readonly world = new World();
  readonly entities = new EntityManager();
  readonly interactions = new InteractionSystem();
  readonly vfx: VFXSystem;
  readonly audio: AudioEngine;
  readonly combat = new CombatSystem();
  readonly water = new WaterSourceSystem();
  readonly progression = new Progression();
  readonly quests = new QuestSystem();
  readonly npcs = new NPCSystem();
  readonly companions = new CompanionSystem();
  readonly avatar = new AvatarStateSystem();
  readonly inventory = new Inventory();
  readonly ui: UIManager;
  readonly cameraRig = new CameraRig();
  readonly playerEntity: Player;
  readonly time: GameTime = { elapsed: 0, dt: 0, frame: 0, real: 0 };
  readonly session: SessionInfo = { active: false, kind: null, slot: null, isNew: false };
  readonly ctx: GameContext;
  mode: GameMode = 'boot';
  paused = false;
  private systems: OrderedSystem[] = [];
  private readonly timer = new THREE.Timer();
  private running = false;
  private autosaveTimer = 0;
  // Main-menu tour state (see MENU_SHOTS).
  private menuShot = 0;
  private menuT = 0;
  private menuPhase: 'play' | 'cut' = 'play';
  private menuToken = 0;
  private menuPrimed = false;
  private menuPreload: Promise<void> | null = null;
  private readonly menuFocus = MENU_FOCUS.clone();
  private menuGround = 0;
  /** False holds the tour on the current shot (tests, screenshots). */
  menuTourAuto = true;
  /** Alternate scene/camera rendered instead of the world (character creator studio). */
  private stage: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
  /** Bumped every session start to cancel stale async work. */
  private sessionToken = 0;

  constructor(readonly canvas: HTMLCanvasElement, readonly uiRoot: HTMLElement) {
    this.settings = new SettingsManager(this.events);
    this.save = new SaveManager(this.events);
    this.render = new RenderPipeline(canvas, this.settings, this.events);
    this.vfx = new VFXSystem(this.settings, this.events);
    this.audio = new AudioEngine(this.settings, this.events);
    this.ui = new UIManager(uiRoot);

    const self = this;
    const extra = new Map<string, unknown>();
    this.ctx = {
      game: this,
      events: this.events,
      input: this.input,
      settings: this.settings,
      save: this.save,
      render: this.render,
      scene: this.render.scene,
      camera: this.render.camera,
      world: this.world,
      entities: this.entities,
      interactions: this.interactions,
      vfx: this.vfx,
      audio: this.audio,
      combat: this.combat,
      water: this.water,
      progression: this.progression,
      quests: this.quests,
      npcs: this.npcs,
      companions: this.companions,
      avatar: this.avatar,
      inventory: this.inventory,
      ui: this.ui,
      cameraRig: this.cameraRig,
      time: this.time,
      session: this.session,
      get player() {
        return self.session.active ? self.playerEntity : null;
      },
      extra,
    };

    this.render.scene.add(this.entities.group);
    this.render.scene.add(this.vfx.group);
    this.playerEntity = new Player(this.ctx);

    this.input.attach(canvas);
    this.applyControlSettings();
    this.events.on('settings:changed', () => this.applyControlSettings());

    // Core systems in update order.
    const core: Array<[string, number, GameSystem]> = [
      ['interactions', 10, this.interactions],
      ['avatar', 20, this.avatar],
      ['combat', 40, this.combat],
      ['water', 45, this.water],
      ['npcs', 50, this.npcs],
      ['companions', 55, this.companions],
      ['quests', 60, this.quests],
      ['progression', 65, this.progression],
      ['inventory', 70, this.inventory],
      ['camera', 1000, this.cameraRig],
    ];
    for (const [name, order, sys] of core) this.systems.push({ name, order, sys });
    for (const m of MODULES) {
      try {
        const sys = m.create(this.ctx);
        extra.set(m.name, sys);
        this.systems.push({ name: m.name, order: m.order ?? 100, sys });
      } catch (err) {
        console.error(`[Game] module ${m.name} failed to create`, err);
      }
    }
    this.systems.sort((a, b) => a.order - b.order);

    // Persistence registrations (order = restore order).
    this.save.register(this.progression);
    this.save.register(this.inventory);
    this.save.register(this.world);
    this.save.register(this.playerEntity);
    this.save.register(this.quests);
    this.save.register(this.companions);
    for (const s of this.systems) {
      const p = s.sys as any;
      if (p.saveKey && typeof p.serialize === 'function' && !this.save.registeredKeys().includes(p.saveKey)) this.save.register(p);
    }
    this.save.metaProvider = () => ({
      characterName: this.playerEntity.characterName,
      startingElement: this.progression.startingElement,
      regionName: this.world.currentRegion?.name ?? regionById(STARTS[this.progression.startingElement].regionId)?.name ?? 'The Four Nations',
      level: this.progression.level,
      playTime: this.playerEntity.playTime,
      masteredCount: this.progression.masteredCount,
    });

    this.world.init(this.ctx);
    for (const s of this.systems) {
      try {
        s.sys.init?.(this.ctx);
      } catch (err) {
        console.error(`[Game] init failed for ${s.name}`, err);
      }
    }
    this.ui.init(this.ctx);

    // Audio unlock on first gesture.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });

    // Losing pointer lock during play opens the pause menu.
    this.input.setPointerLockLostHandler(() => {
      if (this.mode === 'play' && !this.paused && !this.ui.blocksGameplay) this.setPaused(true);
    });
    canvas.addEventListener('click', () => {
      if (this.mode === 'play' && !this.paused && !this.ui.blocksGameplay) this.input.requestPointerLock();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'play' && !this.paused) this.setPaused(true);
    });

    this.events.on('quest:completed', () => this.requestAutosave(true));
    this.events.on('technique:learned', () => this.requestAutosave(true));
    this.events.on('mastery:achieved', () => this.requestAutosave(true));
    this.events.on('companion:bonded', () => this.requestAutosave(true));
    this.events.on('companion:purchased', () => this.requestAutosave(true));
    this.events.on('region:entered', () => this.requestAutosave(false));

    installDebug(this);
  }

  private applyControlSettings(): void {
    const c = this.settings.data.controls;
    this.input.setBindings(c.bindings);
    this.input.mouseSensitivity = c.mouseSensitivity;
    this.input.touchSensitivity = c.touchSensitivity;
    this.input.invertY = c.invertY;
  }

  get player(): Player {
    return this.playerEntity;
  }

  setMode(mode: GameMode): void {
    if (mode === this.mode) return;
    const from = this.mode;
    this.mode = mode;
    this.events.emit('game:mode', { from, to: mode });
  }

  /** Render an alternate scene (creator studio) instead of the world. */
  setStage(stage: { scene: THREE.Scene; camera: THREE.Camera } | null): void {
    this.stage = stage;
  }

  // ---------------------------------------------------------------------------
  // Boot & loop
  // ---------------------------------------------------------------------------

  async boot(onProgress?: (f: number, label: string) => void): Promise<void> {
    this.setMode('loading');
    await this.world.preload(MENU_FOCUS.clone().setY(0), (f, l) => onProgress?.(f, l));
    this.menuPrimed = true;
    this.enterMenu();
    this.start();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer.connect(document);
    const loop = (t: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.timer.update(t);
      const dt = Math.min(0.1, this.timer.getDelta());
      this.frame(dt);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  /** One simulation + render frame (also used by tests via debug.step). */
  frame(dt: number): void {
    this.time.dt = dt;
    this.time.frame++;
    this.time.real += dt;
    this.input.gameplayLocked = this.ui.blocksGameplay || this.paused || this.mode !== 'play';
    this.input.update(dt);
    try {
      const frozen = this.paused || this.ui.freezesSim;
      if (this.mode === 'play' && !frozen) this.updatePlay(dt);
      else if (this.mode === 'menu') this.updateMenu(dt);
      else if (this.mode === 'play' && frozen) {
        // Keep the sky/water alive behind the pause menu but freeze gameplay.
        this.world.updateAmbient(dt * 0.2, this.playerEntity.position);
      }
      this.ui.update(dt);
      this.audio.setListener(this.render.camera);
      this.audio.update(dt);
      if (this.stage) this.render.renderer.render(this.stage.scene, this.stage.camera);
      else if (!(this.mode === 'menu' && this.menuPhase === 'cut')) this.render.render(dt); // menu cut: a snapshot covers the canvas
    } catch (err) {
      console.error('[Game] frame error', err);
    }
    this.input.endFrame();
  }

  private updatePlay(dt: number): void {
    this.time.elapsed += dt;
    const ctx = this.ctx;
    // Order: systems < 30, entities (player first), systems >= 30, then vfx & world right before the camera.
    let entitiesDone = false;
    for (const s of this.systems) {
      if (!entitiesDone && s.order >= 30) {
        this.entities.update(dt, ctx);
        entitiesDone = true;
      }
      if (s.name === 'camera') {
        this.vfx.update(dt);
        this.world.update(dt, this.playerEntity.position);
        this.render.setShadowFocus(this.playerEntity.position);
      }
      try {
        s.sys.update?.(dt, ctx);
      } catch (err) {
        console.error(`[Game] update failed for ${s.name}`, err);
      }
    }
    if (!entitiesDone) this.entities.update(dt, ctx);

    // Autosave (campaign only).
    this.autosaveTimer += dt;
    if (this.autosaveTimer > 90) {
      this.autosaveTimer = 0;
      this.requestAutosave(true);
    }
  }

  private updateMenu(dt: number): void {
    // The creator studio replaces the world; a cut streams the next place in (the menu shows a snapshot meanwhile).
    if (this.stage || this.menuPhase === 'cut') return;
    const shot = MENU_SHOTS[this.menuShot];
    this.menuT += dt;
    this.placeMenuCamera(shot, Math.min(1, this.menuT / shot.duration));
    // Full world tick around the shown place: far cities the tour built earlier drop to their cheap/hidden detail.
    this.world.update(dt, this.menuFocus);
    this.vfx.update(dt);
    this.render.setShadowFocus(this.menuFocus);
    if (this.menuTourAuto && this.menuT >= shot.duration) this.menuCut((this.menuShot + 1) % MENU_SHOTS.length);
  }

  /** Camera on the shot's slow arc at progress k (0..1). */
  private placeMenuCamera(shot: MenuShot, k: number): void {
    const s = k * k * (3 - 2 * k) * 0.35 + k * 0.65; // gentle ease at both ends
    const az = shot.az + shot.sweep * s;
    const r = shot.radius * (1 - 0.1 * s);
    const f = this.menuFocus;
    const cam = this.render.camera;
    const cx = f.x + Math.sin(az) * r;
    const cz = f.z + Math.cos(az) * r;
    const cy = Math.max(this.menuGround + shot.height * (1 - 0.08 * s), this.world.heightAt(cx, cz) + 18);
    cam.position.set(cx, cy, cz);
    cam.lookAt(f.x, this.menuGround + shot.lookY, f.z);
    cam.updateMatrixWorld();
  }

  /**
   * Cross-fade the menu backdrop to another location: the outgoing frame is
   * re-rendered so listeners of 'menu:tour' (phase 'cut') can snapshot the
   * canvas synchronously, then the next place streams in behind that snapshot.
   */
  menuCut(next: number, blank = false): void {
    if (this.mode !== 'menu' || this.menuPhase === 'cut') return;
    const from = MENU_SHOTS[this.menuShot];
    const token = ++this.menuToken;
    this.menuPhase = 'cut';
    if (!blank && !this.stage) this.render.render(0);
    this.events.emit('menu:tour', { phase: 'cut', index: this.menuShot, id: from.id, name: from.name, subtitle: from.subtitle, blank });
    const i = ((next % MENU_SHOTS.length) + MENU_SHOTS.length) % MENU_SHOTS.length;
    const to = MENU_SHOTS[i];
    const p = (this.menuPreload = this.world.preload(new THREE.Vector3(to.x, 0, to.z)).catch((err) => console.error('[Game] menu preload failed', err)));
    void p.then(async () => {
      if (this.menuPreload === p) this.menuPreload = null;
      if (token !== this.menuToken || this.mode !== 'menu') return;
      // Compile the new place's shaders from the first camera pose so the cross-fade does not stutter.
      this.aimMenuShot(i);
      try {
        await this.render.renderer.compileAsync(this.render.scene, this.render.camera);
      } catch {
        /* compile on first draw instead */
      }
      if (token !== this.menuToken || this.mode !== 'menu') return;
      this.startMenuShot(i);
    });
  }

  private aimMenuShot(i: number): void {
    const s = MENU_SHOTS[i];
    this.menuFocus.set(s.x, 0, s.z);
    this.menuGround = this.world.heightAt(s.x, s.z);
    this.menuFocus.y = this.menuGround;
    this.placeMenuCamera(s, 0);
  }

  private startMenuShot(i: number): void {
    const s = MENU_SHOTS[i];
    this.aimMenuShot(i);
    this.menuShot = i;
    this.menuT = 0;
    this.menuPhase = 'play';
    this.events.emit('menu:tour', { phase: 'shot', index: i, id: s.id, name: s.name, subtitle: s.subtitle });
  }

  /** Tour state for the main menu and tests. */
  get menuTour(): { index: number; id: string; name: string; subtitle: string; phase: 'play' | 'cut'; t: number; shots: number } {
    const s = MENU_SHOTS[this.menuShot];
    return { index: this.menuShot, id: s.id, name: s.name, subtitle: s.subtitle, phase: this.menuPhase, t: this.menuT, shots: MENU_SHOTS.length };
  }

  enterMenu(): void {
    this.setMode('menu');
    this.paused = false;
    // Golden hour, drifting very slowly while the tour runs.
    this.world.sky.timeOfDay = MENU_HOUR;
    this.world.sky.secondsPerHour = 1500;
    this.audio.setMusicTheme('menu');
    this.ui.showMainMenu();
    this.menuToken++;
    this.menuPhase = 'play';
    if (this.menuPrimed) {
      this.menuPrimed = false;
      this.startMenuShot(0);
    } else {
      // Back from a session: stream the first location in behind a dark veil.
      this.menuCut(0, true);
    }
  }

  setPaused(p: boolean): void {
    if (this.mode !== 'play' || this.paused === p) return;
    this.paused = p;
    if (p) {
      this.input.releasePointerLock();
      this.ui.showPause();
    } else {
      this.ui.hidePause();
      this.input.requestPointerLock();
    }
    this.events.emit('game:paused', { paused: p });
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  private validSpawn(p: THREE.Vector3): boolean {
    if (![p.x, p.y, p.z].every((v) => Number.isFinite(v))) return false;
    if (Math.abs(p.x) > WORLD_HALF - 150 || Math.abs(p.z) > WORLD_HALF - 150) return false;
    const h = this.world.heightAt(p.x, p.z);
    if (h < -1) return false;
    const w = this.world.waterAt(p.x, p.z);
    if (w && !w.frozen && w.level - h > 1.2) return false;
    return true;
  }

  private async beginSession(kind: SessionKind, spawn: THREE.Vector3, yaw: number, isNew: boolean, slot: string | null): Promise<void> {
    const token = ++this.sessionToken;
    this.setMode('loading');
    this.stage = null;
    this.ui.showLoading(kind === 'tutorial' ? 'Meditation Isle' : this.world.regionAt(spawn.x, spawn.z)?.name ?? 'The Four Nations');
    // Never stream two places at once: let an in-flight menu-tour preload finish first.
    this.menuToken++;
    if (this.menuPreload) await this.menuPreload;
    if (token !== this.sessionToken) return;
    await this.world.preload(spawn, (f, label) => this.ui.setLoadingProgress(f, label));
    if (token !== this.sessionToken) return;
    const player = this.playerEntity;
    // A saved position keeps its own floor (a bridge, rail deck or roof overhead must not lift it on load);
    // fresh spawns (y = 0) search from high above.
    const g = this.world.groundAt(spawn.x, spawn.z, isNew || spawn.y === 0 ? spawn.y + 50 : spawn.y + 2);
    spawn.y = g.y + 0.05;
    this.session.active = true;
    this.session.kind = kind;
    this.session.slot = slot;
    this.session.isNew = isNew;
    this.save.activeSlot = kind === 'campaign' ? slot : null;
    this.save.writesEnabled = kind === 'campaign';
    if (!this.entities.get(player.id)) this.entities.add(player);
    this.entities.playerId = player.id;
    player.teleport(spawn, yaw);
    if (player.safePoint.lengthSq() === 0 || isNew || kind === 'tutorial') player.safePoint.copy(spawn);
    player.chi = player.maxChi;
    player.defeated = false;
    player.alive = true;
    player.humanoid.animator.stop();
    player.switchElement(player.element, true);
    player.humanoid.animator.loco.style = player.element;
    this.time.elapsed += 0.001;
    this.world.sky.secondsPerHour = 90;
    this.world.onSessionStart();
    for (const s of this.systems) {
      try {
        s.sys.onSessionStart?.(this.ctx, isNew);
      } catch (err) {
        console.error(`[Game] onSessionStart failed for ${s.name}`, err);
      }
    }
    this.events.emit('session:started', { kind, isNew });
    this.events.emit('player:spawned', { entityId: player.id });
    this.autosaveTimer = 0;
    this.save.forceAutosaveTimer(this.time.real);
    const region = this.world.regionAt(spawn.x, spawn.z);
    this.audio.setMusicTheme(kind === 'tutorial' ? 'spirit' : region?.theme ?? 'wild');
    this.setMode('play');
    this.paused = false;
    this.ui.hideLoading();
    this.ui.showHUD();
    if (isNew && kind === 'campaign') {
      this.playArrival(region?.name ?? 'The Four Nations', region?.blurb ?? '');
      this.save.save(slot!, true);
    } else if (kind === 'tutorial') {
      this.ui.showBanner('Meditation Isle', 'A training ground between the worlds. Nothing here affects your journey.');
    } else {
      this.ui.showBanner(region?.name ?? 'The Four Nations', 'Your journey continues.');
    }
  }

  /**
   * Arrival cinematic: a sweeping descent over the start city that swings
   * around the Avatar and settles exactly where the follow camera sits behind
   * them, then the first quest prompt. Jump / interact / attack skip it.
   */
  private playArrival(title: string, blurb: string): void {
    const p = this.playerEntity;
    const rig = this.cameraRig;
    const token = this.sessionToken;
    rig.pitch = 0.28;
    // Final pose = the follow camera's pose right after snapBehind().
    const yawC = p.yaw + Math.PI;
    const pivot = p.position.clone();
    pivot.y += 1.55 * (p.height / 1.75);
    pivot.addScaledVector(new THREE.Vector3(Math.cos(yawC), 0, -Math.sin(yawC)), 0.55);
    const dir = new THREE.Vector3(Math.sin(yawC) * Math.cos(rig.pitch), Math.sin(rig.pitch), Math.cos(yawC) * Math.cos(rig.pitch));
    const dist = rig.distance * this.settings.data.controls.cameraDistance;
    const endR = dist * Math.cos(rig.pitch);
    const endH = dist * Math.sin(rig.pitch);
    const endLook = pivot.clone().addScaledVector(dir, -2);
    const fwd = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    const cityLook = p.position.clone().addScaledVector(fwd, 28).setY(p.position.y + 6);
    const startAz = yawC + 2.4;
    const R0 = 170;
    const H0 = 105;
    const dur = 7;
    let t = 0;
    let finished = false;
    const pos = new THREE.Vector3();
    const look = new THREE.Vector3();
    const toCam = new THREE.Vector3();
    p.controlLock = dur + 1;
    const overlay = arrivalOverlay(this.ctx, () => !finished && rig.isScripted && token === this.sessionToken && this.session.active, () => finish());
    this.ui.showBanner(title, blurb);
    const finish = () => {
      if (finished) return;
      finished = true;
      rig.setScripted(null);
      rig.snapBehind();
      p.controlLock = 0;
      overlay.close(true);
    };
    rig.setScripted((dt, cam) => {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const az = startAz + (yawC - startAz) * e;
      const r = R0 * Math.pow(endR / R0, e);
      const hk = Math.pow(Math.max(0, (r - endR) / (R0 - endR)), 0.85);
      pos.set(pivot.x + Math.sin(az) * r, pivot.y + endH + (H0 - endH) * hk, pivot.z + Math.cos(az) * r);
      if (r < 30) {
        // Close to the Avatar: keep architecture from blocking the view, like the follow camera.
        toCam.copy(pos).sub(pivot);
        const len = toCam.length();
        toCam.divideScalar(len);
        const hit = this.world.raycast(pivot, toCam, len + 0.4);
        if (hit) pos.copy(pivot).addScaledVector(toCam, Math.max(0.8, hit.distance - 0.4));
      }
      const gh = this.world.heightAt(pos.x, pos.z) + 1.2;
      if (pos.y < gh) pos.y = gh;
      cam.position.copy(pos);
      const lk = Math.min(1, Math.max(0, (k - 0.35) / 0.6));
      look.copy(cityLook).lerp(endLook, lk * lk * (3 - 2 * lk));
      cam.lookAt(look);
      const skip = t > 0.6 && (this.input.wasPressed('jump') || this.input.wasPressed('interact') || this.input.wasPressed('attack'));
      if (k >= 1 || skip) finish();
    });
  }

  async newGame(cfg: NewGameConfig): Promise<void> {
    if (this.session.active) this.endSession();
    this.save.resetAll();
    this.progression.setupNewGame(cfg.element);
    const p = this.playerEntity;
    p.characterName = cfg.name.trim().slice(0, 24) || 'Avatar';
    p.setAppearance(cfg.appearance);
    p.element = cfg.element;
    p.waterReserve = 0;
    const s = STARTS[cfg.element];
    const spawn = new THREE.Vector3(s.spawn.x, s.spawn.y ?? 0, s.spawn.z);
    p.safePoint.copy(spawn);
    await this.beginSession('campaign', spawn, s.yaw, true, cfg.slot);
  }

  async loadGame(slot: string): Promise<boolean> {
    if (this.session.active) this.endSession();
    if (!this.save.load(slot)) {
      this.ui.notify('That save could not be loaded.', 'error');
      return false;
    }
    const p = this.playerEntity;
    let spawn = p.safePoint.clone();
    if (!this.validSpawn(spawn)) {
      const s = STARTS[this.progression.startingElement];
      spawn = new THREE.Vector3(s.spawn.x, s.spawn.y ?? 0, s.spawn.z);
      p.safePoint.copy(spawn);
    }
    await this.beginSession('campaign', spawn, p.yaw, false, slot);
    this.events.emit('save:loaded', { slot });
    return true;
  }

  async startTutorial(): Promise<void> {
    if (this.session.active) this.endSession();
    this.save.resetAll();
    this.progression.setupSandbox();
    const p = this.playerEntity;
    p.characterName = 'Avatar';
    if (!p.appearance) p.setAppearance(structuredClone(DEFAULT_APPEARANCE.air));
    p.element = 'air';
    // Carried water exists only while waterbending: the pond beside the spawn is where to draw it.
    p.waterReserve = 0;
    const spawn = new THREE.Vector3(TUTORIAL_SPAWN.x, 0, TUTORIAL_SPAWN.z);
    await this.beginSession('tutorial', spawn, TUTORIAL_SPAWN.yaw, true, null);
  }

  /** End the current session and return to the main menu. */
  exitToMenu(saveFirst: boolean): void {
    if (saveFirst && this.session.kind === 'campaign' && this.session.slot) this.save.save(this.session.slot);
    this.endSession();
    this.enterMenu();
  }

  endSession(): void {
    if (!this.session.active) return;
    const kind = this.session.kind!;
    this.events.emit('session:ending', { kind });
    for (const s of this.systems) {
      try {
        s.sys.onSessionEnd?.(this.ctx);
      } catch (err) {
        console.error(`[Game] onSessionEnd failed for ${s.name}`, err);
      }
    }
    this.world.onSessionEnd();
    this.combat.clear();
    this.entities.clear((e) => e === this.playerEntity);
    // The player persists across sessions: detach without disposing.
    this.entities.remove(this.playerEntity, false);
    this.vfx.clear();
    this.cameraRig.setScripted(null);
    this.session.active = false;
    this.session.kind = null;
    this.session.slot = null;
    this.save.activeSlot = null;
    this.save.writesEnabled = true;
    this.paused = false;
    this.input.releasePointerLock();
    this.ui.hideHUD();
    this.events.emit('session:ended', { kind });
  }

  saveGame(slot?: string): boolean {
    if (this.session.kind !== 'campaign') return false;
    const s = slot ?? this.session.slot;
    if (!s) return false;
    const ok = this.save.save(s);
    if (ok) {
      this.session.slot = s;
      this.save.activeSlot = s;
    }
    return ok;
  }

  private lastAutosaveReal = 0;
  requestAutosave(force: boolean): void {
    if (this.session.kind !== 'campaign' || !this.session.slot || this.playerEntity.defeated) return;
    if (!force && this.time.real - this.lastAutosaveReal < 30) return;
    if (this.time.real - this.lastAutosaveReal < 3) return;
    this.lastAutosaveReal = this.time.real;
    this.save.save(this.session.slot, true);
  }
}
