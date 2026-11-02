import { envGain, noiseSrc, oscSrc, registerSound } from '../../../../audio/registry';

/**
 * Wolf Cove sound recipes (procedural WebAudio): the sea ice creaking and booming, otter penguins'
 * honks, tiger seals' howls, the sled dogs, the festival drum and the workshops' scraping and
 * tapping. The polar wind, surf, gulls and the murmur of the crowd come from the shared ambience
 * library; the hearth uses the shared fire crackle.
 */

/** Sea ice under strain: a slow, groaning creak (a resonant sweep over filtered noise). */
registerSound(
  'swt_ice_creak',
  (ac, out, t, o) => {
    const dur = 1.6 + o.seed * 0.8;
    const { filter } = noiseSrc(ac, o.noise, t, dur, 'bandpass', 380 * o.pitch, 9);
    filter.frequency.setValueAtTime(260 * o.pitch, t);
    filter.frequency.linearRampToValueAtTime(520 * o.pitch, t + dur * 0.6);
    filter.frequency.linearRampToValueAtTime(310 * o.pitch, t + dur);
    const g = envGain(ac, t, 0.25, dur * 0.4, dur * 0.5, 0.34 * o.volume);
    // A ratcheting tremolo: the ice grinding against itself.
    const trem = oscSrc(ac, t, dur, 'square', 14 + o.seed * 10);
    const tg = ac.createGain();
    tg.gain.value = 0.35;
    trem.connect(tg).connect(g.gain);
    filter.connect(g).connect(out);
    const send = ac.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 2.5, range: 220, maxVoices: 2, cooldown: 3, reverb: 0.5, desc: 'Sea ice creaking under strain' },
);

/** A distant boom as the pack ice cracks: a low thump and a long rumble. */
registerSound(
  'swt_ice_boom',
  (ac, out, t, o) => {
    const dur = 3.4;
    const thump = oscSrc(ac, t, 0.9, 'sine', 62 * o.pitch);
    thump.frequency.exponentialRampToValueAtTime(34 * o.pitch, t + 0.8);
    const tg = envGain(ac, t, 0.01, 0.08, 0.8, 0.55 * o.volume);
    thump.connect(tg).connect(out);
    const { filter } = noiseSrc(ac, o.noise, t, dur, 'lowpass', 180 * o.pitch, 0.7);
    const rg = envGain(ac, t + 0.03, 0.08, 0.6, dur - 0.8, 0.4 * o.volume);
    filter.connect(rg).connect(out);
    const crack = noiseSrc(ac, o.noise, t, 0.12, 'highpass', 2400 * o.pitch, 0.7).filter;
    const cg = envGain(ac, t, 0.001, 0.01, 0.1, 0.12 * o.volume);
    crack.connect(cg).connect(out);
    const send = ac.createGain();
    send.gain.value = 0.8;
    rg.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 3.5, range: 900, maxVoices: 1, cooldown: 8, reverb: 0.8, desc: 'Distant boom of cracking pack ice' },
);

/** Otter penguin: a nasal honk, two or three in a row. */
registerSound(
  'swt_penguin',
  (ac, out, t, o) => {
    const n = 2 + Math.floor(o.seed * 2);
    let end = 0;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * (0.22 + o.seed * 0.08);
      const d = 0.16 + (i === n - 1 ? 0.12 : 0);
      const src = oscSrc(ac, t0, d, 'sawtooth', 520 * o.pitch * (1 + i * 0.06));
      src.frequency.setValueAtTime(560 * o.pitch, t0);
      src.frequency.linearRampToValueAtTime(430 * o.pitch, t0 + d);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1300 * o.pitch;
      bp.Q.value = 3;
      const g = envGain(ac, t0, 0.01, d * 0.5, d * 0.5, 0.12 * o.volume);
      src.connect(bp).connect(g).connect(out);
      end = t0 + d - t;
    }
    return end + 0.05;
  },
  { duration: 1, range: 70, maxVoices: 3, cooldown: 0.8, desc: 'Otter penguin honks' },
);

