import { GAMEPLAY_EVENT, SESSION_STATE } from './sim.js';
import { GROUND_Y, TOUCH_EFFECT, getCell } from './level-physics.js';

export const AUDIO_EVENT = Object.freeze({
  BUMP: 'bump',
  BOUNCE: 'bounce',
  PAD: 'pad',
  REFILL: 'refill',
  WIN: 'win',
  FAILURE: 'failure',
});

export const DEFAULT_AUDIO_SETTINGS = Object.freeze({
  muted: false,
  volume: 0.8,
  music: true,
  retroMuzax: false,
});

export const SFX_VOICE_COUNT = 8;
export const MUSIC_OSCILLATOR_COUNT = 4;

const MUSIC_STEP_MS = 125;
const MIN_GAIN = 0.0001;
const PLAYING_STATES = new Set(['running', 'interrupted']);
const PAD_EFFECTS = new Set([
  TOUCH_EFFECT.ACCELERATE,
  TOUCH_EFFECT.DECELERATE,
  TOUCH_EFFECT.SLIDE,
]);

const GAMEPLAY_AUDIO_EVENT = Object.freeze({
  [GAMEPLAY_EVENT.SHIP_BUMPED_WALL]: AUDIO_EVENT.BUMP,
  [GAMEPLAY_EVENT.SHIP_BOUNCED]: AUDIO_EVENT.BOUNCE,
  [GAMEPLAY_EVENT.SHIP_REFILLED]: AUDIO_EVENT.REFILL,
  [GAMEPLAY_EVENT.SHIP_EXPLODED]: AUDIO_EVENT.FAILURE,
});

const SFX_PATCHES = Object.freeze({
  [AUDIO_EVENT.BUMP]: Object.freeze({
    type: 'square',
    gain: 0.24,
    duration: 0.16,
    frequencies: [132, 74],
  }),
  [AUDIO_EVENT.BOUNCE]: Object.freeze({
    type: 'triangle',
    gain: 0.2,
    duration: 0.2,
    frequencies: [390, 610, 520],
  }),
  [AUDIO_EVENT.PAD]: Object.freeze({
    type: 'sawtooth',
    gain: 0.16,
    duration: 0.18,
    frequencies: [220, 330, 440],
  }),
  [AUDIO_EVENT.REFILL]: Object.freeze({
    type: 'sine',
    gain: 0.22,
    duration: 0.36,
    frequencies: [523.25, 659.25, 783.99, 1046.5],
  }),
  [AUDIO_EVENT.WIN]: Object.freeze({
    type: 'triangle',
    gain: 0.24,
    duration: 0.58,
    frequencies: [392, 493.88, 587.33, 783.99],
  }),
  [AUDIO_EVENT.FAILURE]: Object.freeze({
    type: 'sawtooth',
    gain: 0.26,
    duration: 0.5,
    frequencies: [196, 130.81, 98],
  }),
});

const MUSIC_SEQUENCES = Object.freeze({
  bass: Object.freeze([55, 55, 65.41, 55, 82.41, 82.41, 73.42, 49]),
  lead: Object.freeze([220, 246.94, 329.63, 293.66, 246.94, 392, 329.63, 293.66]),
  padA: Object.freeze([110, 110, 130.81, 130.81, 98, 98, 146.83, 146.83]),
  padB: Object.freeze([164.81, 164.81, 196, 196, 146.83, 146.83, 220, 220]),
});

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cloneFrame(frame) {
  if (!frame) return null;
  return {
    frameIndex: frame.frameIndex,
    x: frame.x,
    y: frame.y,
    z: frame.z,
    row: frame.row,
    sessionState: frame.sessionState,
    events: [...(frame.events ?? [])],
  };
}

function paramSet(param, value, atTime = 0) {
  if (!param) return;
  if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, atTime);
  else param.value = value;
}

function paramRamp(param, value, atTime = 0) {
  if (!param) return;
  if (typeof param.exponentialRampToValueAtTime === 'function' && value > 0) {
    param.exponentialRampToValueAtTime(value, atTime);
  } else if (typeof param.linearRampToValueAtTime === 'function') {
    param.linearRampToValueAtTime(value, atTime);
  } else {
    param.value = value;
  }
}

