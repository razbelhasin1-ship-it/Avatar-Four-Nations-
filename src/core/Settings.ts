import type { EventBus } from './EventBus';
import type { Action } from './Input';
import { DEFAULT_BINDINGS } from './Input';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra' | 'custom';
export type ShadowQuality = 'off' | 'low' | 'medium' | 'high';

export interface GraphicsSettings {
  preset: QualityPreset;
  /** Multiplier on device pixel ratio (0.5 – 1.0+), capped by maxPixelRatio. */
  renderScale: number;
  maxPixelRatio: number;
  shadows: ShadowQuality;
  /** Metres of terrain/objects drawn before fog hides the world. */
  drawDistance: number;
  /** 0..1 — bias toward lower LODs (0 = best quality). */
  lodBias: number;
  /** 0..1.5 particle budget multiplier. */
  particleDensity: number;
  /** 0..1.5 grass instance density multiplier (0 disables grass). */
  grassDensity: number;
  /** 0..1.5 trees / rocks / props density. */
  foliageDensity: number;
  postProcessing: boolean;
  bloom: boolean;
  /** Clouds, weather particles, ambient motes, footprints. */
  ambientEffects: boolean;
  /** 'low' | 'high' complexity for bending effects (geometry detail, layered shaders). */
  effectsQuality: 'low' | 'medium' | 'high';
  /** Expensive extras: point lights from fire, water reflections, volumetric-looking clouds. */
  dynamicLights: boolean;
  antialias: boolean;
  showFps: boolean;
}

export interface AudioSettings {
  master: number;
  music: number;
  sfx: number;
  ambient: number;
  muted: boolean;
}

export interface ControlSettings {
  mouseSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  cameraShake: number; // 0..1
  cameraDistance: number; // 0.6..1.6 multiplier
  fov: number;
  bindings: Record<Action, string[]>;
  autoTarget: boolean;
  touchControls: 'auto' | 'on' | 'off';
}

export interface GameplaySettings {
  difficulty: 'story' | 'balanced' | 'challenging';
  tutorialHints: boolean;
  damageNumbers: boolean;
  hudScale: number;
  compass: boolean;
}

export interface SettingsData {
  version: number;
  graphics: GraphicsSettings;
  audio: AudioSettings;
  controls: ControlSettings;
  gameplay: GameplaySettings;
}

export const GRAPHICS_PRESETS: Record<Exclude<QualityPreset, 'custom'>, Omit<GraphicsSettings, 'preset' | 'showFps'>> = {
  low: {
    renderScale: 0.75,
    maxPixelRatio: 1,
    shadows: 'off',
    drawDistance: 450,
    lodBias: 0.6,
    particleDensity: 0.4,
    grassDensity: 0,
    foliageDensity: 0.5,
    postProcessing: false,
    bloom: false,
    ambientEffects: false,
    effectsQuality: 'low',
    dynamicLights: false,
    antialias: false,
  },
  medium: {
    renderScale: 1,
    maxPixelRatio: 1,
    shadows: 'low',
    drawDistance: 750,
    lodBias: 0.3,
    particleDensity: 0.7,
    grassDensity: 0.5,
    foliageDensity: 0.8,
    postProcessing: true,
    bloom: true,
    ambientEffects: true,
    effectsQuality: 'medium',
    dynamicLights: false,
    antialias: true,
  },
  high: {
    renderScale: 1,
    maxPixelRatio: 1.5,
    shadows: 'medium',
    drawDistance: 1100,
    lodBias: 0.1,
    particleDensity: 1,
    grassDensity: 1,
    foliageDensity: 1,
    postProcessing: true,
    bloom: true,
    ambientEffects: true,
    effectsQuality: 'high',
    dynamicLights: true,
    antialias: true,
  },
  ultra: {
    renderScale: 1,
    maxPixelRatio: 2,
    shadows: 'high',
    drawDistance: 1600,
    lodBias: 0,
    particleDensity: 1.3,
    grassDensity: 1.5,
    foliageDensity: 1.3,
    postProcessing: true,
    bloom: true,
    ambientEffects: true,
    effectsQuality: 'high',
    dynamicLights: true,
    antialias: true,
  },
};

