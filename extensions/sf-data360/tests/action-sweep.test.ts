/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildData360SweepPlan,
  classifyLiveReadResult,
  classifyUsefulMissingParamResult,
  paramsForDryRun,
} from "../../../scripts/e2e/data360-action-sweep.ts";
import {
  buildDloData360LifecyclePlan,
  buildDmoData360LifecyclePlan,
  canRunData360MutationLifecycle,
  runData360LifecyclePlan,
} from "../../../scripts/e2e/data360/lifecycle.ts";
import {
  findPublicData360Action,
  getPublicData360Actions,
} from "../lib/actions/action-registry.ts";

describe("sf_data360 action sweep", () => {
  it("plans contract, metadata, dry-run, and missing-param checks", () => {
    const selected = [
      findPublicData360Action("prepare.dlo.create")!,
      findPublicData360Action("prepare.dlo.get")!,
      findPublicData360Action("orchestrate.manifest.run")!,
    ];
    const plan = buildData360SweepPlan(selected, { liveRead: true });
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "classification",
          tool: "sf_data360",
          action: "prepare.dlo.create",
          testMode: "fixture_mutation",
          fixturePolicy: "owned_only",
        }),
        expect.objectContaining({
          stage: "describe",
          tool: "sf_data360",
          action: "prepare.dlo.create",
        }),
        expect.objectContaining({ stage: "dry_run", action: "prepare.dlo.create" }),
        expect.objectContaining({ stage: "mutation_gate", action: "prepare.dlo.create" }),
        expect.objectContaining({ stage: "missing_params", action: "prepare.dlo.get" }),
        expect.objectContaining({ stage: "live_read", action: "prepare.dlo.get" }),
      ]),
    );
  });

  it("builds deterministic placeholders for required and any-of parameters", () => {
    const create = findPublicData360Action("prepare.dlo.create")!;
    expect(paramsForDryRun(create)).toMatchObject({ body: { name: "Placeholder" } });
    const mappings = findPublicData360Action("harmonize.dmo_mapping.list")!;
    expect(paramsForDryRun(mappings)).toMatchObject({
      dmoDeveloperName: "PlaceholderDmoDeveloperName",
    });
    expect(buildData360SweepPlan([mappings])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "missing_params", action: mappings.action }),
      ]),
    );
  });

  it("uses action-scoped seed profiles for asset reads and safe POSTs", () => {
    const dloGet = findPublicData360Action("prepare.dlo.get")!;
    const ciValidate = findPublicData360Action("segment.ci.validate")!;
    const seedProfile = {
      defaults: { dataspace: "default" },
      actions: {
        "prepare.dlo.get": { dloName: "Example__dll" },
        "segment.ci.validate": { body: { sql: "SELECT 1" } },
      },
    };
    const plan = buildData360SweepPlan([dloGet, ciValidate], {
      liveRead: true,
      liveSafePost: true,
      seedProfile,
    });
    expect(plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "live_read",
          action: "prepare.dlo.get",
          params: { dloName: "Example__dll", dataspace: "default" },
        }),
        expect.objectContaining({
          stage: "live_read",
          action: "segment.ci.validate",
          params: { body: { sql: "SELECT 1" } },
        }),
      ]),
    );
  });

  it("classifies auth prerequisites and platform failures without hiding them", () => {
    const record = {
      stage: "live_read" as const,
      tool: "sf_data360",
      action: "query.sql.chunk",
      safety: "read",
      outcome: "ok" as const,
      fail: false,
      summary: "planned",
    };
    expect(
      classifyLiveReadResult(record, {
        ok: false,
        error: "Data 360 token exchange failed: invalid_scope",
      }),
    ).toMatchObject({ outcome: "auth_required", fail: false });
    expect(
      classifyLiveReadResult(
        { ...record, action: "semantic.search_index.process_history" },
        { ok: false, status: 500, error: "Internal Server Error" },
      ),
    ).toMatchObject({ outcome: "platform_error", fail: false });
    expect(
      classifyLiveReadResult(
        { ...record, action: "connect.source_schema.get" },
        { ok: false, status: 400, error: "No enum constant ConnectionSchemaTypeEnum.X" },
      ),
    ).toMatchObject({ outcome: "dependency_missing", fail: false });
  });

  it("recognizes actionable missing-parameter failures", () => {
    expect(
      classifyUsefulMissingParamResult(new Error("Missing required parameter 'dloName'.")),
    ).toMatchObject({ ok: true });
    expect(classifyUsefulMissingParamResult({ ok: false, error: "MISSING_PARAM" })).toMatchObject({
      ok: true,
    });
  });

  it("builds a public fixture-owned DLO lifecycle", () => {
    const plan = buildDloData360LifecyclePlan(getPublicData360Actions(), "Run20260811");
    expect(plan.resourceName).toBe("PiData360SweepDlo_Run20260811__dll");
    expect(plan.checks.map(({ tool, action }) => ({ tool, action }))).toEqual([
      { tool: "sf_data360", action: "prepare.dlo.get" },
      { tool: "sf_data360", action: "prepare.dlo.create" },
      { tool: "sf_data360", action: "prepare.dlo.create" },
      { tool: "sf_data360", action: "prepare.dlo.get" },
      { tool: "sf_data360", action: "prepare.dlo.delete" },
      { tool: "sf_data360", action: "prepare.dlo.delete" },
      { tool: "sf_data360", action: "prepare.dlo.get" },
    ]);
  });

  it("keeps maximum-length run IDs within the DLO API-name limit", () => {
    const plan = buildDloData360LifecyclePlan(getPublicData360Actions(), "A".repeat(32));
    expect(plan.resourceName.length).toBeLessThanOrEqual(40);
    expect(plan.resourceName).toMatch(/^PiData360SweepDlo_[A-Za-z0-9_]+__dll$/);
  });

  it("builds a fixture-owned DMO create-update-delete lifecycle", () => {
    const plan = buildDmoData360LifecyclePlan(getPublicData360Actions(), "Run20260811");
    expect(plan.resourceName).toBe("PiData360SweepDmo_Run20260811__dlm");
    expect(plan.checks.map(({ action }) => action)).toEqual([
      "harmonize.dmo.get",
      "harmonize.dmo.create",
      "harmonize.dmo.create",
      "harmonize.dmo.get",
      "harmonize.dmo.update",
      "harmonize.dmo.update",
      "harmonize.dmo.get",
      "harmonize.dmo.delete",
      "harmonize.dmo.delete",
      "harmonize.dmo.get",
    ]);
  });

  it("requires exact non-production mutation gates", () => {
    expect(
      canRunData360MutationLifecycle({
        mutate: true,
        targetOrg: "ExampleSandbox",
        authenticatedTargets: ["ExampleSandbox"],
        orgType: "sandbox",
        runId: "Run20260811",
        mutationTargetOrg: "ExampleSandbox",
        destructiveTargetOrg: "ExampleSandbox",
      }),
    ).toEqual({ ok: true });
  });

  it("always reaches cleanup for a successful lifecycle", async () => {
    const plan = buildDloData360LifecyclePlan(getPublicData360Actions(), "Run20260811");
    let exists = false;
    const records = await runData360LifecyclePlan(
      plan,
      async (input) => {
        if (input.action === "prepare.dlo.get") {
          return exists
            ? { ok: true, status: 200 }
            : { ok: false, status: 404, error: "NOT_FOUND" };
        }
        if (input.action === "prepare.dlo.create" && !input.dry_run) exists = true;
        if (input.action === "prepare.dlo.delete" && !input.dry_run) exists = false;
        return { ok: true };
      },
      { retryDelayMs: 0 },
    );
    expect(records.at(-1)).toMatchObject({ stage: "cleanup_verify", outcome: "cleaned" });
  });
});
