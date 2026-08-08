import {
  GROUND_Y,
  LEVEL_CENTER_X,
  LEVEL_MAX_X,
  LEVEL_MIN_X,
  TOUCH_EFFECT,
  floor16,
  floor32,
  getCell,
  gravityAcceleration,
  isEmptyCell,
  isInsideTile,
  isInsideTunnel,
  normalizeLevel,
  round16Nearest,
  round32Nearest,
  sFloor,
} from './level-physics.js';

export const TICKS_PER_SECOND = 70;
export const MAX_Z_VELOCITY = 0x2aaa / 0x10000;
export const THROTTLE_FORCE = 0x4b / 0x10000;
export const LATERAL_BASE = 0x1d / 0x80;
export const JUMP_VELOCITY = 0x480 / 0x80;
export const REFILL_THRESHOLD = 0x6978;
export const FULL_RESOURCE = 0x7530;

export const DEFAULT_RACE_PHYSICS_CONFIG = Object.freeze({
  topSpeedMultiplier: 1,
  accelerationMultiplier: 1,
  handlingMultiplier: 1,
  jumpVelocityMultiplier: 1,
  fuelEfficiencyMultiplier: 1,
});

export const SHIP_STATE = Object.freeze({
  ALIVE: 'Alive',
  EXPLODED: 'Exploded',
  FALLEN: 'Fallen',
  OUT_OF_FUEL: 'OutOfFuel',
  OUT_OF_OXYGEN: 'OutOfOxygen',
});

export const GAMEPLAY_EVENT = Object.freeze({
  SHIP_BUMPED_WALL: 'ShipBumpedWall',
  SHIP_EXPLODED: 'ShipExploded',
  SHIP_BOUNCED: 'ShipBounced',
  SHIP_REFILLED: 'ShipRefilled',
});

export const SESSION_STATE = Object.freeze({
  PLAYING: 'playing',
  FAILED: 'failed',
  WON: 'won',
});

