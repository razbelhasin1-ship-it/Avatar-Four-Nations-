/**
 * Input manager: maps physical inputs (keyboard codes, mouse buttons, wheel,
 * gamepad buttons, virtual touch buttons) to abstract game Actions.
 *
 * Codes: KeyboardEvent.code ('KeyW', 'Space'...), 'Mouse0'/'Mouse1'/'Mouse2',
 * 'WheelUp'/'WheelDown', 'Pad0'..'Pad15' (standard gamepad mapping).
 *
 * Frame protocol (driven by Game): update() at frame start, endFrame() at frame end.
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'sprint'
  | 'dodge'
  | 'interact'
  | 'companion'
  | 'attack'
  | 'aim'
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ability4'
  | 'ability5'
  | 'elementNext'
  | 'elementPrev'
  | 'drawWater'
  | 'avatarState'
  | 'lockOn'
  | 'map'
  | 'journal'
  | 'inventory'
  | 'techniques'
  | 'companions'
  | 'character'
  | 'pause';

/** Actions that remain readable while gameplay input is locked by UI. */
export const UI_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'map',
  'journal',
  'inventory',
  'techniques',
  'companions',
  'character',
  'pause',
]);

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move Forward',
  back: 'Move Back',
  left: 'Move Left',
  right: 'Move Right',
  jump: 'Jump / Glide',
  sprint: 'Sprint',
  dodge: 'Dodge',
  interact: 'Interact',
  companion: 'Companion / Mount',
  attack: 'Primary Attack',
  aim: 'Aim / Charge Heavy',
  ability1: 'Technique 1',
  ability2: 'Technique 2',
  ability3: 'Technique 3',
  ability4: 'Technique 4',
  ability5: 'Combined Technique',
  elementNext: 'Next Element',
  elementPrev: 'Previous Element',
  drawWater: 'Draw Water',
  avatarState: 'Avatar State',
  lockOn: 'Lock-On Target',
  map: 'World Map',
  journal: 'Quest Journal',
  inventory: 'Inventory & Wardrobe',
  techniques: 'Technique Library',
  companions: 'Companion Stable',
  character: 'Character & Mastery',
  pause: 'Pause Menu',
};

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  jump: ['Space', 'Pad0'],
  sprint: ['ShiftLeft', 'Pad10'],
  dodge: ['KeyQ', 'Pad1'],
  interact: ['KeyE', 'Pad3'],
  companion: ['KeyF', 'Pad13'],
  attack: ['Mouse0', 'Pad7'],
  aim: ['Mouse2', 'Pad6'],
  ability1: ['Digit1', 'Pad14'],
  ability2: ['Digit2', 'Pad12'],
  ability3: ['Digit3', 'Pad15'],
  ability4: ['Digit4', 'Pad2'],
  ability5: ['Digit5'],
  elementNext: ['Tab', 'WheelDown', 'Pad5'],
  elementPrev: ['WheelUp', 'Pad4'],
  drawWater: ['KeyR'],
  avatarState: ['KeyT', 'Pad11'],
  lockOn: ['Mouse1', 'KeyZ'],
  map: ['KeyM', 'Pad8'],
  journal: ['KeyJ'],
  inventory: ['KeyI'],
  techniques: ['KeyK'],
  companions: ['KeyP'],
  character: ['KeyC'],
  pause: ['Escape', 'Pad9'],
};

/** [mobile] Names of the on-screen touch buttons, used by Input.label() while playing by touch. */
export const TOUCH_LABELS: Partial<Record<Action, string>> = {
  forward: 'Stick ↑',
  back: 'Stick ↓',
  left: 'Stick ←',
  right: 'Stick →',
  jump: 'Jump',
  sprint: 'Sprint',
  dodge: 'Dodge',
  interact: 'Tap prompt',
  companion: 'Mount',
  attack: 'Attack',
  aim: 'Heavy',
  ability1: '1',
  ability2: '2',
  ability3: '3',
  ability4: '4',
  ability5: '5',
  elementNext: 'Element',
  elementPrev: 'Hold Element',
  drawWater: 'Draw',
  avatarState: 'Avatar',
  lockOn: 'Lock',
  map: 'Map',
  journal: '☰ Menu',
  inventory: '☰ Menu',
  techniques: '☰ Menu',
  companions: '☰ Menu',
  character: '☰ Menu',
  pause: '☰ Menu',
};

