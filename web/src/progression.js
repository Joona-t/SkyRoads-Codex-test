import {
  CONTENT_MANIFEST,
  COURSE_KIND,
  MEDAL,
  MEDAL_NAMES,
  SPARKY_LIVERY_ID,
  SOURCE_COURSES_PER_WORLD,
  STARTER_CUP_ID,
  allRivals,
  getCourseEntry,
  maybeGetCourseEntry,
  maybeGetRivalEntry,
} from './content-manifest.js';
import { RACE_OUTCOME } from './race-session.js';

const MEDAL_REWARD_KEYS = Object.freeze({
  [MEDAL.BRONZE]: 'bronze',
  [MEDAL.SILVER]: 'silver',
  [MEDAL.GOLD]: 'gold',
});

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultLevelProgress() {
  return {
    bestTicks: null,
    medal: MEDAL.NONE,
    completed: false,
    clean: false,
  };
}

function levelProgress(save, courseId) {
  return {
    ...defaultLevelProgress(),
    ...(save?.levels?.[courseId] ?? {}),
  };
}

function hasCompleted(save, courseId) {
  return levelProgress(save, courseId).completed === true;
}

function worldComplete(save, world) {
  return world.courseIds.every((courseId) => hasCompleted(save, courseId));
}

function sourceWorldUnlocked(save, world) {
  if (world.order === 0) return true;
  const previous = CONTENT_MANIFEST.sourceCampaign.worlds[world.order - 1];
  return worldComplete(save, previous);
}

export function medalName(medal) {
  return MEDAL_NAMES[medal] ?? MEDAL_NAMES[MEDAL.NONE];
}

export function medalForTicks(course, ticks) {
  if (!course?.campaignSlot || !course.medalThresholds) return MEDAL.NONE;
  if (!Number.isSafeInteger(ticks) || ticks <= 0) return MEDAL.NONE;
  if (ticks <= course.medalThresholds.gold) return MEDAL.GOLD;
  if (ticks <= course.medalThresholds.silver) return MEDAL.SILVER;
  if (ticks <= course.medalThresholds.bronze) return MEDAL.BRONZE;
  return MEDAL.NONE;
}

export function isCourseUnlocked(save, courseOrId) {
  const course = typeof courseOrId === 'string' ? maybeGetCourseEntry(courseOrId) : courseOrId;
  if (!course) return false;
  if (course.kind === COURSE_KIND.SOURCE_DEMO) return true;
  if (course.kind === COURSE_KIND.STARTER) {
    return course.unlockAfter == null || hasCompleted(save, course.unlockAfter);
  }
  if (course.kind === COURSE_KIND.SOURCE_CAMPAIGN) {
    const world = CONTENT_MANIFEST.sourceCampaign.worlds[course.worldOrder];
    return sourceWorldUnlocked(save, world);
  }
  return false;
}

function defeatedRivalIds(save) {
  return new Set(save?.rivals?.defeated ?? []);
}

export function createRivalLadderView(save) {
  const defeated = defeatedRivalIds(save);
  const rivals = allRivals().map((rival) => ({
    ...cloneData(rival),
    defeated: defeated.has(rival.id),
    current: false,
  }));
  const active = rivals.find((rival) => !rival.defeated) ?? null;
  if (active) active.current = true;
  return {
    complete: active == null,
    active,
    defeatedIds: rivals.filter((rival) => rival.defeated).map((rival) => rival.id),
    rivals,
  };
}

export function activeRivalForSave(save) {
  return createRivalLadderView(save).active;
}

export function activeRivalForCourse(save, courseId) {
  const active = activeRivalForSave(save);
  return active?.courseId === courseId ? active : null;
}

