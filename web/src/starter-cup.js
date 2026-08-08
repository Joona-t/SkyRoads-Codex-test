import { TOUCH_EFFECT } from './level-physics.js';
import {
  STARTER_COURSE_IDS,
  STARTER_CUP_ID,
  STARTER_CUP_MANIFEST,
  canonicalStarterCourseId,
  getStarterCourseEntry,
} from './content-manifest.js';

export { STARTER_COURSE_IDS, STARTER_CUP_ID, STARTER_CUP_MANIFEST } from './content-manifest.js';

const CONSTANTS = Object.freeze({
  tileStrideX: 46,
  groundY: 80,
  roadColumns: 7,
  levelMinX: 95,
  levelMaxX: 417,
  levelCenterX: 256,
  cubeShortTop: 100,
  cubeTallTop: 120,
  zPerRow: 1,
});

const TRAINING_PALETTE = Object.freeze([
  [4, 8, 16],
  [96, 238, 255],
  [255, 238, 109],
  [0, 255, 163],
  [255, 159, 45],
  [255, 43, 78],
  [157, 75, 255],
  [22, 240, 230],
  [20, 24, 38],
  [69, 255, 138],
]);

const HANDLING_PALETTE = Object.freeze([
  [5, 9, 18],
  [109, 245, 205],
  [250, 216, 84],
  [88, 172, 255],
  [255, 117, 76],
  [255, 39, 91],
  [173, 92, 255],
  [42, 247, 154],
  [31, 35, 47],
  [255, 250, 190],
]);

const JUMP_EFFECT_PALETTE = Object.freeze([
  [7, 10, 20],
  [127, 235, 255],
  [245, 211, 77],
  [91, 255, 149],
  [255, 126, 56],
  [255, 48, 78],
  [188, 103, 255],
  [68, 207, 255],
  [28, 30, 44],
  [239, 255, 154],
]);

export const TRAINING_COACHING = Object.freeze({
  hazard: {
    row: 44,
    endRow: 44,
    cueRow: 30,
    protectedRows: 5,
    action: 'Jump the red hazard',
    successRow: 45,
  },
  finish: {
    row: 91,
    cueRow: 78,
  },
});

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function kindFor({ cube = null, tunnel = false }) {
  const cubeBits = cube == null ? 0 : cube === CONSTANTS.cubeShortTop ? 2 : 4;
  return cubeBits + (tunnel ? 1 : 0);
}

function rawFor({ tile = false, tunnel = false, cube = null, tileColor = 0, tileEffect = TOUCH_EFFECT.NONE }) {
  const effectBits = {
    [TOUCH_EFFECT.NONE]: 0,
    [TOUCH_EFFECT.ACCELERATE]: 1,
    [TOUCH_EFFECT.DECELERATE]: 2,
    [TOUCH_EFFECT.KILL]: 3,
    [TOUCH_EFFECT.SLIDE]: 4,
    [TOUCH_EFFECT.REFILL_OXYGEN]: 5,
  }[tileEffect] ?? 0;
  return (
    (kindFor({ cube, tunnel }) << 12) |
    ((tile ? 1 : 0) << 11) |
    ((tileColor & 0x0f) << 4) |
    effectBits
  );
}

function cell(options = {}) {
  const tile = options.tile ?? false;
  const tunnel = options.tunnel ?? false;
  const cube = options.cube ?? null;
  const tileColor = options.tileColor ?? (tile ? 1 : 0);
  const cubeColor = options.cubeColor ?? (cube == null ? 0 : 8);
  const tileEffect = options.tileEffect ?? TOUCH_EFFECT.NONE;
  const cubeEffect = options.cubeEffect ?? TOUCH_EFFECT.NONE;
  return {
    raw: rawFor({ tile, tunnel, cube, tileColor, tileEffect }),
    kind: kindFor({ cube, tunnel }),
    tile,
    tunnel,
    cube,
    tileColor,
    cubeColor,
    tileEffect,
    cubeEffect,
  };
}

