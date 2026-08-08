export const DEFAULT_WARMUP_FRAMES = 60;
export const DEFAULT_SAMPLE_FRAMES = 600;

function percentile(sorted, fraction) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function summarizeRendererInfo(info = {}) {
  return {
    drawCalls: info.render?.calls ?? 0,
    triangles: info.render?.triangles ?? 0,
    points: info.render?.points ?? 0,
    lines: info.render?.lines ?? 0,
    geometries: info.memory?.geometries ?? 0,
    textures: info.memory?.textures ?? 0,
    programs: Array.isArray(info.programs) ? info.programs.length : (info.programs ?? 0),
  };
}

export class TelemetrySampler {
  constructor(options = {}) {
    this.warmupFrames = options.warmupFrames ?? DEFAULT_WARMUP_FRAMES;
    this.sampleFrames = options.sampleFrames ?? DEFAULT_SAMPLE_FRAMES;
    this.base = { ...(options.base ?? {}) };
    this.reset();
  }

  reset() {
    this.previousNow = 0;
    this.frame = 0;
    this.samples = [];
    this.report = null;
  }

  sample(nowMs, rendererInfo, runtimeCounters = {}, extra = {}) {
    if (this.report) return this.report;
    if (this.previousNow !== 0) {
      const delta = nowMs - this.previousNow;
      if (this.frame >= this.warmupFrames && this.samples.length < this.sampleFrames) {
        this.samples.push(delta);
      }
    }
    this.previousNow = nowMs;
    this.frame += 1;
    if (this.samples.length !== this.sampleFrames) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const total = this.samples.reduce((sum, value) => sum + value, 0);
    this.report = {
      ...this.base,
      ...extra,
      warmupFrames: this.warmupFrames,
      frames: this.sampleFrames,
      meanFps: 1000 / (total / this.sampleFrames),
      p95FrameMs: percentile(sorted, 0.95),
      worstFrameMs: sorted[sorted.length - 1],
      simTicks: runtimeCounters.simTickCount ?? 0,
      droppedCatchUpCount: runtimeCounters.droppedCatchUpCount ?? 0,
      ...summarizeRendererInfo(rendererInfo),
    };
    return this.report;
  }

  snapshot() {
    return {
      warmupFrames: this.warmupFrames,
      sampleFrames: this.sampleFrames,
      frame: this.frame,
      collectedFrames: this.samples.length,
      report: this.report ? { ...this.report } : null,
    };
  }
}
