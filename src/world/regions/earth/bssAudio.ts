import { envGain, noiseSrc, oscSrc, registerSound } from '../../../audio/AudioEngine';
import { registerLoop } from '../../../audio/registry';

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

/** A farm animal's low call: a saw tone through a vowel-like band, rising then sagging. */
registerSound('bss_moo', (ac, out, t, o) => {
  const dur = 1.35;
  const osc = oscSrc(ac, t, dur, 'sawtooth', 118 * o.pitch);
  osc.frequency.setValueAtTime(116 * o.pitch, t);
  osc.frequency.linearRampToValueAtTime(134 * o.pitch, t + 0.3);
  osc.frequency.exponentialRampToValueAtTime(88 * o.pitch, t + dur);
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 430;
  f1.Q.value = 2.2;
  const f2 = ac.createBiquadFilter();
  f2.type = 'lowpass';
  f2.frequency.value = 950;
  const g = envGain(ac, t, 0.14, 0.7, 0.45, 0.3 * o.volume);
  osc.connect(f1).connect(f2).connect(g).connect(out);
  return dur + 0.1;
});

/** Band-passed noise voices with slow random swells: the murmur of a crowd. */
registerLoop('bss_crowd', (ac, out, o) => {
  const master = ac.createGain();
  master.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];
  for (const [f, q, v, rate] of [[470, 3, 0.16, 0.7], [830, 4, 0.13, 1.13], [1380, 5, 0.08, 1.7], [2600, 6, 0.035, 2.4]] as const) {
    const n = ac.createBufferSource();
    n.buffer = o.noise;
    n.loop = true;
    n.loopStart = Math.random();
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f;
    bp.Q.value = q;
    const g = ac.createGain();
    g.gain.value = v;
    const lfo = ac.createOscillator();
    lfo.frequency.value = rate;
    const lg = ac.createGain();
    lg.gain.value = v * 0.55;
    lfo.connect(lg).connect(g.gain);
    n.connect(bp).connect(g).connect(master);
    n.start();
    lfo.start();
    nodes.push(n, lfo);
  }
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.3);
      for (const s of nodes) s.stop(t + 1.6);
    },
  };
});

/** Lake Laogai: a low beating drone with faint lapping water. */
registerLoop('bss_laogai_hum', (ac, out, o) => {
  const master = ac.createGain();
  master.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];
  for (const [f, v] of [[55, 0.12], [82.6, 0.07], [110.4, 0.035]] as const) {
    const s = ac.createOscillator();
    s.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = v;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.11 + f / 2000;
    const lg = ac.createGain();
    lg.gain.value = v * 0.5;
    lfo.connect(lg).connect(g.gain);
    s.connect(g).connect(master);
    s.start();
    lfo.start();
    nodes.push(s, lfo);
  }
  const n = ac.createBufferSource();
  n.buffer = o.brown;
  n.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 320;
  const wg = ac.createGain();
  wg.gain.value = 0.05;
  const lap = ac.createOscillator();
  lap.frequency.value = 0.35;
  const lapG = ac.createGain();
  lapG.gain.value = 0.04;
  lap.connect(lapG).connect(wg.gain);
  n.connect(lp).connect(wg).connect(master);
  n.start();
  lap.start();
  nodes.push(n, lap);
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.4);
      for (const s of nodes) s.stop(t + 2);
    },
  };
});

/** A train rolling over its stone viaduct: low rumble with a steady thud. */
registerLoop('bss_train_rumble', (ac, out, o) => {
  const master = ac.createGain();
  master.connect(out);
  const n = ac.createBufferSource();
  n.buffer = o.brown;
  n.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  const g = ac.createGain();
  g.gain.value = 0.32;
  const lfo = ac.createOscillator();
  lfo.frequency.value = 1.6;
  const lg = ac.createGain();
  lg.gain.value = 0.14;
  lfo.connect(lg).connect(g.gain);
  n.connect(lp).connect(g).connect(master);
  n.start();
  lfo.start();
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.3);
      n.stop(t + 1.5);
      lfo.stop(t + 1.5);
    },
  };
});
