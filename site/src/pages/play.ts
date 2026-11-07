/**
 * The game, played inside the website: a full-window layer with the game's own page in a frame
 * (same origin, so saves, settings and the Android build all share one game). The site's own
 * animation pauses while it is open.
 */
export const GAME_URL = import.meta.env.DEV ? 'http://127.0.0.1:5173/' : 'play/index.html';

interface GameWindow extends Window {
  __game?: { game?: { requestAutosave?: (force: boolean) => void } };
}

export interface PlayHooks {
  onOpen(): void;
  onClose(): void;
}

export function initPlay(hooks: PlayHooks): { open(): void; isOpen(): boolean } {
  const layer = document.getElementById('game-layer')!;
  const frameHost = document.getElementById('game-frame')!;
  const loading = document.getElementById('game-loading')!;
  const bar = document.getElementById('game-bar')!;
  const exitBtn = document.getElementById('game-exit')!;
  const fsBtn = document.getElementById('game-fs')!;
  const confirm = document.getElementById('game-confirm')!;
  const stay = document.getElementById('confirm-stay')!;
  const leave = document.getElementById('confirm-leave')!;
  const openTab = document.getElementById('open-tab') as HTMLAnchorElement | null;
  if (openTab) openTab.href = GAME_URL;

  let frame: HTMLIFrameElement | null = null;
  let open = false;
  let tuckTimer = 0;
  let returnFocus: HTMLElement | null = null;

  const tuck = (later = 2600) => {
    clearTimeout(tuckTimer);
    bar.classList.remove('is-tucked');
    tuckTimer = window.setTimeout(() => bar.classList.add('is-tucked'), later);
  };

  const canFullscreen = () => !!(layer.requestFullscreen || (layer as unknown as { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);
  const isFullscreen = () => !!(document.fullscreenElement || (document as unknown as { webkitFullscreenElement?: Element }).webkitFullscreenElement);
  const enterFullscreen = () => {
    const el = layer as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), undefined);
      p?.then(() => {
        const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        o?.lock?.('landscape').catch(() => {});
      }).catch(() => {});
    } catch {
      /* not allowed here */
    }
  };
  const exitFullscreen = () => {
    try {
      if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    } catch {
      /* ignore */
    }
  };
  if (!canFullscreen()) fsBtn.hidden = true;
  const syncFsLabel = () => {
    const label = fsBtn.querySelector('span');
    if (label) label.textContent = isFullscreen() ? 'Exit full screen' : 'Full screen';
  };
  document.addEventListener('fullscreenchange', syncFsLabel);

  const show = () => {
    if (open) return;
    open = true;
    returnFocus = document.activeElement as HTMLElement | null;
    layer.hidden = false;
    document.documentElement.classList.add('game-open');
    loading.classList.remove('is-done');
    confirm.hidden = true;
    hooks.onOpen();
    // Phones and tablets: go full screen straight away (this runs inside the tap).
    if (matchMedia('(pointer: coarse)').matches && canFullscreen()) enterFullscreen();
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'Avatar: The Four Nations';
      frame.allow = 'fullscreen; autoplay; gamepad; screen-wake-lock';
      frame.setAttribute('allowfullscreen', '');
      const started = performance.now();
      frame.addEventListener('load', () => {
        const wait = Math.max(0, 900 - (performance.now() - started));
        setTimeout(() => {
          loading.classList.add('is-done');
          try {
            frame?.contentWindow?.focus();
          } catch {
            /* ignore */
          }
        }, wait);
      });
      frame.src = GAME_URL;
      frameHost.append(frame);
    } else {
      loading.classList.add('is-done');
    }
    tuck(3200);
  };

  const close = () => {
    // Save the journey before the frame goes away.
    try {
      (frame?.contentWindow as GameWindow | null)?.__game?.game?.requestAutosave?.(true);
    } catch {
      /* the game may not be ready */
    }
    exitFullscreen();
    open = false;
    confirm.hidden = true;
    layer.hidden = true;
    document.documentElement.classList.remove('game-open');
    frame?.remove();
    frame = null;
    hooks.onClose();
    returnFocus?.focus?.({ preventScroll: true });
  };

  exitBtn.addEventListener('click', () => {
    confirm.hidden = false;
    (leave as HTMLButtonElement).focus();
  });
  stay.addEventListener('click', () => {
    confirm.hidden = true;
    try {
      frame?.contentWindow?.focus();
    } catch {
      /* ignore */
    }
    tuck();
  });
  leave.addEventListener('click', close);
  fsBtn.addEventListener('click', () => (isFullscreen() ? exitFullscreen() : enterFullscreen()));
  confirm.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') (stay as HTMLButtonElement).click();
  });

  // The bar slides away while you play; bring it back from the top edge (mouse) or a tap there.
  layer.addEventListener('pointermove', (e) => {
    if (e.clientY < 70) tuck();
  });
  const handle = document.createElement('div');
  handle.className = 'game-layer__handle';
  handle.addEventListener('pointerdown', () => tuck(4000));
  // While the pointer rests on the top edge (or the bar) the bar stays; it slides away once it leaves.
  handle.addEventListener('pointerenter', () => {
    clearTimeout(tuckTimer);
    bar.classList.remove('is-tucked');
  });
  handle.addEventListener('pointerleave', () => tuck(1800));
  layer.append(handle);
  bar.addEventListener('pointerenter', () => clearTimeout(tuckTimer));
  bar.addEventListener('pointerleave', () => tuck(1800));
  bar.addEventListener('focusin', () => {
    clearTimeout(tuckTimer);
    bar.classList.remove('is-tucked');
  });

  document.getElementById('stage-start')?.addEventListener('click', show);
  // On a computer the stage offers the phone first; this plays here anyway.
  document.getElementById('stage-start-pc')?.addEventListener('click', show);

  return { open: show, isOpen: () => open };
}
