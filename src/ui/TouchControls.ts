import { getTechnique } from '../combat/CombatSystem';
import type { GameContext } from '../core/GameContext';
import { ELEMENT_INFO } from '../core/types';
import type { Action } from '../core/Input';
import { h } from './dom';

/**
 * On-screen touch controls: a floating move stick (left), drag-to-look
 * (right half), and action buttons. Feeds Input's virtual action API so all
 * gameplay code works unchanged. Shown when settings.controls.touchControls is
 * 'on', or 'auto' on coarse-pointer / touch devices.
 */
export class TouchControls {
  readonly el: HTMLElement;
  private stick: HTMLElement;
  private nub: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private visible = false;
  private touchSeen = false;
  private sideL: HTMLElement[] = [];
  private sideR: HTMLElement[] = [];
  private layoutTimer = 0;

  constructor(private readonly ctx: GameContext) {
    this.nub = h('div.nub');
    this.stick = h('div.stick', this.nub);
    const btn = (label: string, action: Action, style: Partial<CSSStyleDeclaration>, hold = false) => {
      const b = h('div.tbtn', { 'data-touch': action }, label);
      Object.assign(b.style, style);
      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('active');
        this.ctx.input.setVirtual(action, true);
        if (!hold) setTimeout(() => this.ctx.input.setVirtual(action, false), 90);
      };
      const up = (e: PointerEvent) => {
        e.preventDefault();
        b.classList.remove('active');
        if (hold) this.ctx.input.setVirtual(action, false);
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      return b;
    };
    const R = (r: number, b: number) => ({ right: `${r}px`, bottom: `${b}px` });
    this.el = h(
      'div.touch.hidden',
      this.stick,
      btn('JUMP', 'jump', R(24, 24), true),
      btn('ATK', 'attack', R(94, 24), true),
      btn('DODGE', 'dodge', R(164, 24)),
      btn('HVY', 'aim', R(24, 94), true),
      btn('1', 'ability1', R(94, 94)),
      btn('2', 'ability2', R(164, 94)),
      btn('3', 'ability3', R(24, 164)),
      btn('4', 'ability4', R(94, 164)),
      btn('E', 'interact', R(164, 164)),
    );
    // Side columns: placed under the HUD blocks by layoutSides().
    this.sideR = [btn('◐', 'elementNext', { right: '24px', top: '150px' }), btn('AVTR', 'avatarState', { right: '24px', top: '218px' }), btn('DRAW', 'drawWater', { right: '24px', top: '286px' }, true)];
    this.sideL = [btn('☰', 'pause', { left: '24px', top: '150px' }), btn('MAP', 'map', { left: '24px', top: '218px' }), btn('F', 'companion', { left: '24px', top: '286px' })];
    this.el.append(...this.sideR, ...this.sideL);
    // Movement stick: anywhere on the left 40% of the screen.
    const surface = h('div', { style: { position: 'absolute', left: '0', top: '0', width: '42%', height: '100%', pointerEvents: 'auto', touchAction: 'none' } });
    const lookSurface = h('div', { style: { position: 'absolute', right: '0', top: '0', width: '58%', height: '100%', pointerEvents: 'auto', touchAction: 'none' } });
    this.el.prepend(surface, lookSurface);
    surface.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      surface.setPointerCapture(e.pointerId);
      this.stickOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX - 65}px`;
      this.stick.style.top = `${e.clientY - 65}px`;
      this.stick.style.bottom = 'auto';
      this.updateStick(e.clientX, e.clientY);
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.ctx.input.setVirtualMove(0, 0);
      this.ctx.input.setVirtual('sprint', false);
      this.nub.style.transform = 'translate(0px, 0px)';
      this.stick.style.left = '24px';
      this.stick.style.top = 'auto';
      this.stick.style.bottom = '24px';
    };
    surface.addEventListener('pointerup', endStick);
    surface.addEventListener('pointercancel', endStick);
    lookSurface.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      lookSurface.setPointerCapture(e.pointerId);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    lookSurface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.ctx.input.addLook((e.clientX - this.lookLast.x) * 2.2, (e.clientY - this.lookLast.y) * 2.2, 'touch');
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    lookSurface.addEventListener('pointerup', endLook);
    lookSurface.addEventListener('pointercancel', endLook);
    ctx.events.on('settings:changed', () => this.refresh());
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      this.touchSeen = true;
      if (ctx.settings.data.controls.touchControls === 'auto') this.refresh();
    });
  }

  private updateStick(x: number, y: number): void {
    const dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const max = 55;
    const len = Math.hypot(dx, dy);
    const k = len > max ? max / len : 1;
    this.nub.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const nx = (dx * k) / max, ny = (-dy * k) / max;
    this.ctx.input.setVirtualMove(nx, ny);
    // Push the stick to the edge to sprint.
    this.ctx.input.setVirtual('sprint', len > max * 1.15);
  }

  /** Decide visibility from settings and device; only ever shown in play (never over menus or the creator). */
  refresh(touchSeen = false): void {
    if (touchSeen) this.touchSeen = true;
    const mode = this.ctx.settings.data.controls.touchControls;
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const inGame = this.ctx.session.active && this.ctx.game.mode === 'play';
    const show = inGame && (mode === 'on' || (mode === 'auto' && (coarse || this.touchSeen || this.ctx.input.lastDevice === 'touch')));
    this.setVisible(show);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    document.getElementById('ui')?.classList.toggle('touch-on', v);
    if (v) this.layoutSides();
  }

  /**
   * Keep the side button columns clear of the HUD: the left column starts under
   * the vitals, the right one under the quest tracker (both change size with
   * UI scale and quest text), without running into the bottom action cluster.
   */
  private layoutSides(): void {
    const H = window.innerHeight;
    const step = 66;
    const clusterTop = H - 24 - 164 - 58; // top edge of the bottom-right action cluster / move stick zone
    const below = (sel: string, fallback: number) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.offsetParent === null) return fallback;
      const r = el.getBoundingClientRect();
      return r.height > 0 ? Math.max(fallback, r.bottom + 10) : fallback;
    };
    const place = (col: HTMLElement[], top: number) => {
      const t = Math.max(8, Math.min(top, clusterTop - 10 - col.length * step));
      col.forEach((b, i) => (b.style.top = `${Math.round(t + i * step)}px`));
    };
    place(this.sideL, below('.hud-vitals', 96));
    place(this.sideR, below('.hud-quest', 96));
  }

  get shown(): boolean {
    return this.visible;
  }

  private labelSig = '';
  /** Keep ability buttons labelled with the equipped techniques and the element button with the active element. */
  update(): void {
    if (!this.visible) return;
    const p = this.ctx.player;
    if (!p) return;
    const now = performance.now();
    if (now - this.layoutTimer > 500) {
      this.layoutTimer = now;
      this.layoutSides();
    }
    const sphere = this.ctx.avatar.sphereActive;
    const ids = sphere ? ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado'] : this.ctx.progression.slotsFor(p.element);
    const sig = `${p.element}|${ids.join(',')}`;
    if (sig === this.labelSig) return;
    this.labelSig = sig;
    ids.forEach((id, i) => {
      const b = this.el.querySelector(`[data-touch="ability${i + 1}"]`) as HTMLElement | null;
      if (!b) return;
      const name = id ? getTechnique(id)?.name ?? '' : '';
      b.textContent = name ? name.split(' ').slice(-1)[0].slice(0, 7) : String(i + 1);
      b.style.opacity = id ? '1' : '0.45';
    });
    const el = this.el.querySelector('[data-touch="elementNext"]') as HTMLElement | null;
    if (el) el.textContent = ELEMENT_INFO[p.element].name.toUpperCase();
  }
}
