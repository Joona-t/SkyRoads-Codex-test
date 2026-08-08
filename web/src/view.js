import {
  CRAFT_GROUND_CLEARANCE,
  gameXToWorld,
  gameYToWorld,
  gameZToWorld,
} from './units.js';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, alpha) {
  return a + (b - a) * alpha;
}

export function gameToWorldPosition(frame, constants) {
  return {
    x: gameXToWorld(frame.x, constants.levelCenterX),
    y: gameYToWorld(frame.y, constants.groundY) + CRAFT_GROUND_CLEARANCE,
    z: gameZToWorld(frame.z),
  };
}

export function interpolateFrames(previous, current, alpha) {
  const t = clamp(alpha, 0, 1);
  return {
    ...current,
    controls: { ...(current.controls ?? { turn: 0, accel: 0, jump: false }) },
    events: [...(current.events ?? [])],
    x: lerp(previous.x, current.x, t),
    y: lerp(previous.y, current.y, t),
    z: lerp(previous.z, current.z, t),
    zVel: lerp(previous.zVel ?? 0, current.zVel ?? 0, t),
    fuelPct: lerp(previous.fuelPct ?? current.fuelPct, current.fuelPct, t),
    oxygenPct: lerp(previous.oxygenPct ?? current.oxygenPct, current.oxygenPct, t),
    o2Pct: lerp(previous.o2Pct ?? current.o2Pct, current.o2Pct, t),
  };
}

export function createCraftPresentation(previous, current, alpha, level, options = {}) {
  const frame = interpolateFrames(previous, current, alpha);
  const position = gameToWorldPosition(frame, level.constants);
  const terminalElapsedMs = Math.max(0, options.terminalElapsedMs ?? 0);
  const terminalProgress = frame.sessionState !== 'playing'
    ? clamp(terminalElapsedMs / 750, 0, 1)
    : 0;
  const fallenDrop = frame.state === 'Fallen' ? terminalProgress * 2.4 : 0;
  const lateralDelta = current.x - previous.x;
  const turn = current.controls?.turn ?? 0;
  const bank = clamp(turn * 0.28 + lateralDelta * 0.025, -0.58, 0.58);
  const pitch = clamp((current.y - previous.y) * 0.025 + (current.controls?.jump ? -0.08 : 0), -0.34, 0.42);
  return {
    frame,
    position: {
      ...position,
      y: position.y - fallenDrop,
    },
    simPosition: position,
    rotation: {
      x: pitch,
      y: Math.PI,
      z: -bank,
    },
    bank,
    pitch,
    terminal: current.sessionState !== 'playing',
    terminalElapsedMs,
    terminalFade: current.sessionState !== 'playing' && frame.state === 'Fallen'
      ? 1 - terminalProgress * 0.45
      : 1,
  };
}

export function cameraProfileForAspect(aspect = 16 / 9) {
  const wide = aspect >= 1.65;
  const tall = aspect < 0.85;
  return {
    fov: wide ? 58 : tall ? 68 : 62,
    distance: wide ? 9.8 : tall ? 13.4 : 11.2,
    height: wide ? 4.55 : tall ? 6.2 : 5.15,
    lookAhead: wide ? 15.6 : tall ? 19.5 : 17.2,
    lateralFollow: wide ? 0.34 : 0.42,
  };
}

export function computeChaseCamera(position, options = {}) {
  const profile = cameraProfileForAspect(options.aspect);
  const distance = options.distance ?? profile.distance;
  const height = options.height ?? profile.height;
  const lookAhead = options.lookAhead ?? profile.lookAhead;
  const lateralFollow = options.lateralFollow ?? profile.lateralFollow;
  return {
    position: {
      x: position.x * lateralFollow,
      y: Math.max(3.2, position.y + height),
      z: position.z + distance,
    },
    lookAt: {
      x: position.x,
      y: position.y + 0.65,
      z: position.z - lookAhead,
    },
  };
}

export function applyCraftTransform(object, presentation) {
  object.position.set(presentation.position.x, presentation.position.y, presentation.position.z);
  object.rotation.set(
    presentation.rotation.x,
    presentation.rotation.y,
    presentation.rotation.z
  );
}

export function progressRatio(frame, level) {
  const startZ = level.start?.z ?? 3;
  const finishZ = Math.max(startZ + 1, level.length - 0.5);
  return clamp((frame.z - startZ) / (finishZ - startZ), 0, 1);
}