function courseView(save, course, availability = {}, rivalLadder = null) {
  const progress = levelProgress(save, course.id);
  const unlocked = isCourseUnlocked(save, course);
  const available = availability.available ?? true;
  const disabledReason = availability.disabledReason ?? null;
  const lockReason = unlocked
    ? null
    : course.kind === COURSE_KIND.STARTER
      ? `Complete ${getCourseEntry(course.unlockAfter).name} first`
      : `Complete all three courses in ${CONTENT_MANIFEST.sourceCampaign.worlds[course.worldOrder - 1]?.name ?? 'the previous world'} first`;
  return {
    ...cloneData(course),
    ...availability,
    completed: progress.completed,
    clean: progress.clean,
    bestTicks: progress.bestTicks,
    medal: progress.medal,
    medalName: medalName(progress.medal),
    unlocked,
    lockReason,
    launchable: unlocked && available,
    disabled: !available || !unlocked,
    disabledReason: !available ? disabledReason : lockReason,
    rival: rivalLadder?.active?.courseId === course.id ? cloneData(rivalLadder.active) : null,
  };
}

function rewardClaimed(save, rewardId) {
  return save.rewards?.claimed?.includes(rewardId) === true;
}

function claimReward(next, components, rewardId, label, credits) {
  if (!rewardId || credits <= 0 || rewardClaimed(next, rewardId)) return;
  next.rewards.claimed.push(rewardId);
  next.credits += credits;
  components.push({ rewardId, label, credits });
}

function ensureMutableSave(save) {
  const next = cloneData(save);
  next.levels = next.levels ?? {};
  next.campaign = next.campaign ?? { unlockedCourseIds: [], completedCourseIds: [] };
  next.rewards = next.rewards ?? { claimed: [] };
  next.rewards.claimed = Array.isArray(next.rewards.claimed) ? next.rewards.claimed : [];
  next.unlocks = next.unlocks ?? {};
  next.unlocks.courses = Array.isArray(next.unlocks.courses) ? next.unlocks.courses : [];
  next.unlocks.liveries = Array.isArray(next.unlocks.liveries) ? next.unlocks.liveries : [];
  next.rivals = next.rivals ?? { defeated: [] };
  next.rivals.defeated = Array.isArray(next.rivals.defeated) ? next.rivals.defeated : [];
  next.credits = Number.isSafeInteger(next.credits) && next.credits >= 0 ? next.credits : 0;
  return next;
}

function noRivalResult(save, rival, reason, runRecord = null) {
  return {
    save,
    result: {
      attempted: rival != null,
      defeated: false,
      reason,
      rival: rival ? cloneData(rival) : null,
      raceTicks: runRecord?.raceTicks ?? null,
      targetTicks: rival?.targetTicks ?? null,
      creditsAwarded: 0,
      rewardComponents: [],
      totalCredits: save.credits ?? 0,
      nextRival: activeRivalForSave(save),
      sparkyLiveryUnlocked: false,
    },
  };
}

export function applyRivalRunToProgress(save, runRecord, rivalId = null) {
  const before = ensureMutableSave(save);
  const current = activeRivalForSave(before);
  const rival = rivalId ? maybeGetRivalEntry(rivalId) : current;
  if (!rival) return noRivalResult(before, null, 'no-rival', runRecord);
  if (!current) return noRivalResult(before, rival, 'ladder-complete', runRecord);
  if (rival.id !== current.id) return noRivalResult(before, rival, 'not-current-rival', runRecord);
  if (before.rivals.defeated.includes(rival.id)) return noRivalResult(before, rival, 'already-defeated', runRecord);
  if (runRecord?.outcome !== RACE_OUTCOME.WON || runRecord?.courseId !== rival.courseId) {
    return noRivalResult(before, rival, 'invalid-finish', runRecord);
  }
  if (!Number.isSafeInteger(runRecord.raceTicks) || runRecord.raceTicks <= 0) {
    return noRivalResult(before, rival, 'invalid-finish-time', runRecord);
  }
  if (runRecord.raceTicks >= rival.targetTicks) {
    return noRivalResult(before, rival, 'target-not-beaten', runRecord);
  }

  const next = ensureMutableSave(before);
  const components = [];
  next.rivals.defeated.push(rival.id);
  if (!rewardClaimed(next, rival.reward.id)) {
    next.rewards.claimed.push(rival.reward.id);
    next.credits += rival.reward.credits;
    components.push({
      rewardId: rival.reward.id,
      label: `Rank ${rival.rank} rival defeated`,
      credits: rival.reward.credits,
      liveryId: rival.reward.liveryId ?? null,
    });
  }
  const sparkyLiveryUnlocked = rival.reward.liveryId === SPARKY_LIVERY_ID;
  if (sparkyLiveryUnlocked && !next.unlocks.liveries.includes(SPARKY_LIVERY_ID)) {
    next.unlocks.liveries.push(SPARKY_LIVERY_ID);
  }
  const after = recomputeCampaignUnlocks(next);
  return {
    save: after,
    result: {
      attempted: true,
      defeated: true,
      reason: null,
      rival: cloneData(rival),
      raceTicks: runRecord.raceTicks,
      targetTicks: rival.targetTicks,
      creditsAwarded: components.reduce((sum, item) => sum + item.credits, 0),
      rewardComponents: components,
      totalCredits: after.credits,
      nextRival: activeRivalForSave(after),
      sparkyLiveryUnlocked,
    },
  };
}

