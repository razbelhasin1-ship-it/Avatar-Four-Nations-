import type { DialogueAction, DialogueCondition, DialogueDef } from '../npc/NPCTypes';

/**
 * Dialogues for side-quest givers and city life (src/data/npcs_life.ts).
 * Masters and merchants talk through code (src/training, src/shop).
 */

function giver(
  id: string,
  quest: string,
  o: { offer: string; accept: string; acceptActions?: DialogueAction[]; decline?: string; active: string; thanks: string; locked?: { condition: DialogueCondition; text: string } },
): DialogueDef {
  const start: DialogueDef['start'] = [
    { node: 'thanks', condition: { questComplete: quest } },
    { node: 'active', condition: { questActive: quest } },
  ];
  if (o.locked) start.push({ node: 'locked', condition: o.locked.condition });
  start.push({ node: 'offer' });
  return {
    id,
    start,
    nodes: {
      offer: {
        text: o.offer,
        choices: [
          { text: o.accept, end: true, actions: [{ type: 'startQuest', quest }, ...(o.acceptActions ?? [])] },
          { text: o.decline ?? 'Not right now.', end: true },
        ],
      },
      active: { text: o.active, end: true },
      thanks: { text: o.thanks, end: true },
      ...(o.locked ? { locked: { text: o.locked.text, end: true } } : {}),
    },
  };
}

/** Flavour dialogue: first matching line wins (conditions give hints & reactions). */
function chatter(id: string, lines: Array<{ text: string; condition?: DialogueCondition }>): DialogueDef {
  return {
    id,
    start: lines.map((l, i) => ({ node: `l${i}`, condition: l.condition })),
    nodes: Object.fromEntries(lines.map((l, i) => [`l${i}`, { text: l.text, end: true }])),
  };
}

