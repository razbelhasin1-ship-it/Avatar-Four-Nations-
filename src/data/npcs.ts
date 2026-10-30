import type { NPCDef } from '../npc/NPCTypes';

/**
 * NPC catalog. NPCs stream in near the player. Masters, merchants and quest
 * givers are defined here (or appended by other data modules).
 */
export const NPCS: NPCDef[] = [
  { id: 'nwt_elder', name: 'Elder Kanna', title: 'Tribe Elder', role: 'elder', nation: 'water', x: -246, z: -1592, yaw: Math.PI / 2, behavior: { type: 'idle' }, dialogue: 'dlg_nwt_elder', region: 'northern_water_tribe' },
  { id: 'bss_elder', name: 'Old Man Shoji', title: 'Retired Earthbender', role: 'elder', nation: 'earth', element: 'earth', x: 642.1, z: -31.1, yaw: -Math.PI / 2, behavior: { type: 'idle' }, dialogue: 'dlg_bss_elder', region: 'ba_sing_se' },
  { id: 'fn_elder', name: 'Sage Hira', title: 'Fire Sage', role: 'elder', nation: 'fire', x: -1318, z: 1214, yaw: 0, behavior: { type: 'idle' }, dialogue: 'dlg_fn_elder', region: 'fire_nation_capital', condition: { notFlag: 'hira_at_temple' } },
  { id: 'air_elder', name: 'Monk Tenzo', title: 'Temple Elder', role: 'monk', nation: 'air', element: 'air', x: 1452, z: 1272, yaw: 0, behavior: { type: 'idle', variant: 'meditate' }, dialogue: 'dlg_air_elder', region: 'southern_air_temple', condition: { notFlag: 'tenzo_in_courtyard' } },
];
