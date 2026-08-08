import * as THREE from 'three';
import {
  APP_STATE,
  AppStateController,
  FOCUS_TARGETS,
  canUseRestartShortcut,
  pauseForVisibilityLoss,
  policyForState,
} from './app-state.js';
import { createAudioController } from './audio.js';
import {
  loadLevel,
  loadRequestedLevel,
  loadStarterCourse,
  probeSourceCatalog,
  shouldProbeSourceCatalog,
  starterSelection,
  tutorialSelection,
} from './loader.js';
import {
  STARTER_COURSE_IDS,
  isStarterCourseId,
} from './starter-cup.js';
import { COURSE_KIND, GARAGE_CATEGORY, createSourceDiscovery, getCourseEntry } from './content-manifest.js';
import {
  INPUT_ACTION_MANIFEST,
  bindKeyCode,
  createInputController,
  keyCodeFromEvent,
  keyLabel,
} from './input.js';
import { FixedStepRuntime } from './runtime.js';
import {
  BENCHMARK_FIXTURE_ID,
  BENCHMARK_TRACE_PATH,
  benchmarkDescriptor,
  controlsAtTraceTick,
  validateBenchmarkTrace,
} from './performance-contract.js';
import {
  applyDocumentPresentationState,
  applyRendererPresentation,
  effectivePresentationSettings,
} from './presentation-settings.js';
import { RACE_OUTCOME, createConfiguredRaceSession } from './race-session.js';
import {
  activeRivalForCourse,
  applyRivalRunToProgress,
  createCampaignView,
  applyRunRecordToProgress,
  nextCourseAfter,
} from './progression.js';
import { createSaveManager, upsertGhost } from './save.js';
import { addBaselineLighting, buildLevelScene, createNeonBackdrop, createGhostCraft, createProceduralCraft } from './scene.js';
import {
  buyGarageItem,
  buyTuningTier,
  createCraftRenderParameters,
  createGarageView,
  createRaceTuningConfig,
  createRaceTuningConfigId,
  equipGarageItem,
  previewGarageSelection,
  resetGarageConfiguration,
} from './garage.js';
import {
  createOwnBestGhostPayload,
  createOwnBestReplaySession,
  createRivalReplaySession,
} from './ghost.js';
import { HudPresenter, terminalCopy } from './hud.js';
import { TelemetrySampler, summarizeRendererInfo } from './telemetry.js';
import {
  applyCraftTransform,
  cameraProfileForAspect,
  computeChaseCamera,
  createCraftPresentation,
} from './view.js';
import { createCoursePreview, renderCoursePreview } from './preview.js';
import { createMinimapPresenter } from './minimap.js';
import {
  ListenerRegistry,
  RaceSessionLifecycle,
  ResourceScope,
  advanceRuntimeForShellState,
} from './session-lifecycle.js';
import {
  buildRouteMapView,
  consumePauseRequestForShell,
  resultActionsForRace,
  visibleScreenNamesForState,
} from './shell-ui.js';

const canvas = document.getElementById('c');
const errorBox = document.getElementById('err');
const hudRoot = document.getElementById('hud');
const terminal = document.getElementById('terminal');
const terminalTitle = document.getElementById('terminal-title');
const terminalDetail = document.getElementById('terminal-detail');
const appShell = document.getElementById('app-shell');
const catalogStatus = document.getElementById('catalog-status');
const starterList = document.getElementById('starter-list');
const sourceList = document.getElementById('source-list');
const levelTitle = document.getElementById('level-title');
const levelMeta = document.getElementById('level-meta');
const previewRoot = document.getElementById('course-preview');
const minimapRoot = document.getElementById('minimap');
const progressRail = document.getElementById('progress-rail');
const countdownOverlay = document.getElementById('countdown');
const countdownValue = document.getElementById('countdown-value');
const resultsTitle = document.getElementById('results-title');
const resultsDetail = document.getElementById('results-detail');
const resultsNext = document.getElementById('results-next');
const garageStatus = document.getElementById('garage-status');
const garagePreview = document.getElementById('garage-preview');
const garagePaints = document.getElementById('garage-paints');
const garageUnderglows = document.getElementById('garage-underglows');
const garageLiveries = document.getElementById('garage-liveries');
const garageTuning = document.getElementById('garage-tuning');
const garageReaction = document.getElementById('garage-reaction');
const audioStatus = document.getElementById('audio-status');
const audioMuted = document.getElementById('audio-muted');
const audioMusic = document.getElementById('audio-music');
const audioVolume = document.getElementById('audio-volume');
const audioVolumeValue = document.getElementById('audio-volume-value');
const audioRetro = document.getElementById('audio-retro');
const audioRetroStatus = document.getElementById('audio-retro-status');
const accessReducedMotion = document.getElementById('access-reduced-motion');
const accessHighContrast = document.getElementById('access-high-contrast');
const renderScale = document.getElementById('render-scale');
const renderScaleValue = document.getElementById('render-scale-value');
const qualityTier = document.getElementById('quality-tier');
const keybindList = document.getElementById('keybind-list');
const settingsStatus = document.getElementById('settings-status');

const COUNTDOWN_MS = 1400;
const OWN_BEST_GHOST_APPEARANCE = Object.freeze({
  body: '#ffffff',
  emissive: '#12283d',
  wing: '#45ff8a',
  canopy: '#78f6ff',
  underglow: '#16f0e6',
  underglowIntensity: 1.28,
  livery: {
    pattern: 'splitter-stripes',
    accent: '#ffffff',
    secondary: '#45ff8a',
    opacity: 0.92,
  },
});

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function setHidden(node, hidden) {
  if (node) node.hidden = hidden;
}

function focusState(state) {
  const selector = FOCUS_TARGETS[state];
  const target = selector ? document.querySelector(selector) : null;
  target?.focus?.({ preventScroll: true });
}

function selectedTutorialRecord() {
  return {
    sourceKind: 'starter',
    courseId: STARTER_COURSE_IDS.TRAINING,
    entry: tutorialSelection().entry,
    level: null,
    preview: null,
    loading: null,
    error: null,
  };
}

function selectionRecordForCourse(entry) {
  if (!entry) return null;
  if (entry.kind === COURSE_KIND.STARTER || isStarterCourseId(entry.id)) {
    return {
      sourceKind: 'starter',
      courseId: entry.id,
      entry: { ...starterSelection(entry.id).entry, ...entry },
      level: null,
      preview: null,
      loading: null,
      error: null,
    };
  }
  return {
    sourceKind: 'source',
    courseId: entry.id,
    entry,
    level: null,
    preview: null,
    loading: null,
    error: null,
  };
}

