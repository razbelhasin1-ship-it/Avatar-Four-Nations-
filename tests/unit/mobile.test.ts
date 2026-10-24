import { describe, expect, it } from 'vitest';
import { detectDevice, type DeviceInfo } from '../../src/core/Device';
import { applyMobileDefaults, defaultSettings, GRAPHICS_PRESETS } from '../../src/core/Settings';

const phone: DeviceInfo = { mobile: true, phone: true, touch: true, coarse: true, smallScreen: true, uaMobile: true, reason: 'test' };

describe('mobile defaults', () => {
  it('turns the Low preset into a mobile-safe setup', () => {
    const s = defaultSettings();
    applyMobileDefaults(s, phone);
    const g = s.graphics;
    expect(g.preset).toBe('low');
    expect(g.renderScale).toBeCloseTo(0.7);
    expect(g.maxPixelRatio).toBeLessThanOrEqual(1.5);
    expect(g.postProcessing).toBe(false);
    expect(g.bloom).toBe(false);
    expect(g.drawDistance).toBeLessThan(GRAPHICS_PRESETS.low.drawDistance);
    expect(g.foliageDensity).toBeLessThan(GRAPHICS_PRESETS.medium.foliageDensity);
    expect(g.grassDensity).toBe(0);
    expect(s.controls.touchControls).toBe('auto');
    expect(s.gameplay.hudScale).toBeLessThan(1);
  });

  it('keeps the HUD full size on tablets', () => {
    const s = defaultSettings();
    applyMobileDefaults(s, { ...phone, phone: false });
    expect(s.gameplay.hudScale).toBe(1);
  });

  it('touch layout settings have sane defaults', () => {
    const c = defaultSettings().controls;
    expect(c.touchButtonSize).toBe(1);
    expect(c.touchOpacity).toBeGreaterThan(0.5);
    expect(c.touchLeftHanded).toBe(false);
  });

  it('detects a desktop when there is no window (node)', () => {
    const d = detectDevice();
    expect(d.mobile).toBe(false);
  });
});
