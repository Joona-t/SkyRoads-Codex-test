import assert from 'node:assert/strict';

import {
  CONTENT_MANIFEST,
  RIVAL_LADDER,
  SPARKY_LIVERY_ID,
  STARTER_COURSE_IDS,
  allRivals,
  assertContentManifest,
  getRivalForRank,
  getRivalTuningConfig,
} from '../src/content-manifest.js';
import { createGarageView, createRaceTuningConfig, createRaceTuningConfigId } from '../src/garage.js';
import {
  CONTROL_STREAM_LIMIT_BYTES,
  CONTROL_STREAM_SCHEMA,
  ConfiguredGhostReplaySession,
  byteLength,
  controlAtTick,
  createOwnBestGhostPayload,
  createOwnBestReplaySession,
  createRivalControlStream,
  createRivalReplaySession,
  decodeControlStream,
  encodeControlStream,
  hashCourse,
  hashTuningConfig,
  replayControlStream,
} from '../src/ghost.js';
import {
  activeRivalForSave,
  applyRivalRunToProgress,
} from '../src/progression.js';
import { RaceSessionLifecycle } from '../src/session-lifecycle.js';
import { RaceSessionModel, createRunRecord } from '../src/race-session.js';
import { createDefaultSave, upsertGhost, validateSaveObject } from '../src/save.js';
import { createStarterCourse } from '../src/starter-cup.js';
import { SESSION_STATE, SHIP_STATE, createRacePhysicsConfig } from '../src/sim.js';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function controlsAtTrace(trace, tick) {
  const segment = trace.segments.find((candidate) => tick < candidate.until) ?? trace.segments.at(-1);
  return {
    turn: segment.turn,
    accel: segment.accel,
    jump: segment.jump,
  };
}

function runStarterWin(courseId = STARTER_COURSE_IDS.TRAINING) {
  const level = createStarterCourse(courseId);
  const trace = level.traces.win;
  const save = createDefaultSave();
  const tuningConfig = createRaceTuningConfig(save);
  const session = new RaceSessionModel(level, {
    courseId,
    sourceKind: 'starter',
    tuningConfig,
  });
  let frame = session.snapshot();
  for (let tick = 0; tick < trace.maxTicks; tick++) {
    frame = session.tick(controlsAtTrace(trace, tick));
    if (frame.sessionState !== SESSION_STATE.PLAYING) break;
  }
  assert.equal(frame.sessionState, SESSION_STATE.WON);
  return { level, save, tuningConfig, tuningConfigId: createRaceTuningConfigId(save), session, record: session.terminalRunRecord() };
}

function frameSample(frame) {
  return {
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
  };
}

function fakeWinRecord(rival, ticks = rival.targetTicks - 1) {
  const level = createStarterCourse(rival.courseId);
  return createRunRecord({
    courseId: rival.courseId,
    sourceKind: 'starter',
    level,
    frame: { sessionState: SESSION_STATE.WON, state: SHIP_STATE.ALIVE, row: level.length - 1 },
    raceTicks: ticks,
    events: [],
  });
}

test('VAL-GHOST-001 manifest declares exactly six unique ranked rivals', () => {
  assert.equal(assertContentManifest(), true);
  assert.equal(RIVAL_LADDER.length, 6);
  assert.deepEqual(RIVAL_LADDER.map((rival) => rival.rank), [6, 5, 4, 3, 2, 1]);
  assert.equal(new Set(RIVAL_LADDER.map((rival) => rival.id)).size, 6);
  assert.equal(new Set(RIVAL_LADDER.map((rival) => rival.encodedRunId)).size, 6);
  assert.equal(new Set(RIVAL_LADDER.map((rival) => rival.reward.id)).size, 6);
  for (const rival of RIVAL_LADDER) {
    assert.ok(CONTENT_MANIFEST.starterCup.courses.some((course) => course.id === rival.courseId), rival.id);
    assert.ok(getRivalTuningConfig(rival.tuningConfigId), rival.id);
    assert.ok(Number.isSafeInteger(rival.targetTicks) && rival.targetTicks > 0, rival.id);
    assert.equal(JSON.stringify(rival).includes('http'), false, rival.id);
    assert.equal(JSON.stringify(rival).includes('data:image'), false, rival.id);
    assert.ok(rival.visual.opacity > 0 && rival.visual.opacity < 1, rival.id);
  }
  assert.equal(getRivalForRank(1).reward.liveryId, SPARKY_LIVERY_ID);
});

