import type { GameContext } from '../core/GameContext';
import type { Action } from '../core/Input';
import type { NotifyKind } from '../core/types';
import { h, clear } from './dom';
import { HUD } from './hud/HUD';
import { emblem } from './icons';
import { MainMenu } from './screens/MainMenu';
import { NewGameFlow } from './screens/NewGameFlow';
import { PauseScreen } from './screens/PauseScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SaveLoadScreen } from './screens/SaveLoadScreen';
import { registerGameScreens } from './screens/GameScreens';
import { TouchControls } from './TouchControls';

/**
 * A UI screen. Modal screens block gameplay input and release the mouse.
 * `pausesGame` screens also freeze the simulation (map, journal, menus).
 */
export interface Screen {
  readonly id: string;
  readonly el: HTMLElement;
  modal: boolean;
  pausesGame?: boolean;
  onOpen?(ctx: GameContext, arg?: unknown): void;
  onClose?(): void;
  update?(dt: number): void;
  /** Return true if the key was handled. */
  onKey?(e: KeyboardEvent): boolean;
}

export type ScreenFactory = (ui: UIManager) => Screen;

export interface DialogueView {
  speaker: string;
  text: string;
  choices: Array<{ text: string; onSelect: () => void }>;
}

const TIPS = [
  'Waterbenders cannot create water from nothing — stay near rivers, the sea, ponds or snow, or carry water with you.',
  'Masters across the Four Nations teach techniques no scroll can. Look for the ✦ above their heads.',
  'Hold Jump while falling to glide as an Airbender.',
  'Earthbenders are hard to knock down. Firebenders strike fastest. Find your rhythm.',
  'The Avatar State can be entered at will — but your spirit needs time to recover.',
  'Master all four elements to awaken the Elements Sphere.',
  'Animals remember kindness. Bring the right food and approach slowly.',
  'Press M for the world map, J for your journal, K for techniques.',
];

export class UIManager {
  ctx!: GameContext;
  readonly layers: { hud: HTMLElement; screens: HTMLElement; overlay: HTMLElement; toasts: HTMLElement; top: HTMLElement };
  private screens = new Map<string, ScreenFactory>();
  private instances = new Map<string, Screen>();
  private stack: Screen[] = [];
  hud!: HUD;
  touch!: TouchControls;
  private dialogueEl: HTMLElement | null = null;
  private dialogueChoices: Array<() => void> = [];
  private loadingEl: HTMLElement | null = null;
  private defeatEl: HTMLElement | null = null;
  private confirmEl: HTMLElement | null = null;
  private hidden = false;
  private hudVisible = false;

  constructor(readonly root: HTMLElement) {
    this.layers = {
      hud: h('div.layer'),
      screens: h('div.layer'),
      overlay: h('div.layer'),
      toasts: h('div.toasts'),
      top: h('div.layer.always'),
    };
    root.append(this.layers.hud, this.layers.screens, this.layers.overlay, this.layers.toasts, this.layers.top);
  }

  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.hud = new HUD(this, ctx);
    this.layers.hud.appendChild(this.hud.el);
    this.hud.el.classList.add('hidden');
    this.touch = new TouchControls(ctx);
    this.layers.hud.appendChild(this.touch.el);
    this.registerScreen('mainMenu', (ui) => new MainMenu(ui));
    this.registerScreen('newGame', (ui) => new NewGameFlow(ui));
    this.registerScreen('pause', (ui) => new PauseScreen(ui));
    this.registerScreen('settings', (ui) => new SettingsScreen(ui));
    this.registerScreen('saveload', (ui) => new SaveLoadScreen(ui));
    registerGameScreens(this);
    ctx.events.on('ui:notify', (e) => this.notify(e.text, e.kind ?? 'info', e.duration, e.icon));
    ctx.events.on('player:defeated', () => this.showDefeat());
    ctx.events.on('player:respawned', () => this.hideDefeat());
    ctx.events.on('location:discovered', (e) => {
      if (ctx.session.active) this.notify(`Discovered: ${e.name}`, 'discovery', 4);
    });
    ctx.events.on('region:entered', (e) => {
      if (ctx.session.active && ctx.game.mode === 'play') this.showBanner(e.name, ctx.world.regionAt(ctx.player!.position.x, ctx.player!.position.z)?.blurb ?? '');
    });
    ctx.events.on('technique:learned', (e) => {
      if (e.source === 'start' || e.source === 'debug') return;
      import('../combat/CombatSystem').then(({ getTechnique }) => {
        const def = getTechnique(e.id);
        if (def) this.notify(`Technique learned: ${def.name}`, 'learn', 5);
      });
    });
    ctx.events.on('save:written', (e) => {
      if (!e.auto) this.notify('Game saved.', 'success', 2);
    });
    ctx.events.on('save:failed', () => this.notify('Saving failed — browser storage may be full or disabled.', 'error', 4));
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  registerScreen(id: string, factory: ScreenFactory): void {
    this.screens.set(id, factory);
  }

