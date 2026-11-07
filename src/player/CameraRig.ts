import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import { clamp, damp, dampAngle, lerp } from '../core/MathUtil';

/**
 * Third-person orbit camera with collision, lock-on framing, shake and
 * impulses; plus a "scripted" mode (menu flyovers, cinematics) driven by
 * setScripted(fn).
 */
export class CameraRig implements GameSystem {
  private ctx!: GameContext;
  yaw = Math.PI;
  pitch = 0.28;
  distance = 5.2;
  private currentDist = 5.2;
  readonly pivot = new THREE.Vector3();
  private readonly smoothedPivot = new THREE.Vector3();
  private shake = 0;
  private shakeTime = 0;
  private impulse = { fov: 0, pull: 0, t: 0, dur: 0 };
  private scripted: ((dt: number, cam: THREE.PerspectiveCamera) => void) | null = null;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private initialized = false;
  /** Extra distance requested by systems (mounts: larger creatures). */
  extraDistance = 0;
  /** Extra pivot height (mounts). */
  extraHeight = 0;
  /** [additive: glider] Extra field of view (degrees: the rush of speed). */
  extraFov = 0;
  /** [additive: glider] Camera roll (radians, a flier banking). */
  roll = 0;
  /** [additive: glider] A heading (player yaw) the camera eases in behind while the player leaves the camera alone (chase camera). */
  chaseYaw: number | null = null;
  /** [additive: glider] The camera pitch the chase camera eases to (looking along a dive, up into a climb). */
  chasePitch: number | null = null;
  private lookIdle = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.events.on('camera:shake', (e) => {
      const s = ctx.settings.data.controls.cameraShake;
      if (s <= 0) return;
      this.shake = Math.max(this.shake, e.intensity * s);
      this.shakeTime = Math.max(this.shakeTime, e.duration);
    });
    ctx.events.on('camera:impulse', (e) => {
      this.impulse = { fov: e.fovKick ?? 0, pull: e.pullback ?? 0, t: 0, dur: e.duration };
    });
  }

  /** [additive: sub-elements] Follow this instead of the player (a projected spirit). */
  follow: { position: THREE.Vector3; height: number } | null = null;

  setScripted(fn: ((dt: number, cam: THREE.PerspectiveCamera) => void) | null): void {
    this.scripted = fn;
    if (!fn) this.initialized = false;
  }

  get isScripted(): boolean {
    return !!this.scripted;
  }

  /** Place the camera behind the player instantly. */
  snapBehind(): void {
    const p = this.ctx.player;
    if (!p) return;
    this.yaw = p.yaw + Math.PI;
    this.initialized = false;
  }

  update(dt: number): void {
    const cam = this.ctx.camera;
    if (this.scripted) {
      this.scripted(dt, cam);
      this.applyShake(dt, cam);
      return;
    }
    const p = (this.follow ?? this.ctx.player) as { position: THREE.Vector3; height: number; body?: { horizontalSpeed: number } | null } | null;
    if (!p) return;
    const input = this.ctx.input;
    const ctl = this.ctx.settings.data.controls;
    if (!this.ctx.ui.blocksGameplay) {
      this.yaw -= input.look.x * 0.0032;
      this.pitch += input.look.y * 0.0028;
    }
    this.pitch = clamp(this.pitch, -0.55, 1.2);
    this.lookIdle = input.look.x !== 0 || input.look.y !== 0 ? 0 : this.lookIdle + dt;

    // Lock-on: steer yaw so the target stays framed.
    const lock = (p as any).lockTarget as { position: THREE.Vector3; alive: boolean } | null;
    if (lock && lock.alive) {
      const to = this.tmp.copy(lock.position).sub(p.position);
      const desired = Math.atan2(to.x, to.z) + Math.PI;
      this.yaw = dampAngle(this.yaw, desired, 5, dt);
      this.pitch = damp(this.pitch, 0.32, 3, dt);
    } else if (this.chaseYaw !== null && this.lookIdle > 0.5) {
      // [additive: glider] Swing in behind the flier when the player is not turning the camera.
      this.yaw = dampAngle(this.yaw, this.chaseYaw + Math.PI, 1.6, dt);
      if (this.chasePitch !== null) this.pitch = damp(this.pitch, this.chasePitch, 1.4, dt);
    }

    const mounted = (p as any).mountAnchor != null;
    const height = (mounted ? 2.2 : 1.55) * (p.height / 1.75) + this.extraHeight;
    this.pivot.copy(p.position).setY(p.position.y + height);
    if (!this.initialized) {
      this.smoothedPivot.copy(this.pivot);
      this.currentDist = this.distance;
      this.initialized = true;
    }
    // Smooth pivot vertically more than horizontally (stairs, jumps).
    this.smoothedPivot.x = damp(this.smoothedPivot.x, this.pivot.x, 30, dt);
    this.smoothedPivot.z = damp(this.smoothedPivot.z, this.pivot.z, 30, dt);
    this.smoothedPivot.y = damp(this.smoothedPivot.y, this.pivot.y, 12, dt);

    let wantDist = this.distance * ctl.cameraDistance + this.extraDistance + (mounted ? 4 : 0);
    // Impulse (Avatar State pullback, fov kick)
    let fovKick = 0;
    if (this.impulse.dur > 0) {
      this.impulse.t += dt;
      const k = this.impulse.t / this.impulse.dur;
      if (k >= 1) this.impulse.dur = 0;
      else {
        const env = Math.sin(Math.min(1, k) * Math.PI);
        wantDist += this.impulse.pull * env;
        fovKick = this.impulse.fov * env;
      }
    }
    if (this.ctx.avatar.sphereActive) wantDist += 1.5;

    // Shoulder offset (right side).
    const dir = this.tmp.set(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const right = this.tmp2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    let shoulder = mounted ? 0 : 0.55;
    // A wall right beside the player (narrow lanes) eats into the shoulder offset.
    if (shoulder > 0) {
      const side = this.ctx.world.raycast(this.smoothedPivot, right, shoulder + 0.35);
      if (side) shoulder = Math.max(0, side.distance - 0.35);
    }
    // `right` is the camera's right vector; offsetting the pivot along it gives an over-the-right-shoulder view.
    const pivot = this.smoothedPivot.clone().addScaledVector(right, shoulder);

    // Collision: shorten distance if terrain/architecture is in the way (never closer than 0.3 m to it).
    const hit = this.ctx.world.raycast(pivot, dir, wantDist + 0.4);
    let targetDist = wantDist;
    if (hit) targetDist = Math.max(Math.min(0.8, hit.distance * 0.5), hit.distance - 0.4);
    // Pull in fast, ease out slowly.
    this.currentDist = targetDist < this.currentDist ? damp(this.currentDist, targetDist, 25, dt) : damp(this.currentDist, targetDist, 3, dt);

    cam.position.copy(pivot).addScaledVector(dir, this.currentDist);
    // Keep above terrain.
    const gh = this.ctx.world.heightAt(cam.position.x, cam.position.z) + 0.4;
    if (cam.position.y < gh) cam.position.y = gh;
    const look = pivot.clone().addScaledVector(dir, -2);
    cam.lookAt(look);
    if (this.roll) cam.rotateZ(this.roll);
    const baseFov = ctl.fov;
    const sprintFov = p.body && p.body.horizontalSpeed > 9 ? 4 : 0;
    cam.fov = damp(cam.fov, baseFov + sprintFov + fovKick + this.extraFov, 6, dt);
    cam.updateProjectionMatrix();
    this.applyShake(dt, cam);
  }

  private applyShake(dt: number, cam: THREE.PerspectiveCamera): void {
    if (this.shakeTime <= 0) {
      this.shake = 0;
      return;
    }
    this.shakeTime -= dt;
    const s = this.shake * Math.min(1, this.shakeTime * 4);
    const t = performance.now() * 0.001;
    cam.position.x += Math.sin(t * 61) * s * 0.25;
    cam.position.y += Math.sin(t * 73 + 1.3) * s * 0.2;
    cam.rotation.z += Math.sin(t * 47) * s * 0.02;
    this.shake = lerp(this.shake, 0, dt * 2);
  }
}