function paramCancel(param, atTime = 0) {
  if (typeof param?.cancelScheduledValues === 'function') param.cancelScheduledValues(atTime);
}

function startOscillator(oscillator) {
  if (typeof oscillator?.start === 'function') oscillator.start();
}

function stopOscillator(oscillator) {
  try {
    if (typeof oscillator?.stop === 'function') oscillator.stop();
  } catch (_error) {
    // OscillatorNode.stop() is one-shot in real Web Audio. Disposal is best-effort.
  }
}

function safeConnect(source, destination) {
  if (typeof source?.connect === 'function') source.connect(destination);
}

function safeDisconnect(node) {
  try {
    if (typeof node?.disconnect === 'function') node.disconnect();
  } catch (_error) {
    // Some fake contexts and already-disconnected real nodes throw here.
  }
}

function contextState(context) {
  return context?.state ?? 'missing';
}

function isContextRunning(context) {
  return PLAYING_STATES.has(contextState(context));
}

function defaultContextFactory() {
  const Constructor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return Constructor ? new Constructor() : null;
}

function defaultTimerApi() {
  return {
    setInterval: globalThis.setInterval?.bind(globalThis),
    clearInterval: globalThis.clearInterval?.bind(globalThis),
  };
}

export function normalizeAudioSettings(input = {}) {
  return Object.freeze({
    muted: input?.muted === true,
    volume: clampNumber(input?.volume, 0, 1, DEFAULT_AUDIO_SETTINGS.volume),
    music: input?.music !== false,
    retroMuzax: false,
  });
}

export function createRetroMuzaxCapability() {
  return Object.freeze({
    id: 'retro-muzax-byo',
    label: 'Retro/MUZAX BYO playback',
    available: false,
    enabled: false,
    enabledByDefault: false,
    reason: 'byo-data-required',
    attribution:
      'Retro/MUZAX playback requires user-provided SkyRoads MUZAX.LZS and SFX.SND data. The web build ships no source music or sound recordings.',
  });
}

function padContactForFrame(frame, level) {
  if (!level || !Number.isFinite(frame?.x) || !Number.isFinite(frame?.y) || !Number.isFinite(frame?.z)) {
    return null;
  }
  const groundY = level.constants?.groundY ?? GROUND_Y;
  if (Math.abs(frame.y - groundY) > 0.75) return null;
  const cell = getCell(level, frame.x, frame.y, frame.z);
  if (!PAD_EFFECTS.has(cell.tileEffect)) return null;
  return {
    effect: cell.tileEffect,
    row: Math.max(0, Math.floor(frame.z)),
  };
}

function pushAudioEvent(events, event) {
  if (event && !events.includes(event)) events.push(event);
}

export function audioEventsForFrame(frame, previousFrame = null, level = null, state = {}) {
  const events = [];
  for (const event of frame?.events ?? []) {
    const audioEvent = GAMEPLAY_AUDIO_EVENT[event];
    pushAudioEvent(events, audioEvent);
  }

  const padContact = padContactForFrame(frame, level);
  if (padContact && state.lastPadEffect !== padContact.effect) {
    pushAudioEvent(events, AUDIO_EVENT.PAD);
  }
  state.lastPadEffect = padContact?.effect ?? null;

  const previousSession = previousFrame?.sessionState ?? SESSION_STATE.PLAYING;
  if (previousSession === SESSION_STATE.PLAYING && frame?.sessionState === SESSION_STATE.WON) {
    pushAudioEvent(events, AUDIO_EVENT.WIN);
  } else if (previousSession === SESSION_STATE.PLAYING && frame?.sessionState === SESSION_STATE.FAILED) {
    pushAudioEvent(events, AUDIO_EVENT.FAILURE);
  }
  return events;
}

