import { Result, fail, ok } from '../../core/result';
import { maxGroupsPerDay } from '../business/buildings';
import { COST_OF_GOODS } from '../business/fnb';
import { Course } from '../course/course';
import type { Game, System } from '../game';
import { registerSaveable } from '../saveRegistry';
import { TurfSettings, turfSettings } from '../turf/turf';
import { ratingOf } from './courseRating';
import { award } from './milestones';
import { reputation } from './reputation';
import { conditionScore } from './scores';
import { isUnlocked } from './unlocks';

export type EventKind = 'corporateOuting' | 'clubChampionship' | 'charityScramble' | 'regionalAmateur' | 'proTour';

export interface EventDef {
  label: string;
  minHoles: number;
  /** course rating at least this (0: any) */
  minRating: number;
  minReputation: number;
  minCondition: number;
  days: number;
  players: number;
  entryFee: number;
  sponsorship: number;
  /** reputation stars gained at a perfect-condition event */
  prestige: number;
  spectatorsPerDay: number;
  /** F&B spend per player and spectator per day */
  fnbPerHead: number;
}

export const EVENTS: Record<EventKind, EventDef> = {
  corporateOuting: { label: 'Corporate outing', minHoles: 9, minRating: 0, minReputation: 2, minCondition: 50, days: 1, players: 60, entryFee: 140, sponsorship: 0, prestige: 0.05, spectatorsPerDay: 0, fnbPerHead: 45 },
  clubChampionship: { label: 'Club championship', minHoles: 18, minRating: 0, minReputation: 0, minCondition: 70, days: 1, players: 48, entryFee: 60, sponsorship: 2_000, prestige: 0.1, spectatorsPerDay: 40, fnbPerHead: 20 },
  charityScramble: { label: 'Charity scramble', minHoles: 9, minRating: 0, minReputation: 2.5, minCondition: 55, days: 1, players: 72, entryFee: 90, sponsorship: 3_000, prestige: 0.12, spectatorsPerDay: 30, fnbPerHead: 25 },
  regionalAmateur: { label: 'Regional amateur', minHoles: 18, minRating: 70, minReputation: 3.5, minCondition: 75, days: 2, players: 96, entryFee: 150, sponsorship: 25_000, prestige: 0.25, spectatorsPerDay: 400, fnbPerHead: 18 },
  proTour: { label: 'Pro tour event', minHoles: 18, minRating: 72, minReputation: 4.5, minCondition: 85, days: 4, players: 144, entryFee: 0, sponsorship: 450_000, prestige: 0.6, spectatorsPerDay: 4_000, fnbPerHead: 15 },
};
export const EVENT_KINDS = Object.keys(EVENTS) as EventKind[];
/** Tournament set-up on event days: fast greens, punishing rough. */
export const TOURNAMENT_STIMP = 11.5;
export const TOURNAMENT_ROUGH_MM = 75;
/** Offers come this many days ahead, and lapse after a week. */
export const LEAD_DAYS = 14;
export const OFFER_DAYS = 7;
/** Spectators who come by car, per car. */
const PER_CAR = 2.5;

export interface GolfEvent {
  id: number;
  kind: EventKind;
  courseId: number;
  /** first day of the event */
  day: number;
  status: 'offered' | 'accepted' | 'declined' | 'expired' | 'done' | 'cancelled';
  offeredDay: number;
  /** the course's turf settings before the tournament set-up */
  saved?: Partial<TurfSettings>;
  result?: { revenue: number; prestige: number; condition: number };
}

/** Why a course can't host this event, or null when it can. */
export function eventBlocker(g: Game, course: Course, kind: EventKind): string | null {
  const d = EVENTS[kind];
  const open = course.holes.filter(h => h.state === 'open').length;
  if (kind === 'proTour' && !isUnlocked(g, 'proTour')) return 'Pro tour events need a 4-star, top-3 course';
  if (open < d.minHoles) return `Needs ${d.minHoles} open holes`;
  if (d.minRating && (ratingOf(g, course.id)?.courseRating ?? 0) < d.minRating) return `Needs a course rating of ${d.minRating}`;
  if (reputation(g, course.id).overall < d.minReputation) return `Needs a ${d.minReputation}-star reputation`;
  if (conditionScore(g, course.id) < d.minCondition) return `Needs course condition of ${d.minCondition}`;
  return null;
}

export function eventOn(g: Game, courseId: number, day: number): GolfEvent | undefined {
  return g.golfEvents.find(e => e.courseId === courseId && (e.status === 'accepted' || e.status === 'done') && day >= e.day && day < e.day + EVENTS[e.kind].days);
}

function hash01(a: number, b: number, c: number): number {
  return ((Math.imul(a ^ Math.imul(b + c * 7919, 0x9e3779b1), 0x85ebca6b) >>> 8) & 0xffff) / 65536;
}

/** Make an offer (also used by tests). */
export function offerEvent(g: Game, courseId: number, kind: EventKind, day = g.day + LEAD_DAYS): GolfEvent {
  const e: GolfEvent = { id: g.nextEventId++, kind, courseId, day, status: 'offered', offeredDay: g.day };
  g.golfEvents.push(e);
  const course = g.courses.get(courseId);
  g.notify('info', `${EVENTS[kind].label} request for ${course?.name ?? 'your course'} on day ${day} — accept or decline in Events`);
  return e;
}

function clashes(g: Game, courseId: number, day: number, days: number, except?: number): boolean {
  return g.golfEvents.some(e => e.id !== except && e.courseId === courseId && e.status === 'accepted' && day < e.day + EVENTS[e.kind].days && e.day < day + days);
}

