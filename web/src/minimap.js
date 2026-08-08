import { progressRatio } from './view.js';

function routeClass(cell) {
  if (cell?.tunnel && cell?.tile) return 'finish';
  if (cell?.cube != null || cell?.tileEffect === 'kill' || cell?.cubeEffect === 'kill') return 'obstacle';
  if (cell?.tileEffect !== 'none' || cell?.cubeEffect !== 'none') return 'effect';
  if (cell?.tile || cell?.tunnel) return 'road';
  return 'gap';
}

function sampleRows(level, maxRows) {
  if (level.length <= maxRows) return Array.from({ length: level.length }, (_, row) => row);
  const rows = new Set([0, Math.floor(level.start?.z ?? 0), level.length - 1]);
  for (let index = 0; index < maxRows; index++) {
    rows.add(Math.min(level.length - 1, Math.floor(index * (level.length - 1) / Math.max(1, maxRows - 1))));
  }
  for (let row = 0; row < level.length; row++) {
    for (const cell of level.cells[row]) {
      const kind = routeClass(cell);
      if (kind === 'finish' || kind === 'obstacle' || kind === 'effect') rows.add(row);
    }
    if (level.cells[row].some((cell, column) => kindAt(level, row, column) === 'gap-boundary')) rows.add(row);
  }
  return [...rows].sort((a, b) => a - b);
}

function kindAt(level, row, column) {
  const cell = level.cells[row]?.[column];
  if (!cell || cell.tile || cell.cube != null || cell.tunnel) return routeClass(cell);
  for (const adjacent of [level.cells[row]?.[column - 1], level.cells[row]?.[column + 1]]) {
    if (adjacent?.tile || adjacent?.cube != null || adjacent?.tunnel) return 'gap-boundary';
  }
  return 'gap';
}

export function createMinimapModel(level, frame, options = {}) {
  const staticModel = createStaticMinimapModel(level, options);
  return {
    ...staticModel,
    ...movingMinimapState(level, frame),
  };
}

export function createStaticMinimapModel(level, options = {}) {
  const rows = sampleRows(level, options.maxRows ?? 72);
  const cells = [];
  const counts = { road: 0, gap: 0, gapBoundary: 0, obstacle: 0, effect: 0, finish: 0 };
  for (const row of rows) {
    for (let column = 0; column < level.columns; column++) {
      const rawKind = kindAt(level, row, column);
      const kind = rawKind === 'gap-boundary' ? 'gapBoundary' : rawKind;
      counts[kind] += 1;
      cells.push({ row, column, kind });
    }
  }
  return {
    kind: 'race-minimap',
    levelId: level.roadIndex,
    rows,
    columns: level.columns,
    cells,
    counts,
    signature: `${level.roadIndex}:${level.length}:${level.columns}:${rows.join(',')}:${cells.map((cell) => cell.kind[0]).join('')}`,
  };
}

export function movingMinimapState(level, frame) {
  const progress = progressRatio(frame, level);
  return {
    progress,
    player: {
      row: frame.row ?? Math.floor(frame.z ?? level.start?.z ?? 0),
      column: Math.max(0, Math.min(level.columns - 1, Math.round(((frame.x ?? level.start.x) - level.constants.levelMinX) / level.constants.tileStrideX))),
      progress,
    },
  };
}

function appendStaticCells(container, model) {
  container.replaceChildren();
  container.style.setProperty('--mini-columns', String(model.columns));
  container.style.setProperty('--mini-rows', String(model.rows.length));
  const rowIndex = new Map(model.rows.map((row, index) => [row, index]));
  for (const cell of model.cells) {
    const node = container.ownerDocument.createElement('span');
    node.className = `mini-cell is-${cell.kind}`;
    node.style.gridColumn = String(cell.column + 1);
    node.style.gridRow = String((rowIndex.get(cell.row) ?? 0) + 1);
    node.setAttribute?.('aria-hidden', 'true');
    container.append(node);
  }

  const marker = container.ownerDocument.createElement('span');
  marker.className = 'mini-player';
  marker.setAttribute?.('aria-hidden', 'true');
  container.append(marker);
  container.dataset.minimapSignature = model.signature;
  return marker;
}

function findMarker(container) {
  return container.querySelector?.('.mini-player') ??
    Array.from(container.children ?? []).find((child) => child.className === 'mini-player') ??
    null;
}

export function renderMinimap(container, model) {
  if (!container) return;
  container.setAttribute('aria-label', `Race minimap, ${Math.round(model.progress * 100)} percent complete`);

  const marker = container.dataset?.minimapSignature === model.signature
    ? findMarker(container)
    : appendStaticCells(container, model);
  if (!marker) return;
  marker.style.left = `${50 + (model.player.column - (model.columns - 1) / 2) * (70 / model.columns)}%`;
  marker.style.top = `${Math.max(0, Math.min(100, model.player.progress * 100))}%`;
}

export function createMinimapPresenter(level, container, options = {}) {
  const staticModel = createStaticMinimapModel(level, options);
  return {
    staticModel,
    update(frame) {
      const model = {
        ...staticModel,
        ...movingMinimapState(level, frame),
      };
      renderMinimap(container, model);
      return model;
    },
    snapshot() {
      return {
        levelId: staticModel.levelId,
        rows: staticModel.rows.length,
        columns: staticModel.columns,
        cells: staticModel.cells.length,
        counts: { ...staticModel.counts },
        signature: staticModel.signature,
      };
    },
  };
}
