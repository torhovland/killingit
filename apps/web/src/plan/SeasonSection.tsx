import type { SeasonPlan, ThresholdSummary } from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { Card } from "../components/Card";
import { formatPlanDate } from "./formatPlanDate";
import {
  DietProgressLine,
  PlanList,
  PlanListItem,
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
      {season.introduction != null && season.introduction.trim() !== "" && (
        <div
          className="mt-3 rounded border bg-background p-3 text-base"
          data-testid="season-introduction"
        >
          <FormattedText text={season.introduction} />
        </div>
      )}
      <div className="mt-3 flex flex-col gap-1 text-base">
        <p className="font-medium">Coach's rationale</p>
        <FormattedText
          text={season.rationale}
          className="text-muted-foreground"
          testId="season-rationale"
        />
      </div>
      {showDiet && season.dietProgress != null && (
        <DietProgressLine
          progress={season.dietProgress}
          period="the season"
          testId="season-diet-progress"
        />
      )}
      <PlanList>
        {season.blocks.map((block, index) => (
          <PlanListItem key={`${block.name}-${block.startDate}`}>
            <p className="font-medium">
              {index + 1}. {block.name}
            </p>
            <p className="text-muted-foreground">
              {formatPlanDate(block.startDate)} →{" "}
              {formatPlanDate(block.endDate)}
              <Bullet />
              {block.weekCount} {block.weekCount === 1 ? "week" : "weeks"}
            </p>
            {showDiet && block.dietProgress != null && (
              <DietProgressLine
                progress={block.dietProgress}
                period="the block"
                testId="season-block-diet-progress"
              />
            )}
            <FormattedText
              text={block.focus}
              className="text-muted-foreground"
            />
          </PlanListItem>
        ))}
      </PlanList>
    </Card>
  );
}
