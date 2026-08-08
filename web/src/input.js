export const INPUT_ACTION = Object.freeze({
  LEFT: 'left',
  RIGHT: 'right',
  ACCELERATE: 'accelerate',
  BRAKE: 'brake',
  JUMP: 'jump',
  RESTART: 'restart',
  PAUSE: 'pause',
});

export const INPUT_ACTION_MANIFEST = Object.freeze({
  [INPUT_ACTION.LEFT]: Object.freeze({
    label: 'Steer Left',
    hold: true,
    defaults: Object.freeze(['ArrowLeft', 'KeyA']),
  }),
  [INPUT_ACTION.RIGHT]: Object.freeze({
    label: 'Steer Right',
    hold: true,
    defaults: Object.freeze(['ArrowRight', 'KeyD']),
  }),
  [INPUT_ACTION.ACCELERATE]: Object.freeze({
    label: 'Accelerate',
    hold: true,
    defaults: Object.freeze(['ArrowUp', 'KeyW']),
  }),
  [INPUT_ACTION.BRAKE]: Object.freeze({
    label: 'Brake',
    hold: true,
    defaults: Object.freeze(['ArrowDown', 'KeyS']),
  }),
  [INPUT_ACTION.JUMP]: Object.freeze({
    label: 'Jump',
    hold: true,
    defaults: Object.freeze(['Space']),
  }),
  [INPUT_ACTION.RESTART]: Object.freeze({
    label: 'Restart',
    hold: false,
    recovery: true,
    defaults: Object.freeze(['KeyR', 'Enter']),
  }),
  [INPUT_ACTION.PAUSE]: Object.freeze({
    label: 'Pause',
    hold: false,
    recovery: true,
    defaults: Object.freeze(['Escape', 'KeyP']),
  }),
});

const ACTION_VALUES = new Set(Object.values(INPUT_ACTION));
const DEFAULT_KEY_BINDINGS = Object.freeze(Object.fromEntries(
  Object.entries(INPUT_ACTION_MANIFEST).map(([action, manifest]) => [action, manifest.defaults])
));

function uniqueCodes(codes) {
  const result = [];
  for (const code of codes) {
    if (typeof code !== 'string' || code.length === 0 || code.length > 40) continue;
    if (result.includes(code)) continue;
    result.push(code);
  }
  return result;
}

export function defaultKeyBindings() {
  return Object.fromEntries(Object.entries(DEFAULT_KEY_BINDINGS).map(([action, codes]) => [action, [...codes]]));
}

export function normalizeKeyBindings(input = {}) {
  const customCodes = Object.fromEntries(Object.values(INPUT_ACTION).map((action) => [action, []]));
  for (const [action, raw] of Object.entries(input ?? {})) {
    if (!ACTION_VALUES.has(action)) continue;
    const codes = Array.isArray(raw) ? raw : [raw];
    customCodes[action] = uniqueCodes(codes).slice(0, 2);
  }

  const result = {};
  for (const action of Object.values(INPUT_ACTION)) {
    const defaults = INPUT_ACTION_MANIFEST[action].defaults;
    result[action] = Object.freeze(uniqueCodes([...customCodes[action], ...defaults]));
  }
  return Object.freeze(result);
}

export function bindKeyCode(input = {}, action, code) {
  if (!ACTION_VALUES.has(action)) return normalizeKeyBindings(input);
  const next = {};
  for (const existingAction of Object.values(INPUT_ACTION)) {
    const defaults = INPUT_ACTION_MANIFEST[existingAction].defaults;
    const existing = uniqueCodes(input?.[existingAction] ?? [])
      .filter((candidate) => !defaults.includes(candidate) && candidate !== code);
    next[existingAction] = existing;
  }
  next[action] = uniqueCodes([code, ...(next[action] ?? [])]).slice(0, 2);
  return normalizeKeyBindings(next);
}

export function keyCodeFromEvent(event) {
  return event?.code || event?.key || '';
}

