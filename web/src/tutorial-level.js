import {
  STARTER_COURSE_IDS,
  TRAINING_COACHING,
  createTrainingCourse,
} from './starter-cup.js';

export const TUTORIAL_LEVEL_ID = STARTER_COURSE_IDS.TRAINING;
export const TUTORIAL_COACHING = TRAINING_COACHING;

export function createTutorialLevel() {
  return createTrainingCourse();
}

export const tutorialLevel = Object.freeze(createTutorialLevel());
