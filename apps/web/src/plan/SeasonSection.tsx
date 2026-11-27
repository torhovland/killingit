import type { SeasonPlan, ThresholdSummary } from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { Card } from "../components/Card";
import { CoachQuote } from "../components/CoachQuote";
import { formatPlanDate } from "./formatPlanDate";
import {
  DietProgressLine,
  hasDietTarget,
  PlanList,
  PlanListItem,
  SeasonGoalList,
  SubGoalList,
  ThresholdsLine,
} from "./sections";

/** The whole season: goal, introduction, rationale, and its blocks. */
export function SeasonSection({
  season,
  thresholds = [],
  showDiet = false,
}: {
  season: SeasonPlan;
  thresholds?: readonly ThresholdSummary[];
  showDiet?: boolean;
}) {
  const estimatedFtp = season.estimatedFtpWatts;
  return (
    <Card as="section" variant="inset">
      <h3 className="text-xl font-semibold">
        Season
        <Bullet />
        {season.goal}
      </h3>
      <p className="mt-2 text-base text-muted-foreground">
        {formatPlanDate(season.startDate)} → {formatPlanDate(season.endDate)}
        {thresholds.length > 0 ? (
          <ThresholdsLine
            thresholds={thresholds}
            testId="season-thresholds"
            inline
            showLabel={false}
          />
        ) : (
          estimatedFtp != null && (
            <span data-testid="season-ftp">
              <Bullet />
              Estimated FTP:{" "}
              <span className="font-medium">{estimatedFtp} W</span>
            </span>
          )
        )}
      </p>
      <SeasonGoalList goals={season.goals} testId="season-goals" />
      {season.introduction != null && season.introduction.trim() !== "" && (
        <div
          className="mt-3 rounded border bg-background p-3 text-base"
          data-testid="season-introduction"
        >
          <FormattedText text={season.introduction} />
        </div>
      )}
      <CoachQuote
        text={season.rationale}
        testId="season-rationale"
        className="mt-3"
      />
      <PlanList>
        {season.blocks.map((block, index) => {
          // The last block can end on the season's last day, where its target
          // would restate the season target below it.
          const repeatsSeasonTarget =
            index === season.blocks.length - 1 &&
            block.endDate === season.endDate &&
            season.dietProgress != null &&
            hasDietTarget(season.dietProgress);
          return (
            <PlanListItem key={`${block.name}-${block.startDate}`}>
              <p className="text-lg font-medium">
                {index + 1}. {block.name}
              </p>
              <p className="text-muted-foreground">
                {formatPlanDate(block.startDate)} →{" "}
                {formatPlanDate(block.endDate)}
                <Bullet />
                {block.weekCount} {block.weekCount === 1 ? "week" : "weeks"}
              </p>
              <FormattedText
                text={block.focus}
                className="text-muted-foreground"
              />
              <SubGoalList
                subGoals={block.subGoals}
                goals={season.goals}
                testId="season-block-goals"
              />
              {showDiet &&
                block.dietProgress != null &&
                !repeatsSeasonTarget && (
                  <DietProgressLine
                    progress={block.dietProgress}
                    period="the block"
                    testId="season-block-diet-progress"
                  />
                )}
            </PlanListItem>
          );
        })}
      </PlanList>
      {showDiet && season.dietProgress != null && (
        <DietProgressLine
          progress={season.dietProgress}
          period="the season"
          testId="season-diet-progress"
        />
      )}
    </Card>
  );
}