export const LIFE_DIALOGUES: DialogueDef[] = [
  // ------------------------------------------------------------------ givers
  giver('dlg_qg_bss_fen', 'sq_bss_grocer', {
    offer: 'Three customers asked for cabbages this morning and I have none! The farm cart is late — again. Could you bring me three? Bao across the square sells them, but he will not sell to ME.',
    accept: 'I\'ll bring you three cabbages.',
    active: 'Three cabbages! Bao\'s stall is right there — tell him it is for a friend. Do not tell him which friend.',
    thanks: 'Wonderful! My customers will be thrilled. Well — less angry. Here, for your trouble.',
  }),
  giver('dlg_qg_omashu_cabbage', 'sq_cabbage_cart', {
    offer: 'MY CABBAGES! The cart hit a rut right at the gate and now they are rolling all over Omashu! Please, help me gather them before someone bends them into soup!',
    accept: 'I\'ll round them up.',
    active: 'Five cabbages! I counted! They went that way — and that way — and somehow that way too.',
    thanks: 'You saved them! All five! Take some of my finest — no, not those, those are rolling again.',
  }),
  giver('dlg_qg_nwt_messenger', 'sq_letter', {
    offer: 'The chief needs this letter carried to Chief Hakoda in the Southern Water Tribe, and my canoe has a hole the size of a seal. You travel — would you carry it?',
    accept: 'I\'ll deliver it.',
    acceptActions: [{ type: 'giveItem', item: 'sealed_letter' }],
    active: 'The letter goes to Chief Hakoda, in the south. Do not open it. Probably nothing exciting. Probably.',
    thanks: 'Hakoda got it? Good. The north and the south are one tribe again, one letter at a time.',
  }),
  {
    id: 'dlg_qg_swt_chief',
    start: [{ node: 'thanks', condition: { questComplete: 'sq_letter' } }, { node: 'hello' }],
    nodes: {
      hello: { text: 'Welcome to the Southern Water Tribe, traveller. We are few, but our door is open — and our fires are warm.', end: true },
      thanks: { text: 'A letter from the north... so they still remember us. Thank you, Avatar. Take this — it was my mother\'s, and she would want it worn by someone who crosses oceans.', end: true },
    },
  },
  giver('dlg_qg_fn_child', 'sq_turtleduck', {
    offer: 'Have you seen Mister Waddles? He is my turtle-duck. He was right HERE and now he is not and the pond is very big!',
    accept: 'I\'ll find Mister Waddles.',
    active: 'He is small and green and grumpy. Like my uncle! But a duck.',
    thanks: 'MISTER WADDLES! You found him! Here — you can have my bread crumbs. Not all of them. Okay, all of them.',
  }),
  giver('dlg_qg_fn_sage', 'sq_braziers', {
    offer: 'The four braziers of the court have gone cold for the first time in a century. The Sages say only the Avatar\'s fire may relight them. Will you?',
    accept: 'I will light them.',
    active: 'Four braziers in the court. Strike each with firebending — Agni will do the rest.',
    thanks: 'The court is warm again. The Sages have set aside robes for you — wear them, and the palace guards will bow.',
    locked: { condition: { cannotBend: 'fire' }, text: 'The sacred braziers went cold... but only a firebender could relight them. Come back when the fire answers you.' },
  }),
  giver('dlg_qg_air_bellkeeper', 'sq_bells', {
    offer: 'These bells were cast to sing with the wind. No one has rung them since the old days. Would you wake them with your airbending?',
    accept: 'I\'ll ring them.',
    active: 'Three bells around the pavilion. Do not strike them — breathe on them. With feeling.',
    thanks: 'Did you hear that? The whole mountain listened. Take this cape — it catches the wind, like the bells.',
    locked: { condition: { cannotBend: 'air' }, text: 'These bells only answer to the wind. When you can bend the air, come back to me.' },
  }),
  giver('dlg_qg_air_bisonkeeper', 'sq_peaches', {
    offer: 'The herd is hungry and my knees are old. Gather six moon peaches from the meadow trees for me? And then — I think one of them likes you.',
    accept: 'I\'ll gather the peaches.',
    active: 'Six moon peaches. And when you meet a bison, go slowly. Hold out a peach. They decide, not you.',
    thanks: 'A bison chose you! The first in a long time. Treat them gently and they will carry you anywhere.',
  }),
  giver('dlg_qg_nwt_oasis', 'sq_spirit_oasis', {
    offer: 'The Moon and Ocean spirits circle each other in the oasis behind the palace. The Avatar should sit with them at least once. Will you go?',
    accept: 'I\'ll visit the Spirit Oasis.',
    active: 'Through the west palace garden and up the lantern-lit crevasse in the cliff. The oasis is warm, even here. Sit by the koi and listen.',
    thanks: 'You felt them, did you not? Push and pull. Take this dress — wear it under the full moon.',
  }),
  giver('dlg_qg_tundra_scout', 'sq_ice_caves', {
    offer: 'Three nights now I have seen a light deep in the glacier caves, in the mountains west of the city. Hunters went in and came back talking about "voices in the ice". Will you look?',
    accept: 'I\'ll investigate the caves.',
    active: 'Out through the Glacier Pass, then west along the mountain slopes behind the great ice cliffs. Take a torch. Or be a firebender.',
    thanks: 'A crystal! That is what glowed? Spirits... keep it. Better around your neck than in that cave.',
  }),
  giver('dlg_qg_misty_scholar', 'sq_buried_library', {
    offer: 'I am Professor Zei, of Ba Sing Se University. Somewhere under these dunes lies the library of a knowledge spirit. Bring me proof — a single scroll — and my colleagues will finally stop laughing.',
    accept: 'I\'ll find the library.',
    active: 'Southeast across the dunes. Look for a tower top poking out of the sand. Mind the owl.',
    thanks: 'A real scroll from the library! Oh, they will NOT be laughing now. Here — copper for your trouble, and a scroll of my own.',
  }),
  giver('dlg_qg_riverbend_elder', 'sq_bandits', {
    offer: 'Bandits on every road between here and Gaoling. They take our rice, our carts, our patience. We are farmers, not fighters. You are... clearly not a farmer.',
    accept: 'I\'ll deal with the bandits.',
    active: 'Their camps sit along the roads. Four of them taught a lesson ought to scare off the rest.',
    thanks: 'The roads are quiet again. Riverbend will remember you — we will even name a rice paddy after you.',
  }),
  giver('dlg_qg_kyoshi_captain', 'sq_kyoshi_fans', {
    offer: 'I am Suki, captain of the Kyoshi Warriors. The storm blew three of our war fans out of the dojo. A warrior without her fan is just... a person in makeup. Help us find them?',
    accept: 'I\'ll find your fans.',
    active: 'Three golden fans. Check around the shrine and the village paths.',
    thanks: 'All three! You have the eyes of a warrior. Wear our armour with pride — you have earned it.',
  }),
  giver('dlg_qg_ember_playwright', 'sq_ember_script', {
    offer: 'Disaster! Catastrophe! The wind stole three pages of "Love Amongst the Dragons" and the curtain rises at sundown! You — find them!',
    accept: 'I\'ll find the pages.',
    active: 'Three pages! Act two! The scene with the dragon AND the other dragon!',
    thanks: 'The play is saved! It is still terrible, of course, but it is COMPLETE. Take this — a Pai Sho tile a mysterious old man left in the audience.',
  }),
  giver('dlg_qg_air_pilgrim', 'sq_pilgrim', {
    offer: 'Forty years since I climbed to the temple. My legs remember the way; my lungs do not. Will you walk the trail with me, young one?',
    accept: 'Let\'s climb together.',
    active: 'Go on ahead — I know a bison who owes me a favour. I will meet you at the top.',
    thanks: 'We made it. Well — you made it, I cheated. Thank you for the company on the trail.',
  }),
  {
    id: 'dlg_qg_air_pilgrim_top',
    start: [{ node: 'top' }],
    nodes: { top: { text: 'Ha! There you are. The bison was faster, but you were braver. Sit — the view from up here is worth every switchback.', end: true } },
  },
  // ------------------------------------------------------------------ life
  chatter('dlg_life_nwt', [
    { text: 'Master Siku is impossible to please. My cousin trained with him for six years and got one nod.', condition: { notFlag: 'met_master_siku' } },
    { text: 'Healer Yugoda says there is water inside every living thing. Even the fish? ESPECIALLY the fish, she says.', condition: { notFlag: 'clue_huu' } },
    { text: 'The moon is bright tonight. The waterbenders will be practising late.' },
  ]),
  chatter('dlg_life_swt', [
    { text: 'Hunter Akka can hit a seal-post from forty paces with a shard of ice. I have seen it. The seal-post has not recovered.', condition: { notFlag: 'met_master_akka' } },
    { text: 'The south is small, but nobody here goes hungry while Gran-Gran has sea prunes.' },
  ]),
  chatter('dlg_life_bss', [
    { text: 'You want to see real earthbending? Go to Gaoling and watch the Earth Rumble. There is a blind girl there... nobody has ever beaten her.', condition: { notFlag: 'clue_lin' } },
    { text: 'The Stone Fist Dojo takes students from every ring. Master Lien does not care who your father is.', condition: { notFlag: 'met_master_lien' } },
    { text: 'There is no war in Ba Sing Se. ...Say it with me. There is no war in Ba Sing Se.' },
  ]),
  chatter('dlg_life_gaoling', [
    { text: 'The Earth Rumble poster? It is by the market stalls. Read it — the Blind Bandit is the best show in town.', condition: { notFlag: 'clue_lin' } },
    { text: 'The Beifong estate is beautiful. Very, very beautiful. Also very, very guarded.' },
  ]),
  chatter('dlg_life_riverbend', [
    { text: 'Old Tam keeps a journal some swamp man left behind. It is over by the elder\'s house, if you want a read. Smells like mud.', condition: { notFlag: 'clue_huu' } },
    { text: 'Bandits again on the Gaoling road. Elder Bo says someone ought to do something.', condition: { questNotStarted: 'sq_bandits' } },
    { text: 'Best rice in the Earth Kingdom, grown right here. Do not let Gaoling tell you otherwise.' },
  ]),
  chatter('dlg_life_omashu', [
    { text: 'King Bumo challenged a visitor to a riddle contest yesterday. The visitor is still thinking. The king is having lunch.', condition: { notFlag: 'met_master_bumo' } },
    { text: 'Ride the mail chutes if you dare. The king does it every morning. He says it is "good for the digestion".' },
  ]),
  chatter('dlg_life_kyoshi', [
    { text: 'Avatar Kyoshi raised this whole island from the mainland. Oyagi keeps her earth forms alive at the dojo.', condition: { notFlag: 'met_master_oyagi' } },
    { text: 'Do not swim in the cove. The unagi is very real and very hungry.' },
  ]),
  chatter('dlg_life_misty', [
    { text: 'The desert eats the careless. The scholar by the cantina keeps talking about a library under the sand. I say let it stay buried.' },
  ]),
  chatter('dlg_life_fn', [
    { text: 'Master Jeong drills his cadets in the Agni Kai Arena every morning. You can hear the gong from the palace.', condition: { notFlag: 'met_master_jeong' } },
    { text: 'The Sun Warriors died out centuries ago. That is what the history scrolls say, anyway.', condition: { notFlag: 'met_master_ahkon' } },
    { text: 'Long live the Fire Lord. And long live the turtle-ducks — they are much nicer.' },
  ]),
  chatter('dlg_life_ember', [
    { text: 'There is an old retired general who runs a tea house on the hill. Best jasmine on the island, and he will tell you a proverb whether you want one or not.', condition: { notFlag: 'met_master_iro' } },
    { text: 'Ember Island: where the Fire Nation pretends it is on holiday.' },
  ]),
  chatter('dlg_life_air', [
    { text: 'Sister Iio once rode an air scooter around the whole summit without touching the ground. Twice. She says the second time does not count because she was showing off.', condition: { notFlag: 'met_master_iio' } },
    { text: 'The old monks say there is a hermit beyond the east wall. Nobody has seen him in years, but someone keeps leaving teacups on the ledge.', condition: { notFlag: 'clue_hermit' } },
    { text: 'The wind is gentle today. A good day for flying.' },
  ]),
  chatter('dlg_life_child', [
    { text: 'Are you REALLY the Avatar? Can you do the thing? The thing with all the elements? Do the thing!', condition: { sphere: true } },
    { text: 'Watch this! ...Okay, I cannot bend anything yet. But one day!' },
  ]),
  chatter('dlg_life_guard_water', [{ text: 'Move along. The city is safe under the moon\'s watch.' }]),
  chatter('dlg_life_guard_earth', [{ text: 'Keep your papers ready, citizen. Ba Sing Se\'s walls have never fallen.' }]),
  chatter('dlg_life_guard_fire', [{ text: 'Stand aside. Palace business.' }]),
  chatter('dlg_life_guard_air', [{ text: 'Peace be with you, traveller.' }]),
  chatter('dlg_life_guard_neutral', [{ text: 'Keep moving, stranger.' }]),
];
