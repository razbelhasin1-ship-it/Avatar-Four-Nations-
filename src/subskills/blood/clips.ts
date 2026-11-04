import { registerClip } from '../../character/Animator';

/**
 * Bloodbending poses. The bender's hands are curled and rigid; the victim moves like a marionette:
 * stiff, arms pulled out from the body, head tipped back, small abrupt jerks.
 * ('blood_bend' is fluid like Katara; 'blood_bend_rigid' is Hama's abrupt puppeteer.)
 */

registerClip({
  id: 'blood_bend',
  duration: 2.4,
  loop: true,
  mask: 'upper',
  desc: 'Bloodbender (fluid): arms raised forward, hands curled into rigid claws, slow tense drift.',
  keys: [
    { t: 0, pose: { spine: [0.06, 0, 0], upperArmL: [-1.15, 0.25, 0.32], upperArmR: [-1.15, -0.25, -0.32], foreArmL: [-0.55, 0, 0], foreArmR: [-0.55, 0, 0], handL: [0.55, 0, 0.15], handR: [0.55, 0, -0.15], fistL: 0.6, fistR: 0.6 } },
    { t: 1.2, pose: { spine: [0.1, 0.05, 0], upperArmL: [-1.25, 0.3, 0.36], upperArmR: [-1.05, -0.2, -0.3], foreArmL: [-0.62, 0, 0], foreArmR: [-0.48, 0, 0], handL: [0.65, 0, 0.18], handR: [0.5, 0, -0.12], fistL: 0.68, fistR: 0.55 }, ease: 'inout' },
    { t: 2.4, pose: { spine: [0.06, 0, 0], upperArmL: [-1.15, 0.25, 0.32], upperArmR: [-1.15, -0.25, -0.32], foreArmL: [-0.55, 0, 0], foreArmR: [-0.55, 0, 0], handL: [0.55, 0, 0.15], handR: [0.55, 0, -0.15], fistL: 0.6, fistR: 0.6 }, ease: 'inout' },
  ],
});

registerClip({
  id: 'blood_bend_rigid',
  duration: 1.6,
  loop: true,
  mask: 'upper',
  desc: 'Bloodbender (rigid, abrupt — Hama): claws held high, jerking like a puppeteer working strings.',
  keys: [
    { t: 0, pose: { spine: [0.12, 0, 0], head: [0.08, 0, 0], upperArmL: [-1.5, 0.35, 0.45], upperArmR: [-1.5, -0.35, -0.45], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0.9, 0, 0.2], handR: [0.9, 0, -0.2], fistL: 0.75, fistR: 0.75 } },
    { t: 0.36, pose: { upperArmL: [-1.62, 0.35, 0.5], foreArmL: [-1.05, 0, 0], handL: [1.05, 0, 0.25] }, ease: 'linear' },
    { t: 0.42, pose: { upperArmL: [-1.5, 0.35, 0.45], foreArmL: [-0.9, 0, 0], handL: [0.9, 0, 0.2] }, ease: 'linear' },
    { t: 0.98, pose: { upperArmR: [-1.62, -0.35, -0.5], foreArmR: [-1.05, 0, 0], handR: [1.05, 0, -0.25] }, ease: 'linear' },
    { t: 1.04, pose: { upperArmR: [-1.5, -0.35, -0.45], foreArmR: [-0.9, 0, 0], handR: [0.9, 0, -0.2] }, ease: 'linear' },
    { t: 1.6, pose: { spine: [0.12, 0, 0], head: [0.08, 0, 0], upperArmL: [-1.5, 0.35, 0.45], upperArmR: [-1.5, -0.35, -0.45], foreArmL: [-0.9, 0, 0], foreArmR: [-0.9, 0, 0], handL: [0.9, 0, 0.2], handR: [0.9, 0, -0.2], fistL: 0.75, fistR: 0.75 } },
  ],
});

registerClip({
  id: 'blood_held',
  duration: 1.8,
  loop: true,
  mask: 'upper',
  desc: 'Bloodbent victim: rigid, arms drawn out and back, fingers spread, head tipped up; small abrupt twitches.',
  keys: [
    { t: 0, pose: { spine: [-0.1, 0, 0], chest: [-0.08, 0, 0], head: [-0.25, 0, 0], upperArmL: [0.3, 0, 0.45], upperArmR: [0.3, 0, -0.45], foreArmL: [-0.12, 0, 0], foreArmR: [-0.12, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], fistL: 0, fistR: 0 } },
    { t: 0.55, pose: { head: [-0.31, 0.08, 0], upperArmL: [0.36, 0, 0.52] }, ease: 'linear' },
    { t: 0.6, pose: { head: [-0.25, 0, 0], upperArmL: [0.3, 0, 0.45] }, ease: 'linear' },
    { t: 1.2, pose: { spine: [-0.14, 0.05, 0], upperArmR: [0.36, 0, -0.52] }, ease: 'linear' },
    { t: 1.26, pose: { spine: [-0.1, 0, 0], upperArmR: [0.3, 0, -0.45] }, ease: 'linear' },
    { t: 1.8, pose: { spine: [-0.1, 0, 0], chest: [-0.08, 0, 0], head: [-0.25, 0, 0], upperArmL: [0.3, 0, 0.45], upperArmR: [0.3, 0, -0.45], foreArmL: [-0.12, 0, 0], foreArmR: [-0.12, 0, 0], handL: [-0.3, 0, 0], handR: [-0.3, 0, 0], fistL: 0, fistR: 0 } },
  ],
});

registerClip({
  id: 'blood_shove',
  duration: 0.55,
  mask: 'upper',
  desc: 'Bloodbent victim jerked into a stiff shove (puppet).',
  keys: [
    { t: 0, pose: { spine: [-0.1, 0, 0], upperArmL: [0.3, 0, 0.45], upperArmR: [0.3, 0, -0.45] } },
    { t: 0.12, pose: { spine: [0.25, 0, 0], upperArmL: [-1.45, 0, 0.1], upperArmR: [-1.45, 0, -0.1], foreArmL: [0, 0, 0], foreArmR: [0, 0, 0], fistL: 0, fistR: 0 }, ease: 'linear' },
    { t: 0.55, pose: { spine: [-0.1, 0, 0], upperArmL: [0.3, 0, 0.45], upperArmR: [0.3, 0, -0.45], foreArmL: [-0.12, 0, 0], foreArmR: [-0.12, 0, 0] }, ease: 'inout' },
  ],
});
