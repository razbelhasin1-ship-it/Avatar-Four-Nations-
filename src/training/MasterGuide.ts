import * as THREE from 'three';
import { getTechnique } from '../combat/CombatSystem';
import type { GameContext, GameSystem } from '../core/GameContext';
import { lessonById, MASTERS, masterById, type LessonDef, type MasterDef } from '../data/masters';
import { buildMasterGuideQuests, clueOf, isGuideQuest, learnQuestId, seekQuestId } from '../data/quests_masters';
import type { QuestMarker } from '../quests/QuestSystem';
import { nextWaypoint, planRoute, type RoutePoint } from '../quests/RoutePlanner';
import { getSpot } from '../world/Spots';
import { LANDMARKS, type LandmarkDef } from '../world/WorldLayout';

/**
 * Master guide (module `master_guide`, ctx.extra.get('master_guide')): finding the masters.
 *
 *  - Registers the guide quests of src/data/quests_masters.ts ("Seek <master>", "Learn <ability>")
 *    and starts/tracks them on request (Journal → Masters, the map, the Technique Library). Guides
 *    are directions, not achievements: once done they can be tracked again.
 *  - Plans the road route to whatever is tracked (src/quests/RoutePlanner.ts) for the map, and puts
 *    the next road waypoint on the compass.
 *  - Answers "where is it from here" (distance, compass direction) and "which known travel point is
 *    closest to it" for the journal and the map.
 *
 * Debug: window.__game.debug.guide.
 */

