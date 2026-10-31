/**
 * Southern Air Temple debug overlay, toggled with F3 while at the temple (or
 * __game.debug.air.region('air_temple_summit').overlay.toggle()): frame rate, draw calls and
 * triangles, monks (simulated, visible, walking, indoors), sky bison (flying, grounded, near LOD),
 * lemurs and the sanctuary. Text only, refreshed four times a second.
 */
export class SatOverlay {
  private el: HTMLDivElement | null = null;
  private t = 0;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'F3' || e.repeat || !this.near()) return;
    e.preventDefault();
    this.toggle();
  };

  constructor(
    private readonly lines: () => string[],
    private readonly near: () => boolean,
  ) {
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
      el.id = 'sat-overlay';
      el.style.cssText =
        'position:fixed;left:8px;top:8px;z-index:9999;padding:6px 10px;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;' +
        'color:#fff4dc;background:rgba(40,26,8,0.78);border:1px solid rgba(240,190,90,0.45);border-radius:6px;pointer-events:none;white-space:pre';
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
    if (!this.near()) {
      this.toggle(false);
      return;
    }
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