function installHooks(context) {
  const hooks = Object.freeze({
    appState() {
      return cloneData(context.state.snapshot());
    },
    levelSummary() {
      const level = context.race?.level ?? context.selected.level;
      if (!level) return null;
      return {
        roadIndex: level.roadIndex,
        name: level.name,
        length: level.length,
        columns: level.columns,
        sourceKind: context.race?.sourceKind ?? context.selected.sourceKind,
        courseId: context.race?.courseId ?? context.selected.courseId ?? null,
        starterCupComplete: context.campaignView?.complete ?? false,
      };
    },
    snapshot() {
      return cloneData({
        frame: context.race?.latest.renderState?.current ?? null,
        presentation: context.race?.latest.presentation ?? null,
        counters: context.race?.runtime?.counters?.() ?? null,
      });
    },
    input() {
      return cloneData({
        controls: context.input.snapshot(),
        listeners: context.input.listenerSnapshot(),
      });
    },
    runtime() {
      return context.race?.runtime?.counters?.() ?? null;
    },
    telemetry() {
      return context.race?.telemetry?.snapshot?.() ?? null;
    },
    sceneMetrics() {
      return cloneData(context.race?.sceneMetrics ?? null);
    },
    rendererInfo() {
      return summarizeRendererInfo(context.renderer.info);
    },
    lifecycle() {
      return cloneData(context.lifecycle.snapshot());
    },
    starterCup() {
      return cloneData(context.campaignView?.courses ?? []);
    },
    campaign() {
      return cloneData(context.campaignView);
    },
    rivals() {
      return cloneData(context.campaignView?.rivalLadder ?? null);
    },
    save() {
      return cloneData(context.save);
    },
    audio() {
      return cloneData(context.audio?.snapshot?.() ?? null);
    },
    presentationSettings() {
      return cloneData(context.presentation ?? null);
    },
    benchmarkFixture() {
      return cloneData({
        ...benchmarkDescriptor(),
        contentHash: context.benchmark?.contentHash ?? null,
        controlsHash: context.benchmark?.trace?.controlsHash ?? null,
        active: context.benchmark?.active === true,
      });
    },
    performanceReadback() {
      return cloneData({
        at: new Date().toISOString(),
        fixture: {
          ...benchmarkDescriptor(),
          contentHash: context.benchmark?.contentHash ?? null,
          controlsHash: context.benchmark?.trace?.controlsHash ?? null,
          active: context.benchmark?.active === true,
        },
        renderer: summarizeRendererInfo(context.renderer.info),
        audio: context.audio?.snapshot?.() ?? null,
        input: context.input.listenerSnapshot(),
        shellListeners: context.listeners?.snapshot?.() ?? null,
        lifecycle: context.lifecycle.snapshot(),
        presentation: context.presentation ?? null,
        telemetry: context.race?.telemetry?.snapshot?.() ?? null,
        sceneMetrics: context.race?.sceneMetrics ?? null,
      });
    },
    lastResult() {
      return cloneData(context.race?.progressResult ?? null);
    },
    garage() {
      return cloneData(createGarageView(context.save, { preview: context.garagePreview }));
    },
    craftAppearance() {
      return cloneData(createCraftRenderParameters(context.save));
    },
    raceConfig() {
      return cloneData(createRaceTuningConfig(context.save));
    },
    ghosts() {
      return cloneData({
        savedCourseIds: Object.keys(context.save?.ghosts ?? {}),
        active: context.race?.ghosts?.map((ghost) => ({
          id: ghost.id,
          kind: ghost.kind,
          targetTicks: ghost.targetTicks,
          valid: ghost.valid,
        })) ?? [],
        rejected: context.race?.ghostRejections ?? [],
      });
    },
  });
  Object.defineProperty(window, '__NEONDRIFT__', {
    value: hooks,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(window, '__NEONDRIFT_PERF__', {
    value: Object.freeze({
      fixture: hooks.benchmarkFixture,
      readback: hooks.performanceReadback,
      protocol() {
        return cloneData(benchmarkDescriptor());
      },
    }),
    writable: false,
    configurable: false,
  });
}

function setCommandStatus(message, isError = false) {
  if (!garageStatus) return;
  garageStatus.textContent = message;
  garageStatus.dataset.error = String(isError);
}

function writeGarageResult(context, result) {
  if (!result.ok) {
    setCommandStatus(result.message ?? result.reason, true);
    return false;
  }
  const written = context.saveManager.write(result.save);
  context.save = written.save;
  context.saveStatus = written;
  context.garagePreview = null;
  setCommandStatus(result.message ?? `Credits ${context.save.credits}`);
  return true;
}

function categoryLabel(category) {
  if (category === GARAGE_CATEGORY.PAINTS) return 'paint';
  if (category === GARAGE_CATEGORY.UNDERGLOWS) return 'underglow';
  return 'livery';
}

function itemSwatch(item, category) {
  if (category === GARAGE_CATEGORY.LIVERIES) return item.material?.accent ?? item.material?.secondary ?? '#16f0e6';
  return item.material?.color ?? '#16f0e6';
}

function renderGarageCategory(root, view, category) {
  if (!root) return;
  root.replaceChildren();
  for (const item of view.catalogs[category] ?? []) {
    const row = document.createElement('article');
    row.className = 'garage-item';
    row.setAttribute('role', 'listitem');
    row.dataset.category = category;
    row.dataset.item = item.id;
    row.dataset.equipped = String(item.equipped);
    row.dataset.owned = String(item.owned);
    row.dataset.previewed = String(item.previewed);

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--swatch', itemSwatch(item, category));
    swatch.setAttribute('aria-hidden', 'true');

    const copy = document.createElement('p');
    copy.className = 'garage-copy';
    const status = item.equipped ? 'equipped' : item.owned ? 'owned' : item.unlocked ? `${item.price} credits` : item.disabledReason;
    copy.textContent = `${item.name}\n${status}`;

    const actions = document.createElement('div');
    actions.className = 'command-row';
    const previewButton = document.createElement('button');
    previewButton.type = 'button';
    previewButton.dataset.command = 'garage-preview';
    previewButton.dataset.category = category;
    previewButton.dataset.item = item.id;
    previewButton.textContent = 'Preview';
    previewButton.disabled = !item.unlocked;
    actions.append(previewButton);
    if (!item.owned) {
      const buyButton = document.createElement('button');
      buyButton.type = 'button';
      buyButton.dataset.command = 'garage-buy';
      buyButton.dataset.category = category;
      buyButton.dataset.item = item.id;
      buyButton.textContent = 'Buy';
      buyButton.disabled = !item.unlocked;
      actions.append(buyButton);
    } else {
      const equipButton = document.createElement('button');
      equipButton.type = 'button';
      equipButton.dataset.command = 'garage-equip';
      equipButton.dataset.category = category;
      equipButton.dataset.item = item.id;
      equipButton.textContent = item.equipped ? 'Equipped' : 'Equip';
      equipButton.disabled = item.equipped;
      actions.append(equipButton);
    }
    row.append(swatch, copy, actions);
    root.append(row);
  }
}

function renderGarageTuning(view) {
  if (!garageTuning) return;
  garageTuning.replaceChildren();
  for (const stat of Object.values(view.tuning)) {
    const row = document.createElement('article');
    row.className = 'tuning-item';
    row.setAttribute('role', 'listitem');
    row.dataset.stat = stat.id;
    row.dataset.tier = String(stat.currentTier);
    row.dataset.maxed = String(stat.maxed);
    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.setProperty('--swatch', stat.id === 'lift' ? '#ffe66d' : stat.id === 'handling' ? '#45ff8a' : stat.id === 'accel' ? '#ff3bd4' : '#16f0e6');
    swatch.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('p');
    copy.className = 'garage-copy';
    copy.textContent = [
      `${stat.label} tier ${stat.currentTier} | x${stat.multiplier}`,
      stat.copy,
      stat.maxed ? 'maxed' : `next x${stat.nextMultiplier} | ${stat.nextPrice} credits`,
    ].join('\n');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = 'garage-upgrade';
    button.dataset.stat = stat.id;
    button.dataset.tier = String(stat.nextTier);
    button.textContent = stat.maxed ? 'Max' : 'Upgrade';
    button.disabled = stat.maxed;
    row.append(swatch, copy, button);
    garageTuning.append(row);
  }
}

function renderGarage(context) {
  const view = createGarageView(context.save, { preview: context.garagePreview });
  if (garageStatus && !garageStatus.textContent) garageStatus.textContent = `Credits ${view.credits}`;
  if (garagePreview) {
    garagePreview.replaceChildren();
    garagePreview.style.setProperty('--preview-body', view.renderParameters.body);
    garagePreview.style.setProperty('--preview-under', view.renderParameters.underglow);
    garagePreview.style.setProperty('--preview-livery', view.renderParameters.livery.accent);
    garagePreview.style.setProperty('--preview-livery-opacity', String(view.renderParameters.livery.opacity));
    const ship = document.createElement('div');
    ship.className = 'garage-preview-ship';
    ship.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('p');
    copy.className = 'garage-copy';
    copy.textContent = [
      `${view.preview.paint} | ${view.preview.underglow} | ${view.preview.livery.pattern}`,
      `Credits ${view.credits}`,
    ].join('\n');
    garagePreview.append(ship, copy);
  }
  if (garageReaction) {
    garageReaction.textContent = [
      `Reaction Margin ${view.reactionMargin.label} ${view.reactionMargin.score}`,
      view.reactionMargin.copy,
      view.reactionMargin.limitation,
    ].join('\n');
  }
  renderGarageCategory(garagePaints, view, GARAGE_CATEGORY.PAINTS);
  renderGarageCategory(garageUnderglows, view, GARAGE_CATEGORY.UNDERGLOWS);
  renderGarageCategory(garageLiveries, view, GARAGE_CATEGORY.LIVERIES);
  renderGarageTuning(view);
}

function syncAudioPolicy(context) {
  const policy = policyForState(context.state.state).audio;
  context.audio?.setShellAudioPolicy(policy, { hidden: document.hidden }).catch((error) => {
    console.warn('audio policy sync failed', error);
  });
}

function writeAudioSettings(context, patch) {
  const nextAudio = {
    ...context.save.audio,
    ...patch,
    retroMuzax: false,
  };
  const written = context.saveManager.write({ ...context.save, audio: nextAudio });
  context.save = written.save;
  context.saveStatus = written;
  context.audio?.applySettings(context.save.audio);
  return written;
}

function syncPresentation(context) {
  context.presentation = effectivePresentationSettings(context.save.settings, {
    matchMedia: window.matchMedia?.bind(window),
  });
  context.presentationRenderer = applyRendererPresentation(context.renderer, context.presentation);
  context.presentationDocument = applyDocumentPresentationState(document.documentElement, context.presentation);
  context.race?.levelScene?.setPresentationOptions?.(context.presentation);
  context.race?.backdrop?.setPresentationOptions?.(context.presentation);
  context.race?.craft?.setPresentationOptions?.(context.presentation);
  for (const ghost of context.race?.ghosts ?? []) {
    ghost.craft?.setPresentationOptions?.(context.presentation);
  }
  return context.presentation;
}

function writePresentationSettings(context, patch) {
  const written = context.saveManager.write({
    ...context.save,
    settings: {
      ...context.save.settings,
      ...patch,
    },
  });
  context.save = written.save;
  context.saveStatus = written;
  context.input.setKeyBindings(context.save.settings.keyBindings);
  syncPresentation(context);
  return written;
}

function renderKeybinds(context) {
  if (!keybindList) return;
  const bindings = context.save.settings.keyBindings;
  keybindList.replaceChildren();
  for (const [action, manifest] of Object.entries(INPUT_ACTION_MANIFEST)) {
    const row = document.createElement('article');
    row.className = 'keybind-row';
    row.setAttribute('role', 'listitem');
    row.dataset.action = action;
    row.dataset.pending = String(context.pendingRemapAction === action);

    const label = document.createElement('span');
    label.className = 'setting-copy';
    label.textContent = manifest.label;

    const value = document.createElement('span');
    value.className = 'setting-value';
    value.textContent = (bindings[action] ?? []).map(keyLabel).join(' / ');

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = 'keybind-start';
    button.dataset.remapAction = action;
    button.setAttribute('aria-label', `Change ${manifest.label} key`);
    button.textContent = context.pendingRemapAction === action ? 'Press key' : 'Change';

    row.append(label, value, button);
    keybindList.append(row);
  }
}

function renderSettings(context) {
  const audio = context.save.audio;
  const presentation = syncPresentation(context);
  const snapshot = context.audio?.snapshot?.() ?? null;
  const volumePct = Math.round(audio.volume * 100);
  if (audioMuted) audioMuted.checked = audio.muted;
  if (audioMusic) audioMusic.checked = audio.music;
  if (audioVolume) audioVolume.value = String(volumePct);
  if (audioVolumeValue) audioVolumeValue.textContent = `${volumePct}%`;
  if (audioStatus) {
    const state = snapshot?.activated ? snapshot.contextState : 'standby';
    audioStatus.textContent = `Audio ${state} | ${audio.muted ? 'muted' : `volume ${volumePct}%`}`;
  }
  const retro = context.audio?.retroMuzaxCapability?.() ?? null;
  if (audioRetro) {
    audioRetro.checked = false;
    audioRetro.disabled = true;
  }
  if (audioRetroStatus && retro) {
    audioRetroStatus.textContent = `${retro.label}: ${retro.reason}. ${retro.attribution}`;
  }
  if (accessReducedMotion) accessReducedMotion.checked = context.save.settings.reducedMotionForce;
  if (accessHighContrast) accessHighContrast.checked = context.save.settings.highContrast;
  if (renderScale) renderScale.value = String(context.save.settings.renderScale);
  if (renderScaleValue) renderScaleValue.textContent = `${Math.round(presentation.effectiveRenderScale * 100)}%`;
  if (qualityTier) qualityTier.value = context.save.settings.qualityTier;
  if (settingsStatus) {
    settingsStatus.textContent = [
      `Motion ${presentation.reducedMotion ? 'reduced' : 'standard'}`,
      `contrast ${presentation.highContrast ? 'high' : 'normal'}`,
      `render ${Math.round(presentation.effectiveRenderScale * 100)}%`,
      `quality ${presentation.profile.label}`,
    ].join(' | ');
  }
  renderKeybinds(context);
}

function handleAudioSettingInput(context, target) {
  const setting = target?.dataset?.audioSetting;
  if (!setting) return false;
  if (setting === 'muted') {
    writeAudioSettings(context, { muted: Boolean(target.checked) });
  } else if (setting === 'music') {
    writeAudioSettings(context, { music: Boolean(target.checked) });
  } else if (setting === 'volume') {
    writeAudioSettings(context, { volume: Number(target.value) / 100 });
  } else if (setting === 'retroMuzax') {
    writeAudioSettings(context, { retroMuzax: false });
  } else {
    return false;
  }
  return true;
}

function handlePresentationSettingInput(context, target) {
  const setting = target?.dataset?.presentationSetting;
  if (!setting) return false;
  if (setting === 'reducedMotionForce') {
    writePresentationSettings(context, { reducedMotionForce: Boolean(target.checked) });
  } else if (setting === 'highContrast') {
    writePresentationSettings(context, { highContrast: Boolean(target.checked) });
  } else if (setting === 'renderScale') {
    writePresentationSettings(context, { renderScale: Number(target.value) });
  } else if (setting === 'qualityTier') {
    writePresentationSettings(context, { qualityTier: target.value });
  } else {
    return false;
  }
  return true;
}

function capturePendingRemap(context, event) {
  const action = context.pendingRemapAction;
  if (!action) return false;
  const code = keyCodeFromEvent(event);
  if (code === 'Tab') return false;
  event.preventDefault();
  event.stopPropagation();
  if (!code) return true;
  const keyBindings = bindKeyCode(context.save.settings.keyBindings, action, code);
  context.pendingRemapAction = null;
  writePresentationSettings(context, { keyBindings });
  renderShell(context);
  document.querySelector(`[data-remap-action="${action}"]`)?.focus?.({ preventScroll: true });
  return true;
}

function primeAudioFromGesture(context, event) {
  context.audio?.activateFromGesture(event).catch((error) => {
    console.warn('audio activation failed', error);
  });
}

function renderCatalog(catalog) {
  if (!catalogStatus || !sourceList || !starterList) return;
  starterList.replaceChildren();
  sourceList.replaceChildren();
  const routeMap = buildRouteMapView(catalog, catalog.campaignView);
  if (!routeMap.ready) {
    catalogStatus.textContent = routeMap.statusText;
    return;
  }
  catalogStatus.textContent = routeMap.statusText;

  for (const entry of routeMap.starterCourses) {
    const card = document.createElement('article');
    card.className = 'route-card';
    card.setAttribute('role', 'listitem');
    card.dataset.course = entry.id;
    card.dataset.unlocked = String(entry.unlocked);
    card.dataset.completed = String(entry.completed);

    const title = document.createElement('h3');
    title.textContent = entry.name;
    const meta = document.createElement('p');
    meta.className = 'muted';
    const best = entry.bestTicks ? ` | best ${entry.bestTicks} ticks` : '';
    const rival = entry.rival ? `Rival rank ${entry.rival.rank}: ${entry.rival.name} target ${entry.rival.targetTicks} ticks` : null;
    meta.textContent = [
      `${entry.role} | par ${entry.parTicks} ticks${best}`,
      rival,
      `${entry.completed ? 'complete' : entry.unlocked ? 'open' : 'locked'} | medal ${entry.medalName}`,
      `${entry.gravityLabel} | ${entry.resourcesLabel}`,
      entry.hazardLegend,
      entry.disabledReason,
    ].filter(Boolean).join('\n');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = 'select-starter';
    button.dataset.course = entry.id;
    button.textContent = entry.launchable ? 'Select' : 'Locked';
    button.disabled = !entry.launchable;
    card.dataset.rivalActive = String(Boolean(entry.rival));
    if (entry.id === STARTER_COURSE_IDS.TRAINING) button.setAttribute('data-focus-default', '');
    card.append(title, meta, button);
    starterList.append(card);
  }

  if (routeMap.sourceSummary) {
    const card = document.createElement('article');
    card.className = 'route-card source-summary';
    card.setAttribute('role', 'listitem');
    card.dataset.sourceSummary = routeMap.sourceSummary.id;
    const title = document.createElement('h3');
    title.textContent = routeMap.sourceSummary.title;
    const meta = document.createElement('p');
    meta.className = 'muted';
    meta.textContent = routeMap.sourceSummary.detail;
    card.append(title, meta);
    sourceList.append(card);
    return;
  }

  for (const entry of routeMap.sourceCards) {
    const card = document.createElement('article');
    card.className = 'route-card';
    card.setAttribute('role', 'listitem');
    card.dataset.course = entry.id;
    card.dataset.unlocked = String(entry.unlocked);
    card.dataset.completed = String(entry.completed);
    const title = document.createElement('h3');
    title.textContent = entry.presentationName ?? entry.name;
    const meta = document.createElement('p');
    meta.className = 'muted';
    const best = entry.bestTicks ? ` | best ${entry.bestTicks} ticks` : '';
    const par = entry.parTicks ? `par ${entry.parTicks} ticks${best}` : 'legacy demo, no campaign rewards';
    const rival = entry.rival ? `Rival rank ${entry.rival.rank}: ${entry.rival.name} target ${entry.rival.targetTicks} ticks` : null;
    meta.textContent = [
      par,
      rival,
      `${entry.completed ? 'complete' : entry.unlocked ? 'open' : 'locked'} | medal ${entry.medalName}`,
      `${entry.gravityLabel} | ${entry.resourcesLabel}`,
      entry.hazardLegend,
      entry.disabledReason,
    ].filter(Boolean).join('\n');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.command = 'select-source';
    button.dataset.course = entry.id;
    button.textContent = entry.launchable ? 'Select' : 'Unavailable';
    button.disabled = !entry.launchable;
    card.dataset.rivalActive = String(Boolean(entry.rival));
    card.append(title, meta, button);
    sourceList.append(card);
  }
}

function renderLevelSelect(selected) {
  if (levelTitle) levelTitle.textContent = selected.entry?.name ?? 'Select a route';
  if (levelMeta) {
    if (selected.error) levelMeta.textContent = selected.error.message;
    else if (!selected.level) levelMeta.textContent = 'Loading course data';
    else {
      const par = selected.entry?.parTicks ? ` | par ${selected.entry.parTicks} ticks` : '';
      const best = selected.entry?.bestTicks ? ` | best ${selected.entry.bestTicks} ticks` : '';
      const medal = selected.entry?.medalName ? ` | medal ${selected.entry.medalName}` : '';
      const rival = selected.entry?.rival
        ? `Rival rank ${selected.entry.rival.rank}: ${selected.entry.rival.name} target ${selected.entry.rival.targetTicks} ticks`
        : null;
      levelMeta.textContent = [
        `${selected.sourceKind} route | ${selected.level.length} rows | ${selected.level.columns} lanes${par}${best}${medal}`,
        rival,
        `Gravity ${selected.level.gravity} | fuel ${selected.level.fuel} | oxygen ${selected.level.oxygen}`,
        selected.entry?.hazardLegend,
      ].filter(Boolean).join('\n');
    }
  }
  if (selected.preview) renderCoursePreview(previewRoot, selected.preview);
  else previewRoot?.replaceChildren();
}

function renderResults(race) {
  const frame = race?.latest.renderState?.current;
  const copy = frame ? terminalCopy(frame) : null;
  const result = race?.progressResult ?? null;
  const rivalResult = race?.rivalResult ?? null;
  const ownBestResult = race?.ownBestResult ?? null;
  if (resultsTitle) resultsTitle.textContent = copy?.title ?? 'RUN COMPLETE';
  if (resultsDetail) {
    const row = frame?.row ?? 0;
    const tick = result?.raceTicks ?? frame?.raceTicks ?? 0;
    const rewards = result?.rewardComponents?.length
      ? ` Rewards: ${result.rewardComponents.map((item) => `${item.label} +${item.credits}`).join(', ')}.`
      : '';
    const credits = result ? ` Credits +${result.creditsAwarded ?? 0}; total ${result.totalCredits ?? 0}.` : '';
    const medal = result?.outcome === 'won' ? ` Medal ${result.medalName}; clean ${result.cleanRun ? 'yes' : 'no'}.` : '';
    const unlock = result?.unlockedCourseIds?.length ? ` New unlocks: ${result.unlockedCourseIds.join(', ')}.` : '';
    const rival = rivalResult?.defeated
      ? ` Rival rank ${rivalResult.rival.rank} defeated: ${rivalResult.rival.name}; target ${rivalResult.targetTicks}.`
      : rivalResult?.attempted
        ? ` Rival target ${rivalResult.targetTicks} not beaten.`
        : '';
    const rivalReward = rivalResult?.rewardComponents?.length
      ? ` Rival reward: ${rivalResult.rewardComponents.map((item) => `${item.label} +${item.credits}`).join(', ')}.`
      : '';
    const sparky = rivalResult?.sparkyLiveryUnlocked ? ' Sparky Signal livery unlocked.' : '';
    const ghost = ownBestResult?.accepted
      ? ' Own-best ghost saved.'
      : ownBestResult?.attempted
        ? ` Own-best ghost not saved (${ownBestResult.reason}).`
        : '';
    resultsDetail.textContent = `${copy?.detail ?? 'Session ended.'} Row ${row}, tick ${tick}, time ${result?.timeText ?? frame?.raceTimeText ?? '00:00.000'}.${medal}${credits}${rewards}${unlock}${rival}${rivalReward}${sparky}${ghost}`;
  }
  if (resultsNext) {
    const actions = resultActionsForRace(race);
    resultsNext.hidden = !actions.nextVisible;
    resultsNext.disabled = actions.nextDisabled;
  }
}

function renderShell(context) {
  const state = context.state.state;
  context.campaignView = createCampaignView(context.save, context.catalog.discovery);
  appShell?.setAttribute('data-state', state);
  syncAudioPolicy(context);
  const visibleScreens = visibleScreenNamesForState(state);
  for (const screen of document.querySelectorAll('[data-screen]')) {
    screen.hidden = !visibleScreens.has(screen.dataset.screen);
  }
  setHidden(countdownOverlay, state !== APP_STATE.COUNTDOWN);
  if (state === APP_STATE.RESULTS && terminal) terminal.hidden = true;
  renderCatalog({ ...context.catalog, campaignView: context.campaignView });
  renderLevelSelect(context.selected);
  renderGarage(context);
  renderSettings(context);
  renderResults(context.race);
}

function resize(renderer, camera, level = null) {
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const pixelWidth = Math.floor(width * renderer.getPixelRatio());
  const pixelHeight = Math.floor(height * renderer.getPixelRatio());
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = cameraProfileForAspect(camera.aspect).fov;
    camera.far = level ? Math.max(900, level.length * 5 + 120) : 900;
    camera.updateProjectionMatrix();
  }
}

function placeCamera(race, camera, presentationSettings = {}) {
  const chase = computeChaseCamera(race.latest.presentation.position, { aspect: camera.aspect });
  race.cameraPosition.set(chase.position.x, chase.position.y, chase.position.z);
  race.cameraTarget.set(chase.lookAt.x, chase.lookAt.y, chase.lookAt.z);
  if (!race.cameraPrimed) {
    camera.position.copy(race.cameraPosition);
    race.lookTarget.copy(race.cameraTarget);
    race.cameraPrimed = true;
  } else {
    const positionBlend = presentationSettings.reducedMotion ? 1 : 0.16;
    const targetBlend = presentationSettings.reducedMotion ? 1 : 0.18;
    camera.position.lerp(race.cameraPosition, positionBlend);
    race.lookTarget.lerp(race.cameraTarget, targetBlend);
  }
  camera.lookAt(race.lookTarget);
}

function attachGhostCraft(context, scope, options) {
  const runtime = new FixedStepRuntime(options.session);
  const craft = createGhostCraft({
    ownerId: options.id,
    appearance: options.appearance,
    opacity: options.opacity,
    presentation: context.presentation,
  });
  context.scene.add(craft.group);
  scope.add(`${options.kind}-ghost-${options.id}`, () => craft.dispose());
  return {
    id: options.id,
    kind: options.kind,
    label: options.label,
    targetTicks: options.targetTicks ?? null,
    valid: true,
    runtime,
    craft,
    latest: {
      renderState: runtime.renderState(0, 0),
      presentation: null,
    },
  };
}

function createRaceGhosts(context, selected, scope, raceConfig, tuningConfigId) {
  const ghosts = [];
  const rejected = [];
  const courseId = selected.courseId ?? selected.entry?.id ?? String(selected.level.roadIndex);
  const rival = activeRivalForCourse(context.save, courseId);
  if (rival) {
    try {
      ghosts.push(attachGhostCraft(context, scope, {
        id: rival.id,
        kind: 'rival',
        label: rival.name,
        targetTicks: rival.targetTicks,
        session: createRivalReplaySession(selected.level, rival),
        appearance: rival.visual,
        opacity: rival.visual.opacity,
      }));
    } catch (error) {
      rejected.push({ kind: 'rival', id: rival.id, reason: error.message });
    }
  }

  const savedGhost = context.save?.ghosts?.[courseId];
  if (savedGhost) {
    try {
      ghosts.push(attachGhostCraft(context, scope, {
        id: `${courseId}-own-best`,
        kind: 'own-best',
        label: 'Own Best',
        targetTicks: savedGhost.bestTicks,
        session: createOwnBestReplaySession(selected.level, savedGhost, {
          courseId,
          tuningConfig: raceConfig,
          tuningConfigId,
        }),
        appearance: OWN_BEST_GHOST_APPEARANCE,
        opacity: 0.3,
      }));
    } catch (error) {
      rejected.push({ kind: 'own-best', id: courseId, reason: error.message });
    }
  }
  return { ghosts, rejected, rival };
}

async function ensureSelectedLevel(context) {
  if (context.selected.level) return context.selected;
  if (context.selected.loading) return context.selected.loading;

  context.selected.error = null;
  context.selected.loading = (async () => {
    if (context.selected.sourceKind === 'starter') {
      const loaded = await loadStarterCourse(context.selected.courseId ?? context.selected.entry.id);
      context.selected.level = loaded.level;
      context.selected.courseId = loaded.courseId;
    } else {
      context.selected.level = await loadLevel(context.selected.entry.file);
    }
    context.selected.preview = createCoursePreview(context.selected.level);
    context.selected.loading = null;
    renderShell(context);
    return context.selected;
  })().catch((error) => {
    context.selected.error = error;
    if (context.selected.sourceKind === 'source' && Number.isInteger(context.selected.entry?.roadIndex)) {
      context.catalog.corruptRoads = new Set(context.catalog.corruptRoads ?? []);
      context.catalog.corruptRoads.add(context.selected.entry.roadIndex);
      context.catalog.discovery = createSourceDiscovery(context.catalog.index, {
        corruptRoads: context.catalog.corruptRoads,
      });
    }
    context.selected.loading = null;
    renderShell(context);
    throw error;
  });

  return context.selected.loading;
}

async function openLevelSelect(context, record) {
  context.selected = record;
  const result = context.state.transition(APP_STATE.LEVEL_SELECT, { reason: 'select-level' });
  if (!result.ok) {
    console.warn(result.error);
    return;
  }
  renderShell(context);
  focusState(APP_STATE.LEVEL_SELECT);
  try {
    await ensureSelectedLevel(context);
  } catch (error) {
    console.error(error);
  }
}

async function beginCountdown(context, reason = 'launch') {
  const selected = await ensureSelectedLevel(context);
  if (!selected.level) return;

  const transition = context.state.transition(APP_STATE.COUNTDOWN, { reason });
  if (!transition.ok) {
    console.warn(transition.error);
    return;
  }

  const courseId = selected.courseId ?? selected.entry?.id ?? String(selected.level.roadIndex);
  const scope = context.lifecycle.begin(`race-${courseId}`);
  syncPresentation(context);
  const built = buildLevelScene(selected.level, { presentation: context.presentation });
  context.scene.add(built.group);
  scope.add('level-scene', () => built.dispose());

  const backdrop = createNeonBackdrop(selected.level, { presentation: context.presentation });
  context.scene.add(backdrop.group);
  scope.add('backdrop', () => backdrop.dispose());

  const craft = createProceduralCraft({
    appearance: createCraftRenderParameters(context.save),
    presentation: context.presentation,
    underglowLight: true,
  });
  context.scene.add(craft.group);
  scope.add('craft', () => craft.dispose());

  const raceConfig = createRaceTuningConfig(context.save);
  const tuningConfigId = createRaceTuningConfigId(context.save);
  const runtime = new FixedStepRuntime(createConfiguredRaceSession(selected.level, {
    courseId,
    sourceKind: selected.sourceKind,
    tuningConfig: raceConfig,
  }));
  const ghostSetup = createRaceGhosts(context, selected, scope, raceConfig, tuningConfigId);
  const telemetry = new TelemetrySampler({
    base: {
      level: selected.level.roadIndex,
      sourceKind: selected.sourceKind,
      buildMs: built.metrics.buildMs,
      chunks: built.metrics.chunks,
      drawables: built.metrics.drawables,
      totalInstances: built.metrics.totalInstances,
      tuningConfig: raceConfig,
    },
  });

  context.race = {
    level: selected.level,
    sourceKind: selected.sourceKind,
    courseId,
    entry: selected.entry,
    runtime,
    tuningConfigId,
    telemetry,
    hud: new HudPresenter({ root: hudRoot, terminal, terminalTitle, terminalDetail }),
    audioMapper: context.audio.createRuntimeMapper({ level: selected.level }),
    levelScene: built,
    backdrop,
    sceneMetrics: built.metrics,
    craft,
    minimap: createMinimapPresenter(selected.level, minimapRoot),
    latest: {
      renderState: runtime.renderState(0, 0),
      presentation: null,
    },
    cameraPosition: new THREE.Vector3(),
    cameraTarget: new THREE.Vector3(),
    lookTarget: new THREE.Vector3(),
    cameraPrimed: false,
    countdownEndsAt: performance.now() + COUNTDOWN_MS,
    terminalStartedAt: null,
    lastTelemetryReport: null,
    runRecord: null,
    progressResult: null,
    rivalChallenge: ghostSetup.rival,
    rivalResult: null,
    ownBestResult: null,
    nextCourse: null,
    tuningConfig: raceConfig,
    ghosts: ghostSetup.ghosts,
    ghostRejections: ghostSetup.rejected,
    benchmark: context.benchmark?.active === true ? context.benchmark : null,
  };
  context.input.clear();
  renderShell(context);
  focusState(APP_STATE.COUNTDOWN);
}

function returnToWorldMap(context, reason) {
  const result = context.state.transition(APP_STATE.WORLD_MAP, { reason });
  if (!result.ok) {
    console.warn(result.error);
    return;
  }
  context.lifecycle.disposeCurrent();
  context.race = null;
  context.input.clear();
  renderShell(context);
  focusState(APP_STATE.WORLD_MAP);
}

async function handleCommand(context, command, target) {
  const state = context.state.state;
  let focusSelector = null;
  if (command === 'world-map' && state === APP_STATE.TITLE) {
    context.state.transition(APP_STATE.WORLD_MAP, { reason: command });
  } else if (command === 'garage' && state === APP_STATE.TITLE) {
    context.state.transition(APP_STATE.GARAGE, { reason: command });
  } else if (command === 'settings' && state === APP_STATE.TITLE) {
    context.state.transition(APP_STATE.SETTINGS, { reason: command });
  } else if (command === 'title' && [APP_STATE.WORLD_MAP, APP_STATE.GARAGE, APP_STATE.SETTINGS].includes(state)) {
    context.pendingRemapAction = null;
    context.state.transition(APP_STATE.TITLE, { reason: command });
  } else if (command === 'select-tutorial' && state === APP_STATE.WORLD_MAP) {
    await openLevelSelect(context, selectedTutorialRecord());
  } else if (command === 'select-starter' && state === APP_STATE.WORLD_MAP) {
    const courseId = target.dataset.course;
    const entry = context.campaignView.courses.find((candidate) => candidate.id === courseId);
    if (entry?.launchable && isStarterCourseId(courseId)) {
      await openLevelSelect(context, selectionRecordForCourse(entry));
    }
  } else if (command === 'select-source' && state === APP_STATE.WORLD_MAP) {
    const courseId = target.dataset.course;
    const sourceEntries = [
      context.campaignView.legacyDemo,
      ...context.campaignView.sourceWorlds.flatMap((world) => world.courses),
    ];
    const entry = sourceEntries.find((candidate) => candidate.id === courseId);
    if (entry?.launchable) await openLevelSelect(context, selectionRecordForCourse(entry));
  } else if (command === 'back-world' && state === APP_STATE.LEVEL_SELECT) {
    context.state.transition(APP_STATE.WORLD_MAP, { reason: command });
  } else if (command === 'launch-level' && state === APP_STATE.LEVEL_SELECT) {
    await beginCountdown(context, command);
  } else if (command === 'resume' && state === APP_STATE.PAUSED) {
    context.state.transition(APP_STATE.RACING, { reason: command });
    context.input.clear();
  } else if (command === 'pause' && state === APP_STATE.RACING) {
    context.state.transition(APP_STATE.PAUSED, { reason: command });
    context.input.clear();
  } else if (command === 'retry' && state === APP_STATE.RESULTS) {
    await beginCountdown(context, command);
  } else if (command === 'next-course' && state === APP_STATE.RESULTS) {
    const next = resultActionsForRace(context.race).nextCourse;
    if (next) {
      returnToWorldMap(context, command);
      await openLevelSelect(context, selectionRecordForCourse(next));
    }
  } else if (command === 'return-map' && [APP_STATE.RESULTS, APP_STATE.PAUSED].includes(state)) {
    returnToWorldMap(context, command);
  } else if (command === 'garage-preview' && state === APP_STATE.GARAGE) {
    const category = target.dataset.category;
    const item = target.dataset.item;
    const patch = {};
    if (category === GARAGE_CATEGORY.PAINTS) patch.paint = item;
    else if (category === GARAGE_CATEGORY.UNDERGLOWS) patch.underglow = item;
    else if (category === GARAGE_CATEGORY.LIVERIES) patch.livery = { pattern: item };
    context.garagePreview = previewGarageSelection(context.save, patch);
    setCommandStatus(`Previewing ${categoryLabel(category)} ${item}`);
  } else if (command === 'garage-buy' && state === APP_STATE.GARAGE) {
    writeGarageResult(context, buyGarageItem(context.save, target.dataset.category, target.dataset.item));
  } else if (command === 'garage-equip' && state === APP_STATE.GARAGE) {
    writeGarageResult(context, equipGarageItem(context.save, target.dataset.category, target.dataset.item));
  } else if (command === 'garage-upgrade' && state === APP_STATE.GARAGE) {
    writeGarageResult(context, buyTuningTier(context.save, target.dataset.stat, Number(target.dataset.tier)));
  } else if (command === 'garage-reset' && state === APP_STATE.GARAGE) {
    writeGarageResult(context, resetGarageConfiguration(context.save));
  } else if (command === 'keybind-start' && state === APP_STATE.SETTINGS) {
    const action = target.dataset.remapAction;
    if (Object.hasOwn(INPUT_ACTION_MANIFEST, action)) {
      context.pendingRemapAction = action;
      if (settingsStatus) settingsStatus.textContent = `Press a key for ${INPUT_ACTION_MANIFEST[action].label}`;
      focusSelector = `[data-remap-action="${action}"]`;
    }
  }
  renderShell(context);
  if (focusSelector) document.querySelector(focusSelector)?.focus?.({ preventScroll: true });
  else focusState(context.state.state);
}

function processInput(context) {
  consumePauseRequestForShell({
    state: context.state,
    input: context.input,
    syncAudio: () => syncAudioPolicy(context),
    render: () => renderShell(context),
    focus: focusState,
  }, { reason: 'pause-key' });

  if (context.input.consumeRestartRequested() && canUseRestartShortcut(context.state.state)) {
    beginCountdown(context, 'retry-key').catch((error) => {
      console.error(error);
      errorBox.textContent = `RETRY FAILED\n${error?.stack || error}`;
    });
  }
}

function controlsForActiveRace(context, race) {
  if (race?.benchmark?.active === true) {
    const tick = race.runtime.counters().simTickCount;
    return controlsAtTraceTick(race.benchmark.trace, tick);
  }
  return context.input.snapshot();
}

function updateRace(context, now) {
  const race = context.race;
  if (!race) return;

  if (context.state.state === APP_STATE.COUNTDOWN) {
    const remainingMs = Math.max(0, race.countdownEndsAt - now);
    if (countdownValue) countdownValue.textContent = `${Math.ceil(remainingMs / 1000)}`;
    if (remainingMs <= 0) {
      const result = context.state.transition(APP_STATE.RACING, { reason: 'countdown-complete' });
      if (result.ok) {
        context.input.clear();
        renderShell(context);
        focusState(APP_STATE.RACING);
      }
    }
  }

  race.latest.renderState = advanceRuntimeForShellState(
    race.runtime,
    context.state.state,
    now,
    () => controlsForActiveRace(context, race)
  );
  context.audio.handleRuntimeRenderState(race.latest.renderState, {
    level: race.level,
    mapper: race.audioMapper,
  });

  const frame = race.latest.renderState.current;
  if (context.state.state === APP_STATE.RACING && frame.sessionState !== 'playing') {
    race.terminalStartedAt = now;
    if (!race.runRecord) {
      const runRecord = race.runtime.session.terminalRunRecord?.();
      if (runRecord) {
        const applied = applyRunRecordToProgress(context.save, runRecord);
        let nextSave = applied.save;
        const rivalApplied = applyRivalRunToProgress(nextSave, runRecord, race.rivalChallenge?.id ?? null);
        nextSave = rivalApplied.save;
        let ownBestResult = { attempted: false, accepted: false, reason: null };
        if (applied.result.newBest) {
          const payload = createOwnBestGhostPayload({
            level: race.level,
            courseId: race.courseId,
            tuningConfig: race.tuningConfig,
            tuningConfigId: race.tuningConfigId,
            runRecord,
            controls: race.runtime.session.controlHistory?.() ?? [],
          });
          if (payload.ok) {
            const upserted = upsertGhost(nextSave, race.courseId, payload.ghost);
            nextSave = upserted.save;
            ownBestResult = {
              attempted: true,
              accepted: upserted.accepted,
              reason: upserted.reason,
              bestTicks: payload.ghost.bestTicks,
            };
          } else {
            ownBestResult = { attempted: true, accepted: false, reason: payload.reason };
          }
        }
        const written = context.saveManager.write(nextSave);
        context.save = written.save;
        context.saveStatus = written;
        context.campaignView = createCampaignView(context.save, context.catalog.discovery);
        race.runRecord = runRecord;
        race.progressResult = applied.result;
        race.rivalResult = rivalApplied.result;
        race.ownBestResult = ownBestResult;
        race.nextCourse = applied.result.outcome === RACE_OUTCOME.WON
          ? nextCourseAfter(context.save, race.courseId, context.catalog.discovery)
          : null;
      }
    }
    const result = context.state.transition(APP_STATE.RESULTS, { reason: frame.sessionState });
    if (result.ok) {
      context.input.clear();
      renderShell(context);
      focusState(APP_STATE.RESULTS);
    }
  }

  race.latest.presentation = createCraftPresentation(
    race.latest.renderState.previous,
    race.latest.renderState.current,
    race.latest.renderState.alpha,
    race.level,
    { terminalElapsedMs: race.terminalStartedAt == null ? 0 : now - race.terminalStartedAt }
  );
  applyCraftTransform(race.craft.group, race.latest.presentation);
  race.craft.setVisualState(race.latest.renderState.current, race.latest.presentation);
  for (const ghost of race.ghosts ?? []) {
    ghost.latest.renderState = advanceRuntimeForShellState(
      ghost.runtime,
      context.state.state,
      now,
      () => ({ turn: 0, accel: 0, jump: false })
    );
    ghost.latest.presentation = createCraftPresentation(
      ghost.latest.renderState.previous,
      ghost.latest.renderState.current,
      ghost.latest.renderState.alpha,
      race.level,
      { terminalElapsedMs: 0 }
    );
    applyCraftTransform(ghost.craft.group, ghost.latest.presentation);
    ghost.craft.setVisualState(ghost.latest.renderState.current, ghost.latest.presentation);
  }
  placeCamera(race, context.camera, context.presentation);

  race.hud.update({
    level: race.level,
    frame: race.latest.renderState.current,
    runtimeCounters: race.latest.renderState.counters,
    telemetry: race.telemetry.snapshot(),
    debug: context.debugHud,
    suppressTerminal: context.state.state === APP_STATE.RESULTS,
    force: context.state.state === APP_STATE.RESULTS,
  }, now);

  const minimap = race.minimap.update(race.latest.renderState.current);
  progressRail?.style.setProperty('--progress', `${Math.round(minimap.progress * 100)}%`);

  const report = race.telemetry.sample(
    now,
    context.renderer.info,
    race.latest.renderState.counters,
    { restartCount: race.latest.renderState.counters.restartCount }
  );
  if (report && report !== race.lastTelemetryReport) {
    race.lastTelemetryReport = report;
    window.__NEONDRIFT_METRICS__ = report;
    console.info('NEONDRIFT_METRICS', report);
  }
}

function benchmarkSearchParams(search = location.search) {
  const params = new URLSearchParams(search);
  const requested = params.get('bench') ?? params.get('benchmark');
  return requested === BENCHMARK_FIXTURE_ID ? requested : null;
}

async function loadBenchmarkTraceForSearch(search = location.search) {
  if (!benchmarkSearchParams(search)) return null;
  const response = await fetch(BENCHMARK_TRACE_PATH);
  if (!response.ok) throw new Error(`${BENCHMARK_TRACE_PATH} ${response.status}`);
  const trace = await response.json();
  validateBenchmarkTrace(trace);
  const entry = getCourseEntry(trace.courseId);
  return {
    active: true,
    id: trace.fixtureId,
    courseId: trace.courseId,
    trace,
    contentHash: entry.contentHash ?? null,
    descriptor: benchmarkDescriptor(),
  };
}

async function boot() {
  const appScope = new ResourceScope('neondrift-app');
  const listeners = new ListenerRegistry('shell-listeners');
  appScope.add('shell-listeners', () => listeners.dispose());

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  appScope.add('renderer', () => renderer.dispose());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05010d);
  scene.fog = new THREE.FogExp2(0x120622, 0.01);
  addBaselineLighting(scene);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
  camera.position.set(0, 7, 14);
  camera.lookAt(0, 1, -12);

  const saveManager = createSaveManager();
  const loadedSave = saveManager.load();
  if (loadedSave.warnings.length > 0) {
    errorBox.textContent = loadedSave.warnings.join('\n');
  }

  const input = createInputController({ keyBindings: loadedSave.save.settings.keyBindings });
  appScope.add('keyboard-input', input.attachKeyboard(window, document));
  appScope.add('touch-input', input.attachControls(document));
  const audio = createAudioController({ settings: loadedSave.save.audio });
  appScope.add('audio', () => audio.dispose());

  const shouldProbeByo = shouldProbeSourceCatalog(location.search);
  const context = {
    state: new AppStateController(),
    catalog: shouldProbeByo
      ? { ok: null, index: null, discovery: null, corruptRoads: new Set(), error: null }
      : {
        ok: false,
        index: null,
        discovery: createSourceDiscovery(null),
        corruptRoads: new Set(),
        error: null,
        skipped: true,
      },
    selected: selectedTutorialRecord(),
    saveManager,
    save: loadedSave.save,
    saveStatus: loadedSave,
    garagePreview: null,
    campaignView: null,
    input,
    lifecycle: new RaceSessionLifecycle(),
    renderer,
    scene,
    camera,
    audio,
    race: null,
    listeners,
    presentation: effectivePresentationSettings(loadedSave.save.settings),
    presentationRenderer: null,
    presentationDocument: null,
    pendingRemapAction: null,
    benchmark: null,
    debugHud: new URLSearchParams(location.search).get('debug') === '1',
  };

  syncPresentation(context);
  installHooks(context);

  listeners.add(document, 'keydown', (event) => {
    primeAudioFromGesture(context, event);
    capturePendingRemap(context, event);
  }, { capture: true });
  listeners.add(appShell, 'pointerdown', (event) => {
    primeAudioFromGesture(context, event);
  }, { capture: true });
  listeners.add(appShell, 'click', (event) => {
    const target = event.target.closest?.('[data-command]');
    if (!target) return;
    primeAudioFromGesture(context, event);
    event.preventDefault();
    handleCommand(context, target.dataset.command, target).catch((error) => {
      console.error(error);
      errorBox.textContent = `COMMAND FAILED\n${error?.stack || error}`;
    });
  });
  listeners.add(appShell, 'input', (event) => {
    if (event.target?.type !== 'range') return;
    if (!handleAudioSettingInput(context, event.target) && !handlePresentationSettingInput(context, event.target)) return;
    primeAudioFromGesture(context, event);
    renderShell(context);
  });
  listeners.add(appShell, 'change', (event) => {
    if (event.target?.type === 'range') return;
    if (!handleAudioSettingInput(context, event.target) && !handlePresentationSettingInput(context, event.target)) return;
    primeAudioFromGesture(context, event);
    renderShell(context);
  });
  const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  if (reducedMotionQuery) {
    listeners.add(reducedMotionQuery, 'change', () => {
      syncPresentation(context);
      renderShell(context);
    });
  }
  listeners.add(document, 'visibilitychange', () => {
    context.audio.setVisibilityHidden(document.hidden).catch((error) => {
      console.warn('audio visibility sync failed', error);
    });
    if (document.hidden) {
      pauseForVisibilityLoss(context.state, context.input, { reason: 'visibilitychange' });
      renderShell(context);
      focusState(context.state.state);
    } else {
      syncAudioPolicy(context);
    }
  });
  listeners.add(window, 'blur', () => {
    if (context.state.state === APP_STATE.RACING) {
      pauseForVisibilityLoss(context.state, context.input, { reason: 'window-blur' });
      syncAudioPolicy(context);
      renderShell(context);
      focusState(context.state.state);
    }
  });
  listeners.add(window, 'pagehide', () => {
    renderer.setAnimationLoop(null);
    context.lifecycle.disposeCurrent();
    appScope.dispose();
  }, { once: true });

  const benchmarkMode = benchmarkSearchParams(location.search);
  const initialSearch = benchmarkMode ? `?course=${BENCHMARK_FIXTURE_ID}` : location.search;
  const initialLoad = loadRequestedLevel(initialSearch)
    .then((loaded) => {
      context.selected = {
        sourceKind: loaded.sourceKind,
        courseId: loaded.courseId ?? loaded.entry?.id ?? null,
        entry: loaded.entry,
        level: loaded.level,
        preview: createCoursePreview(loaded.level),
        loading: null,
        error: null,
      };
      renderShell(context);
    })
    .catch((error) => {
      console.warn(error);
      context.selected.error = error;
      renderShell(context);
    });

  if (shouldProbeByo) {
    probeSourceCatalog().then((catalog) => {
      context.catalog = { ...catalog, corruptRoads: new Set() };
      renderShell(context);
    });
  }

  await initialLoad;
  context.benchmark = await loadBenchmarkTraceForSearch(location.search);
  context.state.transition(APP_STATE.TITLE, { reason: 'boot-complete' });
  renderShell(context);
  focusState(APP_STATE.TITLE);

  if (context.benchmark?.active) {
    context.state.transition(APP_STATE.WORLD_MAP, { reason: 'benchmark-fixture' });
    context.state.transition(APP_STATE.LEVEL_SELECT, { reason: 'benchmark-fixture' });
    renderShell(context);
    await beginCountdown(context, 'benchmark-fixture');
  }

  renderer.setAnimationLoop((now) => {
    resize(renderer, camera, context.race?.level ?? null);
    processInput(context);
    updateRace(context, now);
    renderer.render(scene, camera);
  });
}

boot().catch((error) => {
  console.error(error);
  errorBox.textContent = `BOOT FAILED\n${error?.stack || error}`;
  hudRoot.textContent = 'NEONDRIFT // OFFLINE';
});
