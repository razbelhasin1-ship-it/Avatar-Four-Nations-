import * as THREE from 'three';
import type { SurfaceType } from '../../core/types';
import { ENV_NOISE_GLSL, ENV_PARS_GLSL, attachEnvUniforms } from './EnvShared';

/**
 * Pooled, instanced ground decals that conform to the terrain.
 *
 * Every decal is a small grid mesh; its vertex heights are sampled on the CPU
 * when the decal is spawned (terrain LOD0 heights or the flat top of the
 * collider underneath) and stored in one row of a float texture, which the
 * vertex shader reads with texelFetch. So decals hug the ground exactly with no
 * z-fighting, without per-decal geometry.
 *
 * Shading is procedural per decal kind. Prints and burns use "modulate 2x"
 * blending (out = 2 · src · dst): 0.5 is neutral, darker values darken and
 * brighter values lighten the lit ground, which gives footprints a convincing
 * depth illusion (shadowed walls toward the sun, lit far walls, raised rims)
 * under any lighting. Frost uses ordinary alpha blending with its own lighting.
 *
 * Decals fade over their life (footprints ~75 s) and pools recycle the oldest.
 */

export const DECAL_KIND = {
  walk: 0,
  run: 1,
  land: 2,
  slide: 3,
  scorch: 4,
  wet: 5,
  crack: 6,
  frost: 7,
} as const;
export type DecalKind = keyof typeof DECAL_KIND;

/** Surface colour families for prints. */
export const DECAL_SURFACE: Partial<Record<SurfaceType, number>> = { snow: 0, packedsnow: 0, ice: 0, sand: 1, mud: 2, ash: 3, dirt: 4, grass: 4, gravel: 4 };

export interface DecalSpawn {
  x: number;
  z: number;
  /** Size across (m). */
  sizeX: number;
  /** Size along the forward axis (m). */
  sizeZ: number;
  yaw: number;
  kind: number;
  life: number;
  /** Mirror (left foot = 1, right = -1), surface family, intensity. */
  mirror: number;
  surface: number;
  intensity: number;
}

const DECAL_PARS = /* glsl */ `
precision highp sampler2D;
uniform sampler2D uDecalH;
uniform float uDecalTime;
uniform float uGridN;
attribute float aVid;
attribute vec4 aDecalA; // x, z, sizeX, sizeZ
attribute vec4 aDecalB; // yaw, kind, birth, life
attribute vec4 aDecalC; // mirror, surface, intensity, seed
varying vec2 vUv;
varying float vKind;
varying float vAge;
varying float vLife;
varying vec4 vC;
varying vec2 vSunL;
varying float vSunH;
`;