export class RuntimeAudioEventMapper {
  constructor(options = {}) {
    this.level = options.level ?? null;
    this.lastFrame = null;
    this.lastProcessedFrameIndex = null;
    this.padState = { lastPadEffect: null };
  }

  reset(level = this.level) {
    this.level = level;
    this.lastFrame = null;
    this.lastProcessedFrameIndex = null;
    this.padState.lastPadEffect = null;
  }

  collect(renderState, options = {}) {
    const level = options.level ?? this.level;
    const frames = Array.isArray(renderState?.tickFramesThisFrame) && renderState.tickFramesThisFrame.length > 0
      ? renderState.tickFramesThisFrame
      : renderState?.ticksThisFrame > 0
        ? [renderState.current]
        : [];
    const events = [];
    for (const frame of frames) {
      if (!frame) continue;
      const frameIndex = frame.frameIndex ?? null;
      if (frameIndex != null && frameIndex === this.lastProcessedFrameIndex) continue;
      events.push(...audioEventsForFrame(frame, this.lastFrame, level, this.padState));
      this.lastFrame = cloneFrame(frame);
      this.lastProcessedFrameIndex = frameIndex;
    }
    return events;
  }

  snapshot() {
    return {
      lastProcessedFrameIndex: this.lastProcessedFrameIndex,
      lastFrame: cloneFrame(this.lastFrame),
      lastPadEffect: this.padState.lastPadEffect,
    };
  }
}

function createToneVoice(context, destination, label) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  const gain = context.createGain();
  paramSet(gain.gain, 0, context.currentTime ?? 0);
  safeConnect(oscillator, gain);
  safeConnect(gain, destination);
  startOscillator(oscillator);
  return {
    label,
    oscillator,
    gain,
    busyUntil: 0,
    stop() {
      stopOscillator(oscillator);
      safeDisconnect(gain);
      safeDisconnect(oscillator);
    },
  };
}

function configureVoice(context, voice, patch) {
  const now = context.currentTime ?? 0;
  const duration = Math.max(0.01, patch.duration);
  const frequencies = patch.frequencies.length > 0 ? patch.frequencies : [220];
  voice.oscillator.type = patch.type;
  paramCancel(voice.oscillator.frequency, now);
  frequencies.forEach((frequency, index) => {
    const at = now + duration * index / Math.max(1, frequencies.length - 1);
    paramSet(voice.oscillator.frequency, frequency, at);
  });
  paramCancel(voice.gain.gain, now);
  paramSet(voice.gain.gain, MIN_GAIN, now);
  paramRamp(voice.gain.gain, patch.gain, now + 0.012);
  paramRamp(voice.gain.gain, MIN_GAIN, now + duration);
  voice.busyUntil = now + duration;
}

function createGraph(context) {
  const master = context.createGain();
  const music = context.createGain();
  const sfx = context.createGain();
  paramSet(master.gain, DEFAULT_AUDIO_SETTINGS.volume, context.currentTime ?? 0);
  paramSet(music.gain, 0, context.currentTime ?? 0);
  paramSet(sfx.gain, 0.9, context.currentTime ?? 0);
  safeConnect(music, master);
  safeConnect(sfx, master);
  safeConnect(master, context.destination);

  const musicVoices = Array.from({ length: MUSIC_OSCILLATOR_COUNT }, (_, index) =>
    createToneVoice(context, music, `music-${index}`)
  );
  const [bass, lead, padA, padB] = musicVoices;
  bass.oscillator.type = 'sawtooth';
  lead.oscillator.type = 'square';
  padA.oscillator.type = 'triangle';
  padB.oscillator.type = 'triangle';
  paramSet(bass.gain.gain, 0.08, context.currentTime ?? 0);
  paramSet(lead.gain.gain, 0.02, context.currentTime ?? 0);
  paramSet(padA.gain.gain, 0.035, context.currentTime ?? 0);
  paramSet(padB.gain.gain, 0.03, context.currentTime ?? 0);

  const sfxVoices = Array.from({ length: SFX_VOICE_COUNT }, (_, index) =>
    createToneVoice(context, sfx, `sfx-${index}`)
  );

  return {
    master,
    music,
    sfx,
    musicVoices,
    sfxVoices,
    stop() {
      for (const voice of [...musicVoices, ...sfxVoices]) voice.stop();
      for (const node of [sfx, music, master]) safeDisconnect(node);
    },
  };
}

