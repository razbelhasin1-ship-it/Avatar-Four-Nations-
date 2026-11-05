import { blendMoods, MOODS, type Mood } from './moods';
import { buildRidges, RIDGE_WIDTH } from './ridges';
import { FRAG, VERT } from './shader';

export interface HeroOptions {
  reducedMotion: boolean;
  /** Called with the mood index whenever the scene settles on a new mood. */
  onMood?: (index: number) => void;
}

const RIPPLES = 8;

/**
 * The living painting behind the landing page. One WebGL2 full-screen pass; renders at an adaptive
 * fraction of the display resolution, pauses whenever it is off screen, hidden, or the game is open.
 */
export class HeroScene {
  readonly ok: boolean;
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private tex!: WebGLTexture;
  private vao!: WebGLVertexArrayObject;

  private weights = [1, 0, 0, 0];
  private from = [1, 0, 0, 0];
  private target = 0;
  private blendT = 1;
  private mood: Mood = structuredClone(MOODS[0]);

  private mouse = [0, 0];
  private mouseTarget = [0, 0];
  private scroll = 0;
  private ripples = new Float32Array(RIPPLES * 4);
  private rippleIdx = 0;
  private lastRipple = 0;
  private lastPointer: [number, number] | null = null;

  private scale: number;
  private maxScale: number;
  private frameTimes: number[] = [];
  private running = false;
  private visible = true;
  private paused = false;
  private raf = 0;
  private last = 0;
  private time = 0;
  private intro = 0;
  private dirty = true;

