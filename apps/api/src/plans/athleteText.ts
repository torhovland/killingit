import { latestAnswerTimestamp, planIsStale } from "./status.js";

/** The stored plan state the athlete-text readings were last based on. */
export interface AthleteTextReadState {
  /** When the stored plan was generated, or null on a first build. */
  planGeneratedAt: Date | null;
  /** The answer timestamp the stored plan was generated from. */
  planAnswersUpdatedAt: Date | null;
  /** The coaching-input timestamp the stored plan was generated from. */
  planCoachingInputsUpdatedAt: Date | null;
  /** The athlete's current survey answers. */
  answers: readonly { answeredAt: Date | null }[];
  /** The newest current coaching-input timestamp. */
  coachingInputsUpdatedAt: Date | null;
  /** Answers to coach questions, which the plan timestamp does not include. */
  coachAnswers: readonly { answeredAt: Date | string | null }[];
}

/**
 * True when the athlete has written something the last plan build did not read:
 * a changed profile answer, a comment, a manual activity, a weekly note, a
 * period-review comment, or an answer to a coach question. A new day, a forecast
 * change, or a new synced activity does not need the athlete-metrics and
 * athlete-events prompts to run again.
 */
export function athleteTextChanged(input: AthleteTextReadState): boolean {
  const planGeneratedAt = input.planGeneratedAt;
  if (planGeneratedAt === null) {
    return true;
  }
  if (
    planIsStale(
      input.planAnswersUpdatedAt,
      latestAnswerTimestamp(input.answers),
    )
  ) {
    return true;
  }
  if (
    planIsStale(
      input.planCoachingInputsUpdatedAt,
      input.coachingInputsUpdatedAt,
    )
  ) {
    return true;
  }
  return input.coachAnswers.some((answer) => {
    if (answer.answeredAt === null) {
      return false;
    }
    return new Date(answer.answeredAt) > planGeneratedAt;
  });
}
