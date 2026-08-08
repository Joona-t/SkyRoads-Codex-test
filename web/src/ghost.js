import {
  CONTENT_MANIFEST,
  getRivalEntry,
  getRivalTuningConfig,
} from './content-manifest.js';
import { RACE_OUTCOME, createConfiguredRaceSession } from './race-session.js';
import { SESSION_STATE, TICKS_PER_SECOND, createRacePhysicsConfig } from './sim.js';

export const CONTROL_STREAM_SCHEMA = 'neondrift.controls.v1';
export const OWN_BEST_GHOST_SCHEMA = 'neondrift.own-best-ghost.v1';
export const CONTROL_STREAM_LIMIT_BYTES = 32768;
export const GHOST_PAYLOAD_LIMIT_BYTES = 32768;

const HASH_RE = /^fnv1a32:[0-9a-f]{8}$/;
const NEUTRAL_CONTROLS = Object.freeze({ turn: 0, accel: 0, jump: false });

const RIVAL_RUN_SEGMENTS = Object.freeze({
  'run-rival-mara-training-724': Object.freeze([
    { ticks: 120, turn: 0, accel: 0, jump: false },
    { ticks: 300, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: 0, accel: 1, jump: true },
    { ticks: 284, turn: 0, accel: 1, jump: false },
  ]),
  'run-rival-ion-training-644': Object.freeze([
    { ticks: 40, turn: 0, accel: 0, jump: false },
    { ticks: 300, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: 0, accel: 1, jump: true },
    { ticks: 284, turn: 0, accel: 1, jump: false },
  ]),
  'run-rival-vela-handling-845': Object.freeze([
    { ticks: 120, turn: 0, accel: 0, jump: false },
    { ticks: 210, turn: 0, accel: 1, jump: false },
    { ticks: 10, turn: -1, accel: 1, jump: false },
    { ticks: 80, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: 1, accel: 1, jump: false },
    { ticks: 150, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: -1, accel: 1, jump: false },
    { ticks: 235, turn: 0, accel: 1, jump: false },
  ]),
  'run-rival-noor-handling-775': Object.freeze([
    { ticks: 50, turn: 0, accel: 0, jump: false },
    { ticks: 210, turn: 0, accel: 1, jump: false },
    { ticks: 10, turn: -1, accel: 1, jump: false },
    { ticks: 80, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: 1, accel: 1, jump: false },
    { ticks: 150, turn: 0, accel: 1, jump: false },
    { ticks: 20, turn: -1, accel: 1, jump: false },
    { ticks: 235, turn: 0, accel: 1, jump: false },
  ]),
  'run-rival-sable-jump-818': Object.freeze([
    { ticks: 60, turn: 0, accel: 0, jump: false },
    { ticks: 250, turn: 0, accel: 1, jump: false },
    { ticks: 70, turn: 0, accel: 1, jump: true },
    { ticks: 438, turn: 0, accel: 1, jump: false },
  ]),
  'run-rival-cipher-jump-704': Object.freeze([
    { ticks: 250, turn: 0, accel: 1, jump: false },
    { ticks: 70, turn: 0, accel: 1, jump: true },
    { ticks: 384, turn: 0, accel: 1, jump: false },
  ]),
});

const textEncoder = new TextEncoder();

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

