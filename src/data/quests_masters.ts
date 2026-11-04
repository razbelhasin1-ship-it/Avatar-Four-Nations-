import { ELEMENT_INFO } from '../core/types';
import type { ObjectiveDef, QuestDef, QuestStepDef } from '../quests/QuestTypes';
import { AWAKENINGS, lessonById, MASTERS, type LessonDef, type MasterDef } from './masters';
import { QUEST_PROPS } from './quests_props';

/**
 * Master guides: trackable journal entries that lead to every master ("Seek <master>") and to every
 * ability a master teaches ("Learn <ability>"). They are directions, not story: started from the
 * Journal's Masters page, the map or the Technique Library, tracked like any quest (compass ◆, map
 * route, objective panel), and re-trackable after they are done (src/training/MasterGuide.ts).
 *
 * Steps: the rumour first for a hidden master (the clue prop that reveals them), the journey to the
 * master's place (with the way there in words), then meeting them — or, for an ability, the
 * awakening of the element if needed, the lessons it builds on, and the lesson itself.
 */

/** How to get to each master's region, in words (roads and crossings as they are on the map). */
export const ROUTE_HINTS: Record<string, string> = {
  northern_water_tribe:
    'The ice city at the top of the world. The Northern Road runs there from Ba Sing Se\'s west gate, north past the turning for Omashu and over the glaciers.',
  southern_water_tribe:
    'Wolf Cove, at the bottom of the world. Leave Ba Sing Se by the south gate and follow the Southern Road past Misty Palms and down the coast strip to the cove\'s gate.',
  ba_sing_se: 'The great walled city in the east of the Earth Kingdom — the Northern, Southern and Eastern roads all meet at its gates.',
  earth_heartland: 'Gaoling, in the Earth Kingdom heartland south-west of Ba Sing Se, between the Western Road and the Southern Road.',
  omashu: 'The mountain city in the west: turn west off the Northern Road onto the Omashu Road.',
  foggy_swamp: 'On the west coast: follow the Western Road west from the heartland and turn north-west onto the Swamp Trail.',
  fire_nation_capital: 'The Fire Nation is an island in the south-west: follow the Western Road to the coast and cross the Western Causeway bridge.',
  ember_island:
    'Just off the Fire Nation\'s south-west coast: cross the Western Causeway into the Fire Nation, then swim (or fly) the short channel to Ember Island.',
  southern_air_temple: 'The mountains of the south-east: take the Eastern Road south from Ba Sing Se\'s east gate, then climb the switchback trail.',
  kyoshi_island: 'The Kyoshi Warriors\' dojo on the east coast, over the hills north-east of Ba Sing Se\'s east gate.',
};

/** Where each hidden master's clue is, in words. */
const CLUE_PLACES: Record<string, string> = {
  master_hermit: 'near the Southern Air Temple\'s gate',
  master_huu: 'in Riverbend Village, by the elder\'s house',
  master_lin: 'in the Gaoling market',
};

export function seekQuestId(masterId: string): string {
  return `seek_${masterId}`;
}

export function learnQuestId(lessonId: string): string {
  return `learn_${lessonId}`;
}

export function isGuideQuest(id: string): boolean {
  return id.startsWith('seek_master_') || id.startsWith('learn_');
}

/** The clue prop that reveals a hidden master (its spot and offset), if any. */
export function clueOf(m: MasterDef): { spot: string; dx: number; dz: number; label: string; place: string } | null {
  if (!m.hidden) return null;
  const p = QUEST_PROPS.find((d) => d.flag === m.hidden!.flag && d.at.spot);
  if (!p?.at.spot) return null;
  return { spot: p.at.spot, dx: p.at.dx ?? 0, dz: p.at.dz ?? 0, label: p.label.replace(/^Read /, ''), place: CLUE_PLACES[m.id] ?? 'nearby' };
}

