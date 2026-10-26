/**
 * Recorded music track (the main menu theme) played through the music bus, so the
 * music volume, mute, dialogue ducking and the master limiter apply as for the
 * generative themes.
 *
 * - The file is fetched once into a Blob: a blob: URL is same-origin (WebAudio hears
 *   it) and fully seekable everywhere, including the Android WebView's asset loader
 *   (no range requests), so `loop` and rewinding are reliable.
 * - An <audio> element streams it (a decoded 7-minute AudioBuffer would take ~150 MB)
 *   into a MediaElementAudioSourceNode → fade gain → out.
 * - Fades in and out with the theme; once faded out it pauses and rewinds, so every
 *   visit to the menu starts the theme from the top.
 * - Pauses while the page is hidden; retries play() on the next tap if the browser
 *   blocked it; a rebuilt AudioContext (engine watchdog) gets a new element at the
 *   same position (an element can only ever feed one source node).
 * - `failed` (bad file, decode error) lets the director fall back to the generative theme.
 */
export class TrackPlayer {
  failed = false;
  private blobUrl: string | null = null;
  private loading: Promise<void> | null = null;
  private el: HTMLAudioElement | null = null;
  private node: MediaElementAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private ac: AudioContext | null = null;
  private out: AudioNode | null = null;
  private wanted = false;
  private fadeIn = 2;
  /** Context time when the current fade-out ends (then the element pauses and rewinds). */
  private stopAt = Infinity;
  private hiddenPause = false;
  private gestureArmed = false;

  constructor(
    readonly id: string,
    private readonly url: string,
    /** Linear gain of the track on the music bus. */
    private readonly level: number,
    private readonly onFail: () => void,
  ) {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  /** Media elements routed into WebAudio are required (not available offline or outside a browser). */
  static supported(ac?: BaseAudioContext | null): boolean {
    if (typeof Audio === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof fetch !== 'function') return false;
    return !ac || typeof (ac as AudioContext).createMediaElementSource === 'function';
  }

  get playing(): boolean {
    return this.wanted && !!this.el && !this.el.paused;
  }

  /** Download the file ahead of time (no-op once loading). */
  prefetch(): void {
    void this.load();
  }

  private load(): Promise<void> {
    if (!this.loading) {
      this.loading = fetch(this.url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.blob();
        })
        .then((b) => {
          this.blobUrl = URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' }));
        })
        .catch((err) => this.fail(err));
    }
    return this.loading;
  }

  private fail(err: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.wanted = false;
    console.warn(`[Audio] music track '${this.id}' unavailable, using the generative theme`, err);
    this.release();
    this.onFail();
  }

  /** Start (or keep) playing into `out`, fading in over `fadeIn` seconds once the file is loaded. */
  play(ac: AudioContext, out: AudioNode, fadeIn: number): void {
    if (this.failed) return;
    if (this.ac !== ac || this.out !== out) this.rewire(ac, out);
    this.wanted = true;
    this.fadeIn = fadeIn;
    this.stopAt = Infinity;
    if (this.blobUrl) this.start();
    else void this.load().then(() => this.start());
  }

  /** Fade out over `fade` seconds, then pause and rewind. */
  stop(fade: number): void {
    this.wanted = false;
    const ac = this.ac, g = this.gain;
    if (!ac || !g) return;
    const now = ac.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + Math.max(0.05, fade));
    this.stopAt = now + Math.max(0.05, fade);
  }

  update(): void {
    const el = this.el, ac = this.ac;
    if (this.wanted || !el || !ac || el.paused || ac.currentTime < this.stopAt) return;
    el.pause();
    el.currentTime = 0;
    this.stopAt = Infinity;
  }

  /** A new context (or output): the old element can never be re-routed, so make a new one at the same spot. */
  private rewire(ac: AudioContext, out: AudioNode): void {
    const at = this.el ? this.el.currentTime : 0;
    const resume = this.playing;
    this.release();
    this.ac = ac;
    this.out = out;
    if (resume && this.blobUrl) {
      this.createElement();
      if (this.el) this.el.currentTime = at;
    }
  }

  private createElement(): void {
    if (this.el || !this.blobUrl || !this.ac || !this.out) return;
    try {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = true;
      el.src = this.blobUrl;
      el.addEventListener('error', () => {
        if (this.el === el) this.fail(el.error ?? new Error('media error'));
      });
      const node = this.ac.createMediaElementSource(el);
      const g = this.ac.createGain();
      g.gain.value = 0;
      node.connect(g).connect(this.out);
      this.el = el;
      this.node = node;
      this.gain = g;
    } catch (err) {
      this.fail(err);
    }
  }

  private start(): void {
    if (!this.wanted || this.failed) return;
    this.createElement();
    const el = this.el, g = this.gain, ac = this.ac;
    if (!el || !g || !ac) return;
    const now = ac.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(this.level, now + Math.max(0.05, this.fadeIn));
    if (el.paused && !document.hidden) this.tryPlay();
  }

  private tryPlay(): void {
    const el = this.el;
    if (!el) return;
    el.play().catch((err: { name?: string }) => {
      // Blocked until the player taps again (autoplay rules); a pause() during play() is harmless.
      if (err?.name === 'NotAllowedError') this.armGesture();
      else if (err?.name !== 'AbortError') this.fail(err);
    });
  }

  private armGesture(): void {
    if (this.gestureArmed || typeof window === 'undefined') return;
    this.gestureArmed = true;
    const kick = () => {
      this.gestureArmed = false;
      for (const t of ['pointerdown', 'touchend', 'keydown'] as const) window.removeEventListener(t, kick, true);
      if (this.wanted && this.el?.paused && !document.hidden) this.tryPlay();
    };
    for (const t of ['pointerdown', 'touchend', 'keydown'] as const) window.addEventListener(t, kick, true);
  }

  private onVisibility(): void {
    const el = this.el;
    if (!el) return;
    if (document.hidden) {
      if (!el.paused) {
        el.pause();
        // Hidden mid fade-out: finish the stop now (rewound for the next menu visit).
        if (this.wanted) this.hiddenPause = true;
        else el.currentTime = 0;
      }
    } else if (this.hiddenPause) {
      this.hiddenPause = false;
      if (this.wanted) this.tryPlay();
    }
  }

  private release(): void {
    const el = this.el;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    try {
      this.node?.disconnect();
      this.gain?.disconnect();
    } catch {
      /* context already closed */
    }
    this.el = null;
    this.node = null;
    this.gain = null;
  }

  state(): { loaded: boolean; failed: boolean; playing: boolean; paused: boolean; time: number; duration: number; level: number } {
    const el = this.el;
    return {
      loaded: !!this.blobUrl,
      failed: this.failed,
      playing: this.playing,
      paused: !el || el.paused,
      time: el ? +el.currentTime.toFixed(2) : 0,
      duration: el && Number.isFinite(el.duration) ? +el.duration.toFixed(2) : 0,
      level: this.gain ? +this.gain.gain.value.toFixed(3) : 0,
    };
  }
}