function roadCell(row, column, paletteSlot = 1) {
  const edge = column === 0 || column === CONSTANTS.roadColumns - 1;
  return cell({ tile: true, tileColor: edge ? 2 : paletteSlot });
}

function asTunnel(base, tileColor = 9) {
  return cell({ ...base, tunnel: true, tileColor });
}

function applyCourseMetadata(level, manifestEntry, traces) {
  return {
    ...level,
    cup: {
      id: STARTER_CUP_ID,
      courseId: manifestEntry.id,
      order: manifestEntry.order,
      role: manifestEntry.role,
      focus: manifestEntry.focus,
      unlockAfter: manifestEntry.unlockAfter,
      parTicks: manifestEntry.parTicks,
    },
    traces: cloneData(traces),
  };
}

function trainingTile(row, column) {
  let tileColor = column === 0 || column === 6 ? 2 : 1;
  let tileEffect = TOUCH_EFFECT.NONE;

  if (row >= 10 && row <= 13 && (column === 1 || column === 5)) {
    tileColor = 3;
    tileEffect = TOUCH_EFFECT.ACCELERATE;
  }
  if (row >= 20 && row <= 22 && (column === 2 || column === 4)) {
    tileColor = 7;
    tileEffect = TOUCH_EFFECT.REFILL_OXYGEN;
  }
  if (row >= 29 && row <= 34 && column === 3) {
    tileColor = 2;
  }
  if (row >= 68 && row <= 70 && column === 3) {
    tileColor = 6;
    tileEffect = TOUCH_EFFECT.SLIDE;
  }
  if (row >= 76 && row <= 78 && column === 3) {
    tileColor = 3;
    tileEffect = TOUCH_EFFECT.ACCELERATE;
  }

  return cell({ tile: true, tileColor, tileEffect });
}

function makeTrainingRows() {
  const length = 92;
  const rows = [];
  for (let row = 0; row < length; row++) {
    const cells = [];
    for (let column = 0; column < CONSTANTS.roadColumns; column++) {
      const trainingHole = row >= 37 && row <= 38 && (column === 0 || column === 6);
      if (trainingHole) {
        cells.push(cell());
        continue;
      }

      const isFinishTunnel = row >= 88 && row < length;
      const base = trainingTile(row, column);
      const inHazard = row === 44 && column >= 2 && column <= 4;
      if (inHazard) {
        cells.push(cell({ tile: true, tileColor: 5, tileEffect: TOUCH_EFFECT.KILL }));
        continue;
      }
      if (isFinishTunnel) {
        cells.push(asTunnel(base));
        continue;
      }

      if ((row === 60 && (column === 1 || column === 5)) || (row === 64 && (column === 0 || column === 6))) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeShortTop, cubeColor: 8 }));
        continue;
      }
      if (row === 66 && (column === 1 || column === 5)) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeTallTop, cubeColor: 8 }));
        continue;
      }

      cells.push(base);
    }
    rows.push(cells);
  }
  return rows;
}

function handlingGate(row) {
  if (row >= 34 && row <= 37) return new Set([0, 1, 2]);
  if (row >= 53 && row <= 56) return new Set([4, 5, 6]);
  if (row >= 75 && row <= 78) return new Set([1, 2, 3]);
  return null;
}

