import type { BiomeId } from '../../core/types';

/**
 * Moisture available to Moisture Extraction (water_moisture): plants and humid
 * air hold a LIMITED amount of water. Swamps, jungles, forests and rain are
 * generous; deserts and volcanic slopes are nearly bone-dry. Each spot is
 * drained by use and recovers slowly, so the technique never replaces real
 * sources.
 */

const BIOME_HUMIDITY: Record<BiomeId, number> = {
  swamp: 0.95,
  tropical: 0.8,
  forest: 0.7,
  ocean: 0.65,
  coast: 0.6,
  boreal: 0.55,
  temperate: 0.5,
  farmland: 0.45,
  alpine: 0.3,
  tundra: 0.28,
  polar: 0.2,
  savanna: 0.22,
  desert: 0.05,
  volcanic: 0.04,
};

export interface HumidityInput {
  biome: BiomeId;
  /** Biome weights (0..1) for smooth borders. */
  swamp?: number;
  desert?: number;
  volcanic?: number;
  raining?: boolean;
  /** Liquid water (river, lake, sea...) within ~25 m. */
  nearWater?: boolean;
}

export function humidity(i: HumidityInput): number {
  let h = BIOME_HUMIDITY[i.biome] ?? 0.4;
  if (i.swamp) h = Math.max(h, 0.95 * i.swamp);
  if (i.desert) h *= 1 - 0.85 * i.desert;
  if (i.volcanic) h *= 1 - 0.85 * i.volcanic;
  if (i.raining) h += 0.45;
  if (i.nearWater) h += 0.2;
  return Math.max(0, Math.min(1, h));
}

export function humidityLabel(h: number): string {
  if (h >= 0.8) return 'saturated';
  if (h >= 0.55) return 'humid';
  if (h >= 0.3) return 'mild';
  if (h >= 0.12) return 'dry';
  return 'bone-dry';
}

/** Maximum water (units) one extraction yields at full humidity. */
export const MOISTURE_MAX_YIELD = 26;
/** Below this many units the extraction fails (too dry). */
export const MOISTURE_MIN_YIELD = 3;

/**
 * Per-area depletion: every extraction dries a 24 m cell; cells recover over
 * ~90 s. Pure data so it can be unit tested.
 */
export class MoistureMap {
  private cells = new Map<string, { drained: number; t: number }>();
  constructor(readonly cell = 24, readonly recoverPerSec = 1 / 90) {}

  private key(x: number, z: number): string {
    return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
  }

  drained(x: number, z: number, now: number): number {
    const c = this.cells.get(this.key(x, z));
    if (!c) return 0;
    return Math.max(0, c.drained - (now - c.t) * this.recoverPerSec);
  }

  drain(x: number, z: number, now: number, amount: number): void {
    const k = this.key(x, z);
    const d = this.drained(x, z, now);
    this.cells.set(k, { drained: Math.min(1, d + amount), t: now });
    if (this.cells.size > 256) {
      for (const [kk, c] of this.cells) if (c.drained - (now - c.t) * this.recoverPerSec <= 0) this.cells.delete(kk);
    }
  }

  /** Units an extraction would yield here now. */
  yieldAt(x: number, z: number, now: number, hum: number): number {
    return MOISTURE_MAX_YIELD * hum * (1 - this.drained(x, z, now));
  }

  clear(): void {
    this.cells.clear();
  }
}
