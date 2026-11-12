import type { BlockPlan, ThresholdSummary } from "@killingit/shared";
import { Bullet } from "../Bullet";
import { FormattedText } from "../FormattedText";
import { Card } from "../components/Card";
import { formatPlanDate } from "./formatPlanDate";
import {
  DietProgressLine,
  PlanList,
  PlanListItem,
  RefreshingOverlay,
  ThresholdsLine,
} from "./sections";

/** One training block: dates, rationale, and an outline of its weeks. */
export function BlockSection({
  block,
  label,
  testId,
  refreshing = false,
  thresholds = [],
  showDiet = false,
}: {
  block: BlockPlan;
  label: string;
  testId?: string;
  refreshing?: boolean;
  thresholds?: readonly ThresholdSummary[];
  showDiet?: boolean;
}) {
  const estimatedFtp = block.estimatedFtpWatts;
  return (
    <Card
      as="section"
      variant="inset"
      className="relative"
      data-testid={testId}
      aria-busy={refreshing || undefined}
    >
      <div
        className={refreshing ? "flex flex-col opacity-40" : "flex flex-col"}
      >
        <h3 className="text-xl font-semibold">
          {label}
          <Bullet />
          {block.name}
        </h3>
        <p className="mt-2 text-base text-muted-foreground">
          {formatPlanDate(block.startDate)} → {formatPlanDate(block.endDate)}
          {thresholds.length > 0 ? (
            <ThresholdsLine
              thresholds={thresholds}
              testId="block-thresholds"
              inline
            />
          ) : (
            estimatedFtp != null && (
              <span data-testid="block-ftp">
                <Bullet />
                Estimated FTP:{" "}
                <span className="font-medium">{estimatedFtp} W</span>
              </span>
            )
          )}
        </p>
        <FormattedText
          text={block.focus}
          className="mt-3 text-base text-muted-foreground"
          testId="block-focus"
        />
        <div className="mt-3 flex flex-col gap-1 text-base">
          <p className="font-medium">Coach's rationale</p>
          <FormattedText
            text={block.rationale}
            className="text-muted-foreground"
            testId="block-rationale"
          />
        </div>
        {showDiet && block.dietProgress != null && (
          <DietProgressLine
            progress={block.dietProgress}
            period="the block"
            testId="block-diet-progress"
          />
        )}
        <PlanList>
          {block.weeks.map((week) => (
            <PlanListItem key={`${week.number}-${week.startDate}`}>
              <p className="font-medium">Week {week.number}</p>
              <p className="text-muted-foreground">
                Week starting {formatPlanDate(week.startDate)}
              </p>
              <p className="text-muted-foreground">
                Target load: {week.targetLoad}
              </p>
              {week.estimatedFtpWatts != null && (
                <p className="text-muted-foreground">
                  Estimated FTP: {week.estimatedFtpWatts} W
                </p>
              )}
              {showDiet && week.dietProgress != null && (
                <DietProgressLine
                  progress={week.dietProgress}
                  period="the week"
                  testId="block-week-diet-progress"
                />
              )}
              <FormattedText
                text={week.focus}
                className="text-muted-foreground"
              />
            </PlanListItem>
          ))}
        </PlanList>
      </div>
      {refreshing && (
        <RefreshingOverlay
          label={`${label.toLowerCase()}'s`}
          testId={`${testId ?? "plan-block"}-refreshing`}
        />
      )}
    </Card>
  );
}
