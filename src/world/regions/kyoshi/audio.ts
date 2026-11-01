import { envGain, noiseSrc, oscSrc, registerSound } from '../../../audio/registry';

/**
 * Kyoshi Island sound recipes (procedural WebAudio): the shrine bell, the dojo's fan snaps and
 * shouts, mallets on the harbor's planks and a fisher's call across the water. Surf, gulls, wind
 * in the pines, the market and harbor beds come from the shared ambience library.
 */

/** Shrine bell: a deep bronze strike with slowly beating partials and a long tail. */
registerSound(
  'ki_bell',
  (ac, out, t, o) => {
    const dur = 6;
    const g = envGain(ac, t, 0.004, 0.08, dur - 0.2, 0.32 * o.volume);
    for (const [hz, a] of [[196, 1], [197.6, 0.7], [392.5, 0.45], [531, 0.3], [783, 0.18]] as const) {
      const osc = oscSrc(ac, t, dur, 'sine', hz * o.pitch);
      const og = ac.createGain();
      og.gain.setValueAtTime(a, t);
      og.gain.exponentialRampToValueAtTime(0.0008, t + dur * (hz > 500 ? 0.4 : 0.95));
      osc.connect(og).connect(g);
    }
    g.connect(out);
    const send = ac.createGain();
    send.gain.value = 0.6;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 6.1, range: 260, maxVoices: 2, cooldown: 2, reverb: 0.6, desc: 'Kyoshi Shrine bronze bell' },
);

/** War fan snapping open: a papery whoosh and a sharp woody click. */
registerSound(
  'ki_fan',
  (ac, out, t, o) => {
    const { filter } = noiseSrc(ac, o.noise, t, 0.14, 'bandpass', 2600 * o.pitch, 0.8);
    filter.frequency.setValueAtTime(1400 * o.pitch, t);
    filter.frequency.exponentialRampToValueAtTime(4200 * o.pitch, t + 0.1);
    const g = envGain(ac, t, 0.01, 0.04, 0.08, 0.22 * o.volume);
    filter.connect(g).connect(out);
    const click = oscSrc(ac, t + 0.11, 0.05, 'square', 1900 * o.pitch);
    const cg = envGain(ac, t + 0.11, 0.001, 0.004, 0.03, 0.1 * o.volume);
    click.connect(cg).connect(out);
    return 0.2;
  },
  { duration: 0.22, range: 90, maxVoices: 6, cooldown: 0.03, desc: 'Kyoshi war fan snapping open' },
);

/** A short "hah!" from the drilling warriors (vowel formants over a breathy buzz). */
registerSound(
  'ki_shout',
  (ac, out, t, o) => {
    const dur = 0.34;
    const src = oscSrc(ac, t, dur, 'sawtooth', 300 * o.pitch * (0.95 + o.seed * 0.1));
    src.frequency.setValueAtTime(330 * o.pitch, t);
    src.frequency.exponentialRampToValueAtTime(250 * o.pitch, t + dur);
    const g = envGain(ac, t, 0.015, 0.06, 0.2, 0.16 * o.volume);
    for (const [f, q, a] of [[820, 6, 1], [1250, 7, 0.7], [2600, 8, 0.25]] as const) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * o.pitch;
      bp.Q.value = q;
      const fg = ac.createGain();
      fg.gain.value = a;
      src.connect(bp).connect(fg).connect(g);
    }
    const { filter } = noiseSrc(ac, o.noise, t, 0.12, 'highpass', 2200, 0.6);
    const ng = envGain(ac, t, 0.005, 0.03, 0.06, 0.05 * o.volume);
    filter.connect(ng).connect(g);
    g.connect(out);
    return dur;
  },
  { duration: 0.36, range: 110, maxVoices: 4, cooldown: 0.05, reverb: 0.25, desc: 'Kyoshi Warriors drill shout' },
);

/** Mallet on a plank (boat building / pier repairs). */
registerSound(
  'ki_hammer',
  (ac, out, t, o) => {
    const body = oscSrc(ac, t, 0.18, 'triangle', 240 * o.pitch * (0.9 + o.seed * 0.2));
    body.frequency.exponentialRampToValueAtTime(150 * o.pitch, t + 0.12);
    const g = envGain(ac, t, 0.001, 0.01, 0.14, 0.3 * o.volume);
    body.connect(g).connect(out);
    const { filter } = noiseSrc(ac, o.noise, t, 0.05, 'bandpass', 1400 * o.pitch, 1.2);
    const g2 = envGain(ac, t, 0.001, 0.006, 0.04, 0.15 * o.volume);
    filter.connect(g2).connect(out);
    return 0.2;
  },
  { duration: 0.22, range: 120, maxVoices: 4, cooldown: 0.12, desc: 'wooden mallet on planks (Koi Harbor)' },
);

/** A fisher's call across the water: a sung vowel sliding up and falling away. */
registerSound(
  'ki_call',
  (ac, out, t, o) => {
    const dur = 1.3;
    const base = 330 * o.pitch * (0.92 + o.seed * 0.16);
    const src = oscSrc(ac, t, dur, 'sawtooth', base);
    src.frequency.setValueAtTime(base, t);
    src.frequency.linearRampToValueAtTime(base * 1.35, t + 0.35);
    src.frequency.linearRampToValueAtTime(base * 1.1, t + dur);
    const vib = ac.createOscillator();
    vib.frequency.value = 5.5;
    const vg = ac.createGain();
    vg.gain.value = base * 0.015;
    vib.connect(vg).connect(src.frequency);
    vib.start(t);
    vib.stop(t + dur);
    const g = envGain(ac, t, 0.12, 0.4, 0.7, 0.09 * o.volume);
    for (const [f, q] of [[700, 5], [1150, 6]] as const) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      src.connect(bp).connect(g);
    }
    g.connect(out);
    const send = ac.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 1.35, range: 200, maxVoices: 2, cooldown: 3, reverb: 0.5, desc: "a fisher's call across Koi Harbor" },
);