const DECAL_VERTEX = /* glsl */ `
${ENV_PARS_GLSL}
${DECAL_PARS}
#include <common>
#include <fog_pars_vertex>
void main() {
  vUv = position.xz; // -0.5 .. 0.5
  vKind = aDecalB.y;
  vAge = uDecalTime - aDecalB.z;
  vLife = aDecalB.w;
  vC = aDecalC;
  float cy = cos( aDecalB.x ), sy = sin( aDecalB.x );
  // Local axes: +X across (mirrored for left/right), +Z forward along yaw.
  vec2 lp = vec2( position.x * aDecalA.z, position.z * aDecalA.w );
  vec2 wp = aDecalA.xy + vec2( lp.x * cy + lp.y * sy, -lp.x * sy + lp.y * cy );
  int row = gl_InstanceID;
  float h = texelFetch( uDecalH, ivec2( int( aVid + 0.5 ), row ), 0 ).r;
  // Sun direction in decal-local space (for the depth illusion).
  vec2 s = uSunDir.xz;
  vSunL = vec2( s.x * cy - s.y * sy, s.x * sy + s.y * cy );
  vSunL.x *= aDecalC.x;
  vSunH = uSunDir.y;
  bool dead = vAge > vLife || vAge < 0.0;
  vec3 world = vec3( wp.x, h, wp.y );
  vec4 mvPosition = viewMatrix * vec4( world, 1.0 );
  gl_Position = dead ? vec4( 0.0, 0.0, -2.0, 1.0 ) : projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const DECAL_COMMON_FRAG = /* glsl */ `
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
uniform float uDecalTime;
varying vec2 vUv;
varying float vKind;
varying float vAge;
varying float vLife;
varying vec4 vC;
varying vec2 vSunL;
varying float vSunH;
#include <common>
#include <fog_pars_fragment>
float sdEllipse( vec2 p, vec2 c, vec2 r ) { vec2 q = ( p - c ) / r; return ( length( q ) - 1.0 ) * min( r.x, r.y ); }
float smin( float a, float b, float k ) { float h = clamp( 0.5 + 0.5 * ( b - a ) / k, 0.0, 1.0 ); return mix( b, a, h ) - k * h * ( 1.0 - h ); }
// Signed distance of a boot print in local uv (x across, y forward).
float sdBoot( vec2 p, float run ) {
  p.x -= 0.02;
  float toe = sdEllipse( p, vec2( 0.01, 0.13 + run * 0.04 ), vec2( 0.19 + run * 0.02, 0.27 + run * 0.05 ) );
  float heel = sdEllipse( p, vec2( -0.01, -0.27 ), vec2( 0.15, 0.15 ) );
  float arch = sdEllipse( p, vec2( 0.03, -0.07 ), vec2( 0.11, 0.17 ) );
  return smin( smin( toe, heel, 0.05 ), arch, 0.05 );
}
// Height field of a decal shape: negative = depression, positive = raised rim.
float printHeight( vec2 p, float kind, float seed ) {
  if ( kind < 0.5 ) {
    float d = sdBoot( p, 0.0 );
    float tread = 0.5 + 0.5 * sin( p.y * 70.0 );
    return -smoothstep( 0.015, -0.05, d ) * ( 0.9 + 0.1 * tread ) + 0.35 * exp( -pow( ( d - 0.03 ) / 0.035, 2.0 ) );
  } else if ( kind < 1.5 ) {
    // Running: deeper toe, lighter heel, snow/sand kicked out behind the toe.
    float d = sdBoot( p, 1.0 );
    float toeW = smoothstep( -0.3, 0.25, p.y );
    float kick = 0.0;
    for ( int i = 0; i < 4; i++ ) {
      vec2 c = vec2( ( envHash( vec2( seed, float( i ) ) ) - 0.5 ) * 0.5, 0.52 + envHash( vec2( float( i ), seed ) ) * 0.25 );
      kick += 0.4 * exp( -dot( p - c, p - c ) / 0.004 );
    }
    return -smoothstep( 0.015, -0.05, d ) * mix( 0.45, 1.15, toeW ) + 0.4 * exp( -pow( ( d - 0.03 ) / 0.04, 2.0 ) ) + kick;
  } else if ( kind < 2.5 ) {
    // Heavy landing crater.
    float r = length( p ) * 2.0;
    float n = envNoise( p * 9.0 + seed ) * 0.12;
    float d = r + n - 0.72;
    return -smoothstep( 0.05, -0.5, d ) * 1.1 + 0.55 * exp( -pow( ( d - 0.07 ) / 0.1, 2.0 ) );
  } else {
    // Slide streak: a long gouge with ridges along both sides.
    float w = 0.36 - 0.12 * smoothstep( 0.2, 0.5, abs( p.y ) );
    float d = max( abs( p.x ) - w * 0.5, abs( p.y ) - 0.48 );
    float n = envNoise( vec2( p.x * 20.0, p.y * 6.0 ) + seed ) * 0.03;
    return -smoothstep( 0.02, -0.08, d + n ) * mix( 0.5, 1.0, smoothstep( -0.5, 0.2, p.y ) ) + 0.45 * exp( -pow( ( d - 0.03 ) / 0.04, 2.0 ) );
  }
}
`;

const DECAL_MOD_FRAGMENT = /* glsl */ `
${DECAL_COMMON_FRAG}
void main() {
  vec2 p = vUv;
  float kind = vKind;
  float fade = 1.0 - smoothstep( vLife * 0.5, vLife, vAge );
  float seed = vC.w;
  float v = 0.5;
  float surf = vC.y;
  vec3 shadowTint = surf < 0.5 ? vec3( 0.72, 0.82, 1.0 ) : surf < 1.5 ? vec3( 0.9, 0.82, 0.72 ) : surf < 2.5 ? vec3( 0.75, 0.7, 0.62 ) : vec3( 0.8, 0.8, 0.82 );
  vec3 col = vec3( 0.5 );
  if ( kind < 3.5 ) {
    vec2 q = vec2( p.x * vC.x, p.y );
    float e = 0.012;
    float h0 = printHeight( q, kind, seed );
    float hx = printHeight( q + vec2( e, 0.0 ), kind, seed );
    float hy = printHeight( q + vec2( 0.0, e ), kind, seed );
    vec2 grad = vec2( hx - h0, hy - h0 ) / e;
    // Light from the sun direction projected on the ground; walls facing it light up.
    float sunLen = max( length( vSunL ), 1e-3 );
    vec2 sl = vSunL / sunLen;
    float slope = dot( grad, sl ) * 0.035 * ( 1.0 - clamp( vSunH, 0.0, 1.0 ) * 0.5 );
    float depth = clamp( -h0, 0.0, 1.0 );
    // Deeper prints in soft snow read through cool ambient occlusion at the bottom.
    float shade = 0.5 - depth * 0.2 + slope * 1.3 + max( h0, 0.0 ) * 0.07;
    float wet = surf > 1.5 && surf < 2.5 ? depth * 0.12 : 0.0;
    shade -= wet;
    col = mix( vec3( shade ), vec3( shade ) * shadowTint * 1.08, smoothstep( 0.5, 0.3, shade ) );
    float mask = smoothstep( 0.0, 0.02, abs( h0 ) );
    col = mix( vec3( 0.5 ), col, mask * vC.z );
  } else if ( kind < 4.5 ) {
    // Scorch: charred core, burnt brown ring, ragged noisy edge, ash flecks.
    float r = length( p ) * 2.0;
    float n = envFbm( p * 5.0 + seed * 7.0 );
    float edge = r + ( n - 0.5 ) * 0.45;
    float charred = smoothstep( 0.88, 0.3, edge );
    float ring = smoothstep( 1.05, 0.75, edge ) * ( 1.0 - charred );
    col = mix( vec3( 0.5 ), vec3( 0.43, 0.39, 0.35 ), ring );
    // Singed, not ink-black: the ground still reads through.
    col = mix( col, vec3( 0.29, 0.26, 0.23 ), charred * ( 0.5 + 0.2 * n ) );
    float fleck = step( 0.82, envHash( floor( p * 60.0 ) + seed ) ) * charred;
    col = mix( col, vec3( 0.42, 0.4, 0.38 ), fleck * 0.6 );
    // Embers die quickly; the char lingers.
    col = mix( vec3( 0.5 ), col, vC.z );
  } else if ( kind < 5.5 ) {
    // Wet patch drying from the edges.
    float dry = clamp( vAge / max( vLife, 1.0 ), 0.0, 1.0 );
    float r = length( p ) * 2.0;
    float n = envFbm( p * 4.0 + seed * 3.0 );
    float m = smoothstep( 0.95 - dry * 0.6, 0.6 - dry * 0.6, r + ( n - 0.5 ) * 0.5 );
    col = mix( vec3( 0.5 ), vec3( 0.39, 0.4, 0.42 ), m * vC.z );
    fade = 1.0;
  } else {
    // Ground crack: jagged radial fissures and a shallow central depression.
    float r = length( p ) * 2.0;
    float a = atan( p.y, p.x );
    float crack = 0.0;
    for ( int i = 0; i < 7; i++ ) {
      float fi = float( i );
      float ang = fi * 0.8976 + ( envHash( vec2( seed, fi ) ) - 0.5 ) * 0.7;
      float jag = ( envNoise( vec2( r * 7.0, fi * 3.1 + seed ) ) - 0.5 ) * 0.35 * r;
      float da = abs( mod( a - ang - jag + 3.14159, 6.28318 ) - 3.14159 );
      float width = 0.011 * ( 1.0 - r ) + 0.003;
      float len = 0.55 + 0.45 * envHash( vec2( fi, seed + 1.7 ) );
      crack = max( crack, smoothstep( width * 2.0, width * 0.5, da * r ) * step( r, len ) );
    }
    float pit = smoothstep( 0.32, 0.05, r );
    float rim = exp( -pow( ( r - 0.34 ) / 0.07, 2.0 ) );
    col = vec3( 0.5 - pit * 0.07 + rim * 0.04 );
    col = mix( col, vec3( 0.3, 0.27, 0.24 ), crack );
    col = mix( vec3( 0.5 ), col, vC.z * smoothstep( 1.0, 0.85, r ) );
  }
  col = mix( vec3( 0.5 ), col, fade );
  // Fog pulls the decal back toward neutral.
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogF = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    #else
      float fogF = smoothstep( fogNear, fogFar, vFogDepth );
    #endif
    col = mix( col, vec3( 0.5 ), fogF );
  #endif
  if ( abs( col.r - 0.5 ) + abs( col.g - 0.5 ) + abs( col.b - 0.5 ) < 0.004 ) discard;
  gl_FragColor = vec4( col, 1.0 );
}
`;

const DECAL_FROST_FRAGMENT = /* glsl */ `
${DECAL_COMMON_FRAG}
void main() {
  vec2 p = vUv;
  float r = length( p ) * 2.0;
  float seed = vC.w;
  float melt = smoothstep( vLife * 0.45, vLife, vAge );
  float n = envFbm( p * 7.0 + seed * 5.0 );
  float feather = envFbm( p * 22.0 - seed );
  float m = smoothstep( 1.0 - melt * 0.8, 0.55 - melt * 0.8, r + ( n - 0.5 ) * 0.55 );
  float crystals = smoothstep( 0.45, 0.8, feather );
  float a = m * ( 0.55 + 0.4 * crystals ) * vC.z;
  if ( a < 0.01 ) discard;
  vec3 base = mix( vec3( 0.72, 0.84, 0.95 ), vec3( 0.95, 0.98, 1.0 ), crystals );
  float sun = max( uSunDir.y, 0.0 );
  vec3 light = uSunColor * ( 0.35 + 0.65 * sun ) * 0.85 + uSkyZenith * 0.35 + vec3( 0.04 );
  vec3 col = base * light * mix( 0.25, 1.0, uDaylight );
  float sparkle = step( 0.985, envHash( floor( p * 90.0 ) + floor( uDecalTime * 3.0 ) * 0.37 ) ) * crystals;
  col += uSunColor * sparkle * 1.5 * uDaylight;
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

function gridGeometry(n: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const vid: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos.push(i / (n - 1) - 0.5, 0, j / (n - 1) - 0.5);
      vid.push(j * n + i);
    }
  }
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aVid', new THREE.Float32BufferAttribute(vid, 1));
  g.setIndex(idx);
  return g;
}

