import * as THREE from 'three';
import type { GameContext, GameSystem } from '../core/GameContext';
import { getClip } from './Animator';
import { cloneAppearance, type Appearance } from './Appearance';
import { lookSet, setNpcSampler } from './lookSets';
import { generateAppearance } from '../npc/NPCSystem';
import { buildCache } from './CharacterBuild';
import { atlasCache } from './ClothAtlas';
import { Humanoid } from './Humanoid';

/**
 * Character module: applies graphics settings to humanoid LOD/shadow distances
 * and installs `window.__game.debug.character` (character lab for screenshots,
 * crowd measurements, appearance presets).
 */

type Look = Appearance | string;

interface LabOptions {
  looks?: Look[] | string;
  cols?: number;
  spacing?: number;
  /** Camera: position, target, fov. */
  cam?: { pos: [number, number, number]; look: [number, number, number]; fov?: number };
  bg?: [string, string];
  yaw?: number;
  style?: string;
  lod?: 0 | 1;
  idle?: string;
}

export class CharacterSystem implements GameSystem {
  private ctx!: GameContext;
  private lab: { scene: THREE.Scene; camera: THREE.PerspectiveCamera; humans: Humanoid[]; disposables: Array<{ dispose(): void }> } | null = null;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    setNpcSampler(generateAppearance);
    this.applySettings();
    ctx.events.on('settings:changed', () => this.applySettings());
    queueMicrotask(() => this.installDebug());
  }

  private applySettings(): void {
    const g = this.ctx.settings.data.graphics;
    // lodBias: 0 (best) .. 1 (cheapest).
    const bias = Math.min(1, Math.max(0, g.lodBias ?? 0.3));
    // NPC crowds: the cheap LOD (~7k tris) reads well beyond ~15 m; the player is always close.
    Humanoid.lodDistance = 20 - bias * 10;
    Humanoid.lodBuildBudgetMs = 6 + (1 - bias) * 8;
    Humanoid.shadowDistance = g.shadows === 'off' ? 0 : 40 + (1 - bias) * 30;
    Humanoid.animLodDistance = 40 - bias * 14;
  }

  private installDebug(): void {
    const api = (window as any).__game;
    if (!api) return;
    api.debug = api.debug ?? {};
    api.debug.character = {
      lookSet,
      lab: (o: LabOptions = {}) => this.openLab(o),
      labPose: (clipId: string | null, t = 0, style?: string) => this.labPose(clipId, t, style),
      labGlow: (eyes: number, tattoos: number) => this.lab?.humans.forEach((h) => h.setGlow(eyes, tattoos, '#c8ecff')),
      labCamera: (pos: [number, number, number], look: [number, number, number], fov?: number) => this.labCamera(pos, look, fov),
      labYaw: (yaw: number) => this.lab?.humans.forEach((h) => (h.root.rotation.y = yaw)),
      labLoco: (patch: Record<string, unknown>) => this.lab?.humans.forEach((h) => Object.assign(h.animator.loco, patch)),
      labStep: (n = 1, dt = 1 / 30) => {
        for (let i = 0; i < n; i++) this.lab?.humans.forEach((h) => h.update(dt));
      },
      labClose: () => this.closeLab(),
      labStats: () => this.lab?.humans.map((h) => h.stats),
      cacheStats: () => ({ builds: buildCache.size, liveBuilds: buildCache.liveCount, atlases: atlasCache.size }),
      /** Full-frame draw call count (all passes incl. shadows / post). */
      measure: () => {
        const r = this.ctx.render.renderer;
        r.info.autoReset = false;
        r.info.reset();
        this.ctx.game.frame(1 / 30);
        const out = { calls: r.info.render.calls, triangles: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: (r.info as any).programs?.length ?? 0 };
        r.info.autoReset = true;
        return out;
      },
      humanoidOf: (entityId: number) => (this.ctx.entities.get(entityId) as any)?.humanoid ?? null,
      hasClip: (id: string) => !!getClip(id),
    };
  }

  private resolveLooks(looks: Look[] | string | undefined): Appearance[] {
    if (!looks) return lookSet('defaults');
    if (typeof looks === 'string') return lookSet(looks);
    return looks.map((l) => (typeof l === 'string' ? lookSet(l)[0] : cloneAppearance(l)));
  }

  private openLab(o: LabOptions): { count: number; vertices: number[] } {
    this.closeLab();
    const looks = this.resolveLooks(o.looks);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(o.cam?.fov ?? 30, window.innerWidth / window.innerHeight, 0.05, 200);
    const disposables: Array<{ dispose(): void }> = [];
    scene.add(new THREE.HemisphereLight(0xfff2e0, 0x5a5048, 1.25));
    const key = new THREE.DirectionalLight(0xfff4e8, 2.5);
    key.position.set(2.5, 4, 3.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8dcff, 0.7);
    fill.position.set(-3, 2, 2);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbfd8ff, 1.4);
    rim.position.set(-2, 3, -4);
    scene.add(rim);
    const [top, bottom] = o.bg ?? ['#d9e4ec', '#7d8a96'];
    const bgMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
      vertexShader: 'varying vec3 vP;\nvoid main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top;\nuniform vec3 bottom;\nvarying vec3 vP;\nvoid main(){ float t = clamp(normalize(vP).y*0.9+0.45,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0);\n#include <colorspace_fragment>\n}',
      side: THREE.BackSide,
      depthWrite: false,
    });
    const bgGeo = new THREE.SphereGeometry(80, 32, 16);
    scene.add(new THREE.Mesh(bgGeo, bgMat));
    const groundGeo = new THREE.CircleGeometry(30, 48);
    const groundMat = new THREE.MeshStandardMaterial({ color: '#b8ab92', roughness: 0.95 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    disposables.push(bgGeo, bgMat, groundGeo, groundMat);
    const cols = o.cols ?? Math.min(looks.length, 8);
    const sp = o.spacing ?? 0.85;
    const humans: Humanoid[] = [];
    looks.forEach((a, i) => {
      const h = new Humanoid(a, { castShadow: false, lod: o.lod === 1 ? 'low' : 'high' });
      const r = Math.floor(i / cols), c = i % cols;
      const n = Math.min(cols, looks.length - r * cols);
      h.root.position.set((c - (n - 1) / 2) * sp, 0, -r * sp * 1.6);
      h.root.rotation.y = o.yaw ?? 0;
      h.animator.loco.style = (o.style as any) ?? 'neutral';
      if (o.idle) h.animator.loco.idleVariant = o.idle as any;
      scene.add(h.root);
      humans.push(h);
    });
    const rows = Math.ceil(looks.length / cols);
    const w = Math.max(1, (cols - 1) * sp + 0.8);
    const dist = Math.max(3.2, w * 1.9) + rows * 0.8;
    const cam = o.cam ?? { pos: [0, 1.15, dist], look: [0, 0.95, -(rows - 1) * sp * 0.8] };
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.look);
    scene.onBeforeRender = () => {
      const dt = this.ctx.time.dt || 1 / 60;
      for (const h of humans) h.update(dt);
      scene.updateMatrixWorld(true);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    this.lab = { scene, camera, humans, disposables };
    this.ctx.game.setStage({ scene, camera });
    return { count: humans.length, vertices: humans.map((h) => h.stats.vertices) };
  }

  private labCamera(pos: [number, number, number], look: [number, number, number], fov?: number): void {
    if (!this.lab) return;
    const c = this.lab.camera;
    c.position.set(...pos);
    if (fov) c.fov = fov;
    c.lookAt(...look);
    c.updateProjectionMatrix();
  }

  private labPose(clipId: string | null, t: number, style?: string): void {
    if (!this.lab) return;
    for (const h of this.lab.humans) {
      const an = h.animator;
      if (style) an.loco.style = style as any;
      an.stop(undefined, 0);
      for (let k = 0; k < 30; k++) h.update(1 / 30);
      if (clipId) {
        an.play(clipId, { fadeIn: 0, hold: true });
        const steps = Math.max(1, Math.round(t * 120));
        for (let k = 0; k < steps; k++) h.update(t / steps);
        if (t === 0) h.update(0);
      }
    }
  }

  private closeLab(): void {
    if (!this.lab) return;
    for (const h of this.lab.humans) h.dispose();
    for (const d of this.lab.disposables) d.dispose();
    this.lab = null;
    this.ctx.game.setStage(null);
  }
}
