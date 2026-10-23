import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import type { EventBus } from '../core/EventBus';
import type { SettingsManager, ShadowQuality } from '../core/Settings';

const SHADOW_CONFIG: Record<ShadowQuality, { size: number; radius: number }> = {
  off: { size: 0, radius: 0 },
  low: { size: 1024, radius: 45 },
  medium: { size: 2048, radius: 70 },
  high: { size: 4096, radius: 95 },
};

let fogPatched = false;

/**
 * Atmospheric perspective for every material that uses fog: the stock fog
 * chunks are replaced with a height-aware version (thinner air above the
 * viewer so distant peaks stay visible as silhouettes, hazier valleys below),
 * using radial distance, plus an optional sun in-scattering tint that world
 * shaders enable through `envFogSun` (zero — i.e. off — for other materials).
 * Only data every program already has is required (cameraPosition, viewMatrix,
 * mvPosition), so all built-in and custom fogged materials stay compatible.
 */
export function installAtmosphereFog(): void {
  if (fogPatched) return;
  fogPatched = true;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = length( mvPosition.xyz );
  vFogWorldPos = cameraPosition + transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  uniform vec4 envFogSun;
  uniform vec3 envFogSunDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogK = clamp( ( vFogWorldPos.y - cameraPosition.y ) / 150.0, -0.45, 6.0 );
  float fogHF = abs( fogK ) < 1e-3 ? 1.0 : ( 1.0 - exp( - fogK ) ) / fogK;
  float fogD = vFogDepth * fogHF;
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogD * fogD );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogD );
  #endif
  vec3 fogCol = fogColor;
  if ( envFogSun.a > 0.0 ) {
    vec3 fogV = normalize( vFogWorldPos - cameraPosition );
    float fogS = pow( max( dot( fogV, envFogSunDir ), 0.0 ), 5.0 );
    fogCol = mix( fogCol, envFogSun.rgb, fogS * envFogSun.a );
  }
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif
`;
}

/**
 * Final pass: tone mapping + colour space (like OutputPass) plus a painterly
 * grade — gentle warm highlights / cool shadows split toning, a touch of extra
 * saturation, soft contrast and a vignette.
 */
class GradeOutputPass extends ShaderPass {
  private toneMappingKey = -1;
  constructor() {
    super(
      new THREE.RawShaderMaterial({
        name: 'GradeOutputShader',
        uniforms: {
          tDiffuse: { value: null },
          toneMappingExposure: { value: 1 },
          uSaturation: { value: 1.03 },
          uWarm: { value: new THREE.Vector3(1.035, 1.0, 0.95) },
          uCool: { value: new THREE.Vector3(0.95, 0.985, 1.05) },
          uVignette: { value: 0.26 },
          uContrast: { value: 1.04 },
        },
        vertexShader: /* glsl */ `
          precision highp float;
          uniform mat4 modelViewMatrix;
          uniform mat4 projectionMatrix;
          attribute vec3 position;
          attribute vec2 uv;
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          precision highp float;
          uniform sampler2D tDiffuse;
          uniform float uSaturation;
          uniform vec3 uWarm;
          uniform vec3 uCool;
          uniform float uVignette;
          uniform float uContrast;
          varying vec2 vUv;
          #include <tonemapping_pars_fragment>
          #include <colorspace_pars_fragment>
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            #ifdef LINEAR_TONE_MAPPING
              c.rgb = LinearToneMapping(c.rgb);
            #elif defined(REINHARD_TONE_MAPPING)
              c.rgb = ReinhardToneMapping(c.rgb);
            #elif defined(CINEON_TONE_MAPPING)
              c.rgb = CineonToneMapping(c.rgb);
            #elif defined(ACES_FILMIC_TONE_MAPPING)
              c.rgb = ACESFilmicToneMapping(c.rgb);
            #elif defined(AGX_TONE_MAPPING)
              c.rgb = AgXToneMapping(c.rgb);
            #elif defined(NEUTRAL_TONE_MAPPING)
              c.rgb = NeutralToneMapping(c.rgb);
            #endif
            float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
            c.rgb = mix(vec3(l), c.rgb, uSaturation);
            c.rgb *= mix(uCool, uWarm, smoothstep(0.05, 0.7, l));
            c.rgb = clamp((c.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
            vec2 d = vUv - 0.5;
            c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
            #ifdef SRGB_TRANSFER
              c = sRGBTransferOETF(c);
            #endif
            gl_FragColor = c;
          }`,
      }),
    );
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget, deltaTime: number, maskActive: boolean): void {
    this.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;
    const key = renderer.toneMapping * 10 + (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer ? 1 : 0);
    if (key !== this.toneMappingKey) {
      this.toneMappingKey = key;
      const defs: Record<string, string> = {};
      if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defs.SRGB_TRANSFER = '';
      const tm = renderer.toneMapping;
      if (tm === THREE.LinearToneMapping) defs.LINEAR_TONE_MAPPING = '';
      else if (tm === THREE.ReinhardToneMapping) defs.REINHARD_TONE_MAPPING = '';
      else if (tm === THREE.CineonToneMapping) defs.CINEON_TONE_MAPPING = '';
      else if (tm === THREE.ACESFilmicToneMapping) defs.ACES_FILMIC_TONE_MAPPING = '';
      else if (tm === THREE.AgXToneMapping) defs.AGX_TONE_MAPPING = '';
      else if (tm === THREE.NeutralToneMapping) defs.NEUTRAL_TONE_MAPPING = '';
      this.material.defines = defs;
      this.material.needsUpdate = true;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }
}

/**
 * Owns the WebGLRenderer, scene, main camera, global lights and the
 * post-processing chain. Applies graphics settings live.
 *
 * Global lights (sun + hemisphere) live here so the Sky/time-of-day system can
 * drive them; every other system adds its own objects to `scene`.
 */
export class RenderPipeline {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  /** Direction *towards* the sun (unit). Sky system updates this. */
  readonly sunDir = new THREE.Vector3(0.45, 0.8, 0.35).normalize();

  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private outputPass: GradeOutputPass | null = null;
  private shadowRadius = 0;
  private readonly shadowCenter = new THREE.Vector3();
  private width = 1;
  private height = 1;

  /** Exposed stats for the debug overlay. */
  readonly stats = { fps: 60, frameMs: 16, drawCalls: 0, triangles: 0, geometries: 0, textures: 0 };
  private fpsAccum = 0;
  private fpsFrames = 0;

  /** Extra bloom strength requested by gameplay (Avatar State). */
  bloomBoost = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly settings: SettingsManager,
    private readonly events: EventBus,
  ) {
    installAtmosphereFog();
    const g = settings.data.graphics;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: g.antialias && !g.postProcessing,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(settings.data.controls.fov, 1, 0.1, 3000);
    this.camera.position.set(0, 20, 30);

    this.hemi = new THREE.HemisphereLight(0xcfe4ff, 0x6b5a45, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.position.copy(this.sunDir).multiplyScalar(200);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.fog = new THREE.Fog(0xbfd6ea, 200, 800);

    this.applySettings();
    this.resize();
    window.addEventListener('resize', this.onResize);
    events.on('settings:changed', () => this.applySettings());
  }

  private onResize = (): void => this.resize();

  get drawDistance(): number {
    return this.settings.data.graphics.drawDistance;
  }

  get pixelRatio(): number {
    const g = this.settings.data.graphics;
    return Math.max(0.35, Math.min(g.maxPixelRatio, window.devicePixelRatio || 1) * g.renderScale);
  }

  applySettings(): void {
    const g = this.settings.data.graphics;
    const c = this.settings.data.controls;
    this.renderer.setPixelRatio(this.pixelRatio);

    // Shadows
    const sc = SHADOW_CONFIG[g.shadows];
    const shadowsOn = sc.size > 0;
    if (this.renderer.shadowMap.enabled !== shadowsOn) {
      this.renderer.shadowMap.enabled = shadowsOn;
      this.renderer.shadowMap.needsUpdate = true;
      // Materials must recompile when shadow support toggles.
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) m.forEach((mm) => (mm.needsUpdate = true));
        else m.needsUpdate = true;
      });
    }
    this.sun.castShadow = shadowsOn;
    if (shadowsOn) {
      this.shadowRadius = sc.radius;
      const cam = this.sun.shadow.camera as THREE.OrthographicCamera;
      cam.left = -sc.radius;
      cam.right = sc.radius;
      cam.top = sc.radius;
      cam.bottom = -sc.radius;
      cam.near = 1;
      cam.far = 600;
      cam.updateProjectionMatrix();
      if (this.sun.shadow.mapSize.x !== sc.size) {
        this.sun.shadow.mapSize.set(sc.size, sc.size);
        this.sun.shadow.map?.dispose();
        (this.sun.shadow as any).map = null;
      }
    }

    // Fog / draw distance
    const fog = this.scene.fog as THREE.Fog;
    fog.far = g.drawDistance;
    fog.near = Math.min(g.drawDistance * 0.3, 260);
    this.camera.far = g.drawDistance + 2400; // sky dome & distant impostors beyond fog
    this.camera.fov = c.fov;
    this.camera.updateProjectionMatrix();

    // Post-processing chain
    if (g.postProcessing) {
      if (!this.composer) this.buildComposer();
      if (this.bloomPass) this.bloomPass.enabled = g.bloom;
      const rt = (this.composer as any).renderTarget1 as THREE.WebGLRenderTarget;
      const samples = g.antialias ? 4 : 0;
      if (rt && rt.samples !== samples) {
        (this.composer as any).renderTarget1.samples = samples;
        (this.composer as any).renderTarget2.samples = samples;
        this.composer!.reset();
      }
    } else if (this.composer) {
      this.disposeComposer();
    }
    this.resize();
  }

  private buildComposer(): void {
    const g = this.settings.data.graphics;
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: g.antialias ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.86);
    this.composer.addPass(this.bloomPass);
    this.outputPass = new GradeOutputPass();
    this.composer.addPass(this.outputPass);
  }

  private disposeComposer(): void {
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.composer?.dispose();
    this.composer = null;
    this.renderPass = null;
    this.bloomPass = null;
    this.outputPass = null;
  }

  resize(): void {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
      if (this.bloomPass) this.bloomPass.resolution.set(w * 0.5, h * 0.5);
    }
  }

  get viewportWidth(): number {
    return this.width;
  }

  get viewportHeight(): number {
    return this.height;
  }

  /** Centre the sun's shadow frustum around a world point (usually the player). Snaps to texels to avoid shimmer. */
  setShadowFocus(p: THREE.Vector3): void {
    this.shadowCenter.copy(p);
  }

  private updateSun(): void {
    const center = this.shadowCenter;
    if (this.sun.castShadow && this.shadowRadius > 0) {
      const texel = (this.shadowRadius * 2) / this.sun.shadow.mapSize.x;
      const cx = Math.round(center.x / texel) * texel;
      const cz = Math.round(center.z / texel) * texel;
      this.sun.target.position.set(cx, center.y, cz);
    } else {
      this.sun.target.position.copy(center);
    }
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 300);
    this.sun.target.updateMatrixWorld();
  }

  render(dt: number): void {
    this.updateSun();
    // Count every draw of the frame (scene + post passes + any off-screen
    // renders), not just the last pass, which an auto-resetting info reports.
    const info = this.renderer.info;
    info.autoReset = false;
    info.reset();
    if (this.composer) {
      if (this.bloomPass) {
        this.bloomPass.strength = 0.5 + this.bloomBoost;
      }
      this.composer.render(dt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    // stats
    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.stats.fps = this.fpsFrames / this.fpsAccum;
      this.stats.frameMs = (this.fpsAccum / this.fpsFrames) * 1000;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.geometries = info.memory.geometries;
    this.stats.textures = info.memory.textures;
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    this.disposeComposer();
    this.renderer.dispose();
  }
}