/** Tiger seal: a long, wavering howl that falls away. */
registerSound(
  'swt_seal',
  (ac, out, t, o) => {
    const dur = 1.5 + o.seed * 0.7;
    const src = oscSrc(ac, t, dur, 'sawtooth', 300 * o.pitch);
    src.frequency.setValueAtTime(240 * o.pitch, t);
    src.frequency.linearRampToValueAtTime(420 * o.pitch, t + dur * 0.3);
    src.frequency.exponentialRampToValueAtTime(190 * o.pitch, t + dur);
    const vib = oscSrc(ac, t, dur, 'sine', 5.5);
    const vg = ac.createGain();
    vg.gain.value = 14 * o.pitch;
    vib.connect(vg).connect(src.frequency);
    const g = envGain(ac, t, 0.12, dur * 0.5, dur * 0.4, 0.16 * o.volume);
    for (const [f, q, a] of [[700, 5, 1], [1150, 6, 0.6]] as const) {
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * o.pitch;
      bp.Q.value = q;
      const bg = ac.createGain();
      bg.gain.value = a;
      src.connect(bp).connect(bg).connect(g);
    }
    g.connect(out);
    const send = ac.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 2.3, range: 160, maxVoices: 2, cooldown: 2, reverb: 0.5, desc: 'Tiger seal howl' },
);

/** Sled dog: a couple of sharp barks. */
registerSound(
  'swt_dog',
  (ac, out, t, o) => {
    const n = 1 + Math.floor(o.seed * 3);
    let end = 0;
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.28;
      const src = oscSrc(ac, t0, 0.14, 'sawtooth', 420 * o.pitch);
      src.frequency.setValueAtTime(520 * o.pitch, t0);
      src.frequency.exponentialRampToValueAtTime(300 * o.pitch, t0 + 0.12);
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 * o.pitch;
      bp.Q.value = 2.5;
      const g = envGain(ac, t0, 0.005, 0.03, 0.1, 0.2 * o.volume);
      src.connect(bp).connect(g).connect(out);
      const { filter } = noiseSrc(ac, o.noise, t0, 0.1, 'bandpass', 1800 * o.pitch, 1.2);
      const ng = envGain(ac, t0, 0.003, 0.02, 0.07, 0.06 * o.volume);
      filter.connect(ng).connect(out);
      end = t0 + 0.16 - t;
    }
    return end + 0.05;
  },
  { duration: 1, range: 80, maxVoices: 3, cooldown: 0.6, desc: 'Sled dog barks' },
);

/** Festival drum: a big hide drum, a deep thump with a slap on top. */
registerSound(
  'swt_drum',
  (ac, out, t, o) => {
    const dur = 0.9;
    const src = oscSrc(ac, t, dur, 'sine', 92 * o.pitch);
    src.frequency.exponentialRampToValueAtTime(58 * o.pitch, t + 0.5);
    const g = envGain(ac, t, 0.003, 0.04, 0.8, 0.42 * o.volume);
    src.connect(g).connect(out);
    const { filter } = noiseSrc(ac, o.noise, t, 0.08, 'bandpass', 900 * o.pitch, 1);
    const ng = envGain(ac, t, 0.001, 0.01, 0.06, 0.14 * o.volume);
    filter.connect(ng).connect(out);
    const send = ac.createGain();
    send.gain.value = 0.45;
    g.connect(send).connect(o.reverb);
    return dur;
  },
  { duration: 1, range: 140, maxVoices: 4, cooldown: 0.12, reverb: 0.45, desc: 'Festival hide drum' },
);

/** Workshop: a bone scraper's strokes, or a mallet tapping a carving tool. */
registerSound(
  'swt_carve',
  (ac, out, t, o) => {
    if (o.seed < 0.5) {
      const n = 3 + Math.floor(o.seed * 4);
      for (let i = 0; i < n; i++) {
        const t0 = t + i * 0.32;
        const { filter } = noiseSrc(ac, o.noise, t0, 0.22, 'bandpass', 2400 * o.pitch, 3);
        filter.frequency.setValueAtTime(1800 * o.pitch, t0);
        filter.frequency.linearRampToValueAtTime(3200 * o.pitch, t0 + 0.2);
        const g = envGain(ac, t0, 0.04, 0.1, 0.08, 0.09 * o.volume);
        filter.connect(g).connect(out);
      }
      return n * 0.32 + 0.1;
    }
    const n = 2 + Math.floor(o.seed * 3);
    for (let i = 0; i < n; i++) {
      const t0 = t + i * 0.42;
      const src = oscSrc(ac, t0, 0.08, 'triangle', 760 * o.pitch);
      const g = envGain(ac, t0, 0.001, 0.01, 0.07, 0.14 * o.volume);
      src.connect(g).connect(out);
    }
    return n * 0.42 + 0.1;
  },
  { duration: 2.4, range: 50, maxVoices: 2, cooldown: 1.2, desc: 'Bone scraping and carving taps' },
);
