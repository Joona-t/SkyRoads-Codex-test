import { APP_STATE, policyForState } from './app-state.js';
import { RACE_OUTCOME } from './race-session.js';

export const OPTIONAL_SOURCE_UNAVAILABLE = Object.freeze({
  id: 'optional-source-unavailable',
  title: 'Optional source roads unavailable',
  detail: 'Starter Cup is ready. BYO source roads appear here only after a local export or explicit source-road request.',
});

export function visibleScreenNamesForState(state) {
  const root = policyForState(state).visibleRoot;
  const visible = new Set([root]);
  if ([APP_STATE.COUNTDOWN, APP_STATE.RACING, APP_STATE.PAUSED, APP_STATE.RESULTS].includes(state)) {
    visible.add('race');
  }
  if (state === APP_STATE.PAUSED) visible.add('pause');
  if (state === APP_STATE.RESULTS) visible.add('results');
  return visible;
}

export function buildRouteMapView(catalog, campaignView) {
  if (!campaignView) {
    return {
      ready: false,
      statusText: 'Campaign state: loading',
      starterCourses: [],
      sourceMode: 'loading',
      sourceCards: [],
      sourceSummary: null,
    };
  }

  if (catalog?.ok === true) {
    return {
      ready: true,
      statusText: `Source roads: ${catalog.discovery?.availableCampaignCourses ?? 0}/30 optional BYO campaign courses found`,
      starterCourses: campaignView.courses,
      sourceMode: 'available',
      sourceCards: [
        campaignView.legacyDemo,
        ...campaignView.sourceWorlds.flatMap((world) => world.courses),
      ],
      sourceSummary: null,
    };
  }

  if (catalog?.ok === null) {
    return {
      ready: true,
      statusText: 'Source roads: probing locally',
      starterCourses: campaignView.courses,
      sourceMode: 'probing',
      sourceCards: [],
      sourceSummary: null,
    };
  }

  return {
    ready: true,
    statusText: 'Optional source roads unavailable. Starter Cup is ready.',
    starterCourses: campaignView.courses,
    sourceMode: 'unavailable',
    sourceCards: [],
    sourceSummary: OPTIONAL_SOURCE_UNAVAILABLE,
  };
}

export function resultActionsForRace(race) {
  const nextCourse = race?.progressResult?.outcome === RACE_OUTCOME.WON && race?.nextCourse?.launchable
    ? race.nextCourse
    : null;
  return {
    retry: true,
    map: true,
    nextCourse,
    nextVisible: nextCourse != null,
    nextDisabled: nextCourse == null,
  };
}

export function consumePauseRequestForShell(context, meta = {}) {
  if (!context.input?.consumePauseRequested?.()) {
    return { handled: false, state: context.state?.state ?? null };
  }

  const from = context.state.state;
  const to = from === APP_STATE.RACING
    ? APP_STATE.PAUSED
    : from === APP_STATE.PAUSED
      ? APP_STATE.RACING
      : null;
  if (!to) return { handled: true, toggled: false, state: from };

  const transition = context.state.transition(to, { reason: meta.reason ?? 'pause-key' });
  if (!transition.ok) return { handled: true, toggled: false, state: context.state.state, error: transition.error };

  context.input.clear?.();
  context.syncAudio?.();
  context.render?.();
  context.focus?.(to);
  return {
    handled: true,
    toggled: true,
    from,
    to,
    state: context.state.state,
    transition,
  };
}