export const SETTINGS_VERSION = 1;
const STORAGE_KEY = 'a4n.settings';

export function defaultSettings(): SettingsData {
  return {
    version: SETTINGS_VERSION,
    graphics: { preset: 'medium', showFps: false, ...GRAPHICS_PRESETS.medium },
    audio: { master: 0.8, music: 0.55, sfx: 0.85, ambient: 0.7, muted: false },
    controls: {
      mouseSensitivity: 1,
      touchSensitivity: 1,
      invertY: false,
      cameraShake: 1,
      cameraDistance: 1,
      fov: 62,
      bindings: structuredClone(DEFAULT_BINDINGS),
      autoTarget: true,
      touchControls: 'auto',
    },
    gameplay: { difficulty: 'balanced', tutorialHints: true, damageNumbers: true, hudScale: 1, compass: true },
  };
}

/** Deep-merge `src` into `dst` keeping only keys present in `dst` (schema-safe). */
function mergeKnown(dst: any, src: any): any {
  if (!src || typeof src !== 'object') return dst;
  for (const key of Object.keys(dst)) {
    if (!(key in src)) continue;
    const dv = dst[key];
    const sv = src[key];
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) {
      dst[key] = key === 'bindings' ? mergeBindings(dv, sv) : mergeKnown(dv, sv);
    } else if (typeof dv === typeof sv) {
      dst[key] = sv;
    }
  }
  return dst;
}

function mergeBindings(dst: Record<string, string[]>, src: any): Record<string, string[]> {
  if (!src || typeof src !== 'object') return dst;
  for (const key of Object.keys(dst)) {
    const v = src[key];
    if (Array.isArray(v) && v.every((s) => typeof s === 'string')) dst[key] = v.slice(0, 3);
  }
  return dst;
}

/**
 * Persistent player settings. Systems read `settings.data` and subscribe to
 * `settings:changed` to apply changes live (no reload needed).
 */
export class SettingsManager {
  data: SettingsData;

  constructor(private readonly events: EventBus) {
    this.data = this.load();
  }

  private load(): SettingsData {
    const base = defaultSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) mergeKnown(base, JSON.parse(raw));
    } catch {
      /* storage unavailable or corrupt: defaults */
    }
    base.version = SETTINGS_VERSION;
    return base;
  }

  persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* ignore quota / privacy mode */
    }
  }

  /** Set a value by dotted path, e.g. set('graphics.bloom', false). */
  set(path: string, value: unknown): void {
    const parts = path.split('.');
    let obj: any = this.data;
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    const last = parts[parts.length - 1];
    if (obj[last] === value) return;
    obj[last] = value;
    const keys = [path];
    if (parts[0] === 'graphics' && last !== 'preset' && last !== 'showFps') {
      if (this.data.graphics.preset !== 'custom') {
        this.data.graphics.preset = 'custom';
        keys.push('graphics.preset');
      }
    }
    this.persist();
    this.events.emit('settings:changed', { keys });
  }

  applyPreset(preset: Exclude<QualityPreset, 'custom'>): void {
    Object.assign(this.data.graphics, GRAPHICS_PRESETS[preset], { preset });
    this.persist();
    this.events.emit('settings:changed', { keys: ['graphics.*'] });
  }

  setBinding(action: Action, codes: string[]): void {
    this.data.controls.bindings[action] = codes.slice(0, 3);
    this.persist();
    this.events.emit('settings:changed', { keys: ['controls.bindings'] });
  }

  resetBindings(): void {
    this.data.controls.bindings = structuredClone(DEFAULT_BINDINGS);
    this.persist();
    this.events.emit('settings:changed', { keys: ['controls.bindings'] });
  }

  resetAll(): void {
    this.data = defaultSettings();
    this.persist();
    this.events.emit('settings:changed', { keys: ['*'] });
  }
}