  private instance(id: string): Screen | null {
    let s = this.instances.get(id);
    if (!s) {
      const f = this.screens.get(id);
      if (!f) return null;
      s = f(this);
      this.instances.set(id, s);
    }
    return s;
  }

  get currentScreen(): string | null {
    return this.stack.length ? this.stack[this.stack.length - 1].id : null;
  }

  isOpen(id: string): boolean {
    return this.stack.some((s) => s.id === id);
  }

  /** True when gameplay input must be ignored. */
  get blocksGameplay(): boolean {
    return this.stack.some((s) => s.modal) || !!this.dialogueEl || !!this.loadingEl || !!this.confirmEl;
  }

  /** True when the simulation should freeze (menus open). */
  get freezesSim(): boolean {
    return this.stack.some((s) => s.pausesGame);
  }

  open(id: string, arg?: unknown): Screen | null {
    const s = this.instance(id);
    if (!s) return null;
    if (this.stack.includes(s)) {
      this.stack.splice(this.stack.indexOf(s), 1);
    }
    this.stack.push(s);
    this.layers.screens.appendChild(s.el);
    s.el.classList.remove('hidden');
    if (s.modal) this.ctx.input.releasePointerLock();
    try {
      s.onOpen?.(this.ctx, arg);
    } catch (err) {
      console.error(`[UI] onOpen failed for ${id}`, err);
    }
    this.ctx.events.emit('ui:screen', { screen: id });
    return s;
  }

  close(id?: string): void {
    const s = id ? this.stack.find((x) => x.id === id) : this.stack[this.stack.length - 1];
    if (!s) return;
    this.stack.splice(this.stack.indexOf(s), 1);
    s.el.remove();
    try {
      s.onClose?.();
    } catch (err) {
      console.error(`[UI] onClose failed for ${s.id}`, err);
    }
    this.ctx.events.emit('ui:screen', { screen: this.currentScreen });
    if (this.ctx.game.mode === 'play' && !this.blocksGameplay && !this.ctx.game.paused) this.ctx.input.requestPointerLock();
  }

  closeAll(): void {
    while (this.stack.length) this.close();
  }

  toggle(id: string): void {
    if (this.currentScreen === id) this.close();
    else if (!this.blocksGameplay || this.stack.some((s) => s.pausesGame && s.id !== 'pause')) {
      if (this.stack.length && this.stack[this.stack.length - 1].pausesGame) this.close();
      this.open(id);
    }
  }

