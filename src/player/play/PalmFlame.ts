import * as THREE from 'three';
import type { LoopHandle } from '../../audio/AudioEngine';
import type { GameContext } from '../../core/GameContext';
import type { Emitter } from '../../vfx/VFX';
import { addEffect } from '../../vfx/effects/loop';
import type { Player } from '../Player';
import type { PlayInteraction } from './common';

/**
 * Firebending play: outside combat, holding the attack makes a Firebender turn up the right
 * palm and kindle a small flame in it. Two shader layers (an orange body and a white-gold
 * core) flicker and change shape, a few embers rise, a soft glow (and, with dynamic lights,
 * a small point light) warms the hand. The flame sits on the right-hand anchor (child of the
 * handR bone) every frame, so it rides every arm movement; it stays upright like real fire.
 * Letting go makes it shrink and die with a wisp of smoke. It never harms or ignites anything.
 */

/** Flame size (m) at full strength. */
const W = 0.15;
const H = 0.3;
/** Seconds from the press (after the hold) until the flame catches. */
const KINDLE = 0.2;

const VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 center = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float sx = length(modelMatrix[0].xyz);
  float sy = length(modelMatrix[1].xyz);
  vec3 toCam = cameraPosition - center.xyz;
  vec3 dir = normalize(vec3(toCam.x, 0.0, toCam.z) + vec3(1e-4, 0.0, 0.0));
  vec3 right = vec3(dir.z, 0.0, -dir.x);
  float sway = sin(uTime * 4.7 + uSeed * 20.0) * 0.12 * uv.y * uv.y;
  vec3 wp = center.xyz + right * (position.x + sway) * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