export function createCampaignView(save, sourceDiscovery = null) {
  const rivalLadder = createRivalLadderView(save);
  const starterCourses = CONTENT_MANIFEST.starterCup.courses.map((course) => courseView(save, course, {}, rivalLadder));
  const sourceWorlds = CONTENT_MANIFEST.sourceCampaign.worlds.map((world, worldIndex) => {
    const discovered = sourceDiscovery?.worlds?.[worldIndex];
    const courses = world.courseIds.map((courseId, courseIndex) =>
      courseView(save, getCourseEntry(courseId), discovered?.courses?.[courseIndex] ?? {
        available: false,
        disabledReason: 'Local exported source catalog is unavailable',
      }, rivalLadder)
    );
    return {
      ...cloneData(world),
      unlocked: sourceWorldUnlocked(save, world),
      complete: worldComplete(save, world),
      courses,
      availableCount: courses.filter((course) => course.available).length,
    };
  });
  const completedCourseIds = starterCourses.filter((course) => course.completed).map((course) => course.id);
  return {
    cupId: STARTER_CUP_ID,
    starterComplete: starterCourses.every((course) => course.completed),
    complete: starterCourses.every((course) => course.completed),
    completedCourseIds,
    courses: starterCourses,
    legacyDemo: sourceDiscovery?.legacyDemo
      ? courseView(save, CONTENT_MANIFEST.sourceCampaign.legacyDemo, sourceDiscovery.legacyDemo, rivalLadder)
      : courseView(save, CONTENT_MANIFEST.sourceCampaign.legacyDemo, {
        available: false,
        disabledReason: 'Local exported source catalog is unavailable',
      }, rivalLadder),
    rivalLadder,
    sourceWorlds,
    sourceCampaignComplete: sourceWorlds.every((world) => world.complete),
  };
}

export function recomputeCampaignUnlocks(save) {
  const next = ensureMutableSave(save);
  const campaignCourses = CONTENT_MANIFEST.courses.filter((course) => course.campaignSlot);
  const completedCourseIds = campaignCourses
    .filter((course) => levelProgress(next, course.id).completed)
    .map((course) => course.id);
  const unlockedCourseIds = campaignCourses
    .filter((course) => isCourseUnlocked(next, course))
    .map((course) => course.id);
  next.campaign.completedCourseIds = completedCourseIds;
  next.campaign.unlockedCourseIds = unlockedCourseIds;
  next.unlocks.courses = unlockedCourseIds;
  const unlockedSourceWorlds = CONTENT_MANIFEST.sourceCampaign.worlds.filter((world) => sourceWorldUnlocked(next, world));
  next.worlds = next.worlds ?? {};
  next.worlds.unlockedMax = Math.max(0, ...unlockedSourceWorlds.map((world) => world.order));
  return next;
}

