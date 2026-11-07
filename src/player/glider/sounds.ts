import { registerSound } from '../../audio/registry';
import { noiseAHR, thump } from '../../audio/synth';

/**
 * Glider staff sounds (procedural): the fans flicking open — the cloth catching the air with a
 * snap, a wooden knock as the ribs lock — and folding shut.
 */

registerSound(
  'glider.open',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    // Cloth snapping taut, then the air filling it.
    noiseAHR(ac, out, o.white, t, 'bandpass', 1300 * p, 1.4, 0.003, 0.025, 0.09, 0.42 * v);
    noiseAHR(ac, out, o.noise, t + 0.03, 'bandpass', 520 * p, 0.8, 0.012, 0.06, 0.28, 0.4 * v);
    // The ribs locking open: a dry wooden knock.
    thump(ac, out, t + 0.02, 230 * p, 120 * p, 0.07, 0.22 * v);
    noiseAHR(ac, out, o.white, t + 0.02, 'highpass', 3200 * p, 0.9, 0.001, 0.004, 0.03, 0.12 * v);
    return 0.45;
  },
  { duration: 0.5, maxVoices: 2, desc: 'glider staff fans flicking open (cloth snap + wooden knock)' },
);

registerSound(
  'glider.fold',
  (ac, out, t, o) => {
    const p = o.pitch;
    const v = o.volume;
    noiseAHR(ac, out, o.noise, t, 'bandpass', 760 * p, 1.1, 0.02, 0.05, 0.16, 0.3 * v);
    noiseAHR(ac, out, o.white, t + 0.12, 'highpass', 2800 * p, 0.9, 0.001, 0.004, 0.03, 0.1 * v);
    thump(ac, out, t + 0.12, 180 * p, 110 * p, 0.05, 0.12 * v);
    return 0.32;
  },
  { duration: 0.4, maxVoices: 2, desc: 'glider staff fans folding shut' },
);
