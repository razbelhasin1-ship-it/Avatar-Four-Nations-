import type { GameContext } from '../core/GameContext';

/**
 * Sub-skill HUD bits (moon chip, strain meter, spirit view, struggle prompt, focus bar) live in the
 * HUD layer with their own z-index so they sit over the 3D view — which would also put them over an
 * open screen (journal, map, pause…). They hide while any screen is open.
 */

const guarded = new Set<HTMLElement>();
let open = false;
let wired: GameContext | null = null;

export function guardHud(ctx: GameContext, el: HTMLElement): void {
  if (wired !== ctx) {
    wired = ctx;
    ctx.events.on('ui:screen', (e) => {
      open = !!e.screen;
      for (const x of guarded) x.classList.toggle('sk-screen-open', open);
    });
    if (typeof document !== 'undefined' && !document.getElementById('sk-guard-css')) {
      const st = document.createElement('style');
      st.id = 'sk-guard-css';
      st.textContent = '.sk-screen-open{display:none !important}';
      document.head.append(st);
    }
    open = !!ctx.ui?.currentScreen;
  }
  guarded.add(el);
  el.classList.toggle('sk-screen-open', open);
}