export type AbilityStatus = 'learned' | 'available' | 'locked';

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export class MasterGuide implements GameSystem {
  private ctx!: GameContext;
  private routeCache: { key: string; pts: RoutePoint[] } | null = null;
  private wp: THREE.Vector3 | null = null;
  private wpT = 0;

  init(ctx: GameContext): void {
    this.ctx = ctx;
    ctx.extra.set('master_guide', this);
    for (const q of buildMasterGuideQuests((id) => getTechnique(id)?.name ?? id)) ctx.quests.register(q);
    ctx.events.on('quest:completed', ({ questId }) => {
      // Directions, not achievements: a done guide can be tracked again (and does not clutter "Completed").
      if (isGuideQuest(questId)) ctx.quests.completed.delete(questId);
    });
    ctx.quests.addMarkerProvider(() => this.waypointMarkers());
    this.installDebug();
  }

  onSessionStart(): void {
    this.routeCache = null;
    this.wp = null;
    // Build the road graph and land mask now (behind the loading screen), not on the first track.
    planRoute({ x: 0, z: 0 }, { x: 1, z: 1 });
  }

  update(dt: number): void {
    this.wpT -= dt;
    if (this.wpT > 0) return;
    this.wpT = 0.5;
    this.wp = null;
    const p = this.ctx.player;
    const target = this.ctx.quests.trackedTarget();
    if (!p || !target) return;
    const r = this.route(target);
    const n = r ? nextWaypoint(r, { x: p.position.x, z: p.position.z }) : null;
    if (n) this.wp = new THREE.Vector3(n.x, this.ctx.world.heightAt(n.x, n.z), n.z);
  }

  // ---------------------------------------------------------------------------
  // Tracking
  // ---------------------------------------------------------------------------

  private startAndTrack(id: string): boolean {
    const q = this.ctx.quests;
    if (!q.get(id)) return false;
    if (q.isComplete(id)) q.completed.delete(id);
    if (!q.isActive(id)) q.start(id, { silent: true });
    if (!q.isActive(id)) return false;
    q.track(id);
    this.routeCache = null;
    this.wpT = 0;
    this.ctx.events.emit('ui:notify', { text: `Tracking “${q.get(id)!.title}” — follow ◆ on your compass; the map draws the road there.`, kind: 'quest', duration: 4 });
    return true;
  }

  trackMaster(masterId: string): boolean {
    return this.startAndTrack(seekQuestId(masterId));
  }

  trackLesson(lessonId: string): boolean {
    return this.startAndTrack(learnQuestId(lessonId));
  }

  /** Track the lesson that teaches a technique (a master you have met first, then the nearest). */
  trackAbility(techniqueId: string): boolean {
    const l = this.lessonFor(techniqueId);
    return l ? this.trackLesson(l.lesson.id) : false;
  }

  /** The lesson (and master) that teaches a technique, if a master teaches it. */
  lessonFor(techniqueId: string): { master: MasterDef; lesson: LessonDef } | null {
    const all = MASTERS.flatMap((m) => m.lessons.filter((l) => l.technique === techniqueId).map((lesson) => ({ master: m, lesson })));
    if (!all.length) return null;
    const q = this.ctx.quests;
    const met = all.filter((x) => q.hasFlag(`met_${x.master.id}`));
    const pool = met.length ? met : all;
    const p = this.ctx.player?.position;
    if (!p) return pool[0];
    return pool.reduce((a, b) => (this.distanceTo(b.master, p) < this.distanceTo(a.master, p) ? b : a));
  }

  /** Remove a guide from the journal (it can be tracked again any time). */
  drop(questId: string): void {
    const q = this.ctx.quests;
    if (!isGuideQuest(questId) || !q.isActive(questId)) return;
    q.active.delete(questId);
    if (q.tracked === questId) q.track(null);
    this.ctx.events.emit('quest:updated', { questId, stepId: '' });
  }

  stop(): void {
    this.ctx.quests.track(null);
  }

  /** The guide quest being tracked, if the tracked quest is one. */
  get trackedGuide(): string | null {
    const t = this.ctx.quests.tracked;
    return t && isGuideQuest(t) ? t : null;
  }

  isTracked(questId: string): boolean {
    return this.ctx.quests.tracked === questId;
  }

  // ---------------------------------------------------------------------------
  // Knowledge
  // ---------------------------------------------------------------------------

  /** Where a master stands now (their NPC, else their spot, else their fallback). */
  masterPosition(m: MasterDef): THREE.Vector3 {
    const p = this.ctx.npcs.positionOf(m.id);
    if (p) return p.clone();
    const s = getSpot(`master_${m.spot}`);
    const x = s?.x ?? m.fallback.x, z = s?.z ?? m.fallback.z;
    return new THREE.Vector3(x, s?.y ?? this.ctx.world.heightAt(x, z), z);
  }

  /** Where a hidden master's clue is (null when the master is not hidden or the clue is not placed). */
  cluePosition(m: MasterDef): THREE.Vector3 | null {
    const c = clueOf(m);
    const s = c ? getSpot(c.spot) : undefined;
    if (!c || !s) return null;
    const x = s.x + c.dx, z = s.z + c.dz;
    return new THREE.Vector3(x, s.y ?? this.ctx.world.heightAt(x, z), z);
  }

  private distanceTo(m: MasterDef, p: THREE.Vector3): number {
    const t = this.masterPosition(m);
    return Math.hypot(t.x - p.x, t.z - p.z);
  }

  /** "2.3 km south-west" from the player (or "here"). */
  where(pos: { x: number; z: number }): { meters: number; text: string } {
    const p = this.ctx.player?.position;
    if (!p) return { meters: 0, text: '' };
    const dx = pos.x - p.x, dz = pos.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < 25) return { meters: d, text: 'right here' };
    // North is −Z, east +X.
    const ang = Math.atan2(dx, -dz);
    const dir = DIRS[(Math.round(ang / (Math.PI / 4)) + 8) % 8];
    return { meters: d, text: `${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} ${dir}` };
  }

  abilityStatus(l: LessonDef): AbilityStatus {
    const ctx = this.ctx;
    if (ctx.progression.knows(l.technique) || ctx.quests.hasFlag(`lesson_${l.id}`)) return 'learned';
    if ((l.requires ?? []).some((r) => !ctx.quests.hasFlag(`lesson_${r}`))) return 'locked';
    return 'available';
  }

  /** Lessons this one waits on (titles), for the journal. */
  missing(l: LessonDef): string[] {
    return (l.requires ?? []).filter((r) => !this.ctx.quests.hasFlag(`lesson_${r}`)).map((r) => {
      const f = lessonById(r);
      return f ? `“${f.lesson.title}”` : r;
    });
  }

  /** The discovered fast-travel point nearest to a place, if it saves walking. */
  nearestTravel(pos: { x: number; z: number }): { l: LandmarkDef; meters: number } | null {
    const w = this.ctx.world;
    let best: LandmarkDef | null = null;
    let bestD = Infinity;
    for (const l of LANDMARKS) {
      if (!l.fastTravel || !w.discovered.has(l.id)) continue;
      const d = Math.hypot(l.x - pos.x, l.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    if (!best) return null;
    const p = this.ctx.player?.position;
    // Only worth it when it lands you much closer than you are.
    if (p && Math.hypot(pos.x - p.x, pos.z - p.z) < bestD + 300) return null;
    return { l: best, meters: bestD };
  }

  // ---------------------------------------------------------------------------
  // Route
  // ---------------------------------------------------------------------------

  /** Road route from the player to a point (cached while neither moves far). */
  route(to: { x: number; z: number }): RoutePoint[] | null {
    const p = this.ctx.player?.position;
    if (!p) return null;
    const key = `${Math.round(p.x / 30)},${Math.round(p.z / 30)}|${Math.round(to.x / 5)},${Math.round(to.z / 5)}`;
    if (this.routeCache?.key === key) return this.routeCache.pts;
    const pts = planRoute({ x: p.x, z: p.z }, { x: to.x, z: to.z });
    this.routeCache = { key, pts };
    return pts;
  }

  /** The route to whatever is tracked, if anything with a place is tracked. */
  trackedRoute(): RoutePoint[] | null {
    const t = this.ctx.quests.trackedTarget();
    return t ? this.route(t) : null;
  }

  private waypointMarkers(): QuestMarker[] {
    if (!this.wp || !this.ctx.session.active) return [];
    // ◇: the next stop on the way to ◆ (a plain dot would read as a compass tick).
    return [{ questId: 'route:next', title: 'Next waypoint', text: 'Follow the road', position: this.wp, tracked: false, icon: '◇', color: '#ffd76a', compass: true }];
  }

  // ---------------------------------------------------------------------------
  // Debug
  // ---------------------------------------------------------------------------

  private installDebug(): void {
    const w = window as unknown as { __game?: { debug: Record<string, unknown> } };
    const install = () => {
      if (!w.__game) return false;
      w.__game.debug.guide = {
        sys: this,
        trackMaster: (id: string) => this.trackMaster(id),
        trackLesson: (id: string) => this.trackLesson(id),
        trackAbility: (id: string) => this.trackAbility(id),
        drop: (id: string) => this.drop(id),
        tracked: () => this.ctx.quests.tracked,
        target: () => this.ctx.quests.trackedTarget()?.toArray() ?? null,
        route: () => this.trackedRoute(),
        waypoint: () => this.wp?.toArray() ?? null,
        where: (id: string) => {
          const m = masterById(id);
          return m ? { ...this.where(this.masterPosition(m)), pos: this.masterPosition(m).toArray() } : null;
        },
      };
      return true;
    };
    if (!install()) setTimeout(install, 0);
  }
}
