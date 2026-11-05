import themeUrl from '../../../src/audio/music/tracks/menu-theme.mp3?url';

/**
 * The game's main theme, on request only (the music button in the top bar). Fades in and out, and
 * steps aside while the game is open (the game plays its own music).
 */
export function initMusic(): { duck(on: boolean): void } {
  const btn = document.getElementById('music-btn') as HTMLButtonElement | null;
  if (!btn) return { duck: () => {} };
  let audio: HTMLAudioElement | null = null;
  let playing = false;
  let ducked = false;
  let fade = 0;

  const ramp = (to: number, ms: number, done?: () => void) => {
    if (!audio) return;
    cancelAnimationFrame(fade);
    const a = audio;
    const from = a.volume;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      a.volume = from + (to - from) * t;
      if (t < 1) fade = requestAnimationFrame(tick);
      else done?.();
    };
    fade = requestAnimationFrame(tick);
  };

  const setPressed = (on: boolean) => {
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? 'Pause the main theme' : 'Play the main theme');
  };

  btn.addEventListener('click', () => {
    if (!audio) {
      audio = new Audio(themeUrl);
      audio.loop = true;
      audio.preload = 'auto';
      audio.volume = 0;
    }
    if (!playing) {
      playing = true;
      setPressed(true);
      audio.play().then(() => ramp(0.42, 2200)).catch(() => {
        playing = false;
        setPressed(false);
      });
    } else {
      playing = false;
      setPressed(false);
      ramp(0, 900, () => audio?.pause());
    }
  });

  return {
    duck(on: boolean) {
      if (!audio || !playing || ducked === on) return;
      ducked = on;
      if (on) ramp(0, 800, () => audio?.pause());
      else audio.play().then(() => ramp(0.42, 1600)).catch(() => {});
    },
  };
}
