import "./setup.js";
import { describe, expect, it } from "bun:test";
import { dbPlanGenerationStore } from "../src/plans/store.js";
import { PLAN_GENERATION_STEPS } from "../src/plans/steps.js";
import { dbUserStore } from "../src/users/store.js";
import { countRows } from "./database.js";
import { setupIntegrationSuite } from "./setup.js";

setupIntegrationSuite();

describe("dbPlanGenerationStore", () => {
  it("reports an idle status before the first run", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-idle");

    expect(await dbPlanGenerationStore.load(user.id)).toMatchObject({
      status: "idle",
      step: null,
      progress: 0,
      error: null,
      runId: null,
    });
  });

  it("fences a new run and ignores the superseded run's finish", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-fence");

    await dbPlanGenerationStore.begin(user.id, "run-1");
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-1")).toBe(true);
    const running = await dbPlanGenerationStore.load(user.id);
    expect(running.status).toBe("running");
    expect(running.runId).toBe("run-1");

    await dbPlanGenerationStore.begin(user.id, "run-2");
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-1")).toBe(false);
    expect(await dbPlanGenerationStore.isCurrent(user.id, "run-2")).toBe(true);

    await dbPlanGenerationStore.finish(user.id, "run-1");
    const afterLateFinish = await dbPlanGenerationStore.load(user.id);
    expect(afterLateFinish.status).toBe("running");
    expect(afterLateFinish.runId).toBe("run-2");

    await dbPlanGenerationStore.finish(user.id, "run-2");
    const done = await dbPlanGenerationStore.load(user.id);
    expect(done.status).toBe("done");
    expect(done.progress).toBe(100);
    expect(done.runId).toBe("run-2");
    expect(await countRows("plan_generation_step_durations")).toBe(1);
  });

  it("fails only the run that owns the row", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-fail");
    await dbPlanGenerationStore.begin(user.id, "run-current");

    expect(
      await dbPlanGenerationStore.fail(user.id, "stale error", "run-older"),
    ).toBeNull();
    const startedAt = await dbPlanGenerationStore.fail(
      user.id,
      "the provider timed out",
      "run-current",
    );
    expect(startedAt).toBeInstanceOf(Date);

    const failed = await dbPlanGenerationStore.load(user.id);
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("the provider timed out");
    expect(failed.runId).toBe("run-current");
    expect(
      await dbPlanGenerationStore.fail(user.id, "again", "run-current"),
    ).toBeNull();
  });

  it("updates and heartbeats only the run that owns the row", async () => {
    const user = await dbUserStore.ensureUser("auth0|run-steps");
    await dbPlanGenerationStore.begin(user.id, "run-a");

    await dbPlanGenerationStore.update(
      user.id,
      PLAN_GENERATION_STEPS.initialBlock,
      "run-a",
    );
    expect((await dbPlanGenerationStore.load(user.id)).step).toBe(
      PLAN_GENERATION_STEPS.initialBlock.label,
    );

    await dbPlanGenerationStore.begin(user.id, "run-b");
    await dbPlanGenerationStore.update(
      user.id,
      PLAN_GENERATION_STEPS.initialWeek,
      "run-a",
    );
    expect((await dbPlanGenerationStore.load(user.id)).step).toBe(
      PLAN_GENERATION_STEPS.prepare.label,
    );

    await dbPlanGenerationStore.heartbeat(user.id, "run-a");
    expect((await dbPlanGenerationStore.load(user.id)).runId).toBe("run-b");
  });
});