export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Mouse0: 'LMB',
    Mouse1: 'MMB',
    Mouse2: 'RMB',
    WheelUp: 'Wheel ↑',
    WheelDown: 'Wheel ↓',
    Space: 'Space',
    ShiftLeft: 'L-Shift',
    ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl',
    ControlRight: 'R-Ctrl',
    AltLeft: 'L-Alt',
    AltRight: 'R-Alt',
    Escape: 'Esc',
    Tab: 'Tab',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Backquote: '`',
    Pad0: 'Ⓐ',
    Pad1: 'Ⓑ',
    Pad2: 'Ⓧ',
    Pad3: 'Ⓨ',
    Pad4: 'LB',
    Pad5: 'RB',
    Pad6: 'LT',
    Pad7: 'RT',
    Pad8: 'View',
    Pad9: 'Menu',
    Pad10: 'L3',
    Pad11: 'R3',
    Pad12: 'D↑',
    Pad13: 'D↓',
    Pad14: 'D←',
    Pad15: 'D→',
  };
  return map[code] ?? code;
}

type CodeListener = (code: string) => void;

export class Input {
  private bindings: Record<Action, string[]> = structuredClone(DEFAULT_BINDINGS);
  private codeDown = new Set<string>();
  private codePressedQ = new Set<string>();
  private codeReleasedQ = new Set<string>();

  private down = new Map<Action, boolean>();
  private prevDown = new Map<Action, boolean>();
  private pressedNow = new Set<Action>();
  private releasedNow = new Set<Action>();
  private holdTime = new Map<Action, number>();
  private consumed = new Set<Action>();

  private virtualDown = new Set<Action>();
  private virtualPressedQ = new Set<Action>();
  private virtualMove = { x: 0, y: 0 };

  /** Accumulated look delta this frame (pixels-ish). */
  readonly look = { x: 0, y: 0 };
  /** Normalised movement vector: x = right, y = forward. */
  readonly move = { x: 0, y: 0 };

  mouseSensitivity = 1;
  touchSensitivity = 1;
  invertY = false;

  /** When true, gameplay actions read as idle (UI open, dialogue, cutscene). */
  gameplayLocked = false;
  lastDevice: 'kbm' | 'touch' | 'gamepad' = 'kbm';
  pointerLocked = false;
  /** If set, the next physical input code is sent here instead of being processed (rebinding UI). */
  private captureNext: CodeListener | null = null;
  private padPrev: boolean[] = [];
  private canvas: HTMLElement | null = null;
  private wantPointerLock = false;
  private onPointerLockLost: (() => void) | null = null;

  private readonly handlers: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [];

