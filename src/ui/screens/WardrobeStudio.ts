import * as THREE from 'three';
import { cloneAppearance, type Appearance } from '../../character/Appearance';
import { Humanoid } from '../../character/Humanoid';
import type { Element } from '../../core/types';

const THEME: Record<Element, { top: string; bottom: string; ring: string }> = {
  air: { top: '#4a3c2a', bottom: '#0f0b07', ring: '#ffd98a' },
  water: { top: '#22384f', bottom: '#070b12', ring: '#9fd8ff' },
  earth: { top: '#2f3a24', bottom: '#090b06', ring: '#c4e8a0' },
  fire: { top: '#4a2418', bottom: '#0e0605', ring: '#ffb070' },
};

/**
 * Small 3D studio for the wardrobe / character screens: a lit pedestal with a
 * Humanoid built from the player's appearance, rendered through Game.setStage
 * (re-uses the main renderer — no second WebGL context). The character is
 * framed inside a DOM rect (the preview pane) and can be turned by dragging.
 */
export class WardrobeStudio {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1, 0.05, 100);
  readonly humanoid: Humanoid;
  yaw = 0.45;
  private targetYaw = 0.45;
  private pending: Appearance | null = null;
  private pendingT = 0;
  private disposables: Array<{ dispose(): void }> = [];
  private bgMat: THREE.ShaderMaterial;
  private ringMat: THREE.MeshBasicMaterial;

  constructor(appearance: Appearance, element: Element) {
    const s = this.scene;
    s.add(new THREE.HemisphereLight(0xfff2e0, 0x3a3440, 1.2));
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(2.2, 4.2, 3.4);
    const fill = new THREE.DirectionalLight(0xc6dcff, 0.7);
    fill.position.set(-3, 1.8, 2.2);
    const rim = new THREE.DirectionalLight(0xd8e8ff, 1.8);
    rim.position.set(-1.6, 3, -3.6);
    s.add(key, fill, rim);
    this.bgMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP;\nvoid main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top;\nuniform vec3 bottom;\nvarying vec3 vP;\nvoid main(){ float t = clamp(normalize(vP).y*0.9+0.45,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0);\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide,
      depthWrite: false,
    });
    const bgGeo = new THREE.SphereGeometry(30, 32, 16);
    s.add(new THREE.Mesh(bgGeo, this.bgMat));
    const pedGeo = new THREE.CylinderGeometry(0.78, 0.86, 0.16, 48);
    const pedMat = new THREE.MeshStandardMaterial({ color: '#b9a57a', roughness: 0.8 });
    const ped = new THREE.Mesh(pedGeo, pedMat);
    ped.position.y = -0.08;
    s.add(ped);
    const ringGeo = new THREE.TorusGeometry(0.8, 0.012, 8, 64);
    this.ringMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const ring = new THREE.Mesh(ringGeo, this.ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.002;
    s.add(ring);
    this.disposables.push(bgGeo, this.bgMat, pedGeo, pedMat, ringGeo, this.ringMat);
    this.humanoid = new Humanoid(cloneAppearance(appearance), { castShadow: false, lod: 'high' });
    s.add(this.humanoid.root);
    this.setTheme(element);
  }

  setTheme(e: Element): void {
    const t = THEME[e];
    this.bgMat.uniforms.top.value.set(t.top);
    this.bgMat.uniforms.bottom.value.set(t.bottom);
    this.ringMat.color.set(t.ring);
    this.humanoid.animator.loco.style = e;
  }

  /** Debounced appearance change (rebuilding the mesh is not free). */
  setAppearance(a: Appearance, immediate = false): void {
    if (immediate) {
      this.pending = null;
      this.humanoid.setAppearance(cloneAppearance(a));
      return;
    }
    this.pending = cloneAppearance(a);
    this.pendingT = 0.12;
  }

  turn(d: number): void {
    this.targetYaw += d;
  }

  update(dt: number, rect: { x: number; y: number; w: number; h: number }): void {
    if (this.pending) {
      this.pendingT -= dt;
      if (this.pendingT <= 0) {
        this.humanoid.setAppearance(this.pending);
        this.pending = null;
      }
    }
    this.yaw += (this.targetYaw - this.yaw) * Math.min(1, dt * 10);
    this.humanoid.root.rotation.y = this.yaw;
    this.humanoid.update(dt);
    this.frame(rect);
  }

  private frame(fr: { x: number; y: number; w: number; h: number }): void {
    const cam = this.camera;
    const W = Math.max(1, window.innerWidth), H = Math.max(1, window.innerHeight);
    const hgt = this.humanoid.height;
    const focusY = hgt * 0.52;
    const span = hgt * 1.18 + 0.15;
    const spanW = 1.0;
    const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    const dx = cx - W / 2, dy = cy - H / 2;
    const fullW = W + 2 * Math.abs(dx), fullH = H + 2 * Math.abs(dy);
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, Math.abs(dx) - dx, Math.abs(dy) - dy, W, H);
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const pxPerUnitAt1 = fullH / (2 * tanH);
    const dist = Math.max((span * pxPerUnitAt1) / (Math.max(80, fr.h) * 0.92), (spanW * pxPerUnitAt1) / (Math.max(80, fr.w) * 0.92));
    cam.position.set(0, focusY + dist * 0.05, dist);
    cam.lookAt(0, focusY, 0);
    cam.updateProjectionMatrix();
  }

  dispose(): void {
    this.humanoid.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
