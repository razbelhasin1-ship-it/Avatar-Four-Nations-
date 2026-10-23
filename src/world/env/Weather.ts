import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { WorldUpdatable } from '../World';
import type { RegionDef } from '../WorldLayout';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL, envUniforms } from './EnvShared';

/**
 * Regional weather: picks conditions from REGIONS[].weather, blends every
 * parameter smoothly (sky cover/overcast/tint, fog distance, wind, surface
 * wetness, precipitation) and renders precipitation as GPU-animated particle
 * boxes that follow the camera (no per-particle CPU work):
 *   rain (streaks), snow / blizzard (wind-driven flakes), ashfall (flakes plus
 *   glowing embers), sandstorm (horizontal dust streaks), wind (blown leaves).
 * Rain sets ctx.water.raining (rain becomes a waterbending source) and wets the
 * terrain. Emits 'weather:changed'. Particle counts follow
 * settings.graphics.particleDensity. Precipitation (rain, snow, blizzard drift,
 * ash, blowing sand) tells the player what the weather is doing, so it stays
 * visible without ambientEffects at a reduced density; only the decorative
 * layers (ashfall embers, wind-blown leaves) need ambientEffects. Density 0
 * turns every layer off (sky, fog, wind and wetness still change, so gameplay
 * is identical).
 */

export type WeatherType = 'clear' | 'cloudy' | 'snow' | 'blizzard' | 'rain' | 'fog' | 'ashfall' | 'sandstorm' | 'wind';
export const WEATHER_TYPES: WeatherType[] = ['clear', 'cloudy', 'snow', 'blizzard', 'rain', 'fog', 'ashfall', 'sandstorm', 'wind'];

interface WeatherParams {
  cloudCover: number;
  overcast: number;
  /** Fog density multiplier (fog distance = drawDistance / fogScale). */
  fogScale: number;
  tint: THREE.Color;
  cloudTint: THREE.Color;
  wind: number;
  gust: number;
  wet: number;
  rain: number;
  snow: number;
  ash: number;
  sand: number;
  leaves: number;
}

function params(p: Partial<Omit<WeatherParams, 'tint' | 'cloudTint'>> & { tint?: string; cloudTint?: string }): WeatherParams {
  return {
    cloudCover: p.cloudCover ?? 0.4,
    overcast: p.overcast ?? 0,
    fogScale: p.fogScale ?? 1,
    tint: new THREE.Color(p.tint ?? '#ffffff'),
    cloudTint: new THREE.Color(p.cloudTint ?? '#ffffff'),
    wind: p.wind ?? 0.35,
    gust: p.gust ?? 0.3,
    wet: p.wet ?? 0,
    rain: p.rain ?? 0,
    snow: p.snow ?? 0,
    ash: p.ash ?? 0,
    sand: p.sand ?? 0,
    leaves: p.leaves ?? 0,
  };
}

const PRESETS: Record<WeatherType, WeatherParams> = {
  clear: params({ cloudCover: 0.32, wind: 0.3, gust: 0.25 }),
  cloudy: params({ cloudCover: 0.78, overcast: 0.35, fogScale: 1.15, wind: 0.45, gust: 0.4 }),
  rain: params({ cloudCover: 0.95, overcast: 0.82, fogScale: 1.9, tint: '#c6cdd6', cloudTint: '#9aa3ae', wind: 0.6, gust: 0.55, wet: 1, rain: 1 }),
  snow: params({ cloudCover: 0.9, overcast: 0.6, fogScale: 1.8, tint: '#e2ecf8', cloudTint: '#dfe6ef', wind: 0.4, gust: 0.35, snow: 0.7 }),
  blizzard: params({ cloudCover: 1, overcast: 0.88, fogScale: 6.5, tint: '#eef4fb', cloudTint: '#e4eaf2', wind: 1.35, gust: 0.9, snow: 1 }),
  fog: params({ cloudCover: 0.7, overcast: 0.55, fogScale: 5.5, tint: '#cfd8cc', cloudTint: '#c8d0c8', wind: 0.12, gust: 0.1, wet: 0.35 }),
  ashfall: params({ cloudCover: 0.76, overcast: 0.32, fogScale: 2.2, tint: '#f2a77c', cloudTint: '#d69a74', wind: 0.35, gust: 0.3, ash: 1 }),
  sandstorm: params({ cloudCover: 0.7, overcast: 0.55, fogScale: 7, tint: '#e3b77e', cloudTint: '#d9b07c', wind: 1.4, gust: 0.95, sand: 1 }),
  wind: params({ cloudCover: 0.45, overcast: 0.1, fogScale: 1.05, wind: 1.15, gust: 0.9, leaves: 1 }),
};

