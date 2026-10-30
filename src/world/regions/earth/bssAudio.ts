import { envGain, noiseSrc, oscSrc, registerSound } from '../../../audio/AudioEngine';

/**
 * Ba Sing Se sound recipes (procedural WebAudio): the earthbenders' rhythmic
 * stomp that pushes the monorail along its stone rail.
 */

registerSound('bss_train_stomp', (ac, out, t, o) => {
  const th = oscSrc(ac, t, 0.32, 'sine', 64 * o.pitch);
  th.frequency.exponentialRampToValueAtTime(30, t + 0.28);
  const g = envGain(ac, t, 0.004, 0.05, 0.24, 0.75 * o.volume);
  th.connect(g).connect(out);
  const { filter } = noiseSrc(ac, o.noise, t, 0.22, 'bandpass', 420 * o.pitch, 0.9);
  const g2 = envGain(ac, t, 0.002, 0.03, 0.16, 0.32 * o.volume);
  filter.connect(g2).connect(out);
  return 0.4;
});

registerSound('bss_train_grind', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 1.1, 'lowpass', 260 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(120 * o.pitch, t + 1.0);
  const g = envGain(ac, t, 0.08, 0.3, 0.7, 0.5 * o.volume);
  filter.connect(g).connect(out);
  return 1.2;
});
