import { surfaceColorRgb, relativeLuminance } from './course-colors.js';

export const COURSE_CLASS = Object.freeze({
  ROAD: 'road',
  GAP_BOUNDARY: 'gapBoundary',
  PLAYER: 'player',
  OBSTACLE: 'obstacle',
  EFFECT_PAD: 'effectPad',
  FINISH: 'finish',
});

function centerColumn(level) {
  return Math.floor(level.columns / 2);
}

function hasEffect(cell) {
  return cell.tileEffect !== 'none' || cell.cubeEffect !== 'none';
}

function rowHasFinish(level, row) {
  return level.cells[row]?.some((cell) => cell.tunnel && cell.tile) ?? false;
}

function hasRoadNeighbor(level, row, column) {
  for (const [dr, dc] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const cell = level.cells[row + dr]?.[column + dc];
    if (cell?.tile || cell?.cube != null || cell?.tunnel) return true;
  }
  return false;
}

function classifyCell(level, row, column) {
  const cell = level.cells[row]?.[column];
  const classes = new Set();
  if (!cell) return classes;
  if (cell.tile) classes.add(COURSE_CLASS.ROAD);
  if (!cell.tile && cell.cube == null && !cell.tunnel && hasRoadNeighbor(level, row, column)) {
    classes.add(COURSE_CLASS.GAP_BOUNDARY);
  }
  if (cell.cube != null || cell.tileEffect === 'kill' || cell.cubeEffect === 'kill') {
    classes.add(COURSE_CLASS.OBSTACLE);
  }
  if (hasEffect(cell)) classes.add(COURSE_CLASS.EFFECT_PAD);
  if (cell.tunnel && cell.tile) classes.add(COURSE_CLASS.FINISH);
  const startRow = Math.floor(level.start?.z ?? 0);
  if (row === startRow && column === centerColumn(level)) classes.add(COURSE_CLASS.PLAYER);
  return classes;
}

function importantRows(level) {
  const rows = new Set();
  for (let row = 0; row < Math.min(level.length, 12); row++) rows.add(row);
  for (let row = 0; row < level.length; row++) {
    if (rowHasFinish(level, row)) rows.add(row);
    for (let column = 0; column < level.columns; column++) {
      const classes = classifyCell(level, row, column);
      if (
        classes.has(COURSE_CLASS.GAP_BOUNDARY) ||
        classes.has(COURSE_CLASS.OBSTACLE) ||
        classes.has(COURSE_CLASS.EFFECT_PAD)
      ) {
        rows.add(row);
      }
    }
  }
  rows.add(Math.max(0, level.length - 1));
  return [...rows].sort((a, b) => a - b);
}

function classSummary(cells) {
  const summary = Object.fromEntries(Object.values(COURSE_CLASS).map((name) => [name, 0]));
  for (const cell of cells) for (const name of cell.classes) summary[name] += 1;
  return summary;
}

export function createCoursePreview(level, options = {}) {
  const maxRows = options.maxRows ?? 48;
  const rows = importantRows(level);
  const chosenRows = rows.length <= maxRows
    ? rows
    : rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / maxRows) === 0);
  const cells = [];
  const roadLuminance = [];

  for (const row of chosenRows) {
    for (let column = 0; column < level.columns; column++) {
      const source = level.cells[row][column];
      const classes = [...classifyCell(level, row, column)];
      if (source.tile) {
        roadLuminance.push(relativeLuminance(surfaceColorRgb(source, level.palette, 'tile')));
      }
      cells.push({
        row,
        column,
        classes,
        effect: source.tileEffect !== 'none' ? source.tileEffect : source.cubeEffect,
        occupied: Boolean(source.tile || source.tunnel || source.cube != null),
      });
    }
  }

  return {
    kind: 'course-preview',
    levelId: level.roadIndex,
    name: level.name,
    columns: level.columns,
    length: level.length,
    rows: chosenRows,
    cells,
    classes: classSummary(cells),
    minRoadLuminance: roadLuminance.length > 0 ? Math.min(...roadLuminance) : null,
  };
}

export function renderCoursePreview(container, preview) {
  if (!container) return;
  container.replaceChildren();
  container.style.setProperty('--preview-columns', String(preview.columns));
  container.style.setProperty('--preview-rows', String(preview.rows.length));
  container.setAttribute('aria-label', `${preview.name} course preview`);

  const rowIndex = new Map(preview.rows.map((row, index) => [row, index]));
  for (const cell of preview.cells) {
    const node = container.ownerDocument.createElement('span');
    node.className = ['preview-cell', ...cell.classes.map((name) => `is-${name}`)].join(' ');
    node.style.gridColumn = String(cell.column + 1);
    node.style.gridRow = String((rowIndex.get(cell.row) ?? 0) + 1);
    node.dataset.row = String(cell.row);
    node.dataset.column = String(cell.column);
    node.title = `row ${cell.row}, lane ${cell.column + 1}`;
    container.append(node);
  }
}