export function createAudioController(options = {}) {
  let settings = normalizeAudioSettings(options.settings ?? DEFAULT_AUDIO_SETTINGS);
  const contextFactory = options.contextFactory ?? defaultContextFactory;
  const timers = options.timerApi ?? defaultTimerApi();
  const nodeBudget = Object.freeze({
    sfxVoices: options.sfxVoices ?? SFX_VOICE_COUNT,
    musicOscillators: MUSIC_OSCILLATOR_COUNT,
  });
  let context = null;
  let graph = null;
  let activated = false;
  let unavailableReason = null;
  let currentPolicy = 'silent';
  let visibilityHidden = false;
  let musicTimer = null;
  let musicStep = 0;
  let voiceCursor = 0;
  let handledEventCount = 0;
  let suppressedEventCount = 0;
  let contextCreateCount = 0;
  let disposed = false;
  const handledEvents = [];
  const lifecycle = [];

  function snapshot() {
    return {
      activated,
      unavailableReason,
      contextCreated: contextCreateCount,
      contextState: contextState(context),
      policy: currentPolicy,
      visibilityHidden,
      musicTimerActive: musicTimer != null,
      settings: { ...settings },
      nodeBudget: { ...nodeBudget },
      handledEventCount,
      suppressedEventCount,
      handledEvents: [...handledEvents],
      retroMuzax: createRetroMuzaxCapability(),
      disposed,
    };
  }

  function setMasterVolume() {
    if (!graph) return;
    const now = context.currentTime ?? 0;
    paramSet(graph.master.gain, settings.muted ? 0 : settings.volume, now);
  }

  function targetMusicGain() {
    if (settings.muted || !settings.music || currentPolicy === 'silent') return 0;
    if (currentPolicy === 'race') return 0.42;
    if (currentPolicy === 'race-armed') return 0.2;
    if (currentPolicy === 'results') return 0.28;
    return 0.24;
  }

  function scheduleMusicStep() {
    if (!graph || !context || settings.muted || !settings.music) return;
    const now = context.currentTime ?? 0;
    const step = musicStep % MUSIC_SEQUENCES.bass.length;
    const [bass, lead, padA, padB] = graph.musicVoices;
    paramSet(bass.oscillator.frequency, MUSIC_SEQUENCES.bass[step], now);
    paramSet(lead.oscillator.frequency, MUSIC_SEQUENCES.lead[step], now);
    paramSet(padA.oscillator.frequency, MUSIC_SEQUENCES.padA[step], now);
    paramSet(padB.oscillator.frequency, MUSIC_SEQUENCES.padB[step], now);
    paramCancel(lead.gain.gain, now);
    paramSet(lead.gain.gain, step % 2 === 0 ? 0.09 : 0.025, now);
    paramRamp(lead.gain.gain, 0.018, now + 0.1);
    musicStep += 1;
  }

  function stopMusicTimer() {
    if (musicTimer == null) return;
    timers.clearInterval?.(musicTimer);
    musicTimer = null;
  }

  function startMusicTimer() {
    if (musicTimer != null || !timers.setInterval || !graph || settings.muted || !settings.music) return;
    scheduleMusicStep();
    musicTimer = timers.setInterval(scheduleMusicStep, MUSIC_STEP_MS);
  }

  function syncMusic() {
    if (!graph || !context) return;
    const now = context.currentTime ?? 0;
    const gain = targetMusicGain();
    paramSet(graph.music.gain, gain, now);
    if (gain > 0 && isContextRunning(context) && !visibilityHidden && currentPolicy !== 'ducked') {
      startMusicTimer();
    } else {
      stopMusicTimer();
    }
  }

  function shouldSuspend() {
    return visibilityHidden || currentPolicy === 'ducked';
  }

  async function syncContext() {
    if (!context || !activated || disposed) return snapshot();
    setMasterVolume();
    if (shouldSuspend()) {
      stopMusicTimer();
      if (contextState(context) !== 'suspended' && typeof context.suspend === 'function') {
        await context.suspend();
        lifecycle.push({ action: 'suspend', reason: visibilityHidden ? 'visibility-hidden' : currentPolicy });
      }
    } else if (typeof context.resume === 'function' && contextState(context) !== 'closed' && !isContextRunning(context)) {
      await context.resume();
      lifecycle.push({ action: 'resume', reason: currentPolicy });
    }
    syncMusic();
    return snapshot();
  }

  function ensureContext() {
    if (context || disposed) return context;
    context = contextFactory();
    if (!context) {
      unavailableReason = 'audio-context-unavailable';
      return null;
    }
    contextCreateCount += 1;
    graph = createGraph(context);
    if (nodeBudget.sfxVoices !== SFX_VOICE_COUNT && graph.sfxVoices.length > nodeBudget.sfxVoices) {
      graph.sfxVoices.splice(nodeBudget.sfxVoices).forEach((voice) => voice.stop());
    }
    setMasterVolume();
    lifecycle.push({ action: 'create-context', reason: 'trusted-gesture' });
    return context;
  }

  async function activateFromGesture(event = null) {
    if (disposed) return snapshot();
    if (event && event.isTrusted === false) {
      lifecycle.push({ action: 'reject-activation', reason: 'untrusted-event' });
      return snapshot();
    }
    const audioContext = ensureContext();
    if (!audioContext) return snapshot();
    activated = true;
    return syncContext();
  }

  function applySettings(nextSettings = {}) {
    settings = normalizeAudioSettings(nextSettings);
    setMasterVolume();
    syncMusic();
    return snapshot();
  }

  function setShellAudioPolicy(policy) {
    currentPolicy = policy ?? 'silent';
    return syncContext();
  }

  function setVisibilityHidden(hidden) {
    visibilityHidden = Boolean(hidden);
    return syncContext();
  }

  function playEvent(eventName) {
    const patch = SFX_PATCHES[eventName];
    if (!patch) return false;
    if (!activated || !context || !graph || settings.muted || settings.volume <= 0 || shouldSuspend() || !isContextRunning(context)) {
      suppressedEventCount += 1;
      return false;
    }
    const voice = graph.sfxVoices[voiceCursor % graph.sfxVoices.length];
    voiceCursor += 1;
    configureVoice(context, voice, patch);
    handledEventCount += 1;
    handledEvents.push({ event: eventName, voice: voice.label });
    if (handledEvents.length > 64) handledEvents.shift();
    return true;
  }

  function handleRuntimeEvents(events = []) {
    let played = 0;
    for (const eventName of events) {
      if (playEvent(eventName)) played += 1;
    }
    return { played, requested: events.length, snapshot: snapshot() };
  }

  function handleRuntimeRenderState(renderState, options = {}) {
    const mapper = options.mapper ?? new RuntimeAudioEventMapper({ level: options.level });
    const events = mapper.collect(renderState, { level: options.level });
    return {
      events,
      ...handleRuntimeEvents(events),
    };
  }

  function dispose() {
    disposed = true;
    stopMusicTimer();
    if (graph) graph.stop();
    graph = null;
    if (context && contextState(context) !== 'closed' && typeof context.close === 'function') {
      context.close();
    }
    lifecycle.push({ action: 'dispose', reason: 'app-dispose' });
    return snapshot();
  }

  function createRuntimeMapper(options = {}) {
    return new RuntimeAudioEventMapper(options);
  }

  return {
    activateFromGesture,
    applySettings,
    setShellAudioPolicy,
    setVisibilityHidden,
    handleRuntimeEvents,
    handleRuntimeRenderState,
    createRuntimeMapper,
    retroMuzaxCapability: createRetroMuzaxCapability,
    snapshot,
    dispose,
    get lifecycle() {
      return [...lifecycle];
    },
  };
}
