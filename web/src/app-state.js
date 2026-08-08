export const APP_STATE = Object.freeze({
  LOADING: 'loading',
  TITLE: 'title',
  WORLD_MAP: 'worldMap',
  GARAGE: 'garage',
  SETTINGS: 'settings',
  LEVEL_SELECT: 'levelSelect',
  COUNTDOWN: 'countdown',
  RACING: 'racing',
  PAUSED: 'paused',
  RESULTS: 'results',
});

export const LEGAL_TRANSITIONS = Object.freeze({
  [APP_STATE.LOADING]: Object.freeze([APP_STATE.TITLE]),
  [APP_STATE.TITLE]: Object.freeze([APP_STATE.WORLD_MAP, APP_STATE.GARAGE, APP_STATE.SETTINGS]),
  [APP_STATE.WORLD_MAP]: Object.freeze([APP_STATE.TITLE, APP_STATE.LEVEL_SELECT]),
  [APP_STATE.GARAGE]: Object.freeze([APP_STATE.TITLE]),
  [APP_STATE.SETTINGS]: Object.freeze([APP_STATE.TITLE]),
  [APP_STATE.LEVEL_SELECT]: Object.freeze([APP_STATE.WORLD_MAP, APP_STATE.COUNTDOWN]),
  [APP_STATE.COUNTDOWN]: Object.freeze([APP_STATE.RACING]),
  [APP_STATE.RACING]: Object.freeze([APP_STATE.PAUSED, APP_STATE.RESULTS]),
  [APP_STATE.PAUSED]: Object.freeze([APP_STATE.RACING, APP_STATE.WORLD_MAP]),
  [APP_STATE.RESULTS]: Object.freeze([APP_STATE.COUNTDOWN, APP_STATE.WORLD_MAP]),
});

export const STATE_POLICY = Object.freeze({
  [APP_STATE.LOADING]: Object.freeze({
    input: 'none',
    simulation: 'stopped',
    audio: 'silent',
    visibleRoot: 'loading',
  }),
  [APP_STATE.TITLE]: Object.freeze({
    input: 'menu',
    simulation: 'stopped',
    audio: 'menu',
    visibleRoot: 'title',
  }),
  [APP_STATE.WORLD_MAP]: Object.freeze({
    input: 'menu',
    simulation: 'stopped',
    audio: 'menu',
    visibleRoot: 'world-map',
  }),
  [APP_STATE.GARAGE]: Object.freeze({
    input: 'menu',
    simulation: 'stopped',
    audio: 'menu',
    visibleRoot: 'garage',
  }),
  [APP_STATE.SETTINGS]: Object.freeze({
    input: 'menu',
    simulation: 'stopped',
    audio: 'menu',
    visibleRoot: 'settings',
  }),
  [APP_STATE.LEVEL_SELECT]: Object.freeze({
    input: 'menu',
    simulation: 'stopped',
    audio: 'menu',
    visibleRoot: 'level-select',
  }),
  [APP_STATE.COUNTDOWN]: Object.freeze({
    input: 'locked-race',
    simulation: 'stopped',
    audio: 'race-armed',
    visibleRoot: 'race',
  }),
  [APP_STATE.RACING]: Object.freeze({
    input: 'race',
    simulation: 'running',
    audio: 'race',
    visibleRoot: 'race',
  }),
  [APP_STATE.PAUSED]: Object.freeze({
    input: 'pause-menu',
    simulation: 'paused',
    audio: 'ducked',
    visibleRoot: 'pause',
  }),
  [APP_STATE.RESULTS]: Object.freeze({
    input: 'results',
    simulation: 'stopped',
    audio: 'results',
    visibleRoot: 'results',
  }),
});

export const FOCUS_TARGETS = Object.freeze({
  [APP_STATE.LOADING]: '#app-shell',
  [APP_STATE.TITLE]: '[data-screen="title"] [data-focus-default]',
  [APP_STATE.WORLD_MAP]: '[data-screen="world-map"] [data-focus-default]',
  [APP_STATE.GARAGE]: '[data-screen="garage"] [data-focus-default]',
  [APP_STATE.SETTINGS]: '[data-screen="settings"] [data-focus-default]',
  [APP_STATE.LEVEL_SELECT]: '[data-screen="level-select"] [data-focus-default]',
  [APP_STATE.COUNTDOWN]: '#c',
  [APP_STATE.RACING]: '#c',
  [APP_STATE.PAUSED]: '[data-screen="pause"] [data-focus-default]',
  [APP_STATE.RESULTS]: '[data-screen="results"] [data-focus-default]',
});

function typedRejection(from, to) {
  return Object.freeze({
    code: 'ILLEGAL_TRANSITION',
    from,
    to,
    allowed: [...(LEGAL_TRANSITIONS[from] ?? [])],
  });
}

export function policyForState(state) {
  const policy = STATE_POLICY[state];
  if (!policy) throw new Error(`unknown app state ${state}`);
  return policy;
}

export function canTransition(from, to) {
  return Boolean(LEGAL_TRANSITIONS[from]?.includes(to));
}

export function shouldAdvanceSimulation(state) {
  return policyForState(state).simulation === 'running';
}

export function canUseRestartShortcut(state) {
  return state === APP_STATE.RESULTS;
}

export class AppStateController {
  constructor(initialState = APP_STATE.LOADING) {
    if (!Object.hasOwn(LEGAL_TRANSITIONS, initialState)) {
      throw new Error(`unknown initial app state ${initialState}`);
    }
    this.state = initialState;
    this.history = [];
  }

  transition(to, meta = {}) {
    const from = this.state;
    if (!canTransition(from, to)) {
      return {
        ok: false,
        state: this.state,
        error: typedRejection(from, to),
      };
    }
    this.state = to;
    const entry = Object.freeze({
      from,
      to,
      at: meta.at ?? null,
      reason: meta.reason ?? 'unspecified',
    });
    this.history.push(entry);
    return {
      ok: true,
      state: this.state,
      transition: entry,
      policy: policyForState(this.state),
    };
  }

  snapshot() {
    return {
      state: this.state,
      policy: policyForState(this.state),
      allowed: [...(LEGAL_TRANSITIONS[this.state] ?? [])],
      history: [...this.history],
    };
  }
}

export function pauseForVisibilityLoss(controller, input, meta = {}) {
  input?.clear?.();
  if (controller.state !== APP_STATE.RACING) {
    return {
      ok: true,
      state: controller.state,
      paused: false,
    };
  }
  const result = controller.transition(APP_STATE.PAUSED, {
    ...meta,
    reason: meta.reason ?? 'visibility-loss',
  });
  return {
    ...result,
    paused: result.ok,
  };
}
