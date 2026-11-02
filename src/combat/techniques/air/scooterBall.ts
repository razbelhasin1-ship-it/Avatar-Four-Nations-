import * as THREE from 'three';
import type { GameContext } from '../../../core/GameContext';
import { effect } from '../../../vfx/effects/loop';
import { FX_TIME } from '../../../vfx/effects/materials';
import { getNoiseTexture } from '../../../vfx/effects/noise';
import { shared, shellSphere } from '../../../vfx/effects/shapes';

/**
 * The air scooter's ball, after the series: a ball of compressed air, pale mint and nearly
 * solid, wrapped in white wind strokes that swirl round it. It rolls under the rider with the
 * ground speed and whirls about the vertical. update() each frame with its centre, radius and
 * velocity; dispose() bursts it.
 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWN;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = -mv.xyz;
  vWN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * mv;
}`;

// shellSphere() uv: x = latitude (0 bottom .. 1 top), y = longitude (0..1). The strokes sample
// the noise at whole multiples of the longitude, so they close round the ball without a seam;
// they turn with the mesh (the ball rolls), while the shading follows the world (sky above).
const FRAG = /* glsl */ `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uOpacity;
uniform vec3 uBody;
uniform vec3 uShade;
uniform vec3 uStroke;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying vec3 vWN;
void main() {
  float lon = vUv.y;
  float lat = vUv.x * 2.0 - 1.0;
  // Wind strokes wrapping round the ball, bending as they go and curling where they pinch.
  vec2 w = texture2D(uNoise, vec2(lon * 2.0 + uTime * 0.05, lat * 0.7 + 0.31)).rg - 0.5;
  vec2 q = vec2(lon * 3.0 + w.x * 0.3, lat * 1.35 + w.y * 0.35 + 0.17 * sin(lon * 12.5663706 + lat * 3.0));
  float s = texture2D(uNoise, q).r;
  float s2 = texture2D(uNoise, q * vec2(2.0, 1.7) + 0.43).g;
  // (thresholds near the noise's upper quartiles: strokes cover about a quarter of the ball)
  float stroke = clamp(smoothstep(0.71, 0.76, s) + 0.7 * smoothstep(0.78, 0.83, s2), 0.0, 1.0);
  // Toon-lit from the sky: pale mint above, a deeper teal underneath.
  float light = dot(normalize(vWN), vec3(0.28, 0.93, 0.24));
  float tone = smoothstep(-0.3, 0.2, light);
  vec3 col = mix(uShade, uBody, tone);
  col = mix(col, uStroke, stroke * mix(0.75, 1.0, tone));
  float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  col = mix(col, uStroke, pow(rim, 2.5) * 0.3);
  float a = clamp(0.55 + 0.35 * pow(rim, 1.4) + 0.25 * stroke, 0.0, 0.95) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const UP = new THREE.Vector3(0, 1, 0);
const axis = new THREE.Vector3();
const rot = new THREE.Quaternion();

export class ScooterBall {
  readonly group = new THREE.Group();
  private readonly ball: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private fadeIn = 0;
  private disposed = false;

  constructor(ctx: GameContext) {
    const low = ctx.vfx.quality === 'low';
    this.mat = new THREE.ShaderMaterial({
      name: 'air_scooter_ball',
      uniforms: {
        uNoise: { value: getNoiseTexture() },
        uTime: FX_TIME,
        uOpacity: { value: 0 },
        uBody: { value: new THREE.Color('#8fd0bd') },
        uShade: { value: new THREE.Color('#5f9f90') },
        uStroke: { value: new THREE.Color('#eafcf5') },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.ball = new THREE.Mesh(shared(`fx_scooter_ball_${low ? 'l' : 'h'}`, () => shellSphere(1, low ? 24 : 40, low ? 16 : 26)), this.mat);
    this.group.add(this.ball);
    ctx.vfx.group.add(this.group);
  }

  update(dt: number, center: THREE.Vector3, radius: number, vel: THREE.Vector3): void {
    if (this.disposed) return;
    this.fadeIn = Math.min(1, this.fadeIn + dt * 6);
    const k = this.fadeIn;
    this.group.position.copy(center);
    const r = radius * (0.6 + 0.4 * k);
    this.ball.scale.setScalar(r);
    // Rolls with the ground speed (capped so the strokes never strobe) and whirls about the vertical.
    const speed = Math.hypot(vel.x, vel.z);
    if (speed > 0.05) {
      axis.set(vel.z, 0, -vel.x).normalize();
      this.ball.quaternion.premultiply(rot.setFromAxisAngle(axis, Math.min(12, speed / Math.max(0.1, radius)) * dt));
    }
    this.ball.quaternion.premultiply(rot.setFromAxisAngle(UP, dt * 4.5));
    this.mat.uniforms.uOpacity.value = k;
  }

  /** Burst: the ball swells and fades (~fade s), then frees its materials. */
  dispose(fade = 0.2): void {
    if (this.disposed) return;
    this.disposed = true;
    let t = 0;
    const s0 = this.group.scale.x;
    effect(
      (dt) => {
        t += dt;
        const k = Math.max(0, 1 - t / fade);
        this.mat.uniforms.uOpacity.value = k;
        this.group.scale.setScalar(s0 * (1 + t * 2.5));
        return t < fade;
      },
      () => {
        this.group.removeFromParent();
        this.mat.dispose();
      },
    );
  }
}