export function applyRunRecordToProgress(save, runRecord) {
  const course = getCourseEntry(runRecord.courseId);
  const before = recomputeCampaignUnlocks(save);
  const beforeUnlocked = new Set(before.campaign.unlockedCourseIds ?? []);
  const next = ensureMutableSave(before);
  const previous = levelProgress(next, course.id);
  const record = { ...previous };
  const components = [];

  if (runRecord.outcome !== RACE_OUTCOME.WON) {
    return {
      save: before,
      result: {
        courseId: course.id,
        outcome: runRecord.outcome,
        failureReason: runRecord.failureReason,
        recoveryMessage: runRecord.recoveryMessage,
        raceTicks: runRecord.raceTicks,
        timeText: runRecord.timeText,
        cleanRun: false,
        medal: previous.medal,
        medalName: medalName(previous.medal),
        creditsAwarded: 0,
        rewardComponents: [],
        totalCredits: before.credits,
        newBest: false,
        unlockedCourseIds: [],
      },
    };
  }

  const newBest = previous.bestTicks == null || runRecord.raceTicks < previous.bestTicks;
  if (newBest) record.bestTicks = runRecord.raceTicks;
  record.completed = true;
  record.clean = previous.clean || runRecord.cleanRun;
  const earnedMedal = medalForTicks(course, runRecord.raceTicks);
  record.medal = Math.max(previous.medal, earnedMedal);
  next.levels[course.id] = record;

  if (course.campaignSlot) {
    claimReward(next, components, course.rewardIds.completion, 'Completion credits', course.rewards.baseCredits);
    for (const rank of [MEDAL.BRONZE, MEDAL.SILVER, MEDAL.GOLD]) {
      if (earnedMedal >= rank && previous.medal < rank) {
        const key = MEDAL_REWARD_KEYS[rank];
        claimReward(next, components, course.rewardIds[key], `${medalName(rank)} medal bonus`, course.rewards.medalBonuses[rank] ?? 0);
      }
    }
    if (runRecord.cleanRun) {
      claimReward(next, components, course.rewardIds.clean, 'Clean run bonus', course.rewards.cleanRunBonus);
    }
  }

  const after = recomputeCampaignUnlocks(next);
  const unlockedCourseIds = (after.campaign.unlockedCourseIds ?? [])
    .filter((courseId) => !beforeUnlocked.has(courseId));
  return {
    save: after,
    result: {
      courseId: course.id,
      outcome: runRecord.outcome,
      failureReason: null,
      recoveryMessage: null,
      raceTicks: runRecord.raceTicks,
      timeText: runRecord.timeText,
      cleanRun: runRecord.cleanRun,
      medal: earnedMedal,
      medalName: medalName(earnedMedal),
      bestTicks: record.bestTicks,
      newBest,
      creditsAwarded: components.reduce((sum, item) => sum + item.credits, 0),
      rewardComponents: components,
      totalCredits: after.credits,
      unlockedCourseIds,
    },
  };
}

export function nextCourseAfter(save, currentCourseId, sourceDiscovery = null) {
  const view = createCampaignView(save, sourceDiscovery);
  const current = maybeGetCourseEntry(currentCourseId);
  if (!current) return null;
  if (current.kind === COURSE_KIND.STARTER) {
    return view.courses.find((course) => course.launchable && !course.completed) ?? null;
  }
  if (current.kind === COURSE_KIND.SOURCE_CAMPAIGN) {
    const allSource = view.sourceWorlds.flatMap((world) => world.courses);
    const currentIndex = allSource.findIndex((course) => course.id === currentCourseId);
    return allSource.slice(currentIndex + 1).find((course) => course.launchable && !course.completed)
      ?? allSource.find((course) => course.launchable && !course.completed)
      ?? null;
  }
  return null;
}

export function sourceWorldCompleteFromCourses(courseIds) {
  return courseIds.length === SOURCE_COURSES_PER_WORLD;
}
