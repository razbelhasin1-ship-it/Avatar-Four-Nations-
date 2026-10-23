import { describe, expect, it } from 'vitest';
import { pickWeather, WEATHER_TYPES, type WeatherType } from '../../src/world/env/Weather';
import { REGIONS } from '../../src/world/WorldLayout';

describe('weather selection', () => {
  it('only picks weather allowed in the region list', () => {
    for (const r of REGIONS) {
      const list = r.weather as WeatherType[];
      for (let i = 0; i < 50; i++) expect(list).toContain(pickWeather(list, i / 50));
    }
  });

  it('favours the region typical (first) weather', () => {
    const list: WeatherType[] = ['fog', 'rain', 'cloudy'];
    let first = 0;
    for (let i = 0; i < 1000; i++) if (pickWeather(list, (i + 0.5) / 1000) === 'fog') first++;
    expect(first / 1000).toBeGreaterThan(0.45);
  });

  it('avoids repeating the current weather when it can', () => {
    const list: WeatherType[] = ['clear', 'snow', 'cloudy', 'blizzard'];
    let repeats = 0;
    for (let i = 0; i < 1000; i++) if (pickWeather(list, (i + 0.5) / 1000, 'clear') === 'clear') repeats++;
    expect(repeats / 1000).toBeLessThan(0.35);
  });

  it('falls back to clear for empty lists and every region weather is a known type', () => {
    expect(pickWeather([], 0.5)).toBe('clear');
    for (const r of REGIONS) for (const w of r.weather) expect(WEATHER_TYPES).toContain(w);
  });
});
