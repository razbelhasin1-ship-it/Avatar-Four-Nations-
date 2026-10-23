import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import type { WaterfallSite } from '../Water';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_PARS_GLSL } from './EnvShared';

/**
 * Spray and mist where rivers drop over a waterfall (sites come from the river
 * profiles, see WaterRenderer.waterfalls): fast droplets thrown up and
 * downstream from the plunge pool plus large, slow mist puffs that billow and
 * drift. One instanced billboard mesh for every fall, animated entirely in the
 * vertex shader; falls beyond ~320 m collapse to nothing. Particle count follows
 * settings.graphics.particleDensity.
 */

const PER_FALL = 72;
const RANGE = 320;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
${ENV_PARS_GLSL}
attribute vec4 aSeed;
attribute vec4 aFall;
attribute vec4 aDir;
uniform float uAmount;
varying vec2 vUv;
varying float vAlpha;
varying float vMist;
void main() {
  vUv = position.xy + 0.5;
  vec3 base = aFall.xyz;
  float dist = length( base - cameraPosition );
  float vis = step( aSeed.w, uAmount ) * ( 1.0 - smoothstep( ${(RANGE * 0.7).toFixed(1)}, ${RANGE.toFixed(1)}, dist ) );
  float mist = step( 0.78, aSeed.z );
  float rate = mix( 0.6, 0.13, mist );
  float life = fract( uEnvTime * rate + aSeed.x * 7.0 );
  vec2 dir = aDir.xy;
  vec2 perp = vec2( -dir.y, dir.x );
  float lateral = ( aSeed.y - 0.5 ) * aFall.w;
  float drop = clamp( aDir.z / 8.0, 0.5, 1.6 );
  float up = mix( 2.2 + 3.8 * aSeed.z, 1.1, mist ) * drop;
  float outw = mix( 1.0 + 2.6 * aSeed.x, 0.9, mist );
  float t = life * mix( 1.3, 4.2, mist );
  vec3 p = base + vec3( perp.x, 0.0, perp.y ) * lateral * ( 1.0 + life * 0.35 );
  p += vec3( dir.x, 0.0, dir.y ) * outw * t;
  p.y += up * t - mix( 3.4, 0.12, mist ) * t * t + 0.2;
  p.y = max( p.y, base.y - 0.1 );
  float size = mix( 1.3 + 2.8 * life, 4.5 + 8.0 * life, mist ) * mix( 0.8, 1.35, clamp( aFall.w / 12.0, 0.0, 1.0 ) );
  vAlpha = vis * sin( life * 3.14159 ) * mix( 0.75, 0.42, mist );
  vMist = mist;
  vec4 mvPosition = viewMatrix * vec4( p, 1.0 );
  mvPosition.xy += position.xy * size * step( 0.001, vis );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
${ENV_PARS_GLSL}
varying vec2 vUv;
varying float vAlpha;
varying float vMist;
void main() {
  vec2 d = vUv - 0.5;
  float r = length( d ) * 2.0;
  // Soft round puff (gaussian-like falloff).
  float a = exp( -r * r * 3.2 ) * smoothstep( 1.0, 0.7, r ) * vAlpha;
  if ( a < 0.01 ) discard;
  vec3 col = ( uSkyHorizon * 0.55 + uSunColor * 0.5 * uDaylight + vec3( 0.06 ) ) * mix( 1.0, 0.92, vMist );
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class WaterfallFXSystem implements WorldUpdatable {
  readonly mesh: THREE.Mesh | null = null;
  private readonly geo: THREE.InstancedBufferGeometry | null = null;
  private readonly material: THREE.ShaderMaterial | null = null;
  readonly sites: readonly WaterfallSite[];
  enabled = true;

  constructor(ctx: GameContext) {
    this.sites = ctx.world.water?.waterfalls ?? [];
    if (!this.sites.length) return;
    const n = this.sites.length * PER_FALL;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const seed = new Float32Array(n * 4);
    const fall = new Float32Array(n * 4);
    const dir = new Float32Array(n * 4);
    let k = 0;
    for (const s of this.sites) {
      const len = Math.hypot(s.dir.x, s.dir.y) || 1;
      for (let i = 0; i < PER_FALL; i++, k++) {
        seed.set([Math.random(), Math.random(), Math.random(), (i + Math.random()) / PER_FALL], k * 4);
        fall.set([s.base.x, s.base.y, s.base.z, Math.max(2, s.width * 0.9)], k * 4);
        dir.set([s.dir.x / len, s.dir.y / len, s.drop, 0], k * 4);
      }
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
    geo.setAttribute('aFall', new THREE.InstancedBufferAttribute(fall, 4));
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(dir, 4));
    geo.instanceCount = n;
    const material = new THREE.ShaderMaterial({
      uniforms: { uAmount: { value: 0.6 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    attachEnvUniforms(material);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.name = 'waterfall_spray';
    ctx.scene.add(mesh);
    this.mesh = mesh;
    this.geo = geo;
    this.material = material;
  }

  /** Waterfalls within `r` metres of a point (debug / tests). */
  near(x: number, z: number, r: number): WaterfallSite[] {
    return this.sites.filter((s) => Math.hypot(s.base.x - x, s.base.z - z) < r);
  }

  update(_dt: number, ctx: GameContext): void {
    if (!this.mesh || !this.material) return;
    const cam = ctx.camera.position;
    let any = false;
    for (const s of this.sites) {
      if (Math.abs(s.base.x - cam.x) < RANGE && Math.abs(s.base.z - cam.z) < RANGE) {
        any = true;
        break;
      }
    }
    this.mesh.visible = this.enabled && any;
    this.material.uniforms.uAmount.value = Math.max(0.5, ctx.settings.data.graphics.particleDensity);
  }

  dispose(): void {
    this.mesh?.removeFromParent();
    this.geo?.dispose();
    this.material?.dispose();
  }
}
