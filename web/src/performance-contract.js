import { STARTER_COURSE_IDS } from './content-manifest.js';

export const BENCHMARK_FIXTURE_ID = 'starter-ion-gauntlet';
export const BENCHMARK_TRACE_PATH = './tests/fixtures/perf-ion-gauntlet.trace.json';
export const BENCHMARK_VIEWPORT = Object.freeze({ width: 1280, height: 720, dpr: 1 });
export const BENCHMARK_WARMUP_MS = 5000;
export const BENCHMARK_SAMPLE_MS = 20000;
export const BENCHMARK_P95_FRAME_MS = 18.18;
export const BENCHMARK_LONG_TASK_MS = 50;

export const LEAK_SEQUENCE_REPETITIONS = 10;
export const LEAK_RETRIES_PER_LOAD = 1;

export function benchmarkCourseId() {
  return STARTER_COURSE_IDS.JUMP_EFFECT;
}

export function leakLoadSequence(repetitions = LEAK_SEQUENCE_REPETITIONS) {
  return Array.from({ length: repetitions }, () => [
    STARTER_COURSE_IDS.TRAINING,
    benchmarkCourseId(),
  ]).flat();
}

export function benchmarkDescriptor() {
  return Object.freeze({
    fixtureId: BENCHMARK_FIXTURE_ID,
    courseId: benchmarkCourseId(),
    tracePath: BENCHMARK_TRACE_PATH,
    viewport: BENCHMARK_VIEWPORT,
    warmupMs: BENCHMARK_WARMUP_MS,
    sampleMs: BENCHMARK_SAMPLE_MS,
    p95FrameMs: BENCHMARK_P95_FRAME_MS,
    longTaskMs: BENCHMARK_LONG_TASK_MS,
    leakSequence: leakLoadSequence(),
    leakRetriesPerLoad: LEAK_RETRIES_PER_LOAD,
  });
}

export function controlsAtTraceTick(trace, tick) {
  const segments = Array.isArray(trace?.segments) ? trace.segments : [];
  const segment = segments.find((candidate) => tick < candidate.until) ?? segments.at(-1);
  if (!segment) return { turn: 0, accel: 0, jump: false };
  return {
    turn: Math.max(-1, Math.min(1, Number(segment.turn) || 0)),
    accel: Math.max(-1, Math.min(1, Number(segment.accel) || 0)),
    jump: segment.jump === true,
  };
}

export function validateBenchmarkTrace(trace) {
  if (trace?.schema !== 'neondrift.perfTrace.v1') throw new Error('invalid benchmark trace schema');
  if (trace.fixtureId !== BENCHMARK_FIXTURE_ID) throw new Error(`invalid benchmark fixture ${trace.fixtureId}`);
  if (trace.courseId !== benchmarkCourseId()) throw new Error(`invalid benchmark course ${trace.courseId}`);
  if (trace.tickHz !== 70) throw new Error(`invalid benchmark tickHz ${trace.tickHz}`);
  if (!Number.isSafeInteger(trace.maxTicks) || trace.maxTicks <= 0) throw new Error('invalid benchmark maxTicks');
  if (!Array.isArray(trace.segments) || trace.segments.length === 0) throw new Error('benchmark trace has no controls');
  let previousUntil = 0;
  for (const segment of trace.segments) {
    if (!Number.isSafeInteger(segment.until) || segment.until <= previousUntil) {
      throw new Error('benchmark trace controls must be strictly ordered');
    }
    if (![ -1, 0, 1 ].includes(segment.turn) || ![ -1, 0, 1 ].includes(segment.accel)) {
      throw new Error('benchmark trace controls must be normalized');
    }
    if (typeof segment.jump !== 'boolean') throw new Error('benchmark jump controls must be boolean');
    previousUntil = segment.until;
  }
  if (previousUntil < trace.maxTicks) throw new Error('benchmark trace controls end before maxTicks');
  return true;
}
