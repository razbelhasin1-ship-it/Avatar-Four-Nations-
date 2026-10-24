import { allTechniques } from '../../combat/CombatSystem';
import { LANDMARKS } from '../../world/WorldLayout';
import { cosmeticById } from '../../data/cosmetics';
import { clear, h } from '../dom';
import type { UIManager } from '../UIManager';
import { GameScreen } from './gsBase';
import { InventoryScreen } from './InventoryScreen';
import { JournalScreen } from './JournalScreen';
import { ensureMapRaster, mapRasterSize, MapScreen } from './map/MapScreen';
import { TechniquesScreen } from './TechniquesScreen';

/** Fallback stable (the companions module registers the real one over this id). */
class CompanionsScreen extends GameScreen {
  readonly id = 'companions';
  constructor(ui: UIManager) {
    super(ui, 'Companions', 'companions');
  }
  protected renderBody(): void {
    clear(this.body);
    const list = this.ctx.companions.bonded;
    if (!list.length) {
      this.body.append(h('p.muted', 'You have not bonded with any animals yet. Look for tracks, nests and herds in the wild — and bring the food they love.'));
      return;
    }
    for (const c of list) this.body.append(h('div.gs-card', h('h4', c.name), h('div.muted', `${c.speciesId} · bond ${Math.round(c.bond)}%`)));
  }
}

let mapScreen: MapScreen | null = null;
let characterScreen: InventoryScreen | null = null;

export function registerGameScreens(ui: UIManager): void {
  ui.registerScreen('journal', (u) => new JournalScreen(u));
  ui.registerScreen('techniques', (u) => new TechniquesScreen(u));
  ui.registerScreen('map', (u) => (mapScreen = new MapScreen(u)));
  ui.registerScreen('inventory', (u) => new InventoryScreen(u, 'inventory', 'items'));
  ui.registerScreen('companions', (u) => new CompanionsScreen(u));
  ui.registerScreen('character', (u) => (characterScreen = new InventoryScreen(u, 'character', 'wardrobe')));
  installUIDebug(ui);
}

/** window.__game.debug.ui — automation hooks for the in-game screens (tests). */
function installUIDebug(ui: UIManager): void {
  const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
  const screen = <T>(id: string): T => ui.open(id) as unknown as T;
  const api = {
    open: (id: string, arg?: unknown) => !!ui.open(id, arg),
    close: () => ui.close(),
    current: () => ui.currentScreen,
    mapReady: () => mapRasterSize(),
    /** Map centre / zoom / selection while the map is open (no re-open). */
    mapView: () => (ui.currentScreen === 'map' && mapScreen ? mapScreen.viewState() : null),
    /** Learn up to n not-yet-known slottable techniques of an element (tests). Returns their ids. */
    learnSome: (element: string, n = 3) => {
      const pr = ui.ctx.progression;
      const ids = allTechniques().filter((t) => t.element === element && (t.kind === 'ability' || t.kind === 'movement' || t.kind === 'defense') && !pr.knows(t.id)).slice(0, n).map((t) => t.id);
      for (const id of ids) pr.learn(id, 'debug', true);
      return ids;
    },
    /** Wardrobe preview turn while the character screen is open. */
    previewYaw: () => (ui.currentScreen === 'character' && characterScreen ? characterScreen.previewYaw() : null),
    /** Fast-travel points with distance from the player. */
    travelPoints: () => {
      const p = ui.ctx.player;
      return LANDMARKS.filter((l) => l.fastTravel).map((l) => ({ id: l.id, name: l.name, discovered: ui.ctx.world.discovered.has(l.id), dist: p ? Math.round(Math.hypot(l.x - p.position.x, l.z - p.position.z)) : 0 }));
    },
    ensureMap: () => ensureMapRaster(),
    /** Fast travel through the map screen's checks (refused near enemies / undiscovered). */
    travel: async (landmarkId: string) => {
      const l = LANDMARKS.find((x) => x.id === landmarkId);
      if (!l) return { ok: false, reason: 'unknown landmark' };
      const m = screen<MapScreen>('map');
      const block = m.travelBlock(l);
      if (block) {
        ui.close('map');
        return { ok: false, reason: block };
      }
      return { ok: await m.travel(l) };
    },
    /** Page coordinates of a landmark on the open map (centres it first). */
    mapPoint: (landmarkId: string) => {
      const l = LANDMARKS.find((x) => x.id === landmarkId);
      if (!l || ui.currentScreen !== 'map') return null;
      const m = ui.open('map') as unknown as MapScreen;
      m.focusOn(l.x, l.z, 2.5);
      return m.clientPointOf(l.x, l.z);
    },
    equip: (slot: number, id: string | null) => {
      const t = screen<TechniquesScreen>('techniques');
      t.equip(slot, id);
      return ui.ctx.progression.slotsFor(ui.ctx.player!.element);
    },
    wear: (id: string) => {
      const c = cosmeticById(id);
      const s = screen<InventoryScreen>('character');
      return !!c && s.wear(c);
    },
    eat: (id: string) => screen<InventoryScreen>('inventory').eat(id),
    use: (id: string) => screen<InventoryScreen>('inventory').useItem(id),
  };
  const install = () => {
    if (!w.__game) return false;
    w.__game.debug.ui = api;
    return true;
  };
  if (!install()) {
    const iv = setInterval(() => install() && clearInterval(iv), 200);
  }
}