function makeHandlingRows() {
  const length = 112;
  const rows = [];
  for (let row = 0; row < length; row++) {
    const cells = [];
    const gate = handlingGate(row);
    const finish = row >= 108 && row < length;
    for (let column = 0; column < CONSTANTS.roadColumns; column++) {
      let base = roadCell(row, column, row % 8 < 4 ? 1 : 3);
      if (row >= 12 && row <= 15 && (column === 2 || column === 4)) {
        base = cell({ tile: true, tileColor: 3, tileEffect: TOUCH_EFFECT.ACCELERATE });
      }
      if (row >= 44 && row <= 46 && (column === 1 || column === 5)) {
        base = cell({ tile: true, tileColor: 6, tileEffect: TOUCH_EFFECT.SLIDE });
      }
      if (row >= 88 && row <= 90 && (column === 2 || column === 4)) {
        base = cell({ tile: true, tileColor: 7, tileEffect: TOUCH_EFFECT.REFILL_OXYGEN });
      }

      if (gate && !gate.has(column)) {
        cells.push(cell({ tile: true, tileColor: 5, tileEffect: TOUCH_EFFECT.KILL }));
        continue;
      }
      if (finish) {
        cells.push(asTunnel(base, 9));
        continue;
      }
      if ((row === 24 && (column === 0 || column === 6)) || (row === 67 && (column === 0 || column === 6))) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeShortTop, cubeColor: 8 }));
        continue;
      }
      if ((row === 64 && column === 3) || (row === 92 && (column === 1 || column === 5))) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeTallTop, cubeColor: 8 }));
        continue;
      }

      cells.push(base);
    }
    rows.push(cells);
  }
  return rows;
}

function makeJumpEffectRows() {
  const length = 118;
  const rows = [];
  for (let row = 0; row < length; row++) {
    const cells = [];
    const finish = row >= 114 && row < length;
    for (let column = 0; column < CONSTANTS.roadColumns; column++) {
      const edge = column === 0 || column === 6;
      let base = cell({ tile: true, tileColor: edge ? 2 : 1 });
      if (row >= 11 && row <= 14 && column === 3) {
        base = cell({ tile: true, tileColor: 3, tileEffect: TOUCH_EFFECT.ACCELERATE });
      }
      if (row >= 24 && row <= 26 && (column === 2 || column === 4)) {
        base = cell({ tile: true, tileColor: 7, tileEffect: TOUCH_EFFECT.REFILL_OXYGEN });
      }
      if (row >= 36 && row <= 38 && column >= 2 && column <= 4) {
        base = cell({ tile: true, tileColor: 6, tileEffect: TOUCH_EFFECT.SLIDE });
      }
      if (row >= 58 && row <= 60 && (column === 1 || column === 5)) {
        base = cell({ tile: true, tileColor: 4, tileEffect: TOUCH_EFFECT.DECELERATE });
      }

      if (row === 44) {
        cells.push(cell({ tile: true, tileColor: 5, tileEffect: TOUCH_EFFECT.KILL }));
        continue;
      }
      if (finish) {
        cells.push(asTunnel(base, 9));
        continue;
      }
      if ((row === 69 && (column === 1 || column === 5)) || (row === 72 && (column === 0 || column === 6))) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeShortTop, cubeColor: 8 }));
        continue;
      }
      if (row === 96 && (column === 2 || column === 4)) {
        cells.push(cell({ tile: true, tileColor: base.tileColor, cube: CONSTANTS.cubeTallTop, cubeColor: 8 }));
        continue;
      }

      cells.push(base);
    }
    rows.push(cells);
  }
  return rows;
}

const MANIFEST_ENTRIES = STARTER_CUP_MANIFEST.courses;

