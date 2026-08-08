import { APP_STATE, shouldAdvanceSimulation } from './app-state.js';

export class ResourceScope {
  constructor(label) {
    this.label = label;
    this.resources = [];
    this.disposed = false;
  }

  add(label, dispose) {
    if (this.disposed) throw new Error(`scope ${this.label} is already disposed`);
    if (typeof dispose !== 'function') throw new TypeError(`${label} dispose must be a function`);
    this.resources.push({ label, dispose, disposed: false });
    return dispose;
  }

  dispose() {
    if (this.disposed) return { label: this.label, disposed: 0, remaining: 0 };
    let count = 0;
    for (const resource of [...this.resources].reverse()) {
      if (resource.disposed) continue;
      resource.dispose();
      resource.disposed = true;
      count += 1;
    }
    this.disposed = true;
    return { label: this.label, disposed: count, remaining: 0 };
  }

  snapshot() {
    return {
      label: this.label,
      disposed: this.disposed,
      resources: this.resources.map((resource) => ({
        label: resource.label,
        disposed: resource.disposed,
      })),
    };
  }
}

export class ListenerRegistry {
  constructor(label = 'listeners') {
    this.scope = new ResourceScope(label);
    this.count = 0;
  }

  add(target, type, listener, options) {
    target.addEventListener(type, listener, options);
    this.count += 1;
    this.scope.add(`${type}`, () => {
      target.removeEventListener(type, listener, options);
      this.count -= 1;
    });
  }

  dispose() {
    return this.scope.dispose();
  }

  snapshot() {
    return {
      count: this.count,
      ...this.scope.snapshot(),
    };
  }
}

export class RaceSessionLifecycle {
  constructor() {
    this.generation = 0;
    this.current = null;
    this.disposed = [];
  }

  begin(label = `race-${this.generation + 1}`) {
    this.disposeCurrent();
    this.generation += 1;
    this.current = new ResourceScope(label);
    return this.current;
  }

  disposeCurrent() {
    if (!this.current) return null;
    const result = this.current.dispose();
    this.disposed.push({ generation: this.generation, ...result });
    this.current = null;
    return result;
  }

  snapshot() {
    return {
      generation: this.generation,
      active: this.current?.snapshot() ?? null,
      disposed: [...this.disposed],
    };
  }
}

export function advanceRuntimeForShellState(runtime, state, nowMs, controlsProvider) {
  if (!runtime) return null;
  if (!shouldAdvanceSimulation(state)) {
    if (typeof runtime.hold === 'function') return runtime.hold(nowMs);
    return runtime.renderState(0, 0);
  }
  return runtime.advance(nowMs, controlsProvider);
}

export function raceStateFromSessionFrame(frame) {
  if (frame?.sessionState === 'won' || frame?.sessionState === 'failed') return APP_STATE.RESULTS;
  return APP_STATE.RACING;
}
