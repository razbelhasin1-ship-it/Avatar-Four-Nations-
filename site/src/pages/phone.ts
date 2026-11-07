import { isTouchDevice, phoneUrl } from '../ui/device';
import { reducedMotion } from '../ui/dom';
import { qrSvg } from '../ui/qr';

/**
 * The game is made for phones, and the site says so: a landscape phone playing real screenshots in
 * turn, three steps to start on your phone, a QR code for visitors on a computer, and on a computer
 * a "play it on your phone" card when they press Play (with "play here anyway").
 */
export interface PhoneFirst {
  /** True on phones and tablets. */
  readonly touch: boolean;
  /** On a computer, Play first offers the phone (once per visit); returns true if it took over. */
  gate(playHere: () => void): boolean;
}

const QR_LABEL = 'QR code: scan it with your phone camera to open the game on your phone';

export function initPhoneFirst(): PhoneFirst {
  const touch = isTouchDevice();
  const root = document.documentElement;
  root.classList.toggle('is-touch', touch);
  root.classList.toggle('is-computer', !touch);

  // QR codes for computers (made from this page's own address, so they work wherever it is hosted).
  if (!touch) {
    const svg = qrSvg(phoneUrl(), QR_LABEL);
    document.querySelectorAll<HTMLElement>('[data-qr]').forEach((el) => (el.innerHTML = svg));
  }

  // The phone in "Made for your phone": its screen shows one screenshot after another.
  const screen = document.getElementById('device-screen');
  const shots = screen ? Array.from(screen.querySelectorAll<HTMLImageElement>('img')) : [];
  const dots = Array.from(document.querySelectorAll<HTMLButtonElement>('.device__dots button'));
  let shown = 0;
  let timer = 0;
  const show = (i: number) => {
    shown = (i + shots.length) % shots.length;
    shots.forEach((img, k) => img.classList.toggle('is-on', k === shown));
    dots.forEach((d, k) => d.setAttribute('aria-pressed', String(k === shown)));
  };
  const schedule = () => {
    clearInterval(timer);
    if (shots.length > 1 && !reducedMotion()) timer = window.setInterval(() => show(shown + 1), 4200);
  };
  if (shots.length) {
    show(0);
    dots.forEach((d, k) =>
      d.addEventListener('click', () => {
        show(k);
        schedule();
      }),
    );
    // Only cycle while the phone is on screen.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) schedule();
      else clearInterval(timer);
    });
    if (screen) io.observe(screen);
  }

  // "Play it on your phone" for visitors on a computer.
  const dialog = document.getElementById('phone-gate') as HTMLDialogElement | null;
  let playHere: (() => void) | null = null;
  let insisted = false;
  try {
    insisted = sessionStorage.getItem('play-here') === '1';
  } catch {
    /* storage may be unavailable */
  }
  dialog?.addEventListener('click', (e) => {
    const t = e.target as Element;
    if (t === dialog || t.closest('[data-gate="close"]')) dialog.close();
    if (t.closest('[data-gate="anyway"]')) {
      insisted = true;
      try {
        sessionStorage.setItem('play-here', '1');
      } catch {
        /* ignore */
      }
      dialog.close();
      playHere?.();
    }
  });

  return {
    touch,
    gate(fn) {
      if (touch || insisted || !dialog || typeof dialog.showModal !== 'function') return false;
      playHere = fn;
      dialog.showModal();
      return true;
    },
  };
}
