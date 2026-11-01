import { defineSpots, type Spot } from '../../Spots';
import { A, KI, yawOutward } from '../../landforms/kyoshiIsland';
import { off } from './kit';

/**
 * Named places on Kyoshi Island: quest-anchor markers (village entrance, statue, Meeting Hall,
 * dojo, shrine, bay beach, bridge, harbor pier) and clearings that keep trees out of the village,
 * its fields and the harbor (vegetation reads every spot radius as a clear circle).
 */
const R = 'kyoshi_isle';
const V = KI.village;
const up = yawOutward(V.u);
const gate = A(V.u, V.gateR);
const st = (s: number, lat: number) => off(gate, up, lat, s);

const anchors: Record<string, Spot> = {
  ki_village_entrance: { ...st(-6, 0), yaw: up, r: 6, label: 'Village entrance', region: R },
  ki_statue: { ...st(-1, -9), r: 3, label: 'Statue of Avatar Kyoshi', region: R },
  ki_meeting_hall: { ...A(V.u, V.hallR - 12), yaw: up + Math.PI, r: 5, label: 'Meeting Hall', region: R },
  ki_dojo: { ...A(KI.dojo.u, KI.dojo.r), r: 12, label: 'Kyoshi Dojo', region: R },
  ki_shrine: { ...A(KI.shrine.u, KI.shrine.r), r: 6, label: 'Kyoshi Shrine', region: R },
  ki_bay_beach: { ...A(0.22, KI.Ri + 8), r: 6, label: 'Koi Bay beach', region: R },
  ki_bridge: { ...A(KI.falls.u, 268), r: 5, label: 'Crescent Bridge', region: R },
  ki_harbor_pier: { ...A(0.82, KI.harbor.quayR + 6), r: 5, label: 'Koi Harbor pier', region: R },
  dock_ki_harbor: { ...A(0.82, KI.harbor.quayR + 2), r: 4, label: 'Koi Harbor', region: R },
};

const clearings: Record<string, Spot> = {};
for (const [i, s] of [0, 28, 56, 84, 106].entries()) clearings[`ki_clear_village_${i}`] = { ...st(s, 0), r: s === 106 ? 26 : 38, region: R };
for (let i = 0; i < 6; i++) clearings[`ki_clear_harbor_${i}`] = { ...A(0.752 + i * 0.027, 248), r: 34, region: R };
for (let i = 0; i < 4; i++) clearings[`ki_clear_harbor_hill_${i}`] = { ...A(0.77 + i * 0.033, 276), r: 18, region: R };
clearings.ki_clear_rest = { ...A(KI.falls.u + 0.012, 286), r: 7, region: R };
clearings.ki_clear_headland = { ...A(0.968, 300), r: 6, region: R };

defineSpots({ ...anchors, ...clearings });

export const KYOSHI_ANCHORS = Object.keys(anchors);
