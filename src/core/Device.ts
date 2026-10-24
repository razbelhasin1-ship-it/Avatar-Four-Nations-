/**
 * Device class detection: phones and tablets get mobile-safe graphics defaults
 * on first launch (see SettingsManager) and the touch-first UI.
 *
 * "Mobile" = User-Agent Client Hints say mobile, or a phone/tablet user agent
 * (incl. iPadOS posing as a Mac with touch points), or a coarse-pointer / touch
 * -only device whose screen is tablet-sized or smaller. Touch laptops (touch
 * screen + a fine primary pointer + large screen) stay desktop.
 */
export interface DeviceInfo {
  mobile: boolean;
  /** Short side of the screen <= 600 CSS px (phones; tablets are larger). */
  phone: boolean;
  touch: boolean;
  coarse: boolean;
  /** Short side of the screen <= 1024 CSS px. */
  smallScreen: boolean;
  uaMobile: boolean;
  /** Why `mobile` came out the way it did (debugging / tests). */
  reason: string;
}

export function detectDevice(): DeviceInfo {
  const none: DeviceInfo = { mobile: false, phone: false, touch: false, coarse: false, smallScreen: false, uaMobile: false, reason: 'no window' };
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return none;
  const mq = (q: string): boolean => {
    try {
      return typeof matchMedia === 'function' && matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  const touch = (nav.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window;
  const coarse = mq('(pointer: coarse)');
  const anyFine = mq('(any-pointer: fine)');
  const sw = window.screen?.width || window.innerWidth || 0;
  const sh = window.screen?.height || window.innerHeight || 0;
  const short = Math.min(sw, sh) || Math.min(window.innerWidth, window.innerHeight);
  const smallScreen = short > 0 && short <= 1024;
  const ua = nav.userAgent || '';
  const chMobile = nav.userAgentData?.mobile === true;
  const uaPhone = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini/i.test(ua);
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1;
  const uaMobile = chMobile || uaPhone || iPadOS;
  const touchOnly = coarse || (touch && !anyFine);
  let reason = 'desktop';
  let mobile = false;
  if (chMobile) (mobile = true), (reason = 'userAgentData.mobile');
  else if (uaPhone || iPadOS) (mobile = true), (reason = iPadOS ? 'iPadOS' : 'mobile user agent');
  else if (touchOnly && smallScreen) (mobile = true), (reason = coarse ? 'coarse pointer + small screen' : 'touch + small screen');
  return { mobile, phone: mobile && short <= 600, touch, coarse, smallScreen, uaMobile, reason };
}

/** Fullscreen API with the webkit fallbacks (iPhone Safari has none: hide the toggle there). */
export const fullscreen = {
  get supported(): boolean {
    if (typeof document === 'undefined') return false;
    const d = document as Document & { webkitFullscreenEnabled?: boolean };
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown };
    return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(el.requestFullscreen || el.webkitRequestFullscreen);
  },
  get active(): boolean {
    if (typeof document === 'undefined') return false;
    const d = document as Document & { webkitFullscreenElement?: Element | null };
    return !!(d.fullscreenElement || d.webkitFullscreenElement);
  },
  /** Enter fullscreen (must run inside a user gesture); then try to lock landscape on phones/tablets. */
  async enter(lockLandscape: boolean): Promise<boolean> {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else el.webkitRequestFullscreen?.();
    } catch {
      return false;
    }
    if (lockLandscape) {
      // Fire and forget: some browsers never settle the lock promise.
      const o = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void> } }).orientation;
      try {
        o?.lock?.('landscape')?.catch(() => {
          /* not supported (desktop, iOS): fine */
        });
      } catch {
        /* not supported */
      }
    }
    return true;
  },
  async exit(): Promise<void> {
    const d = document as Document & { webkitExitFullscreen?: () => void };
    try {
      const o = (screen as Screen & { orientation?: { unlock?: () => void } }).orientation;
      o?.unlock?.();
    } catch {
      /* ignore */
    }
    try {
      if (d.exitFullscreen) await d.exitFullscreen();
      else d.webkitExitFullscreen?.();
    } catch {
      /* already out */
    }
  },
  async toggle(lockLandscape: boolean): Promise<boolean> {
    if (this.active) {
      await this.exit();
      return false;
    }
    return this.enter(lockLandscape);
  },
};
