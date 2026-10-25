import type { GameContext, GameSystem } from '../core/GameContext';
import type { GameEvents } from '../core/events';
import { TOUCH_LABELS, type Action } from '../core/Input';
import { h } from '../ui/dom';
import { TUTORIAL_STEPS, type StepRuntime, type TutorialStep } from './steps';
import './tutorial.css';

/**
 * Runs the interactive tutorial during 'tutorial' sessions (Meditation Isle).
 * Steps complete through real play; the panel shows live key bindings and
 * progress, with Skip / Back / Exit controls. Nothing here touches campaign
 * saves (the tutorial session has save writes disabled).
 */
export class TutorialSystem implements GameSystem {
  private ctx!: GameContext;
  private index = -1;
  private rt: StepRuntime | null = null;
  private panel: HTMLElement | null = null;
  private titleEl!: HTMLElement;
  private textEl!: HTMLElement;
  private progEl!: HTMLElement;
  private countEl!: HTMLElement;
  private offs: Array<() => void> = [];
  private completeTimer = 0;
  active = false;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    const names = new Set<keyof GameEvents>();
    for (const s of TUTORIAL_STEPS) for (const k of Object.keys(s.onEvent ?? {})) names.add(k as keyof GameEvents);
    for (const name of names) {
      this.offs.push(
        ctx.events.on(name, (p: any) => {
          if (!this.active || !this.rt) return;
          const step = TUTORIAL_STEPS[this.index];
          const fn = (step.onEvent as any)?.[name];
          if (!fn) return;
          const key = fn(this.rt, p);
          if (key) this.rt.counters[key] = (this.rt.counters[key] ?? 0) + 1;
        }),
      );
    }
    ctx.events.on('settings:changed', () => this.renderText());
  }

  private installDebug(): void {
    const api = (window as any).__game;
    if (!api) return;
    api.debug.tutorial = {
      state: () => ({ active: this.active, index: this.index, step: TUTORIAL_STEPS[this.index]?.id ?? null, counters: { ...(this.rt?.counters ?? {}) } }),
      skip: () => this.next(),
      goto: (id: string) => this.goto(TUTORIAL_STEPS.findIndex((s) => s.id === id)),
      steps: () => TUTORIAL_STEPS.map((s) => s.id),
    };
  }

  onSessionStart(ctx: GameContext): void {
    this.installDebug();
    if (ctx.session.kind !== 'tutorial') return;
    this.active = true;
    this.buildPanel();
    this.goto(0);
  }

  /** Run the current step's exit hook (temporary setup is undone before moving on). */
  private leaveStep(): void {
    const cur = this.index >= 0 ? TUTORIAL_STEPS[this.index] : undefined;
    if (!cur?.exit || !this.rt) return;
    try {
      cur.exit(this.rt);
    } catch (err) {
      console.error('[Tutorial] step exit failed', err);
    }
  }

  onSessionEnd(): void {
    this.leaveStep();
    this.active = false;
    this.rt = null;
    this.index = -1;
    this.panel?.remove();
    this.panel = null;
  }

  private buildPanel(): void {
    this.panel?.remove();
    this.titleEl = h('div.tut-title');
    // On phones the text folds to two lines; tap it to read the rest.
    this.textEl = h('div.tut-text', { onclick: () => this.panel?.classList.toggle('tut-open') });
    this.progEl = h('div.tut-progress');
    this.countEl = h('span.tut-count');
    this.panel = h(
      'div.tutorial-panel.panel.interactive',
      h('div.tut-head', h('span.tut-badge', 'TUTORIAL'), this.countEl, h('div.spacer'), h('button.btn.small', { onclick: () => this.prev(), title: 'Previous lesson' }, '◀'), h('button.btn.small', { onclick: () => this.next(), 'data-action': 'tutorial-skip' }, 'Skip ▶'), h('button.btn.small.danger', { onclick: () => this.exit(), 'data-action': 'tutorial-exit' }, 'Exit')),
      this.titleEl,
      this.textEl,
      this.progEl,
    );
    this.ctx.ui.layers.hud.appendChild(this.panel);
  }

  private exit(): void {
    this.ctx.ui.confirm('Leave the tutorial and return to the main menu?', [
      { text: 'Leave', primary: true, onClick: () => this.ctx.game.exitToMenu(false) },
      { text: 'Stay' },
    ]);
  }

  private formatText(text: string, touch = false): string {
    // Touch screens always name the on-screen buttons, whatever device spoke last.
    return text.replace(/\{(\w+)\}/g, (_m, a: string) => `<span class="kbd">${(touch && TOUCH_LABELS[a as Action]) || this.ctx.input.label(a as Action)}</span>`);
  }

  private renderText(): void {
    if (!this.panel || this.index < 0) return;
    const step = TUTORIAL_STEPS[this.index];
    this.titleEl.textContent = step.title;
    const touch = this.ctx.ui.layers.hud.closest('#ui')?.classList.contains('touch-on') ?? false;
    this.textEl.innerHTML = this.formatText(touch && step.touch ? step.touch : step.text, touch);
    this.panel.classList.remove('tut-open');
    this.countEl.textContent = `${this.index + 1} / ${TUTORIAL_STEPS.length}`;
  }

  private goto(i: number): void {
    if (i < 0 || i >= TUTORIAL_STEPS.length) return;
    this.leaveStep();
    this.index = i;
    const step = TUTORIAL_STEPS[i];
    this.rt = { ctx: this.ctx, counters: {}, t: 0, data: {} };
    this.completeTimer = 0;
    if (step.element && this.ctx.player) {
      this.ctx.progression.unlockElement(step.element, true);
      this.ctx.player.switchElement(step.element, true);
    }
    try {
      step.enter?.(this.rt);
    } catch (err) {
      console.error('[Tutorial] step enter failed', err);
    }
    this.renderText();
    this.progEl.textContent = '';
    this.panel?.classList.remove('tut-complete');
    // Keep the CSS placement (centred on desktop, top-right card on touch) while the animation overrides transform.
    const x = this.panel?.closest('#ui')?.classList.contains('touch-on') ? '0' : '-50%';
    this.panel?.animate([{ transform: `translate(${x}, -6px)`, opacity: 0.4 }, { transform: `translate(${x}, 0)`, opacity: 1 }], { duration: 260 });
  }

  next(): void {
    if (this.index < TUTORIAL_STEPS.length - 1) this.goto(this.index + 1);
  }

  prev(): void {
    if (this.index > 0) this.goto(this.index - 1);
  }

  update(dt: number): void {
    if (!this.active || !this.rt || this.index < 0) return;
    const step: TutorialStep = TUTORIAL_STEPS[this.index];
    const rt = this.rt;
    rt.t += dt;
    if (step.id === 'look' && !this.ctx.ui.blocksGameplay) {
      const l = this.ctx.input.look;
      rt.counters.look = (rt.counters.look ?? 0) + Math.abs(l.x) + Math.abs(l.y);
    }
    let done = false;
    try {
      done = step.check(rt) && rt.t >= (step.minTime ?? 0.4);
    } catch (err) {
      console.error('[Tutorial] check failed', err);
    }
    const prog = step.progress?.(rt);
    if (prog !== undefined && this.progEl.textContent !== prog) this.progEl.textContent = prog;
    if (done) {
      if (this.completeTimer === 0) {
        this.panel?.classList.add('tut-complete');
        this.progEl.textContent = '✓ Well done!';
        this.ctx.audio.play('ui_confirm', { bus: 'ui', volume: 0.7 });
      }
      this.completeTimer += dt;
      if (this.completeTimer > 1.1) this.next();
    }
  }
}
