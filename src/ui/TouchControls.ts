import { SPIRIT_TO_ENTER } from '../avatar/AvatarStateSystem';
import { getTechnique } from '../combat/CombatSystem';
import type { GameContext } from '../core/GameContext';
import type { Action } from '../core/Input';
import { ELEMENT_INFO } from '../core/types';
import { h } from './dom';
import { ELEMENT_COLORS, ELEMENT_SVG, iconHTML } from './icons';
import type { Screen } from './UIManager';

/**
 * On-screen touch controls (phones / tablets), feeding Input's virtual action
 * API so all gameplay code works unchanged:
 *  - floating move stick on the left 45 % (push to the rim, or latch SPRINT, to run),
 *  - drag anywhere on the right to look,
 *  - a thumb arc around ATTACK: jump, dodge, heavy, techniques 1-4 (+5 in the Elements Sphere),
 *  - contextual INTERACT pill that shows the prompt ("Talk to Master Pakku"),
 *  - utility buttons placed around the HUD: menu, map, element, Avatar State,
 *    lock-on, companion / mount and Draw Water (lit when a real source is near).
 * Riding and gliding work through the same buttons (they relabel: CLIMB,
 * DESCEND, BOOST, DISMOUNT). Every button is >= 44 px, the layout is computed
 * from the live HUD rectangles and the safe-area insets so nothing overlaps,
 * and it mirrors for left-handed play. Each button / zone tracks its own
 * pointer, so move + look + press work at the same time.
 */