/** Every lesson a master teaches (the element's awakening is a step, not an ability here). */
export function lessonsOf(m: MasterDef): LessonDef[] {
  return m.lessons;
}

const elName = (m: MasterDef) => ELEMENT_INFO[m.element].name.toLowerCase();

function clueSteps(m: MasterDef): QuestStepDef[] {
  const c = clueOf(m);
  if (!c || !m.hidden) return [];
  return [
    {
      id: 'rumour',
      text: `${m.hidden.hint} The clue is ${c.place}.`,
      // One located objective: reading the clue (wherever and whenever) reveals the master; already
      // read, the step is done at once.
      objectives: [{ type: 'flag', flag: m.hidden.flag, spot: c.spot, dx: c.dx, dz: c.dz, text: `Read the ${c.label} ${c.place}` }],
    },
  ];
}

function travelStep(m: MasterDef): QuestStepDef {
  const reach: ObjectiveDef = { type: 'reach', spot: `master_${m.spot}`, x: m.fallback.x, z: m.fallback.z, radius: 130, text: `Travel to ${m.location}` };
  return { id: 'travel', text: `${m.location}. ${ROUTE_HINTS[m.region] ?? ''}`.trim(), objectives: [reach] };
}

/** All guide quests. `name` turns a technique id into its display name (the registry is filled at runtime). */
export function buildMasterGuideQuests(name: (techniqueId: string) => string): QuestDef[] {
  const out: QuestDef[] = [];
  for (const m of MASTERS) {
    out.push({
      id: seekQuestId(m.id),
      title: `Seek ${m.name}`,
      category: 'training',
      summary: `${m.name}, ${m.title}, teaches ${elName(m)}bending at ${m.location}. ${ROUTE_HINTS[m.region] ?? ''}`.trim(),
      region: m.region,
      steps: [...clueSteps(m), travelStep(m), { id: 'meet', text: `Find ${m.name} and speak with them.`, objectives: [{ type: 'talk', npc: m.id, text: `Talk to ${m.name}` }] }],
    });
    for (const l of lessonsOf(m)) {
      const tech = name(l.technique);
      const steps: QuestStepDef[] = [...clueSteps(m), travelStep(m)];
      const aw = AWAKENINGS[m.element];
      steps.push({
        id: 'awaken',
        text: `You must be able to bend ${elName(m)} first: ${m.name} can awaken it in you.`,
        any: true,
        objectives: [
          { type: 'training', master: m.id, lesson: aw.id, text: `Awaken ${elName(m)}bending with ${m.name}` },
          { type: 'element', element: m.element, text: `Bend ${elName(m)}` },
        ],
      });
      for (const r of l.requires ?? []) {
        const rl = lessonById(r);
        if (!rl) continue;
        steps.push({
          id: `prereq_${r}`,
          text: `First, ${rl.master.name} teaches “${rl.lesson.title}” (${name(rl.lesson.technique)}).`,
          any: true,
          objectives: [
            { type: 'training', master: rl.master.id, lesson: r, text: `Pass “${rl.lesson.title}”` },
            { type: 'learn', technique: rl.lesson.technique, text: `Learn ${name(rl.lesson.technique)}` },
          ],
        });
      }
      steps.push({
        id: 'lesson',
        text: `Ask ${m.name} for the lesson “${l.title}” and pass it.`,
        any: true,
        objectives: [
          { type: 'training', master: m.id, lesson: l.id, text: `Pass “${l.title}” with ${m.name}` },
          { type: 'learn', technique: l.technique, text: `Learn ${tech}` },
        ],
      });
      out.push({
        id: learnQuestId(l.id),
        title: `Learn ${tech}`,
        category: 'training',
        summary: `${m.name} (${m.title}) teaches ${tech} in the lesson “${l.title}” — ${m.location}. ${ROUTE_HINTS[m.region] ?? ''}`.trim(),
        region: m.region,
        steps,
      });
    }
  }
  return out;
}