export function byteLength(value) {
  return textEncoder.encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

function canonicalize(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function fnv1a32(value) {
  const input = typeof value === 'string' ? value : stableJson(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}

export function hashCourse(level) {
  return fnv1a32({
    version: level?.version,
    roadIndex: level?.roadIndex,
    world: level?.world,
    gravity: level?.gravity,
    fuel: level?.fuel,
    oxygen: level?.oxygen,
    length: level?.length,
    columns: level?.columns,
    start: level?.start,
    constants: level?.constants,
    cells: level?.cells,
  });
}

export function hashTuningConfig(tuningConfig) {
  return fnv1a32(createRacePhysicsConfig(tuningConfig));
}

function safeControlValue(value, name) {
  if (!Number.isSafeInteger(value) || value < -1 || value > 1) {
    throw new Error(`invalid control ${name}`);
  }
  return value;
}

function normalizeSegment(segment) {
  const source = Array.isArray(segment)
    ? { ticks: segment[0], turn: segment[1], accel: segment[2], jump: segment[3] }
    : segment;
  if (!source || typeof source !== 'object') throw new Error('segment must be an object or tuple');
  const ticks = source.ticks;
  if (!Number.isSafeInteger(ticks) || ticks <= 0 || ticks > 10000) {
    throw new Error('segment has invalid ticks');
  }
  const rawJump = source.jump ?? false;
  if (![true, false, 0, 1].includes(rawJump)) throw new Error('segment has invalid jump');
  return {
    ticks,
    turn: safeControlValue(source.turn ?? 0, 'turn'),
    accel: safeControlValue(source.accel ?? 0, 'accel'),
    jump: rawJump === true || rawJump === 1,
  };
}

function sameControls(left, right) {
  return left.turn === right.turn && left.accel === right.accel && left.jump === right.jump;
}

export function controlsToSegments(controls) {
  if (!Array.isArray(controls) || controls.length === 0) throw new Error('controls must be a non-empty array');
  const segments = [];
  for (const entry of controls) {
    const normalized = normalizeSegment({
      ticks: 1,
      turn: entry?.turn ?? 0,
      accel: entry?.accel ?? 0,
      jump: entry?.jump ?? false,
    });
    const previous = segments.at(-1);
    if (previous && previous.ticks < 10000 && sameControls(previous, normalized)) previous.ticks += 1;
    else segments.push(normalized);
  }
  return segments;
}

function normalizeStreamInput(input) {
  const courseId = input?.courseId;
  const courseHash = input?.courseHash;
  const tuningConfigId = input?.tuningConfigId;
  const tuningConfigHash = input?.tuningConfigHash;
  if (typeof courseId !== 'string' || courseId.length === 0) throw new Error('stream needs course id');
  if (!HASH_RE.test(courseHash)) throw new Error('stream needs course hash');
  if (typeof tuningConfigId !== 'string' || tuningConfigId.length === 0 || tuningConfigId.length > 96) {
    throw new Error('stream needs tuning config id');
  }
  if (!HASH_RE.test(tuningConfigHash)) throw new Error('stream needs tuning config hash');
  const segments = (input.controls ? controlsToSegments(input.controls) : input.segments?.map(normalizeSegment)) ?? [];
  if (!Array.isArray(segments) || segments.length === 0 || segments.length > 4096) {
    throw new Error('stream has invalid segment count');
  }
  const totalTicks = segments.reduce((sum, segment) => sum + segment.ticks, 0);
  if (!Number.isSafeInteger(totalTicks) || totalTicks <= 0 || totalTicks > 20000) {
    throw new Error('stream has invalid total ticks');
  }
  return { courseId, courseHash, tuningConfigId, tuningConfigHash, segments, totalTicks };
}

export function encodeControlStream(input) {
  const stream = normalizeStreamInput(input);
  const encoded = JSON.stringify({
    s: CONTROL_STREAM_SCHEMA,
    hz: TICKS_PER_SECOND,
    c: stream.courseId,
    ch: stream.courseHash,
    tc: stream.tuningConfigId,
    th: stream.tuningConfigHash,
    n: stream.totalTicks,
    r: stream.segments.map((segment) => [
      segment.ticks,
      segment.turn,
      segment.accel,
      segment.jump ? 1 : 0,
    ]),
  });
  if (byteLength(encoded) > CONTROL_STREAM_LIMIT_BYTES) {
    throw new Error('control stream exceeds byte limit');
  }
  return encoded;
}

function fail(reason, detail = null) {
  return Object.freeze({ ok: false, reason, detail, stream: null });
}

export function decodeControlStream(encoded, expected = {}) {
  if (typeof encoded !== 'string') return fail('not-string');
  if (byteLength(encoded) > CONTROL_STREAM_LIMIT_BYTES) return fail('oversize');
  let parsed;
  try {
    parsed = JSON.parse(encoded);
  } catch (error) {
    return fail('invalid-json', error.message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return fail('invalid-root');
  if (parsed.s !== CONTROL_STREAM_SCHEMA) return fail('invalid-schema');
  if (parsed.hz !== TICKS_PER_SECOND) return fail('invalid-tick-rate');
  try {
    const segments = parsed.r?.map(normalizeSegment) ?? [];
    const totalTicks = segments.reduce((sum, segment) => sum + segment.ticks, 0);
    if (parsed.n !== totalTicks) return fail('tick-count-mismatch');
    const stream = normalizeStreamInput({
      courseId: parsed.c,
      courseHash: parsed.ch,
      tuningConfigId: parsed.tc,
      tuningConfigHash: parsed.th,
      segments,
    });
    if (expected.courseId && stream.courseId !== expected.courseId) return fail('course-mismatch');
    if (expected.courseHash && stream.courseHash !== expected.courseHash) return fail('course-hash-mismatch');
    if (expected.tuningConfigId && stream.tuningConfigId !== expected.tuningConfigId) return fail('tuning-config-mismatch');
    if (expected.tuningConfigHash && stream.tuningConfigHash !== expected.tuningConfigHash) {
      return fail('tuning-hash-mismatch');
    }
    return Object.freeze({ ok: true, reason: null, detail: null, stream: deepFreeze(stream) });
  } catch (error) {
    return fail('invalid-segments', error.message);
  }
}

export function controlAtTick(stream, tick) {
  if (!Number.isSafeInteger(tick) || tick < 0 || tick >= stream.totalTicks) return NEUTRAL_CONTROLS;
  let cursor = 0;
  for (const segment of stream.segments) {
    cursor += segment.ticks;
    if (tick < cursor) {
      return { turn: segment.turn, accel: segment.accel, jump: segment.jump };
    }
  }
  return NEUTRAL_CONTROLS;
}

function rivalSegments(rival) {
  const segments = RIVAL_RUN_SEGMENTS[rival.encodedRunId];
  if (!segments) throw new Error(`missing rival control stream ${rival.encodedRunId}`);
  return segments;
}

export function allRivalRunIds() {
  return Object.keys(RIVAL_RUN_SEGMENTS);
}

export function createRivalControlStream(rivalOrId, level, manifest = CONTENT_MANIFEST) {
  const rival = typeof rivalOrId === 'string' ? getRivalEntry(rivalOrId, manifest) : rivalOrId;
  const tuning = getRivalTuningConfig(rival.tuningConfigId, manifest);
  const tuningConfig = createRacePhysicsConfig(tuning.physics);
  return encodeControlStream({
    courseId: rival.courseId,
    courseHash: hashCourse(level),
    tuningConfigId: rival.tuningConfigId,
    tuningConfigHash: hashTuningConfig(tuningConfig),
    segments: rivalSegments(rival),
  });
}

function frameForGhost(frame, ownerKind) {
  return {
    ...frame,
    ghost: true,
    ownerKind,
    events: [...(frame.events ?? [])],
    controls: { ...(frame.controls ?? NEUTRAL_CONTROLS) },
  };
}

export class ConfiguredGhostReplaySession {
  constructor(level, encoded, options = {}) {
    this.level = level;
    this.ownerKind = options.ownerKind ?? 'ghost';
    this.tuningConfig = createRacePhysicsConfig(options.tuningConfig);
    const decoded = decodeControlStream(encoded, {
      courseId: options.courseId,
      courseHash: options.courseHash ?? hashCourse(level),
      tuningConfigId: options.tuningConfigId,
      tuningConfigHash: options.tuningConfigHash ?? hashTuningConfig(this.tuningConfig),
    });
    if (!decoded.ok) throw new Error(`ghost stream rejected: ${decoded.reason}`);
    this.stream = decoded.stream;
    this.session = createConfiguredRaceSession(level, {
      courseId: this.stream.courseId,
      sourceKind: options.sourceKind ?? this.ownerKind,
      tuningConfig: this.tuningConfig,
    });
    this.tickIndex = 0;
    this.lastFrame = frameForGhost(this.session.snapshot(), this.ownerKind);
  }

  tick() {
    if (this.lastFrame.sessionState !== SESSION_STATE.PLAYING || this.tickIndex >= this.stream.totalTicks) {
      return { ...this.lastFrame, events: [], frozen: true, streamEnded: this.tickIndex >= this.stream.totalTicks };
    }
    const controls = controlAtTick(this.stream, this.tickIndex);
    this.lastFrame = frameForGhost(this.session.tick(controls), this.ownerKind);
    this.tickIndex += 1;
    return this.lastFrame;
  }

  snapshot() {
    return { ...this.lastFrame, controls: { ...(this.lastFrame.controls ?? NEUTRAL_CONTROLS) } };
  }

  restart() {
    this.session.restart();
    this.tickIndex = 0;
    this.lastFrame = frameForGhost(this.session.snapshot(), this.ownerKind);
    return this.snapshot();
  }

  terminalRunRecord() {
    return this.session.terminalRunRecord();
  }
}

export function createRivalReplaySession(level, rivalOrId, manifest = CONTENT_MANIFEST) {
  const rival = typeof rivalOrId === 'string' ? getRivalEntry(rivalOrId, manifest) : rivalOrId;
  const tuning = getRivalTuningConfig(rival.tuningConfigId, manifest);
  const tuningConfig = createRacePhysicsConfig(tuning.physics);
  return new ConfiguredGhostReplaySession(level, createRivalControlStream(rival, level, manifest), {
    ownerKind: 'rival',
    sourceKind: 'rival',
    courseId: rival.courseId,
    tuningConfig,
    tuningConfigId: rival.tuningConfigId,
  });
}

export function createOwnBestReplaySession(level, ghost, options = {}) {
  return new ConfiguredGhostReplaySession(level, ghost.data, {
    ownerKind: 'own-best',
    sourceKind: 'own-best',
    courseId: options.courseId ?? ghost.courseId,
    courseHash: options.courseHash ?? hashCourse(level),
    tuningConfig: options.tuningConfig,
    tuningConfigId: options.tuningConfigId ?? ghost.tuningConfigId,
    tuningConfigHash: options.tuningConfigHash,
  });
}

export function replayControlStream(level, encoded, options = {}) {
  const session = new ConfiguredGhostReplaySession(level, encoded, options);
  const frames = [];
  for (let tick = 0; tick <= session.stream.totalTicks; tick++) {
    const frame = tick === 0 ? session.snapshot() : session.tick();
    frames.push({
      raceTicks: frame.raceTicks,
      frameIndex: frame.frameIndex,
      x: frame.x,
      y: frame.y,
      z: frame.z,
      zVel: frame.zVel,
      row: frame.row,
      state: frame.state,
      sessionState: frame.sessionState,
      controls: frame.controls,
    });
    if (frame.sessionState !== SESSION_STATE.PLAYING) break;
  }
  return {
    frames,
    finalFrame: frames.at(-1),
    record: session.terminalRunRecord(),
  };
}

export function createOwnBestGhostPayload({ level, courseId, tuningConfig, tuningConfigId, runRecord, controls }) {
  if (runRecord?.outcome !== RACE_OUTCOME.WON) return { ok: false, reason: 'not-won', ghost: null };
  if (!Number.isSafeInteger(runRecord.raceTicks) || runRecord.raceTicks <= 0) {
    return { ok: false, reason: 'invalid-best-ticks', ghost: null };
  }
  if (!Array.isArray(controls) || controls.length !== runRecord.raceTicks) {
    return { ok: false, reason: 'control-count-mismatch', ghost: null };
  }
  try {
    const normalizedTuning = createRacePhysicsConfig(tuningConfig);
    const courseHash = hashCourse(level);
    const tuningConfigHash = hashTuningConfig(normalizedTuning);
    const data = encodeControlStream({
      courseId,
      courseHash,
      tuningConfigId,
      tuningConfigHash,
      controls,
    });
    const ghost = {
      schema: OWN_BEST_GHOST_SCHEMA,
      bestTicks: runRecord.raceTicks,
      courseId,
      courseHash,
      tuningConfigId,
      tuningConfigHash,
      data,
    };
    if (byteLength(ghost) > GHOST_PAYLOAD_LIMIT_BYTES) return { ok: false, reason: 'oversize', ghost: null };
    return { ok: true, reason: null, ghost: deepFreeze(ghost) };
  } catch (error) {
    return { ok: false, reason: error.message, ghost: null };
  }
}

export function validateStoredGhostPayload(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== OWN_BEST_GHOST_SCHEMA) return null;
  if (!Number.isSafeInteger(value.bestTicks) || value.bestTicks <= 0) return null;
  if (options.levelRecord && value.bestTicks !== options.levelRecord.bestTicks) return null;
  const expected = {
    courseId: options.courseId ?? value.courseId,
    courseHash: options.courseHash ?? value.courseHash,
    tuningConfigId: options.tuningConfigId ?? value.tuningConfigId,
    tuningConfigHash: options.tuningConfigHash ?? value.tuningConfigHash,
  };
  const decoded = decodeControlStream(value.data, expected);
  if (!decoded.ok || decoded.stream.totalTicks !== value.bestTicks) return null;
  const ghost = {
    schema: OWN_BEST_GHOST_SCHEMA,
    bestTicks: value.bestTicks,
    courseId: decoded.stream.courseId,
    courseHash: decoded.stream.courseHash,
    tuningConfigId: decoded.stream.tuningConfigId,
    tuningConfigHash: decoded.stream.tuningConfigHash,
    data: value.data,
  };
  if (byteLength(ghost) > GHOST_PAYLOAD_LIMIT_BYTES) return null;
  return ghost;
}

export function cloneGhostPayload(value) {
  return cloneData(value);
}