test('VAL-GHOST-001 control-stream codec rejects hostile data and enforces byte bounds', () => {
  const level = createStarterCourse(STARTER_COURSE_IDS.TRAINING);
  const tuningConfig = createRaceTuningConfig(createDefaultSave());
  const encoded = encodeControlStream({
    courseId: STARTER_COURSE_IDS.TRAINING,
    courseHash: hashCourse(level),
    tuningConfigId: 'top0:accel0:handling0:lift0',
    tuningConfigHash: hashTuningConfig(tuningConfig),
    segments: [
      { ticks: 3, turn: 0, accel: 1, jump: false },
      { ticks: 2, turn: 0, accel: 1, jump: true },
    ],
  });
  assert.equal(byteLength(encoded) <= CONTROL_STREAM_LIMIT_BYTES, true);
  const decoded = decodeControlStream(encoded, {
    courseId: STARTER_COURSE_IDS.TRAINING,
    courseHash: hashCourse(level),
    tuningConfigId: 'top0:accel0:handling0:lift0',
    tuningConfigHash: hashTuningConfig(tuningConfig),
  });
  assert.equal(decoded.ok, true);
  assert.deepEqual(controlAtTick(decoded.stream, 0), { turn: 0, accel: 1, jump: false });
  assert.deepEqual(controlAtTick(decoded.stream, 4), { turn: 0, accel: 1, jump: true });

  assert.equal(decodeControlStream('{bad').reason, 'invalid-json');
  assert.equal(decodeControlStream('x'.repeat(CONTROL_STREAM_LIMIT_BYTES + 1)).reason, 'oversize');
  const badSchema = JSON.stringify({ s: 'wrong', hz: 70, c: 'tutorial', ch: hashCourse(level), tc: 'x', th: hashTuningConfig(tuningConfig), n: 1, r: [[1, 0, 0, 0]] });
  assert.equal(decodeControlStream(badSchema).reason, 'invalid-schema');
  const badSegment = JSON.stringify({ s: CONTROL_STREAM_SCHEMA, hz: 70, c: 'tutorial', ch: hashCourse(level), tc: 'x', th: hashTuningConfig(tuningConfig), n: 1, r: [[1, 0, 0, 2]] });
  assert.equal(decodeControlStream(badSegment).reason, 'invalid-segments');
  assert.throws(() => encodeControlStream({
    courseId: STARTER_COURSE_IDS.TRAINING,
    courseHash: hashCourse(level),
    tuningConfigId: 'top0:accel0:handling0:lift0',
    tuningConfigHash: hashTuningConfig(tuningConfig),
    segments: [{ ticks: 1, turn: 4, accel: 1, jump: false }],
  }), /invalid control turn/);
});

test('VAL-GHOST-001 all six rival streams replay bit-for-bit through configured sessions', () => {
  for (const rival of allRivals()) {
    const level = createStarterCourse(rival.courseId);
    const tuningConfig = createRacePhysicsConfig(getRivalTuningConfig(rival.tuningConfigId).physics);
    const encoded = createRivalControlStream(rival, level);
    assert.equal(byteLength(encoded) <= CONTROL_STREAM_LIMIT_BYTES, true, rival.id);
    const first = replayControlStream(level, encoded, {
      courseId: rival.courseId,
      tuningConfig,
      tuningConfigId: rival.tuningConfigId,
      sourceKind: 'rival',
    });
    const second = replayControlStream(level, encoded, {
      courseId: rival.courseId,
      tuningConfig,
      tuningConfigId: rival.tuningConfigId,
      sourceKind: 'rival',
    });
    assert.deepEqual(second.frames, first.frames, rival.id);
    assert.equal(first.finalFrame.sessionState, SESSION_STATE.WON, rival.id);
    assert.equal(first.record.raceTicks, rival.targetTicks, rival.id);
  }
});

