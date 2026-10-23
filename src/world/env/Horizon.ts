import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { biomeWeights, heightAt, type BiomeWeights } from '../Heightfield';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_NOISE_GLSL, ENV_PARS_GLSL } from './EnvShared';

/**
 * Distant mountain silhouettes beyond the terrain draw distance.
 *
 * For each of N azimuths the real heightfield is marched outward from just
 * inside the draw distance to ~3 km and the highest elevation angle is kept;
 * a ring at 1.9 km reproduces that skyline, shaded with atmospheric
 * perspective (hazy blue, fading into the fog colour, snow-capped where the
 * real peaks are high). It is recomputed (time-sliced) when the camera moves
 * far, so far ranges like the Air Temple massif or the volcano stay on the
 * horizon even on the Low preset's short draw distance.
 */

const N = 320;
const RING_R = 1880;

const VERT = /* glsl */ `
attribute float aTop;
attribute float aPeak;
attribute float aDist;
attribute float aAz;
attribute float aSnow;
varying float vSnow;
varying float vTop;
varying float vPeak;
varying float vDist;
varying float vAz;
varying float vY;
varying vec3 vDir;
void main() {
  vTop = aTop;
  vPeak = aPeak;
  vDist = aDist;
  vAz = aAz;
  vSnow = aSnow;
  vY = position.y;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = normalize( wp.xyz - cameraPosition );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${ENV_PARS_GLSL}
${ENV_NOISE_GLSL}
uniform vec3 uFog;
uniform float uHaze;
varying float vTop;
varying float vPeak;
varying float vDist;
varying float vAz;
varying float vY;
varying vec3 vDir;
varying float vSnow;
#include <common>
void main() {
  // 0 at the ridge line, 1 at the (fogged) base of the band.
  float k = 1.0 - vTop;
  // Atmospheric perspective: nearer ranges are darker and bluer, far ones pale into the sky.
  float far = smoothstep( 450.0, 3000.0, vDist );
  vec3 nearCol = mix( uFog, uSkyZenith, 0.45 ) * vec3( 0.66, 0.72, 0.8 );
  vec3 col = mix( nearCol, mix( uFog, uSkyHorizon, 0.5 ), 0.25 + 0.55 * far );
  // Painterly gullies and ridges: vertical streaks along the range.
  float streak = envFbm( vec2( vAz * 95.0, vY * 0.0065 ) );
  float ridge = envNoise( vec2( vAz * 24.0, vY * 0.002 + 3.1 ) );
  col *= 0.86 + 0.2 * streak + 0.08 * ridge;
  // Sun-facing slopes catch warm light, the others stay cool.
  vec2 hz = normalize( vDir.xz + 1e-5 );
  float sunSide = dot( hz, normalize( uSunDir.xz + 1e-4 ) );
  col += uSunColor * 0.09 * smoothstep( -0.3, 0.9, sunSide ) * ( 0.5 + 0.5 * streak ) * uDaylight * ( 1.0 - far * 0.6 );
  // Snow caps on genuinely high ranges, ragged along the gullies.
  float snow = max( smoothstep( 210.0, 300.0, vPeak ) * smoothstep( 0.42, 0.12, k + ( streak - 0.5 ) * 0.3 ),
    vSnow * smoothstep( 0.95, 0.35, k + ( streak - 0.5 ) * 0.2 ) );
  vec3 snowCol = mix( uFog, uSkyHorizon * 0.6 + uSunColor * 0.45, 0.75 );
  col = mix( col, snowCol, snow * 0.8 );
  // Haze thickens toward the base (valley mist) and with distance.
  col = mix( col, uFog, clamp( smoothstep( 0.05, 0.95, k ) * 0.9 + far * 0.25, 0.0, 1.0 ) );
  col = mix( col, uFog, uHaze );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class HorizonSystem implements WorldUpdatable {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly heights = new Float32Array(N);
  private readonly peaks = new Float32Array(N);
  private readonly dists = new Float32Array(N);
  private readonly snows = new Float32Array(N);
  private readonly biome: BiomeWeights = { cold: 0, desert: 0, volcanic: 0, swamp: 0, tropical: 0, boreal: 0, dry: 0 };
  private job: Generator<void, void, void> | null = null;
  private readonly center = new THREE.Vector3(Infinity, 0, 0);
  private readonly pending = new THREE.Vector3();
  private ready = false;
  enabled = true;

  constructor(private readonly ctx: GameContext) {
    // N + 1 columns: the last one duplicates the first with azimuth 2π so the
    // shader's azimuth-driven streaks never interpolate across the seam.
    const C = N + 1;
    const pos = new Float32Array(C * 2 * 3);
    const top = new Float32Array(C * 2);
    const peak = new Float32Array(C * 2);
    const dist = new Float32Array(C * 2);
    const az = new Float32Array(C * 2);
    const snow = new Float32Array(C * 2);
    const idx: number[] = [];
    for (let i = 0; i < C; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * RING_R, z = Math.sin(a) * RING_R;
      pos.set([x, -300, z], i * 6);
      pos.set([x, -300, z], i * 6 + 3);
      top[i * 2] = 0;
      top[i * 2 + 1] = 1;
      az[i * 2] = az[i * 2 + 1] = a;
      if (i < N) idx.push(i * 2, (i + 1) * 2, i * 2 + 1, i * 2 + 1, (i + 1) * 2, (i + 1) * 2 + 1);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    this.geo.setAttribute('aPeak', new THREE.BufferAttribute(peak, 1));
    this.geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    this.geo.setAttribute('aAz', new THREE.BufferAttribute(az, 1));
    this.geo.setAttribute('aSnow', new THREE.BufferAttribute(snow, 1));
    this.geo.setIndex(idx);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: new THREE.Color() }, uHaze: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    attachEnvUniforms(this.material);
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -9;
    this.mesh.visible = false;
    this.mesh.name = 'horizon_silhouettes';
    ctx.scene.add(this.mesh);
  }

  private *compute(cx: number, eyeY: number, cz: number, startD: number): Generator<void, void, void> {
    let t0 = performance.now();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let best = -0.2;
      let peak = 0;
      let peakD = 3200;
      let px = cx, pz = cz;
      let d = startD;
      while (d < 3200) {
        const x = cx + dx * d, z = cz + dz * d;
        const h = Math.abs(x) > 2600 || Math.abs(z) > 2600 ? -30 : heightAt(x, z);
        const e = (h - eyeY) / d;
        if (e > best) {
          best = e;
          peak = h;
          peakD = d;
          px = x;
          pz = z;
        }
        d += 16 + d * 0.025;
      }
      this.heights[i] = best;
      this.peaks[i] = peak;
      this.dists[i] = peakD;
      // Snowy ranges (polar and tundra peaks) stay white on the horizon.
      this.snows[i] = best > -0.19 ? Math.min(1, biomeWeights(px, pz, this.biome).cold * 1.3) : 0;
      if (performance.now() - t0 > 2.5) {
        yield;
        t0 = performance.now();
      }
    }
  }

  private apply(c: THREE.Vector3): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const peak = this.geo.getAttribute('aPeak') as THREE.BufferAttribute;
    const dist = this.geo.getAttribute('aDist') as THREE.BufferAttribute;
    const snow = this.geo.getAttribute('aSnow') as THREE.BufferAttribute;
    for (let c = 0; c <= N; c++) {
      const i = c % N;
      // Ring vertex height that subtends the same elevation angle; flat sea sinks below the horizon.
      // Mountains get a little ragged jitter so the ridge line never reads as straight segments.
      const e = this.heights[i];
      const jag = e > 0.01 ? (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.0022 * RING_R : 0;
      const y = Math.max(-260, e * RING_R + jag);
      pos.setY(c * 2, Math.min(y - 120, -140));
      pos.setY(c * 2 + 1, y);
      peak.setX(c * 2, this.peaks[i]);
      peak.setX(c * 2 + 1, this.peaks[i]);
      dist.setX(c * 2, this.dists[i]);
      dist.setX(c * 2 + 1, this.dists[i]);
      snow.setX(c * 2, this.snows[i]);
      snow.setX(c * 2 + 1, this.snows[i]);
    }
    pos.needsUpdate = true;
    peak.needsUpdate = true;
    dist.needsUpdate = true;
    snow.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.mesh.position.copy(c);
    this.mesh.updateMatrixWorld();
    this.center.copy(c);
    this.ready = true;
  }

  update(_dt: number, ctx: GameContext): void {
    if (!this.enabled) {
      this.mesh.visible = false;
      return;
    }
    const cam = ctx.camera.position;
    const moved = Math.hypot(cam.x - this.center.x, cam.z - this.center.z);
    // After a long jump (travel, teleport) the old ring would hang at the wrong
    // place: hide it until the new skyline is ready.
    if (moved > 700 || !Number.isFinite(moved)) this.ready = false;
    if (!this.job && (moved > 140 || Math.abs(cam.y - this.center.y) > 40 || !Number.isFinite(moved))) {
      this.pending.copy(cam);
      const dd = ctx.settings.data.graphics.drawDistance;
      this.job = this.compute(cam.x, cam.y, cam.z, Math.max(260, dd * 0.8));
    }
    if (this.job) {
      const r = this.job.next();
      if (r.done) {
        this.job = null;
        this.apply(this.pending);
      }
    }
    this.mesh.visible = this.ready;
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) this.material.uniforms.uFog.value.copy(fog.color);
    // Thick weather (fog, storms) hides the far ranges entirely.
    this.material.uniforms.uHaze.value = Math.min(1, Math.max(0, (ctx.world.sky.mood.fogScale - 1.1) / 2.2));
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.material.dispose();
  }
}