function boundedMultiplier(value, key) {
  if (value == null) return DEFAULT_RACE_PHYSICS_CONFIG[key];
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${key} must be a positive finite number`);
  return Number(value);
}

export function createRacePhysicsConfig(input = DEFAULT_RACE_PHYSICS_CONFIG) {
  const source = input ?? DEFAULT_RACE_PHYSICS_CONFIG;
  return Object.freeze({
    topSpeedMultiplier: boundedMultiplier(source.topSpeedMultiplier, 'topSpeedMultiplier'),
    accelerationMultiplier: boundedMultiplier(source.accelerationMultiplier, 'accelerationMultiplier'),
    handlingMultiplier: boundedMultiplier(source.handlingMultiplier, 'handlingMultiplier'),
    jumpVelocityMultiplier: boundedMultiplier(source.jumpVelocityMultiplier, 'jumpVelocityMultiplier'),
    fuelEfficiencyMultiplier: boundedMultiplier(source.fuelEfficiencyMultiplier, 'fuelEfficiencyMultiplier'),
  });
}

function maxZVelocity(physics) {
  return MAX_Z_VELOCITY * physics.topSpeedMultiplier;
}

function throttleForce(physics) {
  return THROTTLE_FORCE * physics.accelerationMultiplier;
}

function lateralBase(physics) {
  return LATERAL_BASE * physics.handlingMultiplier;
}

function jumpVelocity(physics) {
  return JUMP_VELOCITY * physics.jumpVelocityMultiplier;
}

function fuelDenominator(level, physics) {
  return level.fuel * physics.fuelEfficiencyMultiplier;
}

export function effectivePhysicsParameters(config = DEFAULT_RACE_PHYSICS_CONFIG, level = null) {
  const physics = createRacePhysicsConfig(config);
  return Object.freeze({
    maxZVelocity: maxZVelocity(physics),
    throttleForce: throttleForce(physics),
    lateralBase: lateralBase(physics),
    jumpVelocity: jumpVelocity(physics),
    fuelEfficiencyMultiplier: physics.fuelEfficiencyMultiplier,
    fuelDenominator: level ? fuelDenominator(level, physics) : null,
  });
}

export function createInitialShip() {
  return {
    xPosition: LEVEL_CENTER_X,
    yPosition: GROUND_Y,
    zPosition: 3,
    slideAmount: 0,
    slidingAccel: 0,
    xMovementBase: 0,
    yVelocity: 0,
    zVelocity: 0,
    fuelRemaining: FULL_RESOURCE,
    oxygenRemaining: FULL_RESOURCE,
    offsetAtWhichNotInsideTile: 0,
    isOnGround: true,
    isGoingUp: false,
    hasRunJumpOMaster: false,
    jumpOMasterVelocityDelta: 0,
    jumpOMasterInUse: false,
    jumpedFromYPosition: 0,
    state: SHIP_STATE.ALIVE,
  };
}

export function cloneShip(ship) {
  return { ...ship };
}

function assignShip(target, source) {
  for (const key of Object.keys(source)) target[key] = source[key];
  return target;
}

function normalizeControls(controls = {}) {
  const turn = controls.turn ?? controls.turnInput ?? controls.turn_input ?? 0;
  const accel = controls.accel ?? controls.accelInput ?? controls.accel_input ?? 0;
  const jump = Boolean(controls.jump ?? controls.jumpInput ?? controls.jump_input ?? false);
  if (![-1, 0, 1].includes(turn)) throw new RangeError(`turn must be -1, 0, or 1, got ${turn}`);
  if (![-1, 0, 1].includes(accel)) throw new RangeError(`accel must be -1, 0, or 1, got ${accel}`);
  return { turn, accel, jump };
}

function sanitizeParameters(ship) {
  ship.xPosition = round16Nearest(ship.xPosition);
  ship.yPosition = round16Nearest(ship.yPosition);
  ship.zPosition = round32Nearest(ship.zPosition);
}

function isDifferentHeight(ship, other) {
  return Math.abs(other.yPosition - ship.yPosition) > 0.01;
}

function clampZVelocity(zVelocity, physics) {
  return Math.min(maxZVelocity(physics), Math.max(0, zVelocity));
}

function clampGlobalZVelocity(ship, physics) {
  ship.zVelocity = clampZVelocity(ship.zVelocity, physics);
}

function getTouchEffect(ship, cell) {
  if (!ship.isOnGround) return TOUCH_EFFECT.NONE;
  const floorY = Math.floor(ship.yPosition);
  if (floorY === GROUND_Y && cell.tile) return cell.tileEffect;
  if (floorY > GROUND_Y && cell.cube === floorY) return cell.cubeEffect;
  return TOUCH_EFFECT.NONE;
}

function applyTouchEffect(ship, effect, events, physics) {
  switch (effect) {
    case TOUCH_EFFECT.ACCELERATE:
      ship.zVelocity += 0x12f / 0x10000;
      break;
    case TOUCH_EFFECT.DECELERATE:
      ship.zVelocity -= 0x12f / 0x10000;
      break;
    case TOUCH_EFFECT.KILL:
      if (ship.state !== SHIP_STATE.EXPLODED) events.push(GAMEPLAY_EVENT.SHIP_EXPLODED);
      ship.state = SHIP_STATE.EXPLODED;
      break;
    case TOUCH_EFFECT.REFILL_OXYGEN:
      if (ship.state === SHIP_STATE.ALIVE) {
        if (ship.fuelRemaining < REFILL_THRESHOLD || ship.oxygenRemaining < REFILL_THRESHOLD) {
          events.push(GAMEPLAY_EVENT.SHIP_REFILLED);
        }
        ship.fuelRemaining = FULL_RESOURCE;
        ship.oxygenRemaining = FULL_RESOURCE;
      }
      break;
    case TOUCH_EFFECT.SLIDE:
    case TOUCH_EFFECT.NONE:
      break;
    default:
      throw new Error(`unknown touch effect ${effect}`);
  }
  clampGlobalZVelocity(ship, physics);
}

function updateYVelocity(ship, expected, level, events) {
  if (!isDifferentHeight(ship, expected)) return;
  if (ship.slideAmount === 0 || ship.offsetAtWhichNotInsideTile >= 2) {
    const yVelocityAbs = Math.abs(ship.yVelocity);
    if (yVelocityAbs > level.gravity * 0x104 / 8 / 0x80) {
      if (ship.yVelocity < 0) events.push(GAMEPLAY_EVENT.SHIP_BOUNCED);
      ship.yVelocity = -0.5 * ship.yVelocity;
    } else {
      ship.yVelocity = 0;
    }
  } else {
    ship.yVelocity = 0;
  }
}

function updateZVelocity(ship, canControl, accelInput, physics) {
  ship.zVelocity += (canControl ? accelInput : 0) * throttleForce(physics);
  clampGlobalZVelocity(ship, physics);
}

function updateXVelocity(ship, canControl, turnInput, isOnSlidingTile, isAboveNothing, physics) {
  if (isOnSlidingTile) return;
  const canControl1 =
    (ship.isGoingUp || isAboveNothing) &&
    ship.xMovementBase === 0 &&
    ship.yVelocity > 0 &&
    ship.yPosition - ship.jumpedFromYPosition < 30;
  const canControl2 = !ship.isGoingUp && !isAboveNothing;
  if (canControl1 || canControl2) {
    ship.xMovementBase = canControl ? turnInput * lateralBase(physics) : 0;
  }
}

function updateJump(ship, canControl, isAboveNothing, jumpInput, level, physics) {
  if (!ship.isGoingUp && !isAboveNothing && jumpInput && level.gravity < 0x14 && canControl) {
    ship.yVelocity = jumpVelocity(physics);
    ship.isGoingUp = true;
    ship.jumpedFromYPosition = ship.yPosition;
  }
}

function updateGravity(ship, level) {
  if (ship.yPosition >= 0x28) {
    ship.yVelocity += gravityAcceleration(level);
    ship.yVelocity = sFloor(ship.yVelocity * 0x80) / 0x80;
  } else if (ship.yVelocity > -(105 / 0x80)) {
    ship.yVelocity = -(105 / 0x80);
  }
}

function attemptMotion(ship, onDecelPad) {
  const isDead = ship.state !== SHIP_STATE.ALIVE;
  let motionVelocity = ship.zVelocity;
  if (!onDecelPad) motionVelocity += 0x618 / 0x10000;
  const xMotion =
    sFloor(ship.xMovementBase * 0x80) *
      sFloor(motionVelocity * 0x10000) /
      0x10000 +
    ship.slideAmount;
  if (!isDead) {
    ship.xPosition += xMotion;
    ship.yPosition += ship.yVelocity;
    ship.zPosition += ship.zVelocity;
  }
}

function interp(ship, dest, percent) {
  ship.xPosition = floor16((dest.xPosition - ship.xPosition) * percent + ship.xPosition);
  ship.yPosition = floor16((dest.yPosition - ship.yPosition) * percent + ship.yPosition);
  ship.zPosition = floor32((dest.zPosition - ship.zPosition) * percent + ship.zPosition);
}

function moveTo(ship, dest, level) {
  if (
    ship.xPosition === dest.xPosition &&
    ship.yPosition === dest.yPosition &&
    ship.zPosition === dest.zPosition
  ) {
    return;
  }

  let fake;
  let iter = 1;
  for (let step = 1; step <= 5; step++) {
    fake = cloneShip(ship);
    interp(fake, dest, step / 5);
    if (isInsideTile(level, fake.xPosition, fake.yPosition, fake.zPosition)) {
      iter = step;
      break;
    }
    iter = step + 1;
  }

  const percent = Math.max(0, iter - 1) / 5;
  interp(ship, dest, percent);

  let zGran = 0x1000 / 0x10000;
  while (zGran !== 0) {
    fake = cloneShip(ship);
    fake.zPosition += zGran;
    if (
      dest.zPosition - ship.zPosition >= zGran &&
      !isInsideTile(level, fake.xPosition, fake.yPosition, fake.zPosition)
    ) {
      ship.zPosition = fake.zPosition;
    } else {
      zGran /= 16;
      zGran = floor32(zGran);
    }
  }
  ship.zPosition = floor32(ship.zPosition);

  let xGran = dest.xPosition > ship.xPosition ? 0x7d / 0x80 : -(0x7d / 0x80);
  while (Math.abs(xGran) > 0) {
    fake = cloneShip(ship);
    fake.xPosition += xGran;
    if (
      Math.abs(dest.xPosition - ship.xPosition) >= Math.abs(xGran) &&
      !isInsideTile(level, fake.xPosition, fake.yPosition, fake.zPosition)
    ) {
      ship.xPosition = fake.xPosition;
    } else {
      xGran = sFloor(xGran / 5 * 0x80) / 0x80;
    }
  }
  ship.xPosition = floor16(ship.xPosition);

  let yGran = dest.yPosition > ship.yPosition ? 0x7d / 0x80 : -(0x7d / 0x80);
  while (Math.abs(yGran) > 0) {
    fake = cloneShip(ship);
    fake.yPosition += yGran;
    if (
      Math.abs(dest.yPosition - ship.yPosition) >= Math.abs(yGran) &&
      !isInsideTile(level, fake.xPosition, fake.yPosition, fake.zPosition)
    ) {
      ship.yPosition = fake.yPosition;
    } else {
      yGran = sFloor(yGran / 5 * 0x80) / 0x80;
    }
  }
  ship.yPosition = floor16(ship.yPosition);
}

function handleBumps(ship, expected, level, events) {
  let movedShip = cloneShip(ship);
  movedShip.zPosition = expected.zPosition;
  if (
    ship.zPosition !== expected.zPosition &&
    isInsideTile(level, movedShip.xPosition, movedShip.yPosition, movedShip.zPosition)
  ) {
    const bumpOff = 0x3a0 / 0x80;
    movedShip = cloneShip(ship);
    movedShip.xPosition = ship.xPosition - bumpOff;
    movedShip.zPosition = expected.zPosition;
    if (!isInsideTile(level, movedShip.xPosition, movedShip.yPosition, movedShip.zPosition)) {
      ship.xPosition = movedShip.xPosition;
      expected.zPosition = ship.zPosition;
      events.push(GAMEPLAY_EVENT.SHIP_BUMPED_WALL);
    } else {
      movedShip.xPosition = ship.xPosition + bumpOff;
      if (!isInsideTile(level, movedShip.xPosition, movedShip.yPosition, movedShip.zPosition)) {
        ship.xPosition = movedShip.xPosition;
        expected.zPosition = ship.zPosition;
        events.push(GAMEPLAY_EVENT.SHIP_BUMPED_WALL);
      }
    }
  }
}

function handleCollision(ship, expected, events, physics) {
  if (Math.abs(ship.zPosition - expected.zPosition) <= 0.01) return;
  if (ship.zVelocity < (1 / 3) * maxZVelocity(physics)) {
    ship.zVelocity = 0;
    events.push(GAMEPLAY_EVENT.SHIP_BUMPED_WALL);
  } else if (ship.state !== SHIP_STATE.EXPLODED) {
    ship.state = SHIP_STATE.EXPLODED;
    events.push(GAMEPLAY_EVENT.SHIP_EXPLODED);
  }
}

function handleSlideCollision(ship, expected, physics) {
  if (Math.abs(ship.xPosition - expected.xPosition) <= 0.01) return;
  ship.xMovementBase = 0;
  if (ship.slideAmount !== 0) {
    expected.xPosition = ship.xPosition;
    ship.slideAmount = 0;
  }
  ship.zVelocity -= 0x97 / 0x10000;
  clampGlobalZVelocity(ship, physics);
}

function handleBounce(ship, expected, level) {
  ship.isOnGround = false;
  if (ship.yVelocity < 0 && expected.yPosition !== ship.yPosition) {
    ship.zVelocity += ship.jumpOMasterVelocityDelta;
    ship.jumpOMasterVelocityDelta = 0;
    ship.hasRunJumpOMaster = false;
    ship.jumpOMasterInUse = false;
    ship.isGoingUp = false;
    ship.isOnGround = true;
    ship.slidingAccel = 0;

    let movedShip;
    for (let i = 1; i <= 0x0e; i++) {
      movedShip = cloneShip(ship);
      movedShip.xPosition += i;
      movedShip.yPosition -= 1 / 0x80;
      if (!isInsideTile(level, movedShip.xPosition, movedShip.yPosition, movedShip.zPosition)) {
        ship.slidingAccel += 1;
        ship.offsetAtWhichNotInsideTile = i;
        break;
      }
    }

    for (let i = 1; i <= 0x0e; i++) {
      movedShip = cloneShip(ship);
      movedShip.xPosition -= i;
      movedShip.yPosition -= 1 / 0x80;
      if (!isInsideTile(level, movedShip.xPosition, movedShip.yPosition, movedShip.zPosition)) {
        ship.slidingAccel -= 1;
        ship.offsetAtWhichNotInsideTile = i;
        break;
      }
    }

    if (ship.slidingAccel !== 0) {
      ship.slideAmount += 0x11 * ship.slidingAccel / 0x80;
    } else {
      ship.slideAmount = 0;
    }
  }
}

function handleOxygenAndFuel(ship, level, physics) {
  ship.oxygenRemaining -= FULL_RESOURCE / (0x24 * level.oxygen);
  if (ship.oxygenRemaining <= 0) {
    ship.oxygenRemaining = 0;
    ship.state = SHIP_STATE.OUT_OF_OXYGEN;
  }

  ship.fuelRemaining -= ship.zVelocity * FULL_RESOURCE / fuelDenominator(level, physics);
  if (ship.fuelRemaining <= 0) {
    ship.fuelRemaining = 0;
    ship.state = SHIP_STATE.OUT_OF_FUEL;
  }
}

function handleFallBelowGround(ship) {
  if (ship.state === SHIP_STATE.ALIVE && ship.yPosition < GROUND_Y) {
    ship.state = SHIP_STATE.FALLEN;
    ship.yPosition = Math.min(ship.yPosition, GROUND_Y);
    ship.yVelocity = 0;
    ship.zVelocity = 0;
    ship.xMovementBase = 0;
    ship.slideAmount = 0;
    ship.jumpOMasterVelocityDelta = 0;
    ship.jumpOMasterInUse = false;
    ship.hasRunJumpOMaster = false;
    ship.isOnGround = false;
    ship.isGoingUp = false;
  }
}

function isOnNothing(level, xPosition, zPosition) {
  const cell = getCell(level, xPosition, 0, zPosition);
  return isEmptyCell(cell) || (cell.tile && cell.tileEffect === TOUCH_EFFECT.KILL);
}

function willLandOnTile(ship, controls, startShip, level, physics) {
  let xPosition = startShip.xPosition;
  let yPosition = startShip.yPosition;
  let zPosition = startShip.zPosition;
  const xVelocity = startShip.xMovementBase;
  let yVelocity = startShip.yVelocity;
  let zVelocity = startShip.zVelocity;

  for (;;) {
    const currentX = xPosition;
    const currentSlideAmount = ship.slideAmount;
    const currentZ = zPosition;

    yVelocity += gravityAcceleration(level);
    zPosition += zVelocity;

    const xRate = zVelocity + 0x618 / 0x10000;
    const xMove = xVelocity * xRate * 128 + currentSlideAmount;
    xPosition += xMove;
    if (xPosition < LEVEL_MIN_X || xPosition > LEVEL_MAX_X) return false;

    yPosition += yVelocity;
    zVelocity = clampZVelocity(zVelocity + controls.accel * throttleForce(physics), physics);

    if (yPosition <= GROUND_Y) {
      return !isOnNothing(level, currentX, currentZ) && !isOnNothing(level, xPosition, zPosition);
    }
  }
}

function runJumpOMaster(ship, controls, level, physics) {
  if (willLandOnTile(ship, controls, cloneShip(ship), level, physics)) return;

  const zVelocity = ship.zVelocity;
  const xMovementBase = ship.xMovementBase;
  let success = false;
  for (let i = 1; i <= 6; i++) {
    ship.xMovementBase = floor16(xMovementBase + xMovementBase * i / 10);
    if (willLandOnTile(ship, controls, cloneShip(ship), level, physics)) {
      success = true;
      break;
    }

    ship.xMovementBase = floor16(xMovementBase - xMovementBase * i / 10);
    if (willLandOnTile(ship, controls, cloneShip(ship), level, physics)) {
      success = true;
      break;
    }

    ship.xMovementBase = xMovementBase;

    let zVelocity2 = floor32(zVelocity + zVelocity * i / 10);
    ship.zVelocity = clampZVelocity(zVelocity2, physics);
    if (ship.zVelocity === zVelocity2 && willLandOnTile(ship, controls, cloneShip(ship), level, physics)) {
      success = true;
      break;
    }

    zVelocity2 = floor32(zVelocity - zVelocity * i / 10);
    ship.zVelocity = clampZVelocity(zVelocity2, physics);
    if (ship.zVelocity === zVelocity2 && willLandOnTile(ship, controls, cloneShip(ship), level, physics)) {
      success = true;
      break;
    }

    ship.zVelocity = zVelocity;
  }

  ship.jumpOMasterVelocityDelta = zVelocity - ship.zVelocity;
  if (success) ship.jumpOMasterInUse = true;
}

function updateJumpOMaster(ship, controls, level, physics) {
  if (ship.isGoingUp && !ship.hasRunJumpOMaster && ship.yPosition >= 110) {
    runJumpOMaster(ship, controls, level, physics);
    ship.hasRunJumpOMaster = true;
  }
}

function updateShip(ship, level, expected, controls, physics) {
  const events = [];
  sanitizeParameters(ship);
  const canControl = ship.state === SHIP_STATE.ALIVE;

  const cell = getCell(level, ship.xPosition, ship.yPosition, ship.zPosition);
  const isAboveNothing = isEmptyCell(cell);
  const touchEffect = getTouchEffect(ship, cell);
  const isOnSlidingTile = touchEffect === TOUCH_EFFECT.SLIDE;
  const isOnDecelPad = touchEffect === TOUCH_EFFECT.DECELERATE;

  applyTouchEffect(ship, touchEffect, events, physics);
  updateYVelocity(ship, expected, level, events);
  updateZVelocity(ship, canControl, controls.accel, physics);
  updateXVelocity(ship, canControl, controls.turn, isOnSlidingTile, isAboveNothing, physics);
  updateJump(ship, canControl, isAboveNothing, controls.jump, level, physics);
  updateJumpOMaster(ship, controls, level, physics);
  updateGravity(ship, level);

  assignShip(expected, ship);
  attemptMotion(expected, isOnDecelPad);
  sanitizeParameters(expected);
  moveTo(ship, expected, level);
  sanitizeParameters(ship);
  sanitizeParameters(expected);
  handleBumps(ship, expected, level, events);
  handleCollision(ship, expected, events, physics);
  handleSlideCollision(ship, expected, physics);
  handleBounce(ship, expected, level);
  handleOxygenAndFuel(ship, level, physics);
  handleFallBelowGround(ship);

  return events;
}

export class SkyRoadsSim {
  constructor(level, options = {}) {
    this.level = normalizeLevel(level);
    this.physics = createRacePhysicsConfig(options.physicsConfig ?? options.tuningConfig ?? DEFAULT_RACE_PHYSICS_CONFIG);
    this.ship = createInitialShip();
    this.expectedShip = cloneShip(this.ship);
    this.didWin = false;
    this.lastControls = { turn: 0, accel: 0, jump: false };
    this.deathFrameIndex = null;
    this.frameIndex = 0;
  }

  tick(controlsInput = {}) {
    const controls = normalizeControls(controlsInput);
    this.lastControls = controls;
    const previousState = this.ship.state;
    const events = updateShip(this.ship, this.level, this.expectedShip, controls, this.physics);
    if (
      previousState === SHIP_STATE.ALIVE &&
      this.ship.state !== SHIP_STATE.ALIVE &&
      this.deathFrameIndex == null
    ) {
      this.deathFrameIndex = this.frameIndex;
    }
    if (
      this.ship.zPosition >= this.level.length - 0.5 &&
      isInsideTunnel(this.level, this.ship.xPosition, this.ship.yPosition, this.ship.zPosition)
    ) {
      this.didWin = true;
    }

    const result = this.frameResult(controls, events);
    this.frameIndex += 1;
    return result;
  }

  frameResult(controls = this.lastControls, events = []) {
    return {
      frameIndex: this.frameIndex,
      controls: { ...controls },
      x: this.ship.xPosition,
      y: this.ship.yPosition,
      z: this.ship.zPosition,
      zVel: this.ship.zVelocity + this.ship.jumpOMasterVelocityDelta,
      state: this.ship.state,
      craftState: this.ship.state,
      oxygenPct: this.ship.oxygenRemaining / FULL_RESOURCE,
      o2Pct: this.ship.oxygenRemaining / FULL_RESOURCE,
      fuelPct: this.ship.fuelRemaining / FULL_RESOURCE,
      jumpOMasterInUse: this.ship.jumpOMasterInUse,
      jumpOMasterVelocityDelta: this.ship.jumpOMasterVelocityDelta,
      events: [...events],
      didWin: this.didWin,
      row: Math.max(0, Math.floor(this.ship.zPosition)),
    };
  }

  snapshot() {
    return this.frameResult(this.lastControls, []);
  }
}

export class AlphaSimSession {
  constructor(level, options = {}) {
    this.level = normalizeLevel(level);
    this.physics = createRacePhysicsConfig(options.physicsConfig ?? options.tuningConfig ?? DEFAULT_RACE_PHYSICS_CONFIG);
    this.sim = new SkyRoadsSim(this.level, { physicsConfig: this.physics });
    this.sessionState = SESSION_STATE.PLAYING;
    this.lastFrame = { ...this.sim.snapshot(), sessionState: this.sessionState, frozen: false };
  }

  tick(controls = {}) {
    if (this.sessionState !== SESSION_STATE.PLAYING) {
      return { ...this.lastFrame, events: [], sessionState: this.sessionState, frozen: true };
    }

    const frame = this.sim.tick(controls);
    if (frame.didWin) this.sessionState = SESSION_STATE.WON;
    else if (frame.state !== SHIP_STATE.ALIVE) this.sessionState = SESSION_STATE.FAILED;
    this.lastFrame = { ...frame, sessionState: this.sessionState, frozen: false };
    return this.lastFrame;
  }

  restart() {
    this.sim = new SkyRoadsSim(this.level, { physicsConfig: this.physics });
    this.sessionState = SESSION_STATE.PLAYING;
    this.lastFrame = { ...this.sim.snapshot(), sessionState: this.sessionState, frozen: false };
    return this.lastFrame;
  }

  snapshot() {
    return { ...this.lastFrame, sessionState: this.sessionState };
  }
}

export const Sim = SkyRoadsSim;