export function acceptEvent(g: Game, id: number): Result<GolfEvent> {
  const e = g.golfEvents.find(x => x.id === id);
  if (!e || e.status !== 'offered') return fail('That offer is no longer open');
  const course = g.courses.get(e.courseId);
  if (!course) return fail('No such course');
  const why = eventBlocker(g, course, e.kind);
  if (why) return fail(why);
  if (clashes(g, e.courseId, e.day, EVENTS[e.kind].days, e.id)) return fail('Another event is booked on those days');
  // golfers already booked for those days are moved off the tee sheet
  for (let d = e.day; d < e.day + EVENTS[e.kind].days; d++) g.groups = g.groups.filter(x => !(x.courseId === e.courseId && x.day === d && !x.started));
  e.status = 'accepted';
  return ok(e);
}

export function declineEvent(g: Game, id: number): Result {
  const e = g.golfEvents.find(x => x.id === id);
  if (!e || e.status !== 'offered') return fail('That offer is no longer open');
  e.status = 'declined';
  return ok(undefined);
}

/** Tee times on an event day belong to the event: hold every slot. */
export function blockTeeSheet(g: Game, courseId: number): boolean {
  if (!eventOn(g, courseId, g.day)) return false;
  const sheet = g.teeSheets.get(courseId);
  if (sheet) sheet.reserve(g.day, sheet.slots(g.day, 1).length + 200, sheet.firstTee, 1);
  return true;
}

/** Event morning: tournament set-up, takings, crowds and the prestige the day earns. */
function runEventDay(g: Game, e: GolfEvent): void {
  const d = EVENTS[e.kind];
  const first = g.day === e.day, last = g.day === e.day + d.days - 1;
  const course = g.courses.get(e.courseId);
  if (!course) { e.status = 'cancelled'; return; }
  if (first) {
    const s = turfSettings(g, e.courseId);
    e.saved = { greenStimpTarget: s.greenStimpTarget, roughMowMm: s.roughMowMm };
    g.turf.settings.set(e.courseId, { ...s, greenStimpTarget: TOURNAMENT_STIMP, roughMowMm: TOURNAMENT_ROUGH_MM });
    const takings = d.players * d.entryFee + d.sponsorship;
    if (takings) g.ledger.earn(takings, 'events', g.day, e.courseId);
    e.result = { revenue: takings, prestige: 0, condition: 0 };
    g.notify('info', `${d.label} under way at ${course.name}`);
    e.status = 'done';
  }
  // the crowd: food and drink, and parking
  const cars = maxGroupsPerDay(g, e.courseId);
  const spectators = d.spectatorsPerDay;
  const parked = Math.min(spectators, Math.max(0, cars * PER_CAR));
  const heads = d.players + parked;
  const fnb = heads * d.fnbPerHead;
  if (fnb) { g.ledger.earn(fnb, 'fnb', g.day, e.courseId); g.ledger.charge(fnb * COST_OF_GOODS, 'supplies', g.day, e.courseId); }
  if (e.result) e.result.revenue += fnb;
  const turnedAway = spectators - parked;
  if (turnedAway > 0) g.notify('warn', `${Math.round(turnedAway)} spectators couldn't park — build more parking for big events`);
  if (last && e.result) {
    // prestige: a well-presented course gains, a scruffy one loses face; a packed car park costs a little
    const cond = conditionScore(g, e.courseId);
    let gain = d.prestige * Math.max(-0.5, Math.min(1.2, (cond - d.minCondition + 10) / 25));
    if (spectators && turnedAway / spectators > 0.3) gain -= d.prestige * 0.2;
    e.result.prestige = Math.round(gain * 100) / 100;
    e.result.condition = Math.round(cond);
    g.repState.bonuses.push({ courseId: e.courseId, day: g.day, stars: e.result.prestige });
    const saved = e.saved;
    if (saved) g.turf.settings.set(e.courseId, { ...turfSettings(g, e.courseId), ...saved });
    if (e.kind === 'clubChampionship') award(g, 'clubChampionship');
    g.notify(gain >= 0 ? 'info' : 'bad', `${d.label} finished: ${gain >= 0 ? '+' : ''}${e.result.prestige.toFixed(2)} reputation (condition ${e.result.condition})`);
  }
}

export const eventSystem: System = {
  name: 'events',
  onDay(g) {
    for (const e of g.golfEvents) {
      if (e.status === 'offered' && (g.day - e.offeredDay >= OFFER_DAYS || g.day >= e.day)) e.status = 'expired';
      if ((e.status === 'accepted' || e.status === 'done') && g.day >= e.day && g.day < e.day + EVENTS[e.kind].days) runEventDay(g, e);
    }
    // weekly: maybe a new request for each course that can host something
    if ((g.day - 1) % 7 === 3) {
      for (const c of g.courses.list) {
        if (g.golfEvents.some(e => e.courseId === c.id && e.status === 'offered')) continue;
        const ok = EVENT_KINDS.filter(k => !eventBlocker(g, c, k));
        if (!ok.length || hash01(c.id, g.day, 61) >= 0.45) continue;
        // grander events are rarer
        const kind = ok[Math.floor(hash01(c.id, g.day, 62) * ok.length * 0.999)]!;
        const day = g.day + LEAD_DAYS;
        if (!clashes(g, c.id, day, EVENTS[kind].days)) offerEvent(g, c.id, kind, day);
      }
    }
    g.golfEvents = g.golfEvents.filter(e => g.day - e.day < 400 || e.status === 'accepted');
  },
};

registerSaveable({
  key: 'golfEvents',
  save: g => ({ list: g.golfEvents, next: g.nextEventId }),
  load: (g, d) => { const s = d as { list: GolfEvent[]; next: number }; g.golfEvents = s.list ?? []; g.nextEventId = s.next ?? 1; },
});
