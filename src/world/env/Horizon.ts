import * as THREE from 'three';
import type { GameContext } from '../../core/GameContext';
import { heightAt } from '../Heightfield';
import type { WorldUpdatable } from '../World';
import { attachEnvUniforms, ENV_PARS_GLSL } from './EnvShared';

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

const N = 160;
const RING_R = 1880;

const VERT = /* glsl */ `
attribute float aTop;
attribute float aPeak;
varying float vTop;
varying float vPeak;
varying vec3 vDir;
void main() {
  vTop = aTop;
  vPeak = aPeak;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = normalize( wp.xyz - cameraPosition );
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
${ENV_PARS_GLSL}
uniform vec3 uFog;
uniform float uHaze;
varying float vTop;
varying float vPeak;
varying vec3 vDir;
#include <common>
void main() {
  // Atmospheric perspective: distant ranges are hazy blue-grey, lighter toward the base.
  vec3 far = mix( uSkyZenith, uSkyHorizon, 0.55 ) * 0.82 + vec3( 0.02, 0.03, 0.05 );
  vec3 col = mix( uFog, far, 0.55 * vTop );
  // Snow caps on genuinely high ranges, lit by the sun.
  float snow = smoothstep( 230.0, 320.0, vPeak ) * smoothstep( 0.55, 0.95, vTop );
  col = mix( col, mix( uFog, uSunColor * 0.55 + uSkyHorizon * 0.5, 0.7 ), snow * 0.7 );
  // Sun-facing side glows slightly.
  float s = max( dot( vDir, uSunDir ), 0.0 );
  col += uSunColor * pow( s, 8.0 ) * 0.08;
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
  private job: Generator<void, void, void> | null = null;
  private readonly center = new THREE.Vector3(Infinity, 0, 0);
  private readonly pending = new THREE.Vector3();
  private ready = false;
  enabled = true;

  constructor(private readonly ctx: GameContext) {
    const pos = new Float32Array(N * 2 * 3);
    const top = new Float32Array(N * 2);
    const peak = new Float32Array(N * 2);
    const idx: number[] = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const x = Math.cos(a) * RING_R, z = Math.sin(a) * RING_R;
      pos.set([x, -300, z], i * 6);
      pos.set([x, -300, z], i * 6 + 3);
      top[i * 2] = 0;
      top[i * 2 + 1] = 1;
      const j = (i + 1) % N;
      idx.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
    this.geo.setAttribute('aPeak', new THREE.BufferAttribute(peak, 1));
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
      let d = startD;
      while (d < 3200) {
        const x = cx + dx * d, z = cz + dz * d;
        const h = Math.abs(x) > 2600 || Math.abs(z) > 2600 ? -30 : heightAt(x, z);
        const e = (h - eyeY) / d;
        if (e > best) {
          best = e;
          peak = h;
        }
        d += 18 + d * 0.03;
      }
      this.heights[i] = best;
      this.peaks[i] = peak;
      if (performance.now() - t0 > 2.5) {
        yield;
        t0 = performance.now();
      }
    }
  }

  private apply(c: THREE.Vector3): void {
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const peak = this.geo.getAttribute('aPeak') as THREE.BufferAttribute;
    for (let i = 0; i < N; i++) {
      // Ring vertex height that subtends the same elevation angle; flat sea sinks below the horizon.
      const y = Math.max(-260, this.heights[i] * RING_R);
      pos.setY(i * 2, Math.min(y - 120, -140));
      pos.setY(i * 2 + 1, y);
      peak.setX(i * 2, this.peaks[i]);
      peak.setX(i * 2 + 1, this.peaks[i]);
    }
    pos.needsUpdate = true;
    peak.needsUpdate = true;
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
