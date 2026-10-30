/**
 * Ba Sing Se debug overlay, toggled with F3 (or __game.debug.bss.overlay()): frame rate, draw calls
 * and triangles, crowd and NPC counts, trains. Text only, refreshed four times a second.
 */
export class BssOverlay {
  private el: HTMLDivElement | null = null;
  private t = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'F3' || e.repeat) return;
    e.preventDefault();
    this.toggle();
  };

  constructor(private readonly lines: () => string[]) {
    window.addEventListener('keydown', this.onKey);
  }

  get visible(): boolean {
    return this.el !== null;
  }

  get text(): string {
    return this.el?.textContent ?? '';
  }

  toggle(on = !this.el): boolean {
    if (on && !this.el) {
      const el = document.createElement('div');
      el.id = 'bss-overlay';
      el.style.cssText =
        'position:fixed;left:8px;top:8px;z-index:9999;padding:6px 10px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
        'color:#e6f0dc;background:rgba(12,22,14,0.78);border:1px solid rgba(150,200,130,0.4);border-radius:6px;pointer-events:none;white-space:pre';
      document.body.appendChild(el);
      this.el = el;
      this.t = 0;
      this.refresh();
    } else if (!on && this.el) {
      this.el.remove();
      this.el = null;
    }
    return this.visible;
  }

  update(dt: number): void {
    if (!this.el) return;
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 0.25;
    this.refresh();
  }

  private refresh(): void {
    if (this.el) this.el.textContent = this.lines().join('\n');
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.toggle(false);
  }
}