  constructor(
    private canvas: HTMLCanvasElement,
    private opts: HeroOptions,
  ) {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.maxScale = Math.min(dpr, 1.5) * (coarse ? 0.7 : 0.85);
    this.scale = Math.min(this.maxScale, coarse ? 0.55 : 0.75);
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    this.ok = !!gl && this.init(gl);
    if (!this.ok) return;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
    });
    if (opts.reducedMotion) this.intro = 1;
  }

  private init(gl: WebGL2RenderingContext): boolean {
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('hero shader:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('hero program:', gl.getProgramInfoLog(prog));
      return false;
    }
    this.prog = prog;
    gl.useProgram(prog);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, RIDGE_WIDTH, 4, 0, gl.RGBA, gl.FLOAT, buildRidges());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const names = [
      'uRes', 'uTime', 'uMouse', 'uScroll', 'uRidges', 'uWeights', 'uSkyTop', 'uSkyMid', 'uSkyHorizon', 'uSunPos', 'uSunSize', 'uSunGlow', 'uMoon', 'uSunColor',
      'uStars', 'uAurora', 'uClouds', 'uRays', 'uCloudSea', 'uWater', 'uGlitter', 'uCloudLit', 'uCloudShade', 'uWaterDeep', 'uMtnNear', 'uMtnFar', 'uFog', 'uRim',
      'uMist', 'uSnow', 'uLava', 'uRimStrength', 'uPColor', 'uPVel', 'uPSize', 'uPStretch', 'uPGlow', 'uPDensity', 'uPFlicker', 'uPSwirl', 'uLanterns', 'uExposure',
      'uIntro', 'uRipples',
    ];
    for (const n of names) this.loc[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.loc.uRidges, 0);
    return gl.getError() === gl.NO_ERROR;
  }

  /** Ease to another mood (0 water, 1 earth, 2 fire, 3 air). */
  setMood(index: number, instant = false): void {
    if (!this.ok) return;
    this.target = index;
    this.from = [...this.weights];
    this.blendT = instant || this.opts.reducedMotion ? 1 : 0;
    if (this.blendT === 1) this.weights = [0, 1, 2, 3].map((i) => (i === index ? 1 : 0));
    this.dirty = true;
    this.kick();
  }

  /** Pointer position in canvas pixels: parallax, and ripples where it moves over the water. */
  pointer(x: number, y: number, w: number, h: number): void {
    this.mouseTarget[0] = (x / w) * 2 - 1;
    this.mouseTarget[1] = -((y / h) * 2 - 1);
    const u = x / w;
    const v = 1 - y / h;
    const now = this.time;
    if (this.lastPointer) {
      const dx = (u - this.lastPointer[0]) * (w / h);
      const dy = v - this.lastPointer[1];
      const speed = Math.hypot(dx, dy);
      if (v < 0.36 && now - this.lastRipple > 0.09 && speed > 0.004) {
        this.addRipple(u, v, Math.min(1, 0.25 + speed * 18));
        this.lastRipple = now;
      }
    }
    this.lastPointer = [u, v];
  }

  /** A splash where the user clicks or taps the water. */
  splash(x: number, y: number, w: number, h: number): void {
    const v = 1 - y / h;
    if (v < 0.38) this.addRipple(x / w, v, 1.6);
  }

  private addRipple(u: number, v: number, amp: number): void {
    const i = this.rippleIdx++ % RIPPLES;
    this.ripples.set([u, v, this.time, amp], i * 4);
    this.dirty = true;
    this.kick();
  }

  setScroll(p: number): void {
    this.scroll = Math.max(0, Math.min(1, p));
    this.dirty = true;
  }

  /** Off screen or on another page: stop drawing. */
  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.kick();
  }

  /** The game is open: give it the GPU. */
  setPaused(p: boolean): void {
    this.paused = p;
    if (!p) this.kick();
  }

  start(): void {
    if (!this.ok) return;
    this.running = true;
    this.kick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private kick(): void {
    if (!this.ok || !this.running || this.raf || !this.visible || this.paused || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (!this.running || !this.visible || this.paused || document.hidden) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const reduced = this.opts.reducedMotion;
    if (!reduced) this.time += dt;
    if (this.intro < 1) this.intro = Math.min(1, this.intro + dt / 1.8);

    // Mood blend (smootherstep over ~1.8 s).
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 1.8);
      const t = this.blendT;
      const e = t * t * t * (t * (t * 6 - 15) + 10);
      this.weights = this.from.map((f, i) => f + ((i === this.target ? 1 : 0) - f) * e);
      this.dirty = true;
      if (this.blendT === 1) this.opts.onMood?.(this.target);
    }
    // Parallax follows the pointer gently.
    const k = 1 - Math.exp(-dt * 3);
    this.mouse[0] += (this.mouseTarget[0] - this.mouse[0]) * k;
    this.mouse[1] += (this.mouseTarget[1] - this.mouse[1]) * k;

    this.resize();
    this.draw();

    // Adapt the resolution to keep the page smooth.
    if (!reduced) {
      this.frameTimes.push(dt);
      if (this.frameTimes.length >= 45) {
        const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
        this.frameTimes.length = 0;
        if (avg > 0.024 && this.scale > 0.32) this.scale = Math.max(0.32, this.scale * 0.82);
        else if (avg < 0.0135 && this.scale < this.maxScale) this.scale = Math.min(this.maxScale, this.scale * 1.08);
      }
    }
    this.dirty = false;
    if (!reduced || this.blendT < 1 || this.intro < 1) this.raf = requestAnimationFrame(this.frame);
  };

  private resize(): void {
    const c = this.canvas;
    const w = Math.max(2, Math.round(c.clientWidth * this.scale));
    const h = Math.max(2, Math.round(c.clientHeight * this.scale));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  }

  private draw(): void {
    const gl = this.gl;
    const L = this.loc;
    const m = blendMoods(this.weights, this.mood);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(L.uTime, this.time);
    gl.uniform2f(L.uMouse, this.mouse[0], this.mouse[1]);
    gl.uniform1f(L.uScroll, this.scroll);
    gl.uniform4f(L.uWeights, this.weights[0], this.weights[1], this.weights[2], this.weights[3]);
    gl.uniform3fv(L.uSkyTop, m.skyTop);
    gl.uniform3fv(L.uSkyMid, m.skyMid);
    gl.uniform3fv(L.uSkyHorizon, m.skyHorizon);
    gl.uniform2fv(L.uSunPos, m.sunPos);
    gl.uniform1f(L.uSunSize, m.sunSize);
    gl.uniform1f(L.uSunGlow, m.sunGlow);
    gl.uniform1f(L.uMoon, m.moon);
    gl.uniform3fv(L.uSunColor, m.sunColor);
    gl.uniform1f(L.uStars, m.stars);
    gl.uniform1f(L.uAurora, m.aurora);
    gl.uniform1f(L.uClouds, m.clouds);
    gl.uniform1f(L.uRays, m.rays);
    gl.uniform1f(L.uCloudSea, m.cloudSea);
    gl.uniform1f(L.uWater, m.water);
    gl.uniform1f(L.uGlitter, m.glitter);
    gl.uniform3fv(L.uCloudLit, m.cloudLit);
    gl.uniform3fv(L.uCloudShade, m.cloudShade);
    gl.uniform3fv(L.uWaterDeep, m.waterDeep);
    gl.uniform3fv(L.uMtnNear, m.mtnNear);
    gl.uniform3fv(L.uMtnFar, m.mtnFar);
    gl.uniform3fv(L.uFog, m.fog);
    gl.uniform3fv(L.uRim, m.rim);
    gl.uniform1f(L.uMist, m.mist);
    gl.uniform1f(L.uSnow, m.snow);
    gl.uniform1f(L.uLava, m.lava);
    gl.uniform1f(L.uRimStrength, m.rimStrength);
    gl.uniform3fv(L.uPColor, m.pColor);
    gl.uniform2fv(L.uPVel, m.pVel);
    gl.uniform1f(L.uPSize, m.pSize);
    gl.uniform1f(L.uPStretch, m.pStretch);
    gl.uniform1f(L.uPGlow, m.pGlow);
    gl.uniform1f(L.uPDensity, m.pDensity);
    gl.uniform1f(L.uPFlicker, m.pFlicker);
    gl.uniform1f(L.uPSwirl, m.pSwirl);
    gl.uniform1f(L.uLanterns, m.lanterns);
    gl.uniform1f(L.uExposure, m.exposure);
    gl.uniform1f(L.uIntro, this.intro * this.intro * (3 - 2 * this.intro));
    gl.uniform4fv(L.uRipples, this.ripples);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Debug/test helper: render one frame now at a given time. */
  renderAt(time: number): void {
    if (!this.ok) return;
    this.time = time;
    this.intro = 1;
    this.blendT = 1;
    this.weights = [0, 1, 2, 3].map((i) => (i === this.target ? 1 : 0));
    this.resize();
    this.draw();
  }

  get currentScale(): number {
    return this.scale;
  }

  dispose(): void {
    this.stop();
    if (!this.ok) return;
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteProgram(this.prog);
    gl.deleteVertexArray(this.vao);
  }
}