const TRACE_LIBRARY = Object.freeze({
  [STARTER_COURSE_IDS.TRAINING]: Object.freeze({
    win: {
      name: 'center jump',
      maxTicks: 900,
      segments: [
        { until: 300, turn: 0, accel: 1, jump: false },
        { until: 320, turn: 0, accel: 1, jump: true },
        { until: 900, turn: 0, accel: 1, jump: false },
      ],
    },
    failure: {
      name: 'missed training jump',
      maxTicks: 700,
      segments: [
        { until: 700, turn: 0, accel: 1, jump: false },
      ],
    },
  }),
  [STARTER_COURSE_IDS.HANDLING]: Object.freeze({
    win: {
      name: 'left-right-left gate trace',
      maxTicks: 900,
      segments: [
        { until: 210, turn: 0, accel: 1, jump: false },
        { until: 220, turn: -1, accel: 1, jump: false },
        { until: 300, turn: 0, accel: 1, jump: false },
        { until: 320, turn: 1, accel: 1, jump: false },
        { until: 470, turn: 0, accel: 1, jump: false },
        { until: 490, turn: -1, accel: 1, jump: false },
        { until: 900, turn: 0, accel: 1, jump: false },
      ],
    },
    failure: {
      name: 'centerline gate impact',
      maxTicks: 520,
      segments: [
        { until: 520, turn: 0, accel: 1, jump: false },
      ],
    },
  }),
  [STARTER_COURSE_IDS.JUMP_EFFECT]: Object.freeze({
    win: {
      name: 'timed jump pads',
      maxTicks: 980,
      segments: [
        { until: 250, turn: 0, accel: 1, jump: false },
        { until: 320, turn: 0, accel: 1, jump: true },
        { until: 980, turn: 0, accel: 1, jump: false },
      ],
    },
    failure: {
      name: 'missed jump lane',
      maxTicks: 620,
      segments: [
        { until: 620, turn: 0, accel: 1, jump: false },
      ],
    },
  }),
});

function manifestEntry(courseId) {
  return getStarterCourseEntry(courseId);
}

export function createTrainingCourse() {
  const entry = manifestEntry(STARTER_COURSE_IDS.TRAINING);
  return applyCourseMetadata({
    version: 1,
    roadIndex: STARTER_COURSE_IDS.TRAINING,
    source: 'tracked-original-neondrift-tutorial',
    name: entry.name,
    world: entry.world,
    gravity: 12,
    fuel: 360,
    oxygen: 360,
    length: 92,
    columns: CONSTANTS.roadColumns,
    start: { x: CONSTANTS.levelCenterX, y: CONSTANTS.groundY, z: 3 },
    constants: { ...CONSTANTS },
    palette: TRAINING_PALETTE.map((color) => [...color]),
    coaching: cloneData(TRAINING_COACHING),
    visualHints: {
      guideRails: [
        { rowStart: 0, rowEnd: 45, leftColumn: 0, rightColumn: 6 },
        { rowStart: 51, rowEnd: 91, leftColumn: 0, rightColumn: 6 },
      ],
      hazardRims: [
        { rowStart: 44, rowEnd: 44, columnStart: 2, columnEnd: 4 },
      ],
      effectCueRows: [10, 20, 29, 68, 76],
    },
    cells: makeTrainingRows(),
  }, entry, TRACE_LIBRARY[entry.id]);
}

export function createHandlingCourse() {
  const entry = manifestEntry(STARTER_COURSE_IDS.HANDLING);
  return applyCourseMetadata({
    version: 1,
    roadIndex: STARTER_COURSE_IDS.HANDLING,
    source: 'tracked-original-neondrift-starter-cup',
    name: entry.name,
    world: entry.world,
    gravity: 12,
    fuel: 380,
    oxygen: 380,
    length: 112,
    columns: CONSTANTS.roadColumns,
    start: { x: CONSTANTS.levelCenterX, y: CONSTANTS.groundY, z: 3 },
    constants: { ...CONSTANTS },
    palette: HANDLING_PALETTE.map((color) => [...color]),
    coaching: {
      hazard: {
        row: 34,
        endRow: 78,
        cueRow: 24,
        protectedRows: 5,
        action: 'Shift into the open lane',
        successRow: 79,
      },
      finish: { row: 111, cueRow: 98 },
    },
    visualHints: {
      guideRails: [
        { rowStart: 0, rowEnd: 33, leftColumn: 0, rightColumn: 6 },
        { rowStart: 38, rowEnd: 52, leftColumn: 0, rightColumn: 6 },
        { rowStart: 57, rowEnd: 74, leftColumn: 0, rightColumn: 6 },
        { rowStart: 79, rowEnd: 111, leftColumn: 0, rightColumn: 6 },
      ],
      hazardRims: [
        { rowStart: 34, rowEnd: 37, columnStart: 3, columnEnd: 6 },
        { rowStart: 53, rowEnd: 56, columnStart: 0, columnEnd: 3 },
        { rowStart: 75, rowEnd: 78, columnStart: 4, columnEnd: 6 },
      ],
      effectCueRows: [12, 44, 88],
    },
    cells: makeHandlingRows(),
  }, entry, TRACE_LIBRARY[entry.id]);
}