/** Height provider: ground height under (x,z) near reference height y. */
export type DecalHeightFn = (x: number, z: number) => number;

export class DecalPool {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly a: THREE.InstancedBufferAttribute;
  private readonly b: THREE.InstancedBufferAttribute;
  private readonly c: THREE.InstancedBufferAttribute;
  private readonly heights: Float32Array;
  private readonly heightTex: THREE.DataTexture;
  private readonly material: THREE.ShaderMaterial;
  private next = 0;
  private used = 0;
  private readonly verts: number;
  /** Birth time per slot (CPU mirror, for counting live decals). */
  private readonly births: Float32Array;
  private readonly lives: Float32Array;

  constructor(readonly capacity: number, readonly gridN: number, blend: 'mod2x' | 'alpha', time: { value: number }, name: string) {
    this.verts = gridN * gridN;
    this.geo = gridGeometry(gridN) as THREE.InstancedBufferGeometry;
    this.a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.b = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.c = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    for (const at of [this.a, this.b, this.c]) at.setUsage(THREE.DynamicDrawUsage);
    // Dead until spawned: life 0, birth far in the past.
    for (let i = 0; i < capacity; i++) (this.b.array as Float32Array)[i * 4 + 2] = -1e6;
    this.geo.setAttribute('aDecalA', this.a);
    this.geo.setAttribute('aDecalB', this.b);
    this.geo.setAttribute('aDecalC', this.c);
    this.geo.instanceCount = 0;
    this.births = new Float32Array(capacity).fill(-1e6);
    this.lives = new Float32Array(capacity);
    this.heights = new Float32Array(this.verts * capacity);
    this.heightTex = new THREE.DataTexture(this.heights, this.verts, capacity, THREE.RedFormat, THREE.FloatType);
    this.heightTex.minFilter = THREE.NearestFilter;
    this.heightTex.magFilter = THREE.NearestFilter;
    this.heightTex.generateMipmaps = false;
    this.heightTex.needsUpdate = true;
    const uniforms: Record<string, THREE.IUniform> = {
      uDecalH: { value: this.heightTex },
      uDecalTime: time,
      uGridN: { value: gridN },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: DECAL_VERTEX,
      fragmentShader: blend === 'mod2x' ? DECAL_MOD_FRAGMENT : DECAL_FROST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    attachEnvUniforms(this.material);
    if (blend === 'mod2x') {
      this.material.blending = THREE.CustomBlending;
      this.material.blendEquation = THREE.AddEquation;
      this.material.blendSrc = THREE.DstColorFactor;
      this.material.blendDst = THREE.SrcColorFactor;
      this.material.blendSrcAlpha = THREE.ZeroFactor;
      this.material.blendDstAlpha = THREE.OneFactor;
    }
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = name;
  }

  /** Spawn a decal; heights are sampled on a gridN × gridN lattice over its footprint. */
  spawn(s: DecalSpawn, now: number, heightFn: DecalHeightFn, lift = 0.03): number {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    this.used = Math.max(this.used, i + 1);
    const A = this.a.array as Float32Array, B = this.b.array as Float32Array, C = this.c.array as Float32Array;
    A[i * 4] = s.x; A[i * 4 + 1] = s.z; A[i * 4 + 2] = s.sizeX; A[i * 4 + 3] = s.sizeZ;
    B[i * 4] = s.yaw; B[i * 4 + 1] = s.kind; B[i * 4 + 2] = now; B[i * 4 + 3] = s.life;
    C[i * 4] = s.mirror; C[i * 4 + 1] = s.surface; C[i * 4 + 2] = s.intensity; C[i * 4 + 3] = Math.random() * 100;
    this.births[i] = now;
    this.lives[i] = s.life;
    const n = this.gridN;
    const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
    const row = i * this.verts;
    for (let j = 0; j < n; j++) {
      for (let k = 0; k < n; k++) {
        const lx = (k / (n - 1) - 0.5) * s.sizeX, lz = (j / (n - 1) - 0.5) * s.sizeZ;
        const wx = s.x + lx * cy + lz * sy, wz = s.z - lx * sy + lz * cy;
        this.heights[row + j * n + k] = heightFn(wx, wz) + lift;
      }
    }
    for (const at of [this.a, this.b, this.c]) {
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.used * 4);
      at.needsUpdate = true;
    }
    this.heightTex.needsUpdate = true;
    this.geo.instanceCount = this.used;
    return i;
  }

  liveCount(now: number): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if (now - this.births[i] <= this.lives[i]) n++;
    return n;
  }

  clear(): void {
    const B = this.b.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) B[i * 4 + 2] = -1e6;
    this.births.fill(-1e6);
    this.b.clearUpdateRanges();
    this.b.needsUpdate = true;
    this.used = 0;
    this.next = 0;
    this.geo.instanceCount = 0;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.heightTex.dispose();
    this.material.dispose();
  }
}
