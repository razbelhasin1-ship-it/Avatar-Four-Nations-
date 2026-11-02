/**
 * Feature flags. Defaults live here; for testing they can be overridden per page load with
 * `?flags=-START_WATER_HOMELANDS` (off) or `?flags=+NAME` (on) in the URL, comma-separated.
 */
export const FEATURES = {
  /**
   * The Water card on "Begin your journey as the Avatar" opens a second step: the Southern or the
   * Northern Water Tribe. Off: the old one-step Water card (Northern Water Tribe start).
   */
  START_WATER_HOMELANDS: true,
};

export type FeatureName = keyof typeof FEATURES;

try {
  const raw = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('flags') : null;
  for (const part of (raw ?? '').split(',')) {
    const name = part.replace(/^[+-]/, '').trim() as FeatureName;
    if (name in FEATURES) FEATURES[name] = !part.startsWith('-');
  }
} catch {
  /* no location (tests): keep the defaults */
}
