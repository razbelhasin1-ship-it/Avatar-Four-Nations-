import { envGain, noiseSrc, oscSrc, registerLoop, registerSound } from '../../../../audio/registry';

/**
 * Southern Air Temple sound recipes (procedural WebAudio): the high wind round the pinnacle, the
 * hushed drone of the Avatar sanctuary, the monks' chant on the meditation terraces, bison tail
 * whooshes, airbending gusts, air-scooter whirrs and the boys' laughter.
 */

/** High-altitude wind: a low gusting roar and a thin whistle that wanders in pitch. */
registerLoop('sat_wind', (ac, out, o) => {
  const master = ac.createGain();
  master.gain.value = 1;
  master.connect(out);
  const nodes: AudioScheduledSourceNode[] = [];
  const roar = ac.createBufferSource();
  roar.buffer = o.brown;
  roar.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const rg = ac.createGain();
  rg.gain.value = 0.16;
  const gust = ac.createOscillator();
  gust.frequency.value = 0.07;
  const gg = ac.createGain();
  gg.gain.value = 0.1;
  gust.connect(gg).connect(rg.gain);
  roar.connect(lp).connect(rg).connect(master);
  const wh = ac.createBufferSource();
  wh.buffer = o.noise;
  wh.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 880;
  bp.Q.value = 7;
  const sweep = ac.createOscillator();
  sweep.frequency.value = 0.045;
  const sg = ac.createGain();
  sg.gain.value = 260;
  sweep.connect(sg).connect(bp.frequency);
  const wg = ac.createGain();
  wg.gain.value = 0.03;
  const swell = ac.createOscillator();
  swell.frequency.value = 0.11;
  const swg = ac.createGain();
  swg.gain.value = 0.022;
  swell.connect(swg).connect(wg.gain);
  wh.connect(bp).connect(wg).connect(master);
  for (const n of [roar, gust, wh, sweep, swell]) n.start();
  nodes.push(roar, gust, wh, sweep, swell);
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.5);
      for (const s of nodes) s.stop(t + 2.5);
    },
    setParam(name: string, v: number) {
      if (name === 'intensity') master.gain.setTargetAtTime(Math.max(0, Math.min(1.5, v)), ac.currentTime, 0.6);
    },
  };
}, { desc: 'Wind round the pinnacle', params: ['intensity'] });

/** The sanctuary: a deep, slowly beating hum and a breath of air, sent to the reverb. */
registerLoop('sat_sanctuary', (ac, out, o) => {
  const master = ac.createGain();
  master.connect(out);
  master.connect(o.reverb);
  const nodes: AudioScheduledSourceNode[] = [];
  for (const [f, v] of [[55, 0.11], [55.6, 0.09], [110.3, 0.04], [164.9, 0.016]] as const) {
    const s = ac.createOscillator();
    s.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = v;
    s.connect(g).connect(master);
    s.start();
    nodes.push(s);
  }
  const air = ac.createBufferSource();
  air.buffer = o.noise;
  air.loop = true;
  const bp = ac.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 620;
  bp.Q.value = 0.7;
  const ag = ac.createGain();
  ag.gain.value = 0.018;
  air.connect(bp).connect(ag).connect(master);
  air.start();
  nodes.push(air);
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.6);
      for (const s of nodes) s.stop(t + 3);
    },
  };
}, { desc: 'Avatar sanctuary hum' });

/** Monks chanting together: a low drone on a vowel, with a fifth above, swelling slowly. */
registerLoop('sat_chant', (ac, out, o) => {
  const master = ac.createGain();
  master.connect(out);
  master.connect(o.reverb);
  const nodes: AudioScheduledSourceNode[] = [];
  const f1 = ac.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 420;
  f1.Q.value = 3;
  const f2 = ac.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 780;
  f2.Q.value = 4;
  const mix = ac.createGain();
  mix.gain.value = 0.22;
  f1.connect(mix);
  f2.connect(mix);
  mix.connect(master);
  for (const [f, v, d] of [[98, 0.5, 0.0], [98.6, 0.35, 0.3], [147, 0.25, 0.6], [196.5, 0.12, 0.2]] as const) {
    const s = ac.createOscillator();
    s.type = 'sawtooth';
    s.frequency.value = f;
    const g = ac.createGain();
    g.gain.value = v;
    const lfo = ac.createOscillator();
    lfo.frequency.value = 0.09 + d * 0.05;
    const lg = ac.createGain();
    lg.gain.value = v * 0.45;
    lfo.connect(lg).connect(g.gain);
    s.connect(g);
    g.connect(f1);
    g.connect(f2);
    s.start();
    lfo.start();
    nodes.push(s, lfo);
  }
  return {
    stop(t: number) {
      master.gain.setTargetAtTime(0, t, 0.8);
      for (const s of nodes) s.stop(t + 4);
    },
  };
}, { desc: 'Monks chanting' });

/** A sky bison's tail stroke: a deep, soft push of air. */
registerSound('sat_whoosh', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.9, 'bandpass', 320 * o.pitch, 0.8);
  filter.frequency.exponentialRampToValueAtTime(110 * o.pitch, t + 0.75);
  const g = envGain(ac, t, 0.16, 0.12, 0.55, 0.55 * o.volume);
  filter.connect(g).connect(out);
  return 0.95;
});

/** An airbending gust: a quick bright rush of air. */
registerSound('sat_gust', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.5, 'bandpass', 1900 * o.pitch, 1.1);
  filter.frequency.exponentialRampToValueAtTime(560 * o.pitch, t + 0.4);
  const g = envGain(ac, t, 0.02, 0.06, 0.3, 0.32 * o.volume);
  filter.connect(g).connect(out);
  return 0.5;
});

/** An air scooter whirring past. */
registerSound('sat_whirr', (ac, out, t, o) => {
  const { filter } = noiseSrc(ac, o.noise, t, 0.8, 'bandpass', 950 * o.pitch, 2.2);
  const g = envGain(ac, t, 0.08, 0.3, 0.35, 0.28 * o.volume);
  const trem = ac.createOscillator();
  trem.frequency.setValueAtTime(28, t);
  const tg = ac.createGain();
  tg.gain.value = 0.5;
  const amp = ac.createGain();
  amp.gain.value = 0.6;
  trem.connect(tg).connect(amp.gain);
  filter.connect(amp).connect(g).connect(out);
  trem.start(t);
  trem.stop(t + 0.85);
  return 0.85;
});

/** Boys laughing: a few quick 'ha' syllables, bright and falling. */
registerSound('sat_laugh', (ac, out, t, o) => {
  const n = 3 + Math.floor(Math.random() * 3);
  const base = (380 + Math.random() * 120) * o.pitch;
  for (let i = 0; i < n; i++) {
    const t0 = t + i * (0.12 + Math.random() * 0.04);
    const f = base * (1 - i * 0.04);
    const s = oscSrc(ac, t0, 0.11, 'sawtooth', f);
    s.frequency.exponentialRampToValueAtTime(f * 0.86, t0 + 0.1);
    const fm = ac.createBiquadFilter();
    fm.type = 'bandpass';
    fm.frequency.value = 1050;
    fm.Q.value = 2.5;
    const g = envGain(ac, t0, 0.012, 0.04, 0.06, 0.16 * o.volume);
    s.connect(fm).connect(g).connect(out);
    const { filter } = noiseSrc(ac, o.noise, t0, 0.08, 'highpass', 2400, 0.7);
    const ng = envGain(ac, t0, 0.005, 0.02, 0.04, 0.05 * o.volume);
    filter.connect(ng).connect(out);
  }
  return n * 0.16 + 0.2;
});