/** Per-region colour mood applied on top of the weather (warm Fire Nation haze, cool poles...). */
const REGION_TINT: Record<string, string> = {
  fire_nation_capital: '#ffe2cf',
  ember_island: '#fff0dc',
  si_wong_desert: '#fff0d6',
  foggy_swamp: '#e6efdc',
  northern_water_tribe: '#eef5ff',
  southern_water_tribe: '#eef5ff',
  frozen_tundra: '#f0f6ff',
};

/** Weighted pick: the first listed weather is the region's typical one. */
export function pickWeather(list: readonly WeatherType[], r: number, avoid?: WeatherType): WeatherType {
  if (!list.length) return 'clear';
  const weights = list.map((w, i) => (i === 0 ? 3 : w === 'blizzard' || w === 'sandstorm' ? 0.8 : 1.2) * (w === avoid && list.length > 1 ? 0.35 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = r * total;
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x <= 0) return list[i];
  }
  return list[list.length - 1];
}

// ---------------------------------------------------------------------------
// Precipitation layer (camera-following particle box animated in the shader)
// ---------------------------------------------------------------------------

export interface LayerOptions {
  name: string;
  count: number;
  box: [number, number, number];
  /** Fall velocity (m/s, y negative) — wind is added on top. */
  fall: number;
  windFactor: number;
  /** Width, length (m). */
  size: [number, number];
  /** 0 = streak along velocity, 1 = soft round flake, 2 = tumbling ash flake, 3 = glowing ember, 4 = dust streak, 5 = leaf. */
  shape: number;
  color: string;
  opacity: number;
  additive?: boolean;
  sway: number;
}

const PRECIP_VERT = /* glsl */ `
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
attribute vec4 aSeed;
uniform vec3 uBox;
uniform vec3 uVel;
uniform vec2 uSize;
uniform float uIntensity;
uniform float uShape;
uniform float uSway;
uniform float uTime;
uniform float uPixel;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = position.xy;
  vSeed = aSeed.w;
  vec3 vel = uVel * ( 0.8 + 0.4 * fract( aSeed.w * 7.31 ) );
  vec3 p = aSeed.xyz * uBox + vel * uTime;
  // Flutter / sway (snow, ash, leaves).
  float ph = aSeed.w * 40.0;
  p.x += sin( uTime * 1.3 + ph ) * uSway;
  p.z += cos( uTime * 1.1 + ph * 1.7 ) * uSway;
  vec3 rel = mod( p - cameraPosition + uBox * 0.5, uBox ) - uBox * 0.5;
  vec3 wp = cameraPosition + rel;
  bool visible = aSeed.w < uIntensity;
  // No particles inside the ground (height texture) or below the sea.
  float ground = envTerrainHeight( wp.xz );
  if ( wp.y < ground - 0.2 || wp.y < -0.5 ) visible = false;
  // Fade at the box edges so the wrap never pops.
  vec3 e = abs( rel ) / ( uBox * 0.5 );
  float edge = 1.0 - smoothstep( 0.75, 1.0, max( e.x, max( e.y, e.z ) ) );
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float depth = -mv.z;
  vAlpha = edge * smoothstep( 0.4, 2.0, depth );
  vec2 corner = position.xy; // -0.5..0.5
  // Never thinner than ~1.3 px (sub-pixel quads would vanish); fade to keep brightness.
  float minW = depth * uPixel * 1.3;
  float width = max( uSize.x, minW );
  vAlpha *= clamp( uSize.x / width, 0.3, 1.0 );
  if ( uShape < 0.5 || uShape > 3.5 && uShape < 4.5 ) {
    // Streak aligned with the screen-space motion direction.
    vec3 tail = wp - normalize( vel ) * uSize.y;
    vec4 mvT = viewMatrix * vec4( tail, 1.0 );
    vec2 dir = mv.xy - mvT.xy;
    float dl = length( dir );
    dir = dl > 1e-4 ? dir / dl : vec2( 0.0, 1.0 );
    vec2 side = vec2( -dir.y, dir.x );
    vec3 base = mix( mvT.xyz, mv.xyz, corner.y + 0.5 );
    mv.xyz = base + vec3( side * corner.x * width, 0.0 );
  } else {
    float rot = uShape > 1.5 ? uTime * ( 1.5 + 3.0 * fract( aSeed.w * 13.7 ) ) + ph : 0.0;
    float c = cos( rot ), s = sin( rot );
    vec2 q = mat2( c, -s, s, c ) * corner;
    float squash = uShape > 1.5 && uShape < 2.5 ? 0.55 + 0.45 * abs( sin( uTime * 2.0 + ph ) ) : 1.0;
    q.y *= squash;
    mv.xy += q * width * ( 0.7 + 0.6 * fract( aSeed.w * 3.7 ) );
  }
  if ( !visible ) mv = vec4( 0.0, 0.0, 10.0, 1.0 );
  vec4 mvPosition = mv;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const PRECIP_FRAG = /* glsl */ `
