import {
  TICKS_PER_SECOND,
  AlphaSimSession,
  GAMEPLAY_EVENT,
  SESSION_STATE,
  SHIP_STATE,
  createRacePhysicsConfig,
} from './sim.js';

export const RACE_OUTCOME = Object.freeze({
  PLAYING: 'playing',
  WON: 'won',
  FAILED: 'failed',
});

export const FAILURE_REASON = Object.freeze({
  EXPLODED: 'exploded',
  FALLEN: 'fallen',
  OUT_OF_FUEL: 'out-of-fuel',
  OUT_OF_OXYGEN: 'out-of-oxygen',
  UNKNOWN: 'unknown',
});

const DIRTY_EVENTS = new Set([
  GAMEPLAY_EVENT.SHIP_BUMPED_WALL,
  GAMEPLAY_EVENT.SHIP_EXPLODED,
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function ticksToMilliseconds(ticks) {
  if (!Number.isSafeInteger(ticks) || ticks < 0) throw new RangeError(`invalid tick count ${ticks}`);
  return Math.round(ticks * 1000 / TICKS_PER_SECOND);
}

export function formatTicks(ticks) {
  const ms = ticksToMilliseconds(ticks);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

export function failureReasonForFrame(frame) {
  if (frame?.sessionState !== SESSION_STATE.FAILED) return null;
  switch (frame.state) {
    case SHIP_STATE.EXPLODED:
      return FAILURE_REASON.EXPLODED;
    case SHIP_STATE.FALLEN:
      return FAILURE_REASON.FALLEN;
    case SHIP_STATE.OUT_OF_FUEL:
      return FAILURE_REASON.OUT_OF_FUEL;
    case SHIP_STATE.OUT_OF_OXYGEN:
      return FAILURE_REASON.OUT_OF_OXYGEN;
    default:
      return FAILURE_REASON.UNKNOWN;
  }
}

export function recoveryMessageForFailure(reason) {
  switch (reason) {
    case FAILURE_REASON.EXPLODED:
      return 'Impact destroyed the craft. Retry with an earlier lane or jump decision.';
    case FAILURE_REASON.FALLEN:
      return 'The craft fell into the void. Retry from a stable lane before the gap.';
    case FAILURE_REASON.OUT_OF_FUEL:
      return 'Fuel reached zero. Retry with less throttle waste or a refill route.';
    case FAILURE_REASON.OUT_OF_OXYGEN:
      return 'Oxygen reached zero. Retry with a faster line or refill route.';
    default:
      return 'The run ended. Retry reconstructs a clean race session.';
  }
}

export function terminalOutcomeForFrame(frame) {
  if (frame?.sessionState === SESSION_STATE.WON) return RACE_OUTCOME.WON;
  if (frame?.sessionState === SESSION_STATE.FAILED) return RACE_OUTCOME.FAILED;
  return RACE_OUTCOME.PLAYING;
}

function summarizeEvents(events) {
  const counts = {};
  for (const event of events) counts[event] = (counts[event] ?? 0) + 1;
  return counts;
}

export function createRunRecord({ courseId, sourceKind, level, frame, raceTicks, events = [] }) {
  if (!courseId) throw new Error('run record requires a course id');
  if (!Number.isSafeInteger(raceTicks) || raceTicks < 0) throw new RangeError(`invalid race ticks ${raceTicks}`);
  const outcome = terminalOutcomeForFrame(frame);
  const failureReason = failureReasonForFrame(frame);
  const dirtyEvents = events.filter((event) => DIRTY_EVENTS.has(event));
  const record = {
    schema: 'neondrift.run.v1',
    courseId,
    sourceKind,
    levelName: level?.name ?? null,
    levelRoadIndex: level?.roadIndex ?? null,
    outcome,
    won: outcome === RACE_OUTCOME.WON,
    failed: outcome === RACE_OUTCOME.FAILED,
    failureReason,
    recoveryMessage: failureReason ? recoveryMessageForFailure(failureReason) : null,
    raceTicks,
    tickHz: TICKS_PER_SECOND,
    timeMs: ticksToMilliseconds(raceTicks),
    timeText: formatTicks(raceTicks),
    cleanRun: outcome === RACE_OUTCOME.WON && dirtyEvents.length === 0,
    row: frame?.row ?? null,
    finalState: frame?.state ?? null,
    finalSessionState: frame?.sessionState ?? null,
    events: [...events],
    eventCounts: summarizeEvents(events),
    immutable: true,
  };
  return deepFreeze(record);
}

export function createRaceSessionConfig(options = {}) {
  return deepFreeze({
    physics: createRacePhysicsConfig(options.physics ?? options.physicsConfig ?? options.tuningConfig),
  });
}

function annotateFrame(frame, raceTicks) {
  return {
    ...frame,
    raceTicks,
    raceTimeMs: ticksToMilliseconds(raceTicks),
    raceTimeText: formatTicks(raceTicks),
  };
}

export class RaceSessionModel {
  constructor(level, options = {}) {
    this.level = level;
    this.courseId = options.courseId ?? String(level?.roadIndex ?? 'unknown');
    this.sourceKind = options.sourceKind ?? 'unknown';
    this.config = createRaceSessionConfig(options);
    this.session = new AlphaSimSession(level, { physicsConfig: this.config.physics });
    this.raceTicks = 0;
    this.events = [];
    this.controls = [];
    this.terminalRecord = null;
    this.restartCount = 0;
    this.initialSnapshot = cloneData(this.snapshot());
  }

  tick(controls = {}) {
    if (this.terminalRecord) {
      return { ...annotateFrame(this.session.snapshot(), this.raceTicks), events: [], frozen: true };
    }
    const frame = this.session.tick(controls);
    this.raceTicks += 1;
    this.events.push(...(frame.events ?? []));
    this.controls.push({ ...(frame.controls ?? controls) });
    const annotated = annotateFrame(frame, this.raceTicks);
    if (annotated.sessionState !== SESSION_STATE.PLAYING) {
      this.terminalRecord = createRunRecord({
        courseId: this.courseId,
        sourceKind: this.sourceKind,
        level: this.level,
        frame: annotated,
        raceTicks: this.raceTicks,
        events: this.events,
      });
    }
    return annotated;
  }

  restart() {
    this.session = new AlphaSimSession(this.level, { physicsConfig: this.config.physics });
    this.raceTicks = 0;
    this.events = [];
    this.controls = [];
    this.terminalRecord = null;
    this.restartCount += 1;
    this.initialSnapshot = cloneData(this.snapshot());
    return this.snapshot();
  }

  snapshot() {
    return annotateFrame(this.session.snapshot(), this.raceTicks);
  }

  terminalRunRecord() {
    return this.terminalRecord;
  }

  controlHistory() {
    return cloneData(this.controls);
  }
}

export function createConfiguredRaceSession(level, options = {}) {
  return new RaceSessionModel(level, options);
}