type Size = 'big' | 'mid' | 'small';
interface Btn {
  action: Action;
  el: HTMLElement;
  size: Size;
  hold: boolean;
  icon: HTMLElement;
  cap: HTMLElement;
  cd?: HTMLElement;
  pointer: number | null;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const SVG = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  jump: SVG('<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>'),
  dodge: SVG('<path d="M3 17c5 0 7-9 13-9h5M17 4l4 4-4 4"/><path d="M3 12h4M3 7h2" opacity=".6"/>'),
  heavy: SVG('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
  sprint: SVG('<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>'),
  lock: SVG('<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),
  menu: SVG('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  map: SVG('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>'),
  talk: SVG('<path d="M4 5h16v10H10l-5 4v-4H4z"/>'),
  paw: SVG('<ellipse cx="12" cy="16" rx="4.5" ry="3.5"/><circle cx="6" cy="10" r="1.8"/><circle cx="10" cy="6.5" r="1.8"/><circle cx="14" cy="6.5" r="1.8"/><circle cx="18" cy="10" r="1.8"/>'),
  drop: SVG('<path d="M12 3c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z"/>'),
};

const PHONE_SVG = `<svg viewBox="0 0 120 80" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
<rect x="44" y="6" width="32" height="56" rx="6"/><path d="M56 54h8"/>
<path d="M18 70c10 6 26 6 36 2" opacity=".7"/><path d="M48 68l6 4-4 6" opacity=".7"/>
<rect x="84" y="34" width="32" height="20" rx="4" transform="rotate(0)" opacity=".45"/></svg>`;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const hit = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Portrait during gameplay: a polite pause card asking to rotate (or carry on in portrait). */
class RotateHint implements Screen {
  readonly id = 'rotateHint';
  readonly el: HTMLElement;
  modal = true;
  pausesGame = true;
  constructor(onDismiss: () => void) {
    this.el = h(
      'div.rotate-hint',
      { role: 'dialog', 'aria-label': 'Rotate your device' },
      h(
        'div.rotate-card',
        h('div.rotate-icon', { html: PHONE_SVG }),
        h('h2.title', 'Turn your device sideways'),
        h('p', 'The Four Nations are best explored in landscape: the controls sit under your thumbs and you see more of the world. The game waits while you turn.'),
        h('button.btn', { type: 'button', 'data-action': 'rotate-dismiss', onclick: onDismiss }, 'Play in portrait anyway'),
      ),
    );
  }
}

export class TouchControls {
  readonly el: HTMLElement;
  private stick: HTMLElement;
  private nub: HTMLElement;
  private moveZone: HTMLElement;
  private lookZone: HTMLElement;
  private stickId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private stickRest: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private stickR = 55;
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private visible = false;
  private touchSeen = false;
  private btns = new Map<Action, Btn>();
  private interact: Btn;
  private sprintLatched = false;
  private layoutTimer = 0;
  private layoutSig = '';
  private labelSig = '';
  private waterT = 0;
  private waterOk = false;
  private insetProbe: HTMLElement;
  private rotateDismissed = false;
  private abilityCount = 4;
  private elementPress = { t: 0, long: false, timer: 0 };

  constructor(private readonly ctx: GameContext) {
    this.nub = h('div.nub');
    this.stick = h('div.stick', this.nub);
    this.moveZone = h('div.tzone.move');
    this.lookZone = h('div.tzone.look');
    this.insetProbe = h('div.inset-probe');
    this.el = h('div.touch.hidden', this.moveZone, this.lookZone, this.stick, this.insetProbe);
    const mk = (action: Action, caption: string, icon: string, size: Size, hold = true) => this.mkBtn(action, caption, icon, size, hold);
    mk('attack', 'Attack', '', 'big');
    mk('jump', 'Jump', ICONS.jump, 'mid');
    mk('dodge', 'Dodge', ICONS.dodge, 'mid');
    mk('aim', 'Heavy', ICONS.heavy, 'mid');
    for (let i = 1; i <= 5; i++) mk(`ability${i}` as Action, String(i), '', 'small');
    mk('sprint', 'Sprint', ICONS.sprint, 'small', false);
    mk('pause', 'Menu', ICONS.menu, 'small');
    mk('map', 'Map', ICONS.map, 'small');
    mk('avatarState', 'Avatar', ELEMENT_SVG.avatar, 'small');
    mk('companion', 'Mount', ICONS.paw, 'small');
    mk('elementNext', 'Element', '', 'small', false);
    mk('lockOn', 'Lock', ICONS.lock, 'small');
    mk('drawWater', 'Draw', ICONS.drop, 'small');
    this.interact = mk('interact', 'Interact', ICONS.talk, 'small');
    this.interact.el.classList.add('pill');
    this.installStick();
    this.installLook();
    this.installElementButton();
    installGestureGuards();
    ctx.ui.registerScreen('rotateHint', () =>
      new RotateHint(() => {
        this.rotateDismissed = true;
        ctx.ui.close('rotateHint');
        this.layout(true);
      }),
    );
    ctx.events.on('settings:changed', () => this.refresh());
    const relayout = () => {
      if (this.visible) {
        this.layout(true);
        this.checkOrientation();
      }
    };
    window.addEventListener('resize', relayout);
    window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType !== 'touch') return;
        this.touchSeen = true;
        if (ctx.settings.data.controls.touchControls === 'auto' && !this.visible) this.refresh();
      },
      { capture: true },
    );
    this.installDebug();
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  private mkBtn(action: Action, caption: string, icon: string, size: Size, hold: boolean): Btn {
    const iconEl = h('span.ti', { html: icon });
    const cap = h('span.tc', caption);
    const el = h(`div.tbtn.${size}`, { 'data-touch': action, role: 'button', 'aria-label': caption }, iconEl, cap);
    const b: Btn = { action, el, size, hold, icon: iconEl, cap, pointer: null };
    if (action.startsWith('ability')) {
      b.cd = h('span.tcd');
      el.prepend(b.cd);
    }
    const release = () => {
      if (b.pointer === null) return;
      b.pointer = null;
      el.classList.remove('active');
      if (b.hold) this.ctx.input.setVirtual(action, false);
    };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (b.pointer !== null) return;
      b.pointer = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      el.classList.add('active');
      if (action === 'sprint') {
        this.sprintLatched = !this.sprintLatched;
        el.classList.toggle('on', this.sprintLatched);
        this.ctx.input.setVirtual('sprint', this.sprintLatched || this.stickSprint);
      } else if (b.hold) this.ctx.input.setVirtual(action, true);
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // No synthetic mouse events / ghost click after a touch press (it could land on a menu this button opened).
    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.cancelable) e.preventDefault();
      },
      { passive: false },
    );
    this.btns.set(action, b);
    this.el.append(el);
    return b;
  }

  /** Element button: tap = next element, long-press = previous. */
  private installElementButton(): void {
    const b = this.btns.get('elementNext')!;
    const ep = this.elementPress;
    b.el.addEventListener('pointerdown', () => {
      ep.t = performance.now();
      ep.long = false;
      clearTimeout(ep.timer);
      ep.timer = window.setTimeout(() => {
        if (b.pointer === null) return;
        ep.long = true;
        this.pulse('elementPrev');
        b.el.classList.add('flash');
        setTimeout(() => b.el.classList.remove('flash'), 250);
      }, 450);
    });
    const up = () => {
      clearTimeout(ep.timer);
      if (!ep.long && ep.t && performance.now() - ep.t < 450) this.pulse('elementNext');
      ep.t = 0;
    };
    b.el.addEventListener('pointerup', up);
    b.el.addEventListener('pointercancel', () => {
      clearTimeout(ep.timer);
      ep.t = 0;
    });
  }

  /** A one-shot virtual press (down now, up shortly after). */
  private pulse(action: Action): void {
    this.ctx.input.setVirtual(action, true);
    setTimeout(() => this.ctx.input.setVirtual(action, false), 60);
  }

  // ---------------------------------------------------------------------------
  // Move stick & look
  // ---------------------------------------------------------------------------

  private stickSprint = false;

  private installStick(): void {
    const z = this.moveZone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      try {
        z.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      // The stick appears under the thumb (kept fully on screen).
      const r = this.stickRest.w / 2;
      const x = clamp(e.clientX, r + 4, window.innerWidth - r - 4);
      const y = clamp(e.clientY, r + 4, window.innerHeight - r - 4);
      this.stickOrigin = { x, y };
      this.stick.style.left = `${x - r}px`;
      this.stick.style.top = `${y - r}px`;
      this.stick.classList.add('active');
      this.updateStick(e.clientX, e.clientY);
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.updateStick(e.clientX, e.clientY);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.ctx.input.setVirtualMove(0, 0);
      this.stickSprint = false;
      // Releasing the stick ends a latched sprint too.
      if (this.sprintLatched) {
        this.sprintLatched = false;
        this.btns.get('sprint')?.el.classList.remove('on');
      }
      this.ctx.input.setVirtual('sprint', false);
      this.nub.style.transform = 'translate(0px, 0px)';
      this.stick.classList.remove('active');
      this.stick.style.left = `${this.stickRest.x}px`;
      this.stick.style.top = `${this.stickRest.y}px`;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  private updateStick(x: number, y: number): void {
    const dx = x - this.stickOrigin.x, dy = y - this.stickOrigin.y;
    const max = this.stickR;
    const len = Math.hypot(dx, dy);
    const k = len > max ? max / len : 1;
    this.nub.style.transform = `translate(${(dx * k).toFixed(1)}px, ${(dy * k).toFixed(1)}px)`;
    let nx = (dx * k) / max, ny = (-dy * k) / max;
    if (Math.hypot(nx, ny) < 0.12) nx = ny = 0; // dead zone
    this.ctx.input.setVirtualMove(nx, ny);
    // Push past the rim to sprint (or latch the SPRINT button).
    this.stickSprint = len > max * 1.2;
    this.ctx.input.setVirtual('sprint', this.stickSprint || this.sprintLatched);
    this.stick.classList.toggle('sprint', this.stickSprint || this.sprintLatched);
  }

  private installLook(): void {
    const z = this.lookZone;
    z.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      try {
        z.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    z.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      // Input applies the touch sensitivity setting.
      this.ctx.input.addLook((e.clientX - this.lookLast.x) * 2.2, (e.clientY - this.lookLast.y) * 2.2, 'touch');
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  /** Decide visibility from settings and device; only ever shown in play (never over menus or the creator). */
  refresh(touchSeen = false): void {
    if (touchSeen) this.touchSeen = true;
    const c = this.ctx.settings.data.controls;
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    const inGame = this.ctx.session.active && this.ctx.game.mode === 'play';
    const show = inGame && (c.touchControls === 'on' || (c.touchControls === 'auto' && (coarse || this.touchSeen || this.ctx.settings.device.mobile || this.ctx.input.lastDevice === 'touch')));
    this.el.style.setProperty('--t-op', String(clamp(c.touchOpacity ?? 0.85, 0.25, 1)));
    this.el.classList.toggle('lefty', !!c.touchLeftHanded);
    this.setVisible(show);
    if (show) this.layout(true);
  }

  setVisible(v: boolean): void {
    const was = this.visible;
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    document.getElementById('ui')?.classList.toggle('touch-on', v);
    if (v && !was) {
      this.layout(true);
      this.checkOrientation();
    }
    if (!v) {
      this.releaseAll();
      if (this.ctx.ui.isOpen('rotateHint')) this.ctx.ui.close('rotateHint');
    }
  }

  private releaseAll(): void {
    for (const b of this.btns.values()) {
      if (b.pointer !== null && b.hold) this.ctx.input.setVirtual(b.action, false);
      b.pointer = null;
      b.el.classList.remove('active');
    }
    this.stickId = this.lookId = null;
    this.sprintLatched = this.stickSprint = false;
    this.btns.get('sprint')?.el.classList.remove('on');
    this.ctx.input.setVirtualMove(0, 0);
    this.ctx.input.setVirtual('sprint', false);
  }

  get shown(): boolean {
    return this.visible;
  }

  /** Landscape is the intended play orientation: in portrait, pause with a rotate card (once per session unless dismissed). */
  private checkOrientation(): void {
    const ui = this.ctx.ui;
    const portrait = window.innerHeight > window.innerWidth * 1.05;
    const want = this.visible && portrait && !this.rotateDismissed && this.ctx.game.mode === 'play' && this.ctx.session.active;
    const open = ui.isOpen('rotateHint');
    if (want && !open && !ui.currentScreen) ui.open('rotateHint');
    else if (!want && open) ui.close('rotateHint');
  }

  // ---------------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------------

  private insets(): { t: number; r: number; b: number; l: number } {
    const cs = getComputedStyle(this.insetProbe);
    const n = (v: string) => parseFloat(v) || 0;
    return { t: n(cs.paddingTop), r: n(cs.paddingRight), b: n(cs.paddingBottom), l: n(cs.paddingLeft) };
  }

  private hudRects(): Rect[] {
    const out: Rect[] = [];
    for (const sel of ['.hud .hud-vitals', '.hud .hud-quest']) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el || el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    return out;
  }

  /** Compute every button position from the viewport, safe-area insets, HUD rectangles and settings. */
  layout(force = false): void {
    if (!this.visible) return;
    const W = window.innerWidth, H = window.innerHeight;
    const hud = this.hudRects();
    const c = this.ctx.settings.data.controls;
    const sig = `${W}x${H}|${hud.map((r) => `${r.x | 0},${r.y | 0},${r.w | 0},${r.h | 0}`).join(';')}|${c.touchButtonSize}|${c.touchLeftHanded}|${this.abilityCount}|${this.btns.get('drawWater')!.el.classList.contains('gone')}|${this.btns.get('elementNext')!.el.classList.contains('gone')}`;
    if (!force && sig === this.layoutSig) return;
    this.layoutSig = sig;
    const ins = this.insets();
    const lefty = !!c.touchLeftHanded;
    const near = lefty ? ins.l : ins.r; // the action-cluster side
    const far = lefty ? ins.r : ins.l; // the stick side
    // Positions are computed for a right-handed layout, then mirrored for left-handed play.
    const mirror = (r: Rect): Rect => (lefty ? { ...r, x: W - r.x - r.w } : r);
    const circle = (x: number, y: number, s: number): Rect => ({ x: x - s / 2, y: y - s / 2, w: s, h: s });
    const m = 12;
    const n = this.abilityCount;
    /** Thumb arc around ATTACK in the bottom corner for a given scale. */
    const arc = (u: number) => {
      const S: Record<Size, number> = { big: Math.round(Math.max(64, 74 * u)), mid: Math.round(Math.max(48, 56 * u)), small: Math.round(Math.max(44, 48 * u)) };
      const gap = Math.round(Math.max(6, 8 * u));
      const big = S.big, mid = S.mid, sm = S.small;
      const cx = W - near - m - big / 2;
      const cy = H - ins.b - m - big / 2;
      const at = (r: number, deg: number, sz: number) => circle(cx + r * Math.cos((deg * Math.PI) / 180), cy - r * Math.sin((deg * Math.PI) / 180), sz);
      const r1 = big / 2 + mid / 2 + gap;
      // HEAVY sits on the diagonal, far enough out that the square hit boxes never touch.
      const rd = r1 * 1.3;
      const r2 = rd + mid / 2 + sm / 2 + gap;
      const pos = new Map<Action, Rect>([
        ['attack', circle(cx, cy, big)],
        ['jump', at(r1, 180, mid)],
        ['dodge', at(r1, 90, mid)],
        ['aim', at(rd, 135, mid)],
      ]);
      for (let i = 1; i <= n; i++) pos.set(`ability${i}` as Action, at(r2, n === 1 ? 135 : 180 - ((180 - 84) * (i - 1)) / (n - 1), sm));
      return { S, gap, cx, cy, r2, pos, arcTop: cy - r2 - sm / 2, arcLeft: cx - r2 - sm / 2 };
    };
    // Shrink (down to the 44 px floor) until the arc clears the HUD on its side.
    let u = clamp(Math.min(W, H) / 390, 0.9, 1.3) * clamp(c.touchButtonSize || 1, 0.7, 1.5);
    let A = arc(u);
    for (let i = 0; i < 10 && u > 0.6; i++) {
      if (![...A.pos.values()].some((r) => hud.some((hr) => hit(mirror(r), hr, A.gap / 2)))) break;
      u *= 0.93;
      A = arc(u);
    }
    const { S, gap, cy, arcTop, arcLeft } = A;
    const sm = S.small;
    const occupied: Rect[] = hud.map((r) => ({ ...r }));
    const put = (b: Btn, r0: Rect) => {
      const r = mirror(r0);
      Object.assign(b.el.style, { left: `${Math.round(r.x)}px`, top: `${Math.round(r.y)}px`, width: `${Math.round(r.w)}px`, height: `${Math.round(r.h)}px` });
      b.el.classList.remove('gone-layout');
      occupied.push(r);
    };
    for (const [action, r] of A.pos) put(this.btns.get(action)!, r);
    for (let i = n + 1; i <= 5; i++) this.btns.get(`ability${i}` as Action)!.el.classList.add('gone-layout');

    // Move stick resting place (bottom of the stick side) and its SPRINT latch.
    const stick = Math.round(clamp(120 * u, 104, 150));
    this.stickR = stick * 0.42;
    const rest = mirror({ x: far + m + 6, y: H - ins.b - m - stick - 4, w: stick, h: stick });
    this.stickRest = rest;
    Object.assign(this.stick.style, { width: `${stick}px`, height: `${stick}px` });
    this.nub.style.width = this.nub.style.height = `${Math.round(stick * 0.42)}px`;
    if (this.stickId === null) Object.assign(this.stick.style, { left: `${rest.x}px`, top: `${rest.y}px` });
    occupied.push(rest);
    const restR = lefty ? { ...rest, x: W - rest.x - rest.w } : rest; // right-handed frame
    const sprintRight = restR.x + stick + gap * 1.5 + sm;
    if (sprintRight < arcLeft - sm * 2) put(this.btns.get('sprint')!, { x: restR.x + stick + gap * 1.5, y: restR.y + stick - sm, w: sm, h: sm });
    else put(this.btns.get('sprint')!, { x: restR.x + (stick - sm) / 2, y: restR.y - gap - sm, w: sm, h: sm });

    // Interact pill: left of the arc when there is room, otherwise above it.
    const pillMax = Math.min(280, W * 0.5);
    const iRightX = arcLeft - gap * 1.5;
    if (iRightX - pillMax > W * 0.3) {
      const r = { x: iRightX - pillMax, y: cy - sm / 2, w: pillMax, h: sm };
      this.interactBox = mirror(r);
      occupied.push(this.interactBox);
    } else {
      const r = { x: W - near - m - pillMax, y: arcTop - gap * 2 - sm, w: pillMax, h: sm };
      this.interactBox = mirror(r);
      occupied.push(this.interactBox);
    }
    this.placeInteract();

    // Utility buttons: combat ones near the stick side (under the vitals), the rest along the top.
    const free = (r: Rect) => r.x >= ins.l + 4 && r.y >= ins.t + 4 && r.x + r.w <= W - ins.r - 4 && r.y + r.h <= H - ins.b - 4 && !occupied.some((o) => hit(r, o, gap / 2));
    const pitch = sm + gap;
    const sideCol = (k: number): Rect[] => {
      // Column k on the stick side, from just above the stick upwards.
      const out: Rect[] = [];
      const x = lefty ? W - ins.r - m - sm - k * pitch : ins.l + m + k * pitch;
      for (let y = rest.y - gap * 1.5 - sm; y >= ins.t + 4; y -= pitch) out.push({ x, y, w: sm, h: sm });
      return out;
    };
    const topRow = (): Rect[] => {
      const out: Rect[] = [];
      const y = ins.t + m;
      const x0 = W / 2 - sm / 2;
      for (let k = 0; k < 20; k++) {
        const dx = Math.ceil(k / 2) * pitch * (k % 2 ? 1 : -1);
        out.push({ x: x0 + dx, y, w: sm, h: sm });
      }
      return out;
    };
    const farCol = (k: number): Rect[] => {
      // Column on the cluster side, from the top down to the arc.
      const out: Rect[] = [];
      const x = lefty ? ins.l + m + k * pitch : W - ins.r - m - sm - k * pitch;
      for (let y = ins.t + m; y + sm <= arcTop - gap; y += pitch) out.push({ x, y, w: sm, h: sm });
      return out;
    };
    const lattice = (): Rect[] => {
      const out: Rect[] = [];
      for (let y = ins.t + m; y + sm < H - ins.b; y += pitch) for (let x = ins.l + m; x + sm < W - ins.r; x += pitch) out.push({ x, y, w: sm, h: sm });
      return out;
    };
    const place = (action: Action, cands: Rect[][]) => {
      const b = this.btns.get(action)!;
      if (b.el.classList.contains('gone')) return;
      for (const list of [...cands, lattice()]) {
        for (const r of list) {
          if (free(r)) {
            Object.assign(b.el.style, { left: `${Math.round(r.x)}px`, top: `${Math.round(r.y)}px`, width: `${sm}px`, height: `${sm}px` });
            b.el.classList.remove('gone-layout');
            occupied.push(r);
            return;
          }
        }
      }
      b.el.classList.add('gone-layout'); // no room at all (absurdly small screen)
    };
    const near1 = [sideCol(0), sideCol(1), farCol(0), topRow()];
    place('elementNext', near1);
    place('lockOn', near1);
    place('drawWater', near1);
    const top = [topRow(), farCol(0), farCol(1), sideCol(0), sideCol(1)];
    place('pause', top);
    place('map', top);
    place('avatarState', top);
    place('companion', top);
    // Look covers the screen except the stick side.
    const split = Math.round(W * 0.45);
    Object.assign(this.moveZone.style, lefty ? { left: `${W - split}px`, width: `${split}px` } : { left: '0px', width: `${split}px` });
    Object.assign(this.lookZone.style, lefty ? { left: '0px', width: `${W - split}px` } : { left: `${split}px`, width: `${W - split}px` });
  }

  private interactBox: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private interactLabel = '';
  private interactSeen = 0;

  /** The interact pill hugs the side nearest the arc and grows with its label (up to the reserved box). */
  private placeInteract(): void {
    const b = this.interact;
    const box = this.interactBox;
    const lefty = !!this.ctx.settings.data.controls.touchLeftHanded;
    const sm = box.h;
    // Natural width: padding + icon + gap + the caption's full text width (its own scrollWidth ignores the ellipsis).
    const w = this.interactLabel ? Math.min(box.w, Math.max(sm * 2.4, 12 + 22 + 8 + b.cap.scrollWidth + 18 + 4)) : sm;
    const x = lefty ? box.x : box.x + box.w - w;
    Object.assign(b.el.style, { left: `${Math.round(x)}px`, top: `${Math.round(box.y)}px`, width: `${Math.round(w)}px`, height: `${sm}px`, maxWidth: `${Math.round(box.w)}px` });
  }

  // ---------------------------------------------------------------------------
  // Per-frame: labels, cooldowns, context
  // ---------------------------------------------------------------------------

  update(): void {
    if (!this.visible) return;
    const ctx = this.ctx;
    const p = ctx.player;
    if (!p) return;
    this.el.classList.toggle('blocked', ctx.ui.blocksGameplay);
    const now = performance.now();
    if (now - this.layoutTimer > 400) {
      this.layoutTimer = now;
      this.layout();
      this.checkOrientation();
    }
    const sphere = ctx.avatar.sphereActive;
    const ids = sphere ? ['ult_hurricane', 'ult_tsunami', 'ult_earthquake', 'ult_fire_tornado', 'ult_cataclysm'] : ctx.progression.slotsFor(p.element).slice(0, 4);
    const count = sphere ? 5 : 4;
    const cs = ctx.companions;
    const waterEl = p.element === 'water' && ctx.progression.canBend('water');
    const multi = ctx.progression.unlocked.size > 1;
    const sig = `${p.element}|${ids.join(',')}|${cs.mounted}|${cs.mountedFlying}|${waterEl}|${multi}|${ctx.avatar.active}`;
    if (sig !== this.labelSig) {
      this.labelSig = sig;
      ids.forEach((id, i) => {
        const b = this.btns.get(`ability${i + 1}` as Action);
        if (!b) return;
        const def = id ? getTechnique(id) : undefined;
        b.icon.innerHTML = def ? iconHTML(def.icon) : '';
        setCap(b, def ? shortName(def.name) : String(i + 1));
        b.el.classList.toggle('empty', !def);
        b.el.classList.toggle('ult', !!def && (def.kind === 'ultimate' || def.kind === 'combined'));
        b.el.setAttribute('aria-label', def?.name ?? `Technique ${i + 1} (empty)`);
        b.el.dataset.id = id ?? '';
      });
      const el = p.element;
      const atk = this.btns.get('attack')!;
      atk.icon.innerHTML = ELEMENT_SVG[ctx.avatar.active || sphere ? 'avatar' : el];
      atk.el.style.setProperty('--el', ELEMENT_COLORS[el].glow);
      atk.el.style.setProperty('--el-shadow', ELEMENT_COLORS[el].shadow);
      const eb = this.btns.get('elementNext')!;
      eb.icon.innerHTML = ELEMENT_SVG[el];
      eb.icon.style.color = ELEMENT_COLORS[el].glow;
      setCap(eb, ELEMENT_INFO[el].name);
      eb.el.setAttribute('aria-label', `Element: ${ELEMENT_INFO[el].name} (tap: next, hold: previous)`);
      eb.el.classList.toggle('gone', !multi);
      this.btns.get('drawWater')!.el.classList.toggle('gone', !waterEl);
      // Riding / flying relabels the movement buttons.
      const fly = cs.mounted && cs.mountedFlying;
      setCap(this.btns.get('jump')!, fly ? 'Climb' : p.element === 'air' && !cs.mounted ? 'Jump·Glide' : 'Jump');
      setCap(this.btns.get('dodge')!, fly ? 'Descend' : 'Dodge');
      setCap(this.btns.get('sprint')!, fly ? 'Boost' : cs.mounted ? 'Gallop' : 'Sprint');
      setCap(this.btns.get('companion')!, cs.mounted ? 'Dismount' : 'Mount');
      this.abilityCount = count;
      this.layout(true);
    }
    // Cooldowns, chi and water availability on the technique buttons.
    for (let i = 1; i <= count; i++) {
      const b = this.btns.get(`ability${i}` as Action)!;
      const id = b.el.dataset.id;
      if (!id || !b.cd) continue;
      const f = clamp(ctx.combat.cooldownFraction(p, id), 0, 1);
      b.cd.style.setProperty('--cd', f.toFixed(3));
      b.el.classList.toggle('cooling', f > 0);
      const def = getTechnique(id);
      if (def) b.el.classList.toggle('nochi', p.chi < def.chiCost - 0.01);
    }
    // Draw Water lights up when a real source is in reach.
    this.waterT -= ctx.time.dt;
    if (this.waterT <= 0) {
      this.waterT = 0.3;
      this.waterOk = waterEl ? !!ctx.water.describe(p).ok : false;
      this.btns.get('drawWater')!.el.classList.toggle('near', this.waterOk);
    }
    const av = this.btns.get('avatarState')!.el;
    av.classList.toggle('on', ctx.avatar.active || sphere);
    av.classList.toggle('ready', !ctx.avatar.active && ctx.avatar.spirit >= SPIRIT_TO_ENTER);
    this.btns.get('lockOn')!.el.classList.toggle('on', !!(p.lockTarget && p.lockTarget.alive));
    this.btns.get('sprint')!.el.classList.toggle('on', this.sprintLatched);
    // Interact: the prompt label lives on the button.
    const inter = ctx.interactions.current;
    let label = inter && !ctx.ui.dialogueOpen ? inter.label : '';
    // Hold the label briefly when a target drifts across the edge of its radius, so the pill does not flicker.
    if (label) this.interactSeen = now;
    else if (this.interactLabel && !ctx.ui.dialogueOpen && now - this.interactSeen < 350) label = this.interactLabel;
    if (label !== this.interactLabel) {
      this.interactLabel = label;
      this.interact.cap.textContent = label || 'Interact';
      this.interact.el.classList.toggle('ready', !!label);
      this.interact.el.setAttribute('aria-label', label || 'Interact');
      this.placeInteract();
    }
  }

  // ---------------------------------------------------------------------------
  // Debug / tests: window.__game.debug.touch
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    const api = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
    const install = () => {
      const g = (window as unknown as { __game?: { debug?: Record<string, unknown> } }).__game;
      if (!g) return false;
      g.debug = g.debug ?? {};
      g.debug.touch = {
        shown: () => this.visible,
        /** Visible buttons with their screen rectangles. */
        buttons: () =>
          [...this.btns.values()]
            .filter((b) => b.el.offsetParent !== null && getComputedStyle(b.el).visibility !== 'hidden')
            .map((b) => {
              const r = b.el.getBoundingClientRect();
              return { action: b.action, label: b.cap.textContent, x: r.left, y: r.top, w: r.width, h: r.height, classes: b.el.className };
            }),
        stick: () => ({ id: this.stickId, rest: { ...this.stickRest }, radius: this.stickR }),
        rotateDismissed: () => this.rotateDismissed,
        relayout: () => this.layout(true),
      };
      return true;
    };
    if (!api) setTimeout(install, 0);
    else install();
  }
}

/** Set a button caption; long words get a tighter type size so nothing is clipped. */
function setCap(b: { cap: HTMLElement; el: HTMLElement }, text: string): void {
  if (b.cap.textContent !== text) b.cap.textContent = text;
  b.el.classList.toggle('long', text.length > 6);
}

/** Short caption for a technique button ("Water Whip" → "Whip", "Fire Tornado" → "Tornado"). */
function shortName(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}' -]/gu, '').split(/\s+/).filter(Boolean);
  const w = words.length > 1 ? words[words.length - 1] : words[0] ?? name;
  return w.length > 8 ? w.slice(0, 7) + '.' : w;
}

let guardsInstalled = false;
/**
 * Keep browser gestures from breaking play: no pinch / double-tap zoom, no
 * pull-to-refresh or overscroll, no long-press menus or text selection on the
 * game UI, and the page scrolls back after the on-screen keyboard closes.
 * Text fields (character name) keep working normally.
 */
export function installGestureGuards(): void {
  if (guardsInstalled || typeof document === 'undefined') return;
  guardsInstalled = true;
  const isText = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  // iOS Safari pinch gestures.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  // Two-finger page zoom (our own pinch handlers use pointer events, which still fire).
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // Double-tap zoom on non-interactive surfaces (buttons keep their fast taps).
  let lastEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = e.timeStamp;
      const t = e.target as HTMLElement | null;
      const interactive = !!t?.closest?.('button, a, input, select, textarea, label, [role="button"], .tbtn');
      if (!interactive && now - lastEnd < 320 && e.cancelable) e.preventDefault();
      lastEnd = now;
    },
    { passive: false },
  );
  document.addEventListener('dblclick', (e) => e.preventDefault());
  // Long-press menus everywhere except text fields.
  document.addEventListener('contextmenu', (e) => {
    if (!isText(e.target)) e.preventDefault();
  });
  document.addEventListener('selectstart', (e) => {
    if (!isText(e.target)) e.preventDefault();
  });
  // After the on-screen keyboard closes, iOS can leave the page scrolled: put it back.
  document.addEventListener('focusout', (e) => {
    if (!isText(e.target)) return;
    setTimeout(() => {
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
      const se = document.scrollingElement;
      if (se && se.scrollTop) se.scrollTop = 0;
    }, 60);
  });
  window.addEventListener('scroll', () => {
    if (!isText(document.activeElement) && (window.scrollX || window.scrollY)) window.scrollTo(0, 0);
  });
}