  attach(canvas: HTMLElement): void {
    this.canvas = canvas;
    const on = (t: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, opts);
      this.handlers.push([t, type, fn as EventListener, opts]);
    };
    on(window, 'keydown', (e: KeyboardEvent) => this.onKeyDown(e));
    on(window, 'keyup', (e: KeyboardEvent) => this.onKeyUp(e));
    on(window, 'blur', () => this.releaseAll());
    on(canvas, 'mousedown', (e: MouseEvent) => this.onMouseDown(e));
    on(window, 'mouseup', (e: MouseEvent) => this.onMouseUp(e));
    on(window, 'mousemove', (e: MouseEvent) => this.onMouseMove(e));
    on(canvas, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      const wasLocked = this.pointerLocked;
      this.pointerLocked = locked;
      if (wasLocked && !locked && this.wantPointerLock) this.onPointerLockLost?.();
    });
  }

  detach(): void {
    for (const [t, type, fn, opts] of this.handlers) t.removeEventListener(type, fn, opts);
    this.handlers.length = 0;
  }

  setBindings(b: Record<Action, string[]>): void {
    this.bindings = structuredClone(b);
  }

  getBindings(): Readonly<Record<Action, string[]>> {
    return this.bindings;
  }

  /** Request pointer lock for mouse-look (must originate from a user gesture). */
  requestPointerLock(): void {
    this.wantPointerLock = true;
    if (!this.canvas || this.pointerLocked || this.lastDevice === 'touch') return;
    try {
      const p = (this.canvas as any).requestPointerLock?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* unsupported */
    }
  }

  /** Release pointer lock intentionally (opening a menu). */
  releasePointerLock(): void {
    this.wantPointerLock = false;
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  setPointerLockLostHandler(fn: (() => void) | null): void {
    this.onPointerLockLost = fn;
  }

  get wantsPointerLock(): boolean {
    return this.wantPointerLock;
  }

  captureNextCode(fn: CodeListener | null): void {
    this.captureNext = fn;
  }

  // ---- raw event handlers ----

  private isTypingTarget(e: Event): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  private onKeyDown(e: KeyboardEvent): void {
    this.lastDevice = 'kbm';
    if (this.captureNext) {
      e.preventDefault();
      const fn = this.captureNext;
      this.captureNext = null;
      fn(e.code);
      return;
    }
    if (this.isTypingTarget(e)) return;
    if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    this.codeDown.add(e.code);
    this.codePressedQ.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent): void {
    if (!this.codeDown.has(e.code)) return;
    this.codeDown.delete(e.code);
    this.codeReleasedQ.add(e.code);
  }

  private onMouseDown(e: MouseEvent): void {
    this.lastDevice = 'kbm';
    const code = 'Mouse' + e.button;
    if (this.captureNext) {
      e.preventDefault();
      const fn = this.captureNext;
      this.captureNext = null;
      fn(code);
      return;
    }
    this.codeDown.add(code);
    this.codePressedQ.add(code);
  }

  private onMouseUp(e: MouseEvent): void {
    const code = 'Mouse' + e.button;
    if (!this.codeDown.has(code)) return;
    this.codeDown.delete(code);
    this.codeReleasedQ.add(code);
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.pointerLocked) return;
    // Guard against browser spikes on lock acquisition.
    const mx = Math.max(-250, Math.min(250, e.movementX || 0));
    const my = Math.max(-250, Math.min(250, e.movementY || 0));
    this.look.x += mx * this.mouseSensitivity;
    this.look.y += my * this.mouseSensitivity * (this.invertY ? -1 : 1);
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const code = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    if (this.captureNext) {
      const fn = this.captureNext;
      this.captureNext = null;
      fn(code);
      return;
    }
    this.codePressedQ.add(code);
    this.codeReleasedQ.add(code);
  }

  private releaseAll(): void {
    for (const c of this.codeDown) this.codeReleasedQ.add(c);
    this.codeDown.clear();
    this.virtualDown.clear();
  }

  // ---- virtual (touch) API ----

  setVirtual(action: Action, isDown: boolean): void {
    // [ui] Only a press is evidence of touch play: releases also run when touch controls reset on desktop.
    if (isDown) this.lastDevice = 'touch';
    if (isDown) {
      if (!this.virtualDown.has(action)) this.virtualPressedQ.add(action);
      this.virtualDown.add(action);
    } else {
      this.virtualDown.delete(action);
    }
  }

  setVirtualMove(x: number, y: number): void {
    this.virtualMove.x = x;
    this.virtualMove.y = y;
    if (x !== 0 || y !== 0) this.lastDevice = 'touch';
  }

  addLook(dx: number, dy: number, device: 'touch' | 'gamepad' = 'touch'): void {
    const s = device === 'touch' ? this.touchSensitivity : 1;
    this.look.x += dx * s;
    this.look.y += dy * s * (this.invertY ? -1 : 1);
  }

  // ---- frame update ----

  private pollGamepad(dt: number): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) if (p && p.connected) { pad = p; break; }
    if (!pad) return;
    for (let i = 0; i < pad.buttons.length && i < 16; i++) {
      const pressed = pad.buttons[i].pressed || pad.buttons[i].value > 0.5;
      const code = 'Pad' + i;
      if (pressed && !this.padPrev[i]) {
        this.lastDevice = 'gamepad';
        if (this.captureNext) {
          const fn = this.captureNext;
          this.captureNext = null;
          fn(code);
        } else {
          this.codeDown.add(code);
          this.codePressedQ.add(code);
        }
      } else if (!pressed && this.padPrev[i]) {
        this.codeDown.delete(code);
        this.codeReleasedQ.add(code);
      }
      this.padPrev[i] = pressed;
    }
    const dz = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0), ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0), ry = dz(pad.axes[3] ?? 0);
    if (lx || ly) {
      this.virtualMove.x = lx;
      this.virtualMove.y = -ly;
      this.lastDevice = 'gamepad';
    } else if (this.lastDevice === 'gamepad') {
      this.virtualMove.x = 0;
      this.virtualMove.y = 0;
    }
    if (rx || ry) this.addLook(rx * 900 * dt, ry * 650 * dt, 'gamepad');
  }

  update(dt: number): void {
    this.pollGamepad(dt);
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.consumed.clear();
    for (const action of Object.keys(this.bindings) as Action[]) {
      const codes = this.bindings[action];
      let isDown = this.virtualDown.has(action);
      let pressed = this.virtualPressedQ.has(action);
      let released = false;
      for (const c of codes) {
        if (this.codeDown.has(c)) isDown = true;
        if (this.codePressedQ.has(c)) pressed = true;
        if (this.codeReleasedQ.has(c)) released = true;
      }
      const was = this.down.get(action) ?? false;
      this.prevDown.set(action, was);
      if (pressed || (isDown && !was)) this.pressedNow.add(action);
      if ((was && !isDown) || (released && !isDown)) this.releasedNow.add(action);
      this.down.set(action, isDown);
      this.holdTime.set(action, isDown ? (this.holdTime.get(action) ?? 0) + dt : 0);
    }
    this.codePressedQ.clear();
    this.codeReleasedQ.clear();
    this.virtualPressedQ.clear();

    // Movement vector (keyboard + virtual stick), clamped to unit length.
    let mx = 0, my = 0;
    if (this.down.get('right')) mx += 1;
    if (this.down.get('left')) mx -= 1;
    if (this.down.get('forward')) my += 1;
    if (this.down.get('back')) my -= 1;
    mx += this.virtualMove.x;
    my += this.virtualMove.y;
    const len = Math.hypot(mx, my);
    if (len > 1) { mx /= len; my /= len; }
    this.move.x = mx;
    this.move.y = my;
    if (this.gameplayLocked) {
      this.move.x = 0;
      this.move.y = 0;
    }
  }

  endFrame(): void {
    this.look.x = 0;
    this.look.y = 0;
  }

  private allowed(action: Action): boolean {
    return !this.gameplayLocked || UI_ACTIONS.has(action);
  }

  isDown(action: Action): boolean {
    return this.allowed(action) && (this.down.get(action) ?? false);
  }

  wasPressed(action: Action): boolean {
    return this.allowed(action) && this.pressedNow.has(action) && !this.consumed.has(action);
  }

  wasReleased(action: Action): boolean {
    return this.allowed(action) && this.releasedNow.has(action);
  }

  /** Seconds the action has been held (0 if up). */
  held(action: Action): number {
    return this.allowed(action) ? this.holdTime.get(action) ?? 0 : 0;
  }

  /** Prevent other readers from seeing this press during the current frame. */
  consume(action: Action): void {
    this.consumed.add(action);
  }

  /** True if any physical key/button is currently down (used by "press any key"). */
  anyDown(): boolean {
    return this.codeDown.size > 0 || this.virtualDown.size > 0;
  }

  /** Short label for the primary binding of an action, for prompts like "[E] Talk". */
  label(action: Action): string {
    // [mobile] Touch players see the on-screen button names in prompts and hints.
    if (this.lastDevice === 'touch') return TOUCH_LABELS[action] ?? ACTION_LABELS[action];
    const codes = this.bindings[action] ?? [];
    const prefer = this.lastDevice === 'gamepad' ? codes.find((c) => c.startsWith('Pad')) : codes.find((c) => !c.startsWith('Pad'));
    return codeLabel(prefer ?? codes[0] ?? '?');
  }
}

/**
 * [additive: QA/mobile] Fill `{action}` placeholders in data texts (hints, ability descriptions) with the
 * current device's control names — keys, pad buttons or the on-screen touch buttons.
 */
export function keyHints(input: Pick<Input, 'label'>, text: string): string {
  return text.replace(/\{(\w+)\}/g, (all, a: string) => (a in ACTION_LABELS ? input.label(a as Action) : all));
}