test('VAL-GHOST-001 ghost sessions ignore player input and cannot affect player physics', () => {
  const rival = getRivalForRank(6);
  const level = createStarterCourse(rival.courseId);
  const playerAlone = new RaceSessionModel(level, { courseId: rival.courseId, sourceKind: 'starter' });
  const playerWithGhost = new RaceSessionModel(level, { courseId: rival.courseId, sourceKind: 'starter' });
  const ghostNeutral = createRivalReplaySession(level, rival);
  const ghostHostile = createRivalReplaySession(level, rival);

  for (let tick = 0; tick < 260; tick++) {
    const playerControls = { turn: tick % 80 < 20 ? -1 : 0, accel: 1, jump: false };
    const alone = playerAlone.tick(playerControls);
    const withGhost = playerWithGhost.tick(playerControls);
    const neutral = ghostNeutral.tick();
    const hostile = ghostHostile.tick({ turn: 1, accel: -1, jump: true });
    assert.deepEqual(frameSample(withGhost), frameSample(alone), `player changed at tick ${tick}`);
    assert.deepEqual(frameSample(hostile), frameSample(neutral), `ghost accepted hostile input at tick ${tick}`);
  }
});

test('VAL-GHOST-001 rival rewards advance only from valid faster player finishes and stay idempotent', () => {
  let save = createDefaultSave();
  const rank6 = getRivalForRank(6);
  const win = fakeWinRecord(rank6);
  let applied = applyRivalRunToProgress(save, win, rank6.id);
  assert.equal(applied.result.defeated, true);
  assert.equal(applied.result.nextRival.rank, 5);
  assert.deepEqual(applied.save.rivals.defeated, [rank6.id]);
  assert.equal(applied.result.creditsAwarded, rank6.reward.credits);

  const creditsAfterFirst = applied.save.credits;
  applied = applyRivalRunToProgress(applied.save, win, rank6.id);
  assert.equal(applied.result.defeated, false);
  assert.equal(applied.result.reason, 'not-current-rival');
  assert.equal(applied.save.credits, creditsAfterFirst);

  const rank5 = getRivalForRank(5);
  const equalTarget = fakeWinRecord(rank5, rank5.targetTicks);
  applied = applyRivalRunToProgress(applied.save, equalTarget, rank5.id);
  assert.equal(applied.result.defeated, false);
  assert.equal(applied.result.reason, 'target-not-beaten');
  assert.equal(applied.save.rivals.defeated.includes(rank5.id), false);

  const failed = createRunRecord({
    courseId: rank5.courseId,
    sourceKind: 'starter',
    level: createStarterCourse(rank5.courseId),
    frame: { sessionState: SESSION_STATE.FAILED, state: SHIP_STATE.EXPLODED, row: 44 },
    raceTicks: rank5.targetTicks - 50,
    events: [],
  });
  applied = applyRivalRunToProgress(applied.save, failed, rank5.id);
  assert.equal(applied.result.defeated, false);
  assert.equal(applied.result.reason, 'invalid-finish');
});

