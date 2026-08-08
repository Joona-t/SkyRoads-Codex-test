import { SHIP_STATE } from './sim.js';
import { progressRatio } from './view.js';

const CONTROL_HELP = 'Drive WASD/Arrows | Jump Space | Restart R/Enter';
const MAX_DISPLAY_SPEED = 0x2aaa / 0x10000;

function pct(value) {
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

function speedText(frame) {
  const ratio = Math.max(0, Math.min(1, (frame.zVel ?? 0) / MAX_DISPLAY_SPEED));
  return `${Math.round(ratio * 100)}%`;
}

function cueForFrame(level, frame) {
  if (frame.sessionState !== 'playing') return null;
  const row = frame.row ?? Math.floor(frame.z ?? 0);
  const coaching = level.coaching;
  if (coaching?.hazard) {
    const hazard = coaching.hazard;
    const cueRow = hazard.cueRow ?? Math.max(0, hazard.row - 12);
    const successRow = hazard.successRow ?? hazard.endRow + 1;
    if (row >= cueRow && row < successRow) {
      return `${hazard.action} at row ${hazard.row}`;
    }
  }
  if (coaching?.finish && row >= coaching.finish.cueRow && row < coaching.finish.row) {
    return 'Hold the center line into the finish ring';
  }
  if (row < 10) return 'Hold Go and try small steering taps';
  return 'Keep the lane centered';
}

export function terminalCopy(frame) {
  if (frame.sessionState === 'won') {
    return {
      key: 'won',
      title: 'VICTORY',
      detail: 'Finish tunnel reached. Press R, Enter, or Restart for a clean run.',
    };
  }
  if (frame.sessionState !== 'failed') return null;
  switch (frame.state) {
    case SHIP_STATE.EXPLODED:
      return { key: 'exploded', title: 'IMPACT FAILURE', detail: 'The craft hit a red hazard or obstacle.' };
    case SHIP_STATE.FALLEN:
      return { key: 'fallen', title: 'VOID FALL', detail: 'The craft left the road and dropped below the track.' };
    case SHIP_STATE.OUT_OF_FUEL:
      return { key: 'fuel', title: 'FUEL EMPTY', detail: 'Fuel reserve reached zero.' };
    case SHIP_STATE.OUT_OF_OXYGEN:
      return { key: 'oxygen', title: 'OXYGEN EMPTY', detail: 'Oxygen reserve reached zero.' };
    default:
      return { key: 'failed', title: 'RUN FAILED', detail: `Terminal ship state: ${frame.state}.` };
  }
}

export function computeHudView({ level, frame, runtimeCounters, telemetry, debug = false }) {
  const terminal = terminalCopy(frame);
  const progress = progressRatio(frame, level);
  const cue = cueForFrame(level, frame);
  const telemetryText = telemetry?.report
    ? `${telemetry.report.meanFps.toFixed(1)} FPS p95 ${telemetry.report.p95FrameMs.toFixed(2)}ms`
    : `profiling ${telemetry?.collectedFrames ?? 0}/${telemetry?.sampleFrames ?? 600}`;
  const status = terminal?.title ?? 'RUNNING';
  const lines = [
    `NEONDRIFT // ${level.name}`,
    `Speed ${speedText(frame)} | Progress ${Math.round(progress * 100)}%`,
    `Fuel ${pct(frame.fuelPct)} | Oxygen ${pct(frame.oxygenPct ?? frame.o2Pct ?? 0)}`,
    `Cue: ${cue ?? (terminal ? 'Restart for a clean run' : 'Hold Go')}`,
    CONTROL_HELP,
  ];
  if (debug) {
    lines.push(`Debug ticks ${runtimeCounters?.simTickCount ?? 0} | drops ${runtimeCounters?.droppedCatchUpCount ?? 0} | ${telemetryText}`);
  }
  return {
    status,
    terminal,
    lines,
    cue,
    controlHelp: CONTROL_HELP,
  };
}

export class HudPresenter {
  constructor(elements, options = {}) {
    this.elements = elements;
    this.minWriteIntervalMs = options.minWriteIntervalMs ?? 100;
    this.lastWriteMs = -Infinity;
    this.writeCount = 0;
  }

  update(model, nowMs) {
    if (!model?.force && nowMs - this.lastWriteMs < this.minWriteIntervalMs) return false;
    const view = computeHudView(model);
    this.elements.root.textContent = view.lines.join('\n');
    const terminal = model?.suppressTerminal ? null : view.terminal;
    if (terminal) {
      this.elements.terminal.hidden = false;
      this.elements.terminal.dataset.state = terminal.key;
      this.elements.terminalTitle.textContent = terminal.title;
      this.elements.terminalDetail.textContent = terminal.detail;
    } else {
      this.elements.terminal.hidden = true;
      this.elements.terminal.dataset.state = 'playing';
      this.elements.terminalTitle.textContent = '';
      this.elements.terminalDetail.textContent = '';
    }
    this.lastWriteMs = nowMs;
    this.writeCount += 1;
    return true;
  }
}