  private onKeyDown(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') (e.target as HTMLElement).blur();
      return;
    }
    if (this.confirmEl && e.key === 'Escape') {
      this.confirmEl.remove();
      this.confirmEl = null;
      return;
    }
    if (this.dialogueEl) {
      const n = Number(e.key);
      if (n >= 1 && n <= this.dialogueChoices.length) {
        e.preventDefault();
        this.dialogueChoices[n - 1]();
        return;
      }
      if ((e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.key === ' ') && this.dialogueChoices.length === 1) {
        e.preventDefault();
        this.dialogueChoices[0]();
        return;
      }
    }
    const top = this.stack[this.stack.length - 1];
    if (top?.onKey?.(e)) return;
    if (e.key === 'Escape' && top) {
      if (top.id === 'mainMenu') return;
      if (top.id === 'pause') this.ctx.game.setPaused(false);
      else this.close();
    }
  }

  /** Called each frame by Game. */
  update(dt: number): void {
    const ctx = this.ctx;
    for (const s of this.stack) s.update?.(dt);
    if (ctx.game.mode === 'play') {
      const input = ctx.input;
      if (!this.loadingEl && !this.dialogueEl && !this.confirmEl) {
        const toggles: Array<[Action, string]> = [
          ['map', 'map'],
          ['journal', 'journal'],
          ['inventory', 'inventory'],
          ['techniques', 'techniques'],
          ['companions', 'companions'],
          ['character', 'character'],
        ];
        if (!ctx.game.paused) {
          for (const [a, id] of toggles) if (input.wasPressed(a) && this.screens.has(id)) this.toggle(id);
        }
        if (input.wasPressed('pause') && !this.stack.length) ctx.game.setPaused(true);
      }
      if (this.hudVisible) {
        this.hud.update(dt);
        this.touch.update();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Flows
  // ---------------------------------------------------------------------------

  showMainMenu(): void {
    this.closeAll();
    this.hideHUD();
    this.open('mainMenu');
  }

  showHUD(): void {
    this.closeAll();
    this.hudVisible = true;
    this.hud.el.classList.remove('hidden');
    this.hud.onShow();
    this.touch.refresh();
  }

  hideHUD(): void {
    this.hudVisible = false;
    this.hud.el.classList.add('hidden');
    this.touch?.setVisible(false);
    this.hideDialogue();
    this.hideDefeat();
  }

  showPause(): void {
    this.open('pause');
  }

  hidePause(): void {
    this.close('pause');
    this.close('settings');
    this.close('saveload');
  }

  setHidden(hide: boolean): void {
    this.hidden = hide;
    this.root.classList.toggle('hidden', hide);
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  showLoading(title: string): void {
    this.closeAll();
    this.hideLoading();
    const bar = h('div');
    const label = h('div.muted', { style: { marginTop: '10px', fontSize: '14px' } }, 'Preparing…');
    this.loadingEl = h(
      'div.loading',
      h('div.emblems', emblem('water'), emblem('earth'), emblem('fire'), emblem('air')),
      h('h2.title', { style: { margin: '0', fontSize: 'clamp(22px,3vw,34px)' } }, title),
      h('div.progress', bar),
      label,
      h('div.tip', TIPS[Math.floor(Math.random() * TIPS.length)]),
    );
    (this.loadingEl as any)._bar = bar;
    (this.loadingEl as any)._label = label;
    this.layers.top.appendChild(this.loadingEl);
  }

  setLoadingProgress(f: number, label: string): void {
    if (!this.loadingEl) return;
    (this.loadingEl as any)._bar.style.width = `${Math.round(f * 100)}%`;
    (this.loadingEl as any)._label.textContent = label;
  }

  hideLoading(): void {
    this.loadingEl?.remove();
    this.loadingEl = null;
  }

  // ---------------------------------------------------------------------------
  // Notifications & banners
  // ---------------------------------------------------------------------------

  notify(text: string, kind: NotifyKind = 'info', duration = 3, icon?: string): void {
    const el = h(`div.toast.${kind}`, icon ? `${icon} ${text}` : text);
    this.layers.toasts.appendChild(el);
    while (this.layers.toasts.children.length > 6) this.layers.toasts.firstElementChild?.remove();
    if (kind === 'learn' || kind === 'quest' || kind === 'avatar') this.ctx?.audio.play('notify', { bus: 'ui', volume: 0.6 });
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }, duration * 1000);
  }

  private bannerEl: HTMLElement | null = null;
  showBanner(title: string, subtitle = ''): void {
    this.bannerEl?.remove();
    this.bannerEl = h('div.banner', h('h1', title), subtitle ? h('p', subtitle) : null);
    this.layers.overlay.appendChild(this.bannerEl);
    const el = this.bannerEl;
    setTimeout(() => el.remove(), 4600);
  }

  // ---------------------------------------------------------------------------
  // Dialogue
  // ---------------------------------------------------------------------------

  showDialogue(v: DialogueView): void {
    this.ctx.input.releasePointerLock();
    if (!this.dialogueEl) {
      this.dialogueEl = h('div.dialogue.panel');
      this.layers.overlay.appendChild(this.dialogueEl);
    }
    const el = this.dialogueEl;
    clear(el);
    this.dialogueChoices = v.choices.map((c) => () => {
      this.ctx.audio.play('ui_click', { bus: 'ui' });
      c.onSelect();
    });
    el.append(
      h('div.speaker', v.speaker),
      h('div.text', v.text),
      h(
        'div.choices',
        v.choices.map((c, i) => h('button.btn.choice', { onclick: this.dialogueChoices[i] }, h('span.kbd', String(i + 1)), ' ', c.text)),
      ),
    );
  }

  hideDialogue(): void {
    this.dialogueEl?.remove();
    this.dialogueEl = null;
    this.dialogueChoices = [];
    if (this.ctx?.game.mode === 'play' && !this.blocksGameplay && !this.ctx.game.paused) this.ctx.input.requestPointerLock();
  }

  get dialogueOpen(): boolean {
    return !!this.dialogueEl;
  }

  // ---------------------------------------------------------------------------
  // Confirm & defeat
  // ---------------------------------------------------------------------------

  confirm(message: string, buttons: Array<{ text: string; primary?: boolean; danger?: boolean; onClick?: () => void }>): void {
    this.confirmEl?.remove();
    const close = () => {
      this.confirmEl?.remove();
      this.confirmEl = null;
    };
    this.confirmEl = h(
      'div.modal-backdrop',
      h(
        'div.confirm.panel',
        h('p', { style: { fontSize: '18px', margin: '0 0 18px' } }, message),
        h(
          'div.row',
          { style: { justifyContent: 'center', flexWrap: 'wrap' } },
          buttons.map((b) =>
            h(
              `button.btn${b.primary ? '.primary' : ''}${b.danger ? '.danger' : ''}`,
              {
                onclick: () => {
                  close();
                  this.ctx.audio.play('ui_click', { bus: 'ui' });
                  b.onClick?.();
                },
              },
              b.text,
            ),
          ),
        ),
      ),
    );
    this.layers.top.appendChild(this.confirmEl);
  }

  private showDefeat(): void {
    this.hideDefeat();
    this.ctx.input.releasePointerLock();
    this.defeatEl = h(
      'div.defeat',
      h('h1', 'You have fallen'),
      h('p.muted', { style: { fontSize: '18px', marginBottom: '22px', textAlign: 'center', maxWidth: '90vw' } }, 'The Avatar endures. Rest, gather your strength, and rise again.'),
      h('button.btn.primary', { onclick: () => this.ctx.player?.recover() }, 'Recover'),
    );
    this.layers.overlay.appendChild(this.defeatEl);
  }

  private hideDefeat(): void {
    this.defeatEl?.remove();
    this.defeatEl = null;
  }
}
