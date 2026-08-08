import { AlphaSimSession, TICKS_PER_SECOND } from './sim.js';

export const FIXED_TICK_HZ = TICKS_PER_SECOND;
export const FIXED_STEP_MS = 1000 / FIXED_TICK_HZ;
export const DEFAULT_MAX_CATCH_UP_TICKS = 5;

const EPSILON_MS = 1e-7;
const NEUTRAL_CONTROLS = Object.freeze({ turn: 0, accel: 0, jump: false });

function cloneFrame(frame) {
  return {
    ...frame,
    controls: { ...(frame.controls ?? NEUTRAL_CONTROLS) },
    events: [...(frame.events ?? [])],
  };
}

function controlsFrom(provider) {
  if (typeof provider === 'function') return provider();
  return provider ?? NEUTRAL_CONTROLS;
}

export class FixedStepRuntime {
  constructor(sessionOrLevel, options = {}) {
    const sessionLike =
      sessionOrLevel &&
      typeof sessionOrLevel.tick === 'function' &&
      typeof sessionOrLevel.snapshot === 'function' &&
      typeof sessionOrLevel.restart === 'function';
    this.session = sessionLike ? sessionOrLevel : new AlphaSimSession(sessionOrLevel);
    this.maxCatchUpTicks = options.maxCatchUpTicks ?? DEFAULT_MAX_CATCH_UP_TICKS;
    this.restartCount = 0;
    this._resetState(null);
  }

  _resetState(nowMs) {
    const frame = this.session.snapshot();
    this.previousFrame = cloneFrame(frame);
    this.currentFrame = cloneFrame(frame);
    this.accumulatorMs = 0;
    this.lastNowMs = Number.isFinite(nowMs) ? nowMs : null;
    this.frameCount = 0;
    this.simTickCount = 0;
    this.droppedCatchUpCount = 0;
    this.droppedCatchUpMs = 0;
    this.lastTickControls = { ...NEUTRAL_CONTROLS };
  }

  restart(nowMs = null) {
    this.session.restart();
    this.restartCount += 1;
    this._resetState(nowMs);
    return this.renderState(0, 0, []);
  }

  hold(nowMs = null) {
    if (Number.isFinite(nowMs)) this.lastNowMs = nowMs;
    this.accumulatorMs = 0;
    this.frameCount += 1;
    return this.renderState(0, 0, []);
  }

  advance(nowMs, controlsProvider = NEUTRAL_CONTROLS) {
    let ticksThisFrame = 0;
    let droppedThisFrame = 0;
    const tickFramesThisFrame = [];

    if (this.lastNowMs == null) {
      this.lastNowMs = nowMs;
      this.frameCount += 1;
      return this.renderState(ticksThisFrame, droppedThisFrame, tickFramesThisFrame);
    }

    const deltaMs = Math.max(0, nowMs - this.lastNowMs);
    this.lastNowMs = nowMs;
    this.accumulatorMs += deltaMs;

    const controls = controlsFrom(controlsProvider);
    while (
      this.accumulatorMs + EPSILON_MS >= FIXED_STEP_MS &&
      ticksThisFrame < this.maxCatchUpTicks &&
      this.currentFrame.sessionState === 'playing'
    ) {
      this.previousFrame = cloneFrame(this.currentFrame);
      this.currentFrame = cloneFrame(this.session.tick(controls));
      tickFramesThisFrame.push(cloneFrame(this.currentFrame));
      this.lastTickControls = { ...controls };
      this.accumulatorMs -= FIXED_STEP_MS;
      this.simTickCount += 1;
      ticksThisFrame += 1;
    }

    if (this.accumulatorMs + EPSILON_MS >= FIXED_STEP_MS) {
      droppedThisFrame = Math.floor((this.accumulatorMs + EPSILON_MS) / FIXED_STEP_MS);
      this.droppedCatchUpCount += droppedThisFrame;
      this.droppedCatchUpMs += this.accumulatorMs;
      this.accumulatorMs = 0;
    }

    if (this.currentFrame.sessionState !== 'playing') {
      this.accumulatorMs = 0;
    }

    this.frameCount += 1;
    return this.renderState(ticksThisFrame, droppedThisFrame, tickFramesThisFrame);
  }

  counters() {
    return {
      fixedTickHz: FIXED_TICK_HZ,
      fixedStepMs: FIXED_STEP_MS,
      frameCount: this.frameCount,
      simTickCount: this.simTickCount,
      droppedCatchUpCount: this.droppedCatchUpCount,
      droppedCatchUpMs: this.droppedCatchUpMs,
      accumulatorMs: this.accumulatorMs,
      maxCatchUpTicks: this.maxCatchUpTicks,
      restartCount: this.restartCount,
      lastTickControls: { ...this.lastTickControls },
    };
  }

  renderState(ticksThisFrame, droppedThisFrame, tickFramesThisFrame = []) {
    const alpha = Math.min(1, Math.max(0, this.accumulatorMs / FIXED_STEP_MS));
    const clonedTickFrames = tickFramesThisFrame.map((frame) => cloneFrame(frame));
    return {
      previous: cloneFrame(this.previousFrame),
      current: cloneFrame(this.currentFrame),
      alpha,
      ticksThisFrame,
      droppedThisFrame,
      tickFramesThisFrame: clonedTickFrames,
      eventsThisFrame: clonedTickFrames.flatMap((frame) => frame.events ?? []),
      counters: this.counters(),
    };
  }
}
