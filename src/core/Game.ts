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

/** Menu backdrop: a slow orbit above the Southern Air Temple's sea of clouds. */
const MENU_FOCUS = new THREE.Vector3(1450, 330, 1250);

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
  private menuAngle = 0;
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
      else this.render.render(dt);
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
    this.menuAngle += dt * 0.035;
    const cam = this.render.camera;
    const r = 340;
    cam.position.set(MENU_FOCUS.x + Math.cos(this.menuAngle) * r, MENU_FOCUS.y + 70 + Math.sin(this.menuAngle * 0.7) * 15, MENU_FOCUS.z + Math.sin(this.menuAngle) * r);
    cam.lookAt(MENU_FOCUS.x, MENU_FOCUS.y - 10, MENU_FOCUS.z);
    this.world.updateAmbient(dt, MENU_FOCUS);
    this.vfx.update(dt);
    this.render.setShadowFocus(MENU_FOCUS);
  }

  enterMenu(): void {
    this.setMode('menu');
    this.paused = false;
    this.world.sky.secondsPerHour = 40;
    this.audio.setMusicTheme('menu');
    this.ui.showMainMenu();
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
    await this.world.preload(spawn, (f, label) => this.ui.setLoadingProgress(f, label));
    if (token !== this.sessionToken) return;
    const player = this.playerEntity;
    const g = this.world.groundAt(spawn.x, spawn.z, spawn.y + 50);
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

  /** Short cinematic: sweep down from the sky onto the Avatar, then hand over control. */
  private playArrival(title: string, blurb: string): void {
    const p = this.playerEntity;
    const target = p.position.clone();
    const start = target.clone().add(new THREE.Vector3(Math.sin(p.yaw) * 90, 70, Math.cos(p.yaw) * 90));
    const end = target.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 5.5, 2.4, -Math.cos(p.yaw) * 5.5));
    let t = 0;
    const dur = 4.2;
    p.controlLock = dur;
    this.ui.showBanner(title, blurb);
    this.cameraRig.setScripted((dt, cam) => {
      t += dt;
      const k = Math.min(1, t / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      cam.position.lerpVectors(start, end, e);
      const look = target.clone().setY(target.y + 1.5 + (1 - e) * 4);
      cam.lookAt(look);
      if (k >= 1 || (t > 0.8 && this.input.wasPressed('pause'))) {
        this.cameraRig.setScripted(null);
        this.cameraRig.snapBehind();
        p.controlLock = 0;
      }
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
    const spawn = new THREE.Vector3(s.spawn.x, 0, s.spawn.z);
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
      spawn = new THREE.Vector3(s.spawn.x, 0, s.spawn.z);
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
    p.waterReserve = 30;
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
