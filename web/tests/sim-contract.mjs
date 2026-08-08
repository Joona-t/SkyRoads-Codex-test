import assert from 'node:assert/strict';

import {
  GROUND_Y,
  LEVEL_CENTER_X,
  LEVEL_MAX_X,
  LEVEL_MIN_X,
  LEVEL_TILE_STRIDE_X,
  TOUCH_EFFECT,
  floor16,
  floor32,
  getCell,
  isInsideTile,
  isInsideTunnel,
  round16Nearest,
  round32Nearest,
  sFloor,
} from '../src/level-physics.js';
import {
  AlphaSimSession,
  GAMEPLAY_EVENT,
  FULL_RESOURCE,
  MAX_Z_VELOCITY,
  SESSION_STATE,
  SHIP_STATE,
  SkyRoadsSim,
} from '../src/sim.js';

const CENTER_COLUMN = 3;

function near(actual, expected, tolerance = 1e-9, message = undefined) {
  assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} != ${expected}`);
}

function makeCell(options = {}) {
  return {
    raw: options.raw ?? 0,
    kind: options.kind ?? 0,
    tile: options.tile ?? false,
    tunnel: options.tunnel ?? false,
    cube: options.cube ?? null,
    tileColor: options.tileColor ?? (options.tile ? 1 : 0),
    cubeColor: options.cubeColor ?? (options.cube == null ? 0 : 1),
    tileEffect: options.tileEffect ?? TOUCH_EFFECT.NONE,
    cubeEffect: options.cubeEffect ?? TOUCH_EFFECT.NONE,
  };
}

function cloneCell(cell) {
  return { ...cell };
}

function makeLevel(options = {}) {
  const length = options.length ?? 80;
  const columns = options.columns ?? 7;
  const fill = options.fill ?? 'flat';
  const fillCell =
    typeof fill === 'object'
      ? fill
      : fill === 'empty'
        ? makeCell()
        : makeCell({ tile: true });
  const cells = Array.from({ length }, () =>
    Array.from({ length: columns }, () => cloneCell(fillCell))
  );
  return {
    version: 1,
    roadIndex: options.roadIndex ?? 999,
    name: options.name ?? 'fixture',
    world: 0,
    gravity: options.gravity ?? 8,
    fuel: options.fuel ?? 100000,
    oxygen: options.oxygen ?? 100000,
    columns,
    length,
    start: { x: LEVEL_CENTER_X, y: GROUND_Y, z: 3 },
    constants: {
      tileStrideX: LEVEL_TILE_STRIDE_X,
      groundY: GROUND_Y,
      roadColumns: columns,
      levelMinX: LEVEL_MIN_X,
      levelMaxX: LEVEL_MAX_X,
      levelCenterX: LEVEL_CENTER_X,
      cubeShortTop: 100,
      cubeTallTop: 120,
      zPerRow: 1,
    },
    palette: [[0, 0, 0], [255, 255, 255]],
    cells,
  };
}

function setCell(level, row, column, cell) {
  level.cells[row][column] = makeCell(cell);
}

function centerEffectLevel(effect, options = {}) {
  const level = makeLevel({ fill: 'empty', length: options.length ?? 20, ...options });
  for (let row = 0; row < level.length; row++) {
    setCell(level, row, CENTER_COLUMN, { tile: true, tileEffect: effect });
  }
  return level;
}

function runUntil(sim, predicate, limit = 200) {
  for (let i = 0; i < limit; i++) {
    const frame = sim.tick();
    if (predicate(frame, sim)) return frame;
  }
  throw new Error(`predicate did not become true within ${limit} ticks`);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('VAL-MOVE-001 quantizers match Rust floor, nearest, and signed floor helpers', () => {
  near(floor16(1.019), 1.015625);
  near(floor32(3.00115), 3.0011444091796875);
  near(round16Nearest(1.011), 1.0078125);
  near(round32Nearest(3.00115), 3.0011444091796875);
  assert.equal(sFloor(3.9), 3);
  assert.equal(sFloor(-3.9), -3);
});

test('VAL-MOVE-001 accel, brake, and z-velocity clamps preserve source constants', () => {
  let sim = new SkyRoadsSim(makeLevel());
  let frame = sim.tick({ accel: 1 });
  near(frame.zVel, 0x4b / 0x10000);
  assert.equal(frame.state, SHIP_STATE.ALIVE);

  sim = new SkyRoadsSim(makeLevel());
  sim.ship.zVelocity = MAX_Z_VELOCITY - 0.00001;
  frame = sim.tick({ accel: 1 });
  near(frame.zVel, MAX_Z_VELOCITY);

  sim = new SkyRoadsSim(makeLevel());
  sim.ship.zVelocity = 0.0001;
  frame = sim.tick({ accel: -1 });
  near(frame.zVel, 0);
});

test('VAL-MOVE-001 neutral input does not apply forward creep to z-position', () => {
  const sim = new SkyRoadsSim(makeLevel());
  const frame = sim.tick();
  near(frame.z, 3);
  near(frame.zVel, 0);
});

test('VAL-MOVE-001 lateral control and one-shot airborne steering follow source gates', () => {
  const sim = new SkyRoadsSim(makeLevel());
  sim.ship.zVelocity = 0.05;
  const frame = sim.tick({ turn: 1 });
  assert.ok(frame.x > LEVEL_CENTER_X);
  near(sim.ship.xMovementBase, 0x1d / 0x80);

  const air = new SkyRoadsSim(makeLevel());
  air.ship.yPosition = 90;
  air.expectedShip.yPosition = 90;
  air.ship.yVelocity = 2;
  air.ship.isGoingUp = true;
  air.ship.jumpedFromYPosition = 80;
  air.tick({ turn: 1 });
  near(air.ship.xMovementBase, 0x1d / 0x80);
  air.tick({ turn: -1 });
  near(air.ship.xMovementBase, 0x1d / 0x80);
});

test('VAL-MOVE-001 jump gate denies gravity 20 and preserves jump/landing trajectory at gravity 8', () => {
  const heavy = new SkyRoadsSim(makeLevel({ gravity: 20 }));
  heavy.tick({ jump: true });
  assert.equal(heavy.ship.isGoingUp, false);
  assert.ok(heavy.ship.yPosition <= GROUND_Y);

  const normal = new SkyRoadsSim(makeLevel({ gravity: 8 }));
  let frame = normal.tick({ jump: true });
  assert.equal(normal.ship.isGoingUp, true);
  assert.ok(frame.y > GROUND_Y);
  let peak = frame.y;
  frame = runUntil(normal, (candidate) => {
    peak = Math.max(peak, candidate.y);
    return normal.ship.isOnGround && !normal.ship.isGoingUp && candidate.y <= GROUND_Y + 0.01;
  }, 80);
  assert.ok(peak > 100);
  assert.equal(frame.state, SHIP_STATE.ALIVE);
});

for (const cubeHeight of [100, 120]) {
  test(`VAL-COLLISION-001 ${cubeHeight} cube slow frontal collision bumps and stops`, () => {
    const level = makeLevel();
    setCell(level, 10, CENTER_COLUMN, { cube: cubeHeight });
    const sim = new SkyRoadsSim(level);
    sim.ship.zPosition = 9.99;
    sim.expectedShip.zPosition = 9.99;
    sim.ship.zVelocity = 0.04;
    const frame = sim.tick();
    assert.equal(frame.state, SHIP_STATE.ALIVE);
    assert.ok(frame.events.includes(GAMEPLAY_EVENT.SHIP_BUMPED_WALL));
    near(frame.zVel, 0);
    assert.ok(frame.z < 10);
  });

  test(`VAL-COLLISION-001 ${cubeHeight} cube fast frontal collision explodes`, () => {
    const level = makeLevel();
    setCell(level, 10, CENTER_COLUMN, { cube: cubeHeight });
    const sim = new SkyRoadsSim(level);
    sim.ship.zPosition = 9.99;
    sim.expectedShip.zPosition = 9.99;
    sim.ship.zVelocity = 0.08;
    const frame = sim.tick();
    assert.equal(frame.state, SHIP_STATE.EXPLODED);
    assert.ok(frame.events.includes(GAMEPLAY_EVENT.SHIP_EXPLODED));
  });
}

test('VAL-COLLISION-001 lateral obstruction cancels x motion and penalizes z velocity', () => {
  const level = makeLevel();
  setCell(level, 5, CENTER_COLUMN + 1, { cube: 100 });
  const sim = new SkyRoadsSim(level);
  sim.ship.zPosition = 5.2;
  sim.expectedShip.zPosition = 5.2;
  sim.ship.yPosition = 90;
  sim.expectedShip.yPosition = 90;
  sim.ship.isGoingUp = true;
  sim.ship.zVelocity = 0.1;
  sim.ship.xMovementBase = 3;
  const frame = sim.tick();
  assert.equal(sim.ship.xMovementBase, 0);
  assert.ok(frame.zVel < 0.1);
  assert.ok(frame.x < sim.expectedShip.xPosition);
});

test('VAL-COLLISION-001 tunnel and tile probes preserve source geometry boundaries', () => {
  const level = makeLevel({ fill: 'empty', length: 12 });
  setCell(level, 5, CENTER_COLUMN, { tile: true, tunnel: true });
  assert.equal(getCell(level, LEVEL_CENTER_X, GROUND_Y, 5.2).tunnel, true);
  assert.equal(isInsideTunnel(level, LEVEL_CENTER_X, GROUND_Y, 5.2), true);
  assert.equal(isInsideTunnel(level, LEVEL_CENTER_X, GROUND_Y - 0.25, 5.2), false);
  assert.equal(isInsideTile(level, LEVEL_CENTER_X, GROUND_Y - 0.5, 5.2), true);
  assert.equal(isInsideTile(level, LEVEL_CENTER_X, 50, 5.2), false);
});

test('VAL-COLLISION-001 holes cause falling and Fallen latches with zeroed motion', () => {
  const sim = new SkyRoadsSim(makeLevel({ fill: 'empty', length: 20 }));
  sim.ship.zVelocity = 0.05;
  const frame = runUntil(sim, (candidate) => candidate.state === SHIP_STATE.FALLEN, 60);
  assert.equal(frame.state, SHIP_STATE.FALLEN);
  near(sim.ship.zVelocity, 0);
  near(sim.ship.yVelocity, 0);
  near(sim.ship.xMovementBase, 0);
  assert.equal(sim.ship.isOnGround, false);
});

test('VAL-EFFECTS-001 accelerate, decelerate, kill, slide, and refill effects apply in source order', () => {
  let sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.ACCELERATE));
  let frame = sim.tick();
  near(frame.zVel, 0x12f / 0x10000);

  sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.DECELERATE));
  sim.ship.zVelocity = 0.01;
  frame = sim.tick();
  near(frame.zVel, 0.01 - 0x12f / 0x10000, 1e-9);

  sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.KILL));
  frame = sim.tick({ accel: 1 });
  assert.equal(frame.state, SHIP_STATE.EXPLODED);
  assert.deepEqual(frame.events, [GAMEPLAY_EVENT.SHIP_EXPLODED]);

  sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.SLIDE));
  sim.ship.zVelocity = 0.05;
  frame = sim.tick({ turn: 1 });
  near(sim.ship.xMovementBase, 0);
  assert.equal(frame.state, SHIP_STATE.ALIVE);

  sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.REFILL_OXYGEN));
  sim.ship.fuelRemaining = 26000;
  sim.ship.oxygenRemaining = 28000;
  frame = sim.tick();
  assert.ok(frame.events.includes(GAMEPLAY_EVENT.SHIP_REFILLED));
  assert.ok(sim.ship.fuelRemaining > 29999);
  assert.ok(sim.ship.oxygenRemaining > 29999);

  sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.REFILL_OXYGEN));
  sim.ship.fuelRemaining = 28000;
  sim.ship.oxygenRemaining = 28000;
  frame = sim.tick();
  assert.equal(frame.events.includes(GAMEPLAY_EVENT.SHIP_REFILLED), false);
});

test('VAL-EFFECTS-001 decelerate pad suppresses lateral forward-creep while normal tile permits it', () => {
  const normal = new SkyRoadsSim(makeLevel());
  normal.ship.xMovementBase = 1;
  normal.ship.isGoingUp = true;
  normal.tick();

  const decel = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.DECELERATE));
  decel.ship.xMovementBase = 1;
  decel.ship.isGoingUp = true;
  decel.tick();

  assert.ok(normal.ship.xPosition > LEVEL_CENTER_X);
  near(decel.ship.xPosition, LEVEL_CENTER_X);
});

test('VAL-EFFECTS-001 fuel is speed-dependent, oxygen is speed-independent, and simultaneous depletion favors fuel', () => {
  const slow = new SkyRoadsSim(makeLevel({ fuel: 100, oxygen: 100 }));
  const fast = new SkyRoadsSim(makeLevel({ fuel: 100, oxygen: 100 }));
  fast.ship.zVelocity = 0.1;
  slow.tick();
  fast.tick();
  assert.ok(fast.ship.fuelRemaining < slow.ship.fuelRemaining);
  near(fast.ship.oxygenRemaining, slow.ship.oxygenRemaining);

  const oxygen = new SkyRoadsSim(makeLevel({ fuel: 100000, oxygen: 1 }));
  oxygen.ship.oxygenRemaining = 10;
  oxygen.tick();
  assert.equal(oxygen.ship.state, SHIP_STATE.OUT_OF_OXYGEN);

  const fuel = new SkyRoadsSim(makeLevel({ fuel: 1, oxygen: 100000 }));
  fuel.ship.fuelRemaining = 1;
  fuel.ship.zVelocity = 0.1;
  fuel.tick();
  assert.equal(fuel.ship.state, SHIP_STATE.OUT_OF_FUEL);

  const both = new SkyRoadsSim(makeLevel({ fuel: 1, oxygen: 1 }));
  both.ship.fuelRemaining = 1;
  both.ship.oxygenRemaining = 1;
  both.ship.zVelocity = 0.1;
  both.tick();
  assert.equal(both.ship.state, SHIP_STATE.OUT_OF_FUEL);
});

test('VAL-BOUNCE-001 bounce threshold and no-bounce threshold follow previous expected state', () => {
  let sim = new SkyRoadsSim(makeLevel());
  sim.ship.yVelocity = -3;
  sim.expectedShip.yPosition = GROUND_Y - 1;
  let frame = sim.tick();
  assert.ok(frame.events.includes(GAMEPLAY_EVENT.SHIP_BOUNCED));
  assert.ok(sim.ship.yVelocity > 0);

  sim = new SkyRoadsSim(makeLevel());
  sim.ship.yVelocity = -1;
  sim.expectedShip.yPosition = GROUND_Y - 1;
  frame = sim.tick();
  assert.equal(frame.events.includes(GAMEPLAY_EVENT.SHIP_BOUNCED), false);
  assert.equal(sim.ship.isOnGround, true);
});

test('VAL-BOUNCE-001 slide guard prevents ledge slides from bouncing', () => {
  const sim = new SkyRoadsSim(makeLevel());
  sim.ship.yVelocity = -3;
  sim.ship.slideAmount = 1;
  sim.ship.offsetAtWhichNotInsideTile = 1;
  sim.expectedShip.yPosition = GROUND_Y - 1;
  const frame = sim.tick();
  assert.equal(frame.events.includes(GAMEPLAY_EVENT.SHIP_BOUNCED), false);
});

test('VAL-BOUNCE-001 landing resets jump state and repays Jump-O-Master z delta', () => {
  const sim = new SkyRoadsSim(makeLevel());
  sim.ship.yPosition = 82;
  sim.expectedShip.yPosition = 82;
  sim.ship.yVelocity = -5;
  sim.ship.zVelocity = 0.05;
  sim.ship.isGoingUp = true;
  sim.ship.hasRunJumpOMaster = true;
  sim.ship.jumpOMasterInUse = true;
  sim.ship.jumpOMasterVelocityDelta = 0.02;
  sim.tick();
  assert.equal(sim.ship.isOnGround, true);
  assert.equal(sim.ship.isGoingUp, false);
  assert.equal(sim.ship.hasRunJumpOMaster, false);
  assert.equal(sim.ship.jumpOMasterInUse, false);
  near(sim.ship.jumpOMasterVelocityDelta, 0);
  near(sim.ship.zVelocity, 0.07);
});

test('VAL-BOUNCE-001 edge overhang produces slide acceleration and slide amount', () => {
  const level = makeLevel({ fill: 'empty', length: 20 });
  for (let row = 0; row < level.length; row++) setCell(level, row, CENTER_COLUMN, { tile: true });
  const sim = new SkyRoadsSim(level);
  sim.ship.xPosition = LEVEL_CENTER_X + 23;
  sim.expectedShip.xPosition = sim.ship.xPosition;
  sim.ship.yPosition = 82;
  sim.expectedShip.yPosition = 82;
  sim.ship.yVelocity = -5;
  sim.tick();
  assert.notEqual(sim.ship.slidingAccel, 0);
  assert.notEqual(sim.ship.slideAmount, 0);
});

test('VAL-STATE-001 terminal ship states remain distinct from alpha session state', () => {
  let sim = new SkyRoadsSim(centerEffectLevel(TOUCH_EFFECT.KILL));
  assert.equal(sim.tick().state, SHIP_STATE.EXPLODED);

  sim = new SkyRoadsSim(makeLevel({ fill: 'empty' }));
  assert.equal(runUntil(sim, (frame) => frame.state === SHIP_STATE.FALLEN, 60).state, SHIP_STATE.FALLEN);

  sim = new SkyRoadsSim(makeLevel({ fuel: 1, oxygen: 100000 }));
  sim.ship.fuelRemaining = 1;
  sim.ship.zVelocity = 0.1;
  assert.equal(sim.tick().state, SHIP_STATE.OUT_OF_FUEL);

  sim = new SkyRoadsSim(makeLevel({ fuel: 100000, oxygen: 1 }));
  sim.ship.oxygenRemaining = 1;
  assert.equal(sim.tick().state, SHIP_STATE.OUT_OF_OXYGEN);
});

test('VAL-STATE-001 victory requires the end tunnel and latches in alpha session', () => {
  let level = makeLevel({ fill: 'empty', length: 8 });
  setCell(level, 7, CENTER_COLUMN, { tile: true });
  let sim = new SkyRoadsSim(level);
  sim.ship.zPosition = 7.5;
  sim.expectedShip.zPosition = 7.5;
  assert.equal(sim.tick().didWin, false);

  level = makeLevel({ fill: 'empty', length: 8 });
  setCell(level, 7, CENTER_COLUMN, { tile: true, tunnel: true });
  sim = new SkyRoadsSim(level);
  sim.ship.zPosition = 7.5;
  sim.expectedShip.zPosition = 7.5;
  assert.equal(sim.tick().didWin, true);

  const session = new AlphaSimSession(level);
  session.sim.ship.zPosition = 7.5;
  session.sim.expectedShip.zPosition = 7.5;
  const won = session.tick();
  assert.equal(won.sessionState, SESSION_STATE.WON);
  assert.equal(won.didWin, true);
  const frozen = session.tick({ accel: 1, turn: 1, jump: true });
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.frameIndex, won.frameIndex);
  assert.equal(frozen.z, won.z);
});

test('VAL-STATE-001 alpha session freezes after failure and restart reconstructs exact start state', () => {
  const level = centerEffectLevel(TOUCH_EFFECT.KILL);
  const session = new AlphaSimSession(level);
  const failed = session.tick({ accel: 1 });
  assert.equal(failed.state, SHIP_STATE.EXPLODED);
  assert.equal(failed.sessionState, SESSION_STATE.FAILED);
  assert.equal(session.sim.frameIndex, 1);

  const frozen = session.tick({ accel: 1, turn: 1, jump: true });
  assert.equal(frozen.frozen, true);
  assert.equal(session.sim.frameIndex, 1);
  assert.equal(frozen.x, failed.x);
  assert.equal(frozen.z, failed.z);

  const restarted = session.restart();
  const fresh = new AlphaSimSession(level).snapshot();
  assert.deepEqual(session.sim.ship, new SkyRoadsSim(level).ship);
  assert.deepEqual(session.sim.expectedShip, new SkyRoadsSim(level).expectedShip);
  assert.equal(session.sim.frameIndex, 0);
  assert.equal(session.sessionState, SESSION_STATE.PLAYING);
  assert.equal(restarted.sessionState, fresh.sessionState);
  assert.equal(restarted.x, fresh.x);
  assert.equal(restarted.y, fresh.y);
  assert.equal(restarted.z, fresh.z);
  assert.equal(restarted.fuelPct, FULL_RESOURCE / FULL_RESOURCE);
});

let passed = 0;
const started = performance.now();
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(JSON.stringify({
  tests: passed,
  ms: performance.now() - started,
  targets: [
    'VAL-MOVE-001',
    'VAL-COLLISION-001',
    'VAL-EFFECTS-001',
    'VAL-BOUNCE-001',
    'VAL-STATE-001',
  ],
}, null, 2));