test('VAL-GHOST-001 rank 1 grants the one-time Sparky livery reward', () => {
  const save = createDefaultSave();
  save.rivals.defeated = [6, 5, 4, 3, 2].map((rank) => getRivalForRank(rank).id);
  const rank1 = activeRivalForSave(save);
  assert.equal(rank1.rank, 1);
  const applied = applyRivalRunToProgress(save, fakeWinRecord(rank1), rank1.id);
  assert.equal(applied.result.defeated, true);
  assert.equal(applied.result.sparkyLiveryUnlocked, true);
  assert.equal(applied.save.rewards.claimed.includes(rank1.reward.id), true);
  assert.equal(applied.save.unlocks.liveries.includes(SPARKY_LIVERY_ID), true);

  const normalized = validateSaveObject(applied.save).save;
  const view = createGarageView(normalized);
  assert.equal(view.catalogs.liveries.find((item) => item.id === SPARKY_LIVERY_ID).owned, true);
});

test('VAL-GHOST-001 own-best ghosts are tagged, hash-checked, and preserve previous valid streams', () => {
  const { level, save, tuningConfig, tuningConfigId, session, record } = runStarterWin();
  save.levels[record.courseId] = {
    bestTicks: record.raceTicks,
    medal: 3,
    completed: true,
    clean: true,
  };
  const payload = createOwnBestGhostPayload({
    level,
    courseId: record.courseId,
    tuningConfig,
    tuningConfigId,
    runRecord: record,
    controls: session.controlHistory(),
  });
  assert.equal(payload.ok, true);
  assert.equal(payload.ghost.schema, 'neondrift.own-best-ghost.v1');
  assert.equal(payload.ghost.courseHash, hashCourse(level));
  assert.equal(payload.ghost.tuningConfigHash, hashTuningConfig(tuningConfig));

  let result = upsertGhost(save, record.courseId, payload.ghost);
  assert.equal(result.accepted, true);
  const preservedData = result.save.ghosts[record.courseId].data;
  result = upsertGhost(result.save, record.courseId, {
    ...payload.ghost,
    data: 'x'.repeat(CONTROL_STREAM_LIMIT_BYTES + 1),
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, 'invalid-or-oversize-ghost');
  assert.equal(result.save.ghosts[record.courseId].data, preservedData);

  const wrongCourse = cloneData(level);
  wrongCourse.gravity += 1;
  assert.throws(() => createOwnBestReplaySession(wrongCourse, payload.ghost, {
    courseId: record.courseId,
    tuningConfig,
    tuningConfigId,
  }), /course-hash-mismatch/);
  assert.throws(() => createOwnBestReplaySession(level, payload.ghost, {
    courseId: record.courseId,
    tuningConfig: createRacePhysicsConfig({ topSpeedMultiplier: 1.08 }),
    tuningConfigId,
  }), /tuning-hash-mismatch/);

  const replay = new ConfiguredGhostReplaySession(level, payload.ghost.data, {
    courseId: record.courseId,
    tuningConfig,
    tuningConfigId,
  });
  while (replay.snapshot().sessionState === SESSION_STATE.PLAYING) replay.tick();
  assert.equal(replay.terminalRunRecord().raceTicks, record.raceTicks);
});

test('VAL-GHOST-001 ghost resources are disposed with race lifecycle scopes', () => {
  const lifecycle = new RaceSessionLifecycle();
  let activeResources = 0;
  let peakResources = 0;
  for (let swap = 0; swap < 25; swap++) {
    const scope = lifecycle.begin(`ghost-race-${swap}`);
    for (const label of ['level-scene', 'craft', 'rival-ghost', 'own-best-ghost']) {
      activeResources += 1;
      peakResources = Math.max(peakResources, activeResources);
      scope.add(label, () => {
        activeResources -= 1;
      });
    }
  }
  assert.equal(activeResources, 4);
  assert.equal(peakResources <= 4, true);
  const snapshot = lifecycle.snapshot();
  assert.equal(snapshot.active.resources.some((resource) => resource.label === 'rival-ghost'), true);
  lifecycle.disposeCurrent();
  assert.equal(activeResources, 0);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(JSON.stringify({ tests: passed, target: 'VAL-GHOST-001' }, null, 2));