uniform float uCore;
varying vec2 vUv;
float fh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float fn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fh(i), fh(i + vec2(1.0, 0.0)), u.x), mix(fh(i + vec2(0.0, 1.0)), fh(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float t = uTime * 1.25 + uSeed * 17.0;
  vec2 uv = vUv;
  float n1 = fn(vec2(uv.x * 4.0, uv.y * 3.0 - t * 3.6));
  float n2 = fn(vec2(uv.x * 9.0 + 3.1, uv.y * 7.0 - t * 6.0));
  float n = n1 * 0.65 + n2 * 0.35;
  float x = (uv.x - 0.5) * 2.0;
  float y = uv.y;
  // Teardrop that narrows and breaks up toward the licking tip.
  float width = (1.0 - pow(y, 1.3)) * (0.55 + 0.45 * sqrt(max(y, 0.0))) * 0.95;
  float dx = abs(x + (n1 - 0.5) * 0.55 * y);
  float body = 1.0 - smoothstep(width * 0.5, width + 0.02, dx);
  body *= smoothstep(1.02, 0.32 + n * 0.45, y + (n - 0.5) * 0.28);
  body *= smoothstep(0.0, 0.1, y);
  float core = (1.0 - smoothstep(0.0, width * 0.55, dx)) * (1.0 - smoothstep(0.08, 0.65, y));
  vec3 outer = vec3(1.0, 0.3, 0.05);
  vec3 mid = vec3(1.0, 0.64, 0.18);
  vec3 hot = vec3(1.0, 0.95, 0.7);
  vec3 col = mix(outer, mid, smoothstep(0.15, 0.7, body));
  col = mix(col, hot, clamp(core * (0.8 + uCore), 0.0, 1.0));
  float a = body * uIntensity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * (1.0 + uCore * 0.6), min(a, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

let quad: THREE.PlaneGeometry | null = null;
let glowTex: THREE.DataTexture | null = null;

function flameQuad(): THREE.PlaneGeometry {
  if (!quad) {
    quad = new THREE.PlaneGeometry(1, 1, 1, 1);
    quad.translate(0, 0.5, 0);
  }
  return quad;
}

function glowTexture(): THREE.DataTexture {
  if (!glowTex) {
    const n = 32;
    const data = new Uint8Array(n * n * 4);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const dx = (i + 0.5) / n - 0.5, dy = (j + 0.5) / n - 0.5;
        const v = Math.max(0, 1 - Math.hypot(dx, dy) * 2);
        const k = (j * n + i) * 4;
        data[k] = data[k + 1] = data[k + 2] = 255;
        data[k + 3] = Math.round(255 * v * v);
      }
    }
    glowTex = new THREE.DataTexture(data, n, n);
    glowTex.needsUpdate = true;
  }
  return glowTex;
}

function flameMaterial(core: number, seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'palm_flame',
    uniforms: { uTime: { value: 0 }, uSeed: { value: seed }, uIntensity: { value: 1.3 }, uCore: { value: core } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const tA = new THREE.Vector3();

export class PalmFlame implements PlayInteraction {
  readonly kind = 'fire' as const;
  readonly moveFactor = 1;
  readonly facesAim = false;
  private readonly group = new THREE.Group();
  private readonly outer: THREE.Mesh;
  private readonly inner: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly light: THREE.PointLight | null;
  private readonly mats: THREE.ShaderMaterial[];
  private embers: Emitter | null = null;
  private loop: LoopHandle | null = null;
  private t = 0;
  /** 0..1 flame strength (grows when kindled, shrinks when released). */
  private strength = 0;
  private kindled = false;
  private released = false;
  private readonly seed = Math.random();
  /** Last flame base position (debug/tests: does it follow the hand?). */
  readonly at = new THREE.Vector3();

  constructor(private readonly ctx: GameContext, private readonly player: Player) {
    this.mats = [flameMaterial(0, this.seed), flameMaterial(0.9, this.seed + 0.37)];
    this.outer = new THREE.Mesh(flameQuad(), this.mats[0]);
    this.inner = new THREE.Mesh(flameQuad(), this.mats[1]);
    for (const m of [this.outer, this.inner]) {
      m.frustumCulled = false;
      m.renderOrder = 14;
    }
    this.inner.renderOrder = 15;
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff8a3a', blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    this.glow.renderOrder = 13;
    this.group.name = 'palm_flame';
    this.group.add(this.glow, this.outer, this.inner);
    this.light = ctx.settings.data.graphics.dynamicLights ? new THREE.PointLight('#ff9040', 0, 3.2, 2) : null;
    if (this.light) this.group.add(this.light);
    this.group.visible = false;
    ctx.vfx.group.add(this.group);
    player.humanoid.animator.play('play_fire_palm', { fadeIn: 0.22 });
  }

  /** Base of the flame: just above the right palm (anchor on the handR bone). */
  private palm(out: THREE.Vector3): THREE.Vector3 {
    this.player.castOrigin('handR', out);
    return out.setY(out.y + 0.035);
  }

  update(dt: number): boolean {
    this.t += dt;
    // Water puts it out.
    if (this.player.body?.swimming) return false;
    if (!this.kindled && this.t >= KINDLE) {
      this.kindled = true;
      const p = this.palm(tA);
      this.ctx.audio.play('bend_fire_puff', { position: p, volume: 0.35, pitch: 1.5 });
      this.ctx.vfx.burst('embers', p, { count: 5, speed: 0.6, size: 0.4 });
      this.loop = this.ctx.audio.loop('fire_crackle', { position: p, volume: 0.16 });
      this.loop.setParam('intensity', 0.25);
      const rate = this.ctx.vfx.quality === 'low' ? 2 : 4;
      this.embers = this.ctx.vfx.emitter('embers', rate, { size: 0.3, speed: 0.5, dir: new THREE.Vector3(0, 1, 0), spread: 0.35, life: 0.9 });
    }
    const want = this.kindled ? 1 : 0;
    this.strength += (want - this.strength) * Math.min(1, dt * (want > this.strength ? 9 : 6));
    this.pose();
    return true;
  }

  /** Place, size and flicker every layer at the palm. */
  private pose(): void {
    const p = this.palm(this.at);
    const s = this.strength;
    const time = this.ctx.time.elapsed;
    const flick = 0.9 + 0.1 * Math.sin(time * 23 + this.seed * 9) + 0.06 * Math.sin(time * 37.7);
    this.group.visible = s > 0.02;
    this.group.position.copy(p);
    this.outer.scale.set(W * (0.92 + 0.08 * Math.sin(time * 17)) * s, H * flick * s, 1);
    this.inner.scale.set(W * 0.55 * s, H * 0.6 * flick * s, 1);
    this.glow.position.set(0, H * 0.3 * s, 0);
    this.glow.scale.setScalar(0.5 * s + 0.05);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.32 * s * flick;
    for (const m of this.mats) m.uniforms.uTime.value = time;
    if (this.light) {
      this.light.position.set(0, 0.12, 0);
      this.light.intensity = 2.4 * s * (0.8 + 0.2 * flick + 0.1 * Math.sin(time * 41));
    }
    if (this.embers) {
      this.embers.position.copy(p).setY(p.y + H * 0.45 * s);
      this.embers.active = s > 0.3;
    }
    this.loop?.setPosition(p);
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    this.player.humanoid.animator.stop('play_fire_palm', 0.35);
    this.embers?.stop();
    this.embers = null;
    const swimming = !!this.player.body?.swimming;
    if (swimming && this.strength > 0.1) this.ctx.audio.play('steam_hiss', { position: this.at, volume: 0.4 });
    this.loop?.stop(0.25);
    this.loop = null;
    let smoked = false;
    addEffect({
      update: (dt) => {
        this.strength -= dt * 3.2;
        if (this.strength <= 0.05 && !smoked) {
          smoked = true;
          if (this.kindled) this.ctx.vfx.burst(swimming ? 'steam' : 'smoke', tA.copy(this.at).setY(this.at.y + 0.1), { count: 3, size: 0.35, speed: 0.4 });
        }
        if (this.strength <= 0) return false;
        this.pose();
        return true;
      },
      dispose: () => this.destroy(),
    });
  }

  private destroy(): void {
    this.group.removeFromParent();
    for (const m of this.mats) m.dispose();
    (this.glow.material as THREE.SpriteMaterial).dispose();
    this.light?.dispose();
  }

  dispose(): void {
    this.released = true;
    this.player.humanoid.animator.stop('play_fire_palm', 0.1);
    this.embers?.stop();
    this.embers = null;
    this.loop?.stop(0.1);
    this.loop = null;
    this.destroy();
  }

  debug(): Record<string, unknown> {
    const hand = this.player.castOrigin('handR', new THREE.Vector3());
    return {
      kindled: this.kindled,
      strength: +this.strength.toFixed(2),
      flame: [+this.at.x.toFixed(3), +this.at.y.toFixed(3), +this.at.z.toFixed(3)],
      hand: [+hand.x.toFixed(3), +hand.y.toFixed(3), +hand.z.toFixed(3)],
      light: !!this.light,
    };
  }
}