${ENV_PARS_GLSL}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uShape;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
#include <common>
#include <fog_pars_fragment>
void main() {
  vec2 q = vUv * 2.0;
  float a;
  vec3 col = uColor;
  float sun = clamp( uSunDir.y, 0.0, 1.0 );
  vec3 light = uSunColor * ( 0.25 + 0.55 * sun ) + uSkyHorizon * 0.55 + vec3( 0.03 );
  if ( uShape < 0.5 ) {
    a = ( 1.0 - abs( q.x ) ) * smoothstep( -1.0, 0.2, q.y ) * smoothstep( 1.0, 0.6, q.y );
    col *= light;
  } else if ( uShape < 1.5 ) {
    a = smoothstep( 1.0, 0.25, length( q ) );
    col *= light * 1.05;
  } else if ( uShape < 2.5 ) {
    a = step( length( q * vec2( 1.0, 1.4 ) ), 0.95 ) * 0.9;
    col *= light * ( 0.75 + 0.5 * fract( vSeed * 11.0 ) );
  } else if ( uShape < 3.5 ) {
    a = smoothstep( 1.0, 0.0, length( q ) );
    col *= 1.6 + 0.8 * fract( vSeed * 17.0 );
  } else if ( uShape < 4.5 ) {
    a = ( 1.0 - abs( q.x ) ) * smoothstep( -1.0, 0.0, q.y ) * smoothstep( 1.0, 0.3, q.y ) * 0.6;
    col *= light;
  } else {
    // Leaf: little almond shape, two tones.
    float d = length( vec2( q.x * 1.9, q.y ) );
    a = step( d, 0.95 );
    col = mix( vec3( 0.36, 0.5, 0.18 ), vec3( 0.72, 0.62, 0.24 ), fract( vSeed * 23.0 ) ) * light * 1.2;
  }
  a *= uOpacity * vAlpha;
  if ( a < 0.01 ) discard;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** View-space size of one pixel at 1 m depth (updated per frame). */
const PRECIP_PIXEL = { value: 0.002 };

export class PrecipLayer {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly baseFall: number;
  /** Current 0..1 amount (visible fraction of particles). */
  amount = 0;

  constructor(private readonly o: LayerOptions, time: { value: number }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count; i++) {
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = (i + Math.random()) / o.count; // rank: uniform thinning
    }
    this.geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.geo.instanceCount = 0;
    this.baseFall = o.fall;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBox: { value: new THREE.Vector3(...o.box) },
        uVel: { value: new THREE.Vector3(0, o.fall, 0) },
        uSize: { value: new THREE.Vector2(...o.size) },
        uIntensity: { value: 0 },
        uShape: { value: o.shape },
        uSway: { value: o.sway },
        uTime: time,
        uPixel: PRECIP_PIXEL,
        uColor: { value: new THREE.Color(o.color) },
        uOpacity: { value: o.opacity },
        ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      },
      vertexShader: PRECIP_VERT,
      fragmentShader: PRECIP_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      // Streak quads are re-oriented in view space (mirrored winding for some directions).
      side: THREE.DoubleSide,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    attachEnvUniforms(this.material);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'precip_' + o.name;
    quad.dispose();
  }

  /** amount 0..1, density = particle budget multiplier, wind = world wind vector (m/s). */
  update(amount: number, density: number, windX: number, windZ: number, fallScale = 1): void {
    this.amount = amount;
    const n = Math.round(this.o.count * Math.min(1, density));
    const visible = amount > 0.002 && n > 0;
    this.mesh.visible = visible;
    if (!visible) return;
    const u = this.material.uniforms;
    // Draw only the needed prefix of the (rank-sorted) instances.
    this.geo.instanceCount = Math.max(1, Math.ceil(n * Math.min(1, amount * 1.05)));
    u.uIntensity.value = (amount * n) / this.o.count;
    u.uVel.value.set(windX * this.o.windFactor, this.baseFall * fallScale, windZ * this.o.windFactor);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// Weather system
// ---------------------------------------------------------------------------

export class WeatherSystem implements WorldUpdatable {
  readonly group = new THREE.Group();
  private readonly time = { value: 0 };
  private readonly layers: Record<'rain' | 'snow' | 'ash' | 'ember' | 'sand' | 'leaves' | 'drift', PrecipLayer>;
  private readonly cur: WeatherParams = params({});
  private regionId: string | null = null;
  current: WeatherType = 'clear';
  private forced: WeatherType | null = null;
  private timer = 0;
  private density = 1;
  private particlesOn = true;
  private windAngle = 0.6;
  private wetness = 0;
  private pendingSnap = true;
  /** Extra fog from local effects (e.g. walking inside the Air Temple cloud deck), 0..1. */
  fogBoost = 0;
  /** 0..1 viewer up on the Air Temple massif above the cloud sea: the deck hides the
   * far ground, so the haze recedes (longer views of the spires and the sea). */
  fogClear = 0;
  private readonly tmpTint = new THREE.Color();
  private readonly regionTint = new THREE.Color();

  constructor(private readonly ctx: GameContext) {
    this.group.name = 'weather';
    const t = this.time;
    this.layers = {
      rain: new PrecipLayer({ name: 'rain', count: 8000, box: [34, 22, 34], fall: -17, windFactor: 0.6, size: [0.02, 0.9], shape: 0, color: '#c4d0dc', opacity: 0.5, sway: 0 }, t),
      snow: new PrecipLayer({ name: 'snow', count: 8000, box: [38, 22, 38], fall: -1.6, windFactor: 1.0, size: [0.1, 0.1], shape: 1, color: '#ffffff', opacity: 0.95, sway: 0.5 }, t),
      ash: new PrecipLayer({ name: 'ash', count: 4000, box: [36, 20, 36], fall: -0.9, windFactor: 0.8, size: [0.065, 0.065], shape: 2, color: '#8a817b', opacity: 0.85, sway: 0.7 }, t),
      ember: new PrecipLayer({ name: 'ember', count: 500, box: [36, 20, 36], fall: 0.35, windFactor: 0.6, size: [0.06, 0.06], shape: 3, color: '#ff7a2a', opacity: 0.9, additive: true, sway: 0.9 }, t),
      sand: new PrecipLayer({ name: 'sand', count: 6000, box: [40, 12, 40], fall: -0.4, windFactor: 1.6, size: [0.06, 1.6], shape: 4, color: '#dcb57c', opacity: 0.55, sway: 0.2 }, t),
      leaves: new PrecipLayer({ name: 'leaves', count: 450, box: [40, 16, 40], fall: -0.8, windFactor: 1.1, size: [0.12, 0.12], shape: 5, color: '#ffffff', opacity: 1, sway: 1.1 }, t),
      drift: new PrecipLayer({ name: 'drift', count: 5000, box: [34, 10, 34], fall: -2.5, windFactor: 2.2, size: [0.05, 1.1], shape: 4, color: '#ffffff', opacity: 0.55, sway: 0.3 }, t),
    };
    for (const l of Object.values(this.layers)) this.group.add(l.mesh);
    ctx.scene.add(this.group);
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
    this.copyParams(this.cur, PRESETS.clear);
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    this.density = Math.max(0, Math.min(1.5, g.particleDensity)) / 1.0;
    this.particlesOn = g.ambientEffects;
  }

  private copyParams(dst: WeatherParams, src: WeatherParams): void {
    dst.cloudCover = src.cloudCover;
    dst.overcast = src.overcast;
    dst.fogScale = src.fogScale;
    dst.tint.copy(src.tint);
    dst.cloudTint.copy(src.cloudTint);
    dst.wind = src.wind;
    dst.gust = src.gust;
    dst.wet = src.wet;
    dst.rain = src.rain;
    dst.snow = src.snow;
    dst.ash = src.ash;
    dst.sand = src.sand;
    dst.leaves = src.leaves;
  }

  /** Allowed weather for a region (or a sensible default outside regions). */
  private listFor(r: RegionDef | null): WeatherType[] {
    if (r && r.weather?.length) return r.weather as WeatherType[];
    return ['clear', 'cloudy'];
  }

  /** Force a weather type (debug / scripted events); null resumes the regional cycle. */
  force(type: WeatherType | null, snap = false): void {
    this.forced = type;
    if (type) this.setWeather(type, snap);
    else this.timer = 0;
  }

  get forcedWeather(): WeatherType | null {
    return this.forced;
  }

  private setWeather(type: WeatherType, snap = false): void {
    const changed = type !== this.current;
    this.current = type;
    if (snap) this.snap();
    if (changed) this.ctx.events.emit('weather:changed', { regionId: this.regionId ?? 'wilds', weather: type });
  }

  /** Jump all blended parameters to the current target (loading screens). */
  snap(): void {
    this.copyParams(this.cur, PRESETS[this.current]);
    this.wetness = this.cur.wet;
    this.pushSky(true);
  }

  private pushSky(snap: boolean): void {
    const sky = this.ctx.world.sky;
    const rt = this.regionId ? REGION_TINT[this.regionId] : undefined;
    this.tmpTint.copy(this.cur.tint);
    if (rt) this.tmpTint.multiply(this.regionTint.set(rt));
    const fogScale = this.cur.fogScale * (1 + this.fogBoost * 7) * (1 - 0.4 * this.fogClear);
    sky.setMood({ cloudCover: this.cur.cloudCover, overcast: this.cur.overcast, fogScale, tint: this.tmpTint, cloudTint: this.cur.cloudTint });
    if (snap) sky.snapMood();
  }

  update(dt: number, ctx: GameContext, focus: THREE.Vector3): void {
    this.time.value += dt;
    const region = ctx.session.active ? ctx.world.currentRegion ?? ctx.world.regionAt(focus.x, focus.z) : null;
    const rid = region?.id ?? null;
    if (rid !== this.regionId) {
      this.regionId = rid;
      if (!this.forced) {
        const list = this.listFor(region);
        if (!list.includes(this.current)) this.setWeather(pickWeather(list, Math.random()));
        this.timer = 150 + Math.random() * 150;
      }
    }
    if (!this.forced && ctx.session.active) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 150 + Math.random() * 210;
        this.setWeather(pickWeather(this.listFor(region), Math.random(), this.current));
      }
    }
    if (!ctx.session.active && !this.forced && this.current !== 'clear') this.setWeather('clear');
    if (this.pendingSnap) {
      this.pendingSnap = false;
      this.snap();
    }

    // Blend towards the target (~8 s time constant; precipitation a little faster).
    const tgt = PRESETS[this.current];
    const k = 1 - Math.exp(-dt / 8);
    const kp = 1 - Math.exp(-dt / 5);
    const c = this.cur;
    c.cloudCover += (tgt.cloudCover - c.cloudCover) * k;
    c.overcast += (tgt.overcast - c.overcast) * k;
    c.fogScale += (tgt.fogScale - c.fogScale) * k;
    c.tint.lerp(tgt.tint, k);
    c.cloudTint.lerp(tgt.cloudTint, k);
    c.wind += (tgt.wind - c.wind) * k;
    c.gust += (tgt.gust - c.gust) * k;
    for (const key of ['rain', 'snow', 'ash', 'sand', 'leaves'] as const) c[key] += (tgt[key] - c[key]) * kp;
    // Surfaces wet quickly in rain and dry slowly afterwards.
    const wetTarget = Math.max(tgt.wet, c.rain);
    this.wetness += (wetTarget - this.wetness) * (1 - Math.exp(-dt / (wetTarget > this.wetness ? 6 : 40)));
    envUniforms.uRainWet.value = this.wetness;
    ctx.water.raining = c.rain > 0.3;

    // Wind: slowly veering direction, strength from the weather.
    this.windAngle += dt * 0.01 * Math.sin(this.time.value * 0.05);
    const wx = Math.cos(this.windAngle), wz = Math.sin(this.windAngle);
    const w = envUniforms.uWind.value;
    w.set(wx, wz, c.wind, c.gust);
    const windSpeed = 2 + c.wind * 9;
    ctx.world.sky.drift(wx * windSpeed * dt * 0.0006, wz * windSpeed * dt * 0.0006);
    this.pushSky(false);

    // Precipitation particles.
    const camP = ctx.camera as THREE.PerspectiveCamera;
    PRECIP_PIXEL.value = (2 * Math.tan(((camP.fov ?? 60) * Math.PI) / 360)) / Math.max(200, ctx.render.renderer.domElement.height || 540);
    const on = this.density > 0;
    const decor = on && this.particlesOn;
    const d = this.particlesOn ? this.density : Math.max(0.25, this.density * 0.6);
    const L = this.layers;
    const cam = ctx.camera.position;
    // Above the cloud deck / very high peaks: no precipitation falls on you.
    const high = cam.y > 300 ? 0 : 1;
    L.rain.update(on ? c.rain * high : 0, d, wx * windSpeed, wz * windSpeed);
    const blizzard = Math.max(0, (c.wind - 0.5) / 0.85);
    L.snow.update(on ? c.snow * high : 0, d, wx * windSpeed, wz * windSpeed, 1 + blizzard * 1.5);
    L.drift.update(on ? c.snow * Math.min(1, blizzard) * high : 0, d, wx * windSpeed, wz * windSpeed);
    L.ash.update(on ? c.ash : 0, d, wx * windSpeed, wz * windSpeed);
    L.ember.update(decor ? c.ash * 0.8 : 0, d, wx * windSpeed, wz * windSpeed);
    L.sand.update(on ? c.sand : 0, d, wx * windSpeed, wz * windSpeed);
    L.leaves.update(decor ? c.leaves * 0.9 : 0, d, wx * windSpeed, wz * windSpeed);
  }

  /** New session / long travel: re-pick the regional weather and apply it instantly. */
  resetForSession(): void {
    this.regionId = '\u0000';
    this.pendingSnap = true;
  }

  /** Snapshot for tests / debug. */
  state(): { weather: WeatherType; forced: WeatherType | null; region: string | null; wet: number; raining: boolean; fogScale: number; wind: number; particles: Record<string, number> } {
    const p: Record<string, number> = {};
    for (const [k, l] of Object.entries(this.layers)) p[k] = +l.amount.toFixed(2);
    return { weather: this.current, forced: this.forced, region: this.regionId, wet: +this.wetness.toFixed(2), raining: this.ctx.water.raining, fogScale: +this.cur.fogScale.toFixed(2), wind: +this.cur.wind.toFixed(2), particles: p };
  }

  dispose(): void {
    for (const l of Object.values(this.layers)) l.dispose();
    this.group.removeFromParent();
  }
}