export function createJumpEffectCourse() {
  const entry = manifestEntry(STARTER_COURSE_IDS.JUMP_EFFECT);
  return applyCourseMetadata({
    version: 1,
    roadIndex: STARTER_COURSE_IDS.JUMP_EFFECT,
    source: 'tracked-original-neondrift-starter-cup',
    name: entry.name,
    world: entry.world,
    gravity: 12,
    fuel: 400,
    oxygen: 400,
    length: 118,
    columns: CONSTANTS.roadColumns,
    start: { x: CONSTANTS.levelCenterX, y: CONSTANTS.groundY, z: 3 },
    constants: { ...CONSTANTS },
    palette: JUMP_EFFECT_PALETTE.map((color) => [...color]),
    coaching: {
      hazard: {
        row: 44,
        endRow: 44,
        cueRow: 32,
        protectedRows: 5,
        action: 'Jump the full-width hazard',
        successRow: 45,
      },
      finish: { row: 117, cueRow: 104 },
    },
    visualHints: {
      guideRails: [
        { rowStart: 0, rowEnd: 47, leftColumn: 0, rightColumn: 6 },
        { rowStart: 50, rowEnd: 81, leftColumn: 0, rightColumn: 6 },
        { rowStart: 84, rowEnd: 117, leftColumn: 0, rightColumn: 6 },
      ],
      hazardRims: [
        { rowStart: 44, rowEnd: 44, columnStart: 0, columnEnd: 6 },
      ],
      effectCueRows: [11, 24, 36, 58],
    },
    cells: makeJumpEffectRows(),
  }, entry, TRACE_LIBRARY[entry.id]);
}

const COURSE_FACTORIES = Object.freeze({
  [STARTER_COURSE_IDS.TRAINING]: createTrainingCourse,
  [STARTER_COURSE_IDS.HANDLING]: createHandlingCourse,
  [STARTER_COURSE_IDS.JUMP_EFFECT]: createJumpEffectCourse,
});

export function createStarterCourse(courseId = STARTER_COURSE_IDS.TRAINING) {
  const canonicalCourseId = canonicalStarterCourseId(courseId);
  const factory = COURSE_FACTORIES[canonicalCourseId];
  if (!factory) throw new Error(`unknown Starter Cup course ${courseId}`);
  return factory();
}

export function createStarterCupCourses() {
  return MANIFEST_ENTRIES.map((entry) => createStarterCourse(entry.id));
}

export function isStarterCourseId(courseId) {
  return Object.hasOwn(COURSE_FACTORIES, canonicalStarterCourseId(courseId));
}

export function starterCourseEntry(courseId = STARTER_COURSE_IDS.TRAINING) {
  return { ...manifestEntry(canonicalStarterCourseId(courseId)) };
}

export function starterCourseSelection(courseId = STARTER_COURSE_IDS.TRAINING) {
  return {
    type: 'starter',
    entry: starterCourseEntry(courseId),
  };
}

export function createStarterCupProgression(completedCourseIds = []) {
  const completed = new Set(completedCourseIds);
  const courses = MANIFEST_ENTRIES.map((entry) => {
    const unlocked = entry.unlockAfter == null || completed.has(entry.unlockAfter);
    return {
      ...entry,
      completed: completed.has(entry.id),
      unlocked,
    };
  });
  return {
    cupId: STARTER_CUP_ID,
    complete: courses.every((course) => course.completed),
    completedCourseIds: courses.filter((course) => course.completed).map((course) => course.id),
    courses,
  };
}