export function keyLabel(code) {
  const labels = {
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    Space: 'Space',
    Escape: 'Esc',
    Enter: 'Enter',
  };
  if (labels[code]) return labels[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return code;
}

function buildKeyActions(bindings) {
  const actions = {};
  for (const [action, codes] of Object.entries(bindings)) {
    const defaults = INPUT_ACTION_MANIFEST[action]?.defaults ?? [];
    for (const code of codes) {
      const isDefault = defaults.includes(code);
      if (!isDefault || !actions[code]) actions[code] = action;
    }
  }
  return actions;
}

function actionForKeyEvent(event, bindings) {
  const keyActions = buildKeyActions(bindings);
  return keyActions[event.code] ?? keyActions[event.key] ?? null;
}

function consume(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

function axis(negative, positive) {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}

export class InputController {
  constructor(options = {}) {
    this.held = new Set();
    this.restartQueued = false;
    this.pauseQueued = false;
    this.keyBindings = normalizeKeyBindings(options.keyBindings);
    this.listenerCount = 0;
    this.controlButtonCount = 0;
  }

  setKeyBindings(nextBindings) {
    this.keyBindings = normalizeKeyBindings(nextBindings);
  }

  setAction(action, pressed) {
    if (!Object.values(INPUT_ACTION).includes(action)) {
      throw new Error(`unknown input action ${action}`);
    }
    if (action === INPUT_ACTION.RESTART) {
      if (pressed && !this.held.has(INPUT_ACTION.RESTART)) {
        this.restartQueued = true;
      }
      if (pressed) this.held.add(INPUT_ACTION.RESTART);
      else this.held.delete(INPUT_ACTION.RESTART);
      return;
    }
    if (action === INPUT_ACTION.PAUSE) {
      if (pressed && !this.held.has(INPUT_ACTION.PAUSE)) {
        this.pauseQueued = true;
      }
      if (pressed) this.held.add(INPUT_ACTION.PAUSE);
      else this.held.delete(INPUT_ACTION.PAUSE);
      return;
    }
    if (pressed) this.held.add(action);
    else this.held.delete(action);
  }

  handleKeyDown(event) {
    const action = actionForKeyEvent(event, this.keyBindings);
    if (!action) return false;
    consume(event);
    if (event.repeat) return true;
    this.setAction(action, true);
    return true;
  }

  handleKeyUp(event) {
    const action = actionForKeyEvent(event, this.keyBindings);
    if (!action) return false;
    consume(event);
    this.setAction(action, false);
    return true;
  }

  clear() {
    this.held.clear();
    this.restartQueued = false;
    this.pauseQueued = false;
  }

  snapshot() {
    return {
      turn: axis(this.held.has(INPUT_ACTION.LEFT), this.held.has(INPUT_ACTION.RIGHT)),
      accel: axis(this.held.has(INPUT_ACTION.BRAKE), this.held.has(INPUT_ACTION.ACCELERATE)),
      jump: this.held.has(INPUT_ACTION.JUMP),
    };
  }

  bindingSnapshot() {
    return defaultKeyBindings();
  }

  configuredBindingSnapshot() {
    return Object.fromEntries(Object.entries(this.keyBindings).map(([action, codes]) => [action, [...codes]]));
  }

  listenerSnapshot() {
    return {
      listeners: this.listenerCount,
      controlButtons: this.controlButtonCount,
      heldCount: this.held.size,
      bindings: this.configuredBindingSnapshot(),
    };
  }

  consumeRestartRequested() {
    const requested = this.restartQueued;
    this.restartQueued = false;
    return requested;
  }

  consumePauseRequested() {
    const requested = this.pauseQueued;
    this.pauseQueued = false;
    return requested;
  }

  attachKeyboard(target = globalThis.window, doc = globalThis.document) {
    const keydown = (event) => this.handleKeyDown(event);
    const keyup = (event) => this.handleKeyUp(event);
    const clear = () => this.clear();
    const visibility = () => {
      if (doc?.hidden) this.clear();
    };
    target.addEventListener('keydown', keydown, { passive: false });
    target.addEventListener('keyup', keyup, { passive: false });
    target.addEventListener('blur', clear);
    doc?.addEventListener?.('visibilitychange', visibility);
    this.listenerCount += 4;
    return () => {
      target.removeEventListener('keydown', keydown);
      target.removeEventListener('keyup', keyup);
      target.removeEventListener('blur', clear);
      doc?.removeEventListener?.('visibilitychange', visibility);
      this.listenerCount -= 4;
    };
  }

  attachControls(root) {
    const buttons = Array.from(root.querySelectorAll('[data-action]'));
    const disposers = [];
    this.controlButtonCount = buttons.length;
    const release = (button, event) => {
      consume(event);
      const action = button.dataset.action;
      if (button.hasPointerCapture?.(event.pointerId)) button.releasePointerCapture(event.pointerId);
      this.setAction(action, false);
      button.setAttribute('aria-pressed', 'false');
    };

    for (const button of buttons) {
      const press = (event) => {
        consume(event);
        const action = button.dataset.action;
        button.setPointerCapture?.(event.pointerId);
        this.setAction(action, true);
        button.setAttribute('aria-pressed', action === INPUT_ACTION.RESTART ? 'false' : 'true');
      };
      const cancel = (event) => release(button, event);
      const click = (event) => {
        if (button.dataset.action === INPUT_ACTION.RESTART) {
          consume(event);
          this.setAction(INPUT_ACTION.RESTART, true);
          this.setAction(INPUT_ACTION.RESTART, false);
        }
      };
      button.addEventListener('pointerdown', press, { passive: false });
      button.addEventListener('pointerup', cancel, { passive: false });
      button.addEventListener('pointercancel', cancel, { passive: false });
      button.addEventListener('pointerleave', cancel, { passive: false });
      button.addEventListener('lostpointercapture', cancel, { passive: false });
      button.addEventListener('click', click, { passive: false });
      this.listenerCount += 6;
      disposers.push(() => {
        button.removeEventListener('pointerdown', press);
        button.removeEventListener('pointerup', cancel);
        button.removeEventListener('pointercancel', cancel);
        button.removeEventListener('pointerleave', cancel);
        button.removeEventListener('lostpointercapture', cancel);
        button.removeEventListener('click', click);
        this.listenerCount -= 6;
      });
    }

    return () => {
      for (const dispose of disposers) dispose();
      this.controlButtonCount = 0;
      this.clear();
    };
  }
}

export function createInputController(options = {}) {
  return new InputController(options);
}
