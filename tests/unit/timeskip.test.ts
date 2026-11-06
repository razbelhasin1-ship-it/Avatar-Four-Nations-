import { describe, expect, it } from 'vitest';
import { formatClock, formatSpan, hoursUntil, isNightHour, lapseSeconds, partOfDay, SUNRISE_HOUR, TIME_PRESETS } from '../../src/world/TimeSkip';

describe('passing time', () => {
  it('waits forward round the clock, never back', () => {
    expect(hoursUntil(21.5, 6)).toBeCloseTo(8.5);
    expect(hoursUntil(6, 21.5)).toBeCloseTo(15.5);
    expect(hoursUntil(23.75, 0.25)).toBeCloseTo(0.5);
    expect(hoursUntil(10, 10)).toBe(0);
    for (let h = 0; h < 24; h += 0.5) for (let t = 0; t < 24; t += 1.25) {
      const d = hoursUntil(h, t);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(24);
      expect(((h + d) % 24) - t).toBeCloseTo(0);
    }
  });

  it('reads the clock and the span', () => {
    expect(formatClock(6)).toBe('06:00');
    expect(formatClock(18.5)).toBe('18:30');
    expect(formatClock(23.999)).toBe('00:00');
    expect(formatClock(-1)).toBe('23:00');
    expect(formatSpan(8.5)).toBe('8 h 30 min');
    expect(formatSpan(3)).toBe('3 h');
    expect(formatSpan(0.25)).toBe('15 min');
  });

  it('names the parts of the day like the sky, and skipping the night wakes you at dawn', () => {
    expect(partOfDay(2)).toBe('Night');
    expect(partOfDay(6)).toBe('Dawn');
    expect(partOfDay(12)).toBe('Midday');
    expect(partOfDay(19)).toBe('Evening');
    expect(partOfDay(23)).toBe('Night');
    expect(isNightHour(22)).toBe(true);
    expect(isNightHour(3)).toBe(true);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(SUNRISE_HOUR)).toBe(false);
    expect(TIME_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('a longer wait plays a longer (but short) time-lapse', () => {
    expect(lapseSeconds(1)).toBeLessThan(lapseSeconds(12));
    expect(lapseSeconds(23.9)).toBeLessThanOrEqual(3.5);
    expect(lapseSeconds(0.25)).toBeGreaterThan(1);
  });
});
