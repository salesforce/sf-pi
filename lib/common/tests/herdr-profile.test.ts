/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for shared Herdr workflow profiles and lane planning. */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SF_HERDR_PREFERENCES,
  buildHerdrLanePlan,
  formatHerdrActionCall,
  herdrPreferencesPath,
  readSfHerdrPreferences,
  resolveHerdrProfile,
  writeSfHerdrPreferences,
  type SfHerdrPreferences,
} from "../herdr-profile/store.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";
let tmpDir: string;
let prevAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-herdr-profile-"));
  prevAgentDir = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgentDir === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("herdr-profile store contract", () => {
  it("uses the canonical sf-pi/herdr preferences path", () => {
    expect(herdrPreferencesPath()).toContain("sf-pi/herdr/preferences.json");
  });

  it("resolves opinionated Apex lane defaults", () => {
    const profile = resolveHerdrProfile(DEFAULT_SF_HERDR_PREFERENCES, "apex");

    expect(profile.workflow).toBe("apex");
    expect(profile.splitDirection).toBe("right");
    expect(profile.lanes.tests.baseAlias).toBe("apex_tests");
    expect(profile.lanes.logs.baseAlias).toBe("apex_logs");
    expect(profile.lanes.logs.lifecycle).toBe("ephemeral");
  });

  it("merges related workflow lane add-ons without replacing global placement", () => {
    const profile = resolveHerdrProfile(DEFAULT_SF_HERDR_PREFERENCES, "agentscript", ["apex"]);

    expect(profile.workflow).toBe("agentscript");
    expect(profile.relatedWorkflows).toEqual(["apex"]);
    expect(profile.splitDirection).toBe("right");
    expect(profile.lanes.preview.baseAlias).toBe("agent_preview");
    expect(profile.lanes.logs.baseAlias).toBe("apex_logs");
  });

  it("treats generic as the base profile, not a related workflow override", () => {
    const profile = resolveHerdrProfile(DEFAULT_SF_HERDR_PREFERENCES, "apex", [
      "generic",
      "apex",
      "generic",
    ]);

    expect(profile.relatedWorkflows).toEqual([]);
    expect(profile.lanes.tests.baseAlias).toBe("apex_tests");
    expect(profile.lanes.logs.baseAlias).toBe("apex_logs");
  });

  it("builds fresh ephemeral lane plans with action hints and cleanup policy", () => {
    const plan = buildHerdrLanePlan(DEFAULT_SF_HERDR_PREFERENCES, {
      primaryWorkflow: "agentscript",
      relatedWorkflows: ["apex"],
      intent: "preview",
      confidence: 0.87,
      reason: "Recent Agent Script preview and Apex activity.",
    });

    expect(plan.workflow.primary).toBe("agentscript");
    expect(plan.workflow.related).toEqual(["apex"]);
    expect(plan.workflow.confidence).toBe(0.87);
    expect(plan.lane.id).toBe("preview");
    expect(plan.lane.baseAlias).toBe("agent_preview");
    expect(plan.lane.lifecycle).toBe("ephemeral");
    expect(plan.alias).toMatchObject({
      baseAlias: "agent_preview",
      targetAliasHint: "agent_preview_<shortid>",
      pattern: "agent_preview_<shortid>",
    });
    expect(plan.placement).toMatchObject({
      prefer: "split",
      splitDirection: "right",
      focus: false,
      sourcePane: { default: "current_agent_pane", paneParam: "omit" },
    });
    expect(plan.recommendedActions.map((action) => action.action)).toEqual([
      "list",
      "pane_split",
      "run",
      "watch",
      "read",
      "stop",
    ]);
    expect(plan.recommendedActions[1]?.paramsHint).toMatchObject({
      pane: "<omit for current agent/orchestrator pane>",
      newPane: "agent_preview_<shortid>",
      direction: "right",
      focus: false,
    });
    expect(plan.phases.create).toContain(formatHerdrActionCall(plan.recommendedActions[1]!));
    expect(plan.cleanupPolicy.onSuccess).toEqual({
      action: "stop",
      requires: "workflow-success-condition",
    });
    expect(plan.cleanupPolicy.onFailureOrTimeout).toEqual({
      action: "read-summarize-ask",
      readSource: "recent-unwrapped",
    });
    expect(plan.phases.discover).toContain("previously closed ephemeral pane aliases");
    expect(plan.phases.create).toContain('herdr(action="pane_split"');
    expect(plan.phases.cleanup).toContain('herdr(action="stop"');
    expect(plan.phases.cleanup).toContain("Workflow Success Condition");
  });

  it("plans Apex log tails as fresh ephemeral lanes", () => {
    const plan = buildHerdrLanePlan(DEFAULT_SF_HERDR_PREFERENCES, {
      primaryWorkflow: "apex",
      intent: "tail-logs",
      expectedDuration: "short",
    });

    expect(plan.lane.id).toBe("logs");
    expect(plan.lane.baseAlias).toBe("apex_logs");
    expect(plan.lane.lifecycle).toBe("ephemeral");
    expect(plan.alias.pattern).toBe("apex_logs_<shortid>");
    expect(plan.phases.run).toContain(
      "do not pre-open this lane from session or workflow inference alone",
    );
    expect(plan.phases.observe).toContain("expected log marker");
  });

  it("keeps server lanes sticky with no auto-close policy", () => {
    const preferences: SfHerdrPreferences = {
      ...DEFAULT_SF_HERDR_PREFERENCES,
      defaults: { ...DEFAULT_SF_HERDR_PREFERENCES.defaults, splitDirection: "down" },
      workflows: {
        ...DEFAULT_SF_HERDR_PREFERENCES.workflows,
        uiBundle: {
          lanes: {
            server: { alias: "ui_server", lifecycle: "sticky" },
          },
        },
      },
    };

    const plan = buildHerdrLanePlan(preferences, {
      primaryWorkflow: "uiBundle",
      intent: "server",
      expectedDuration: "long",
    });

    expect(plan.lane.baseAlias).toBe("ui_server");
    expect(plan.lane.lifecycle).toBe("sticky");
    expect(plan.placement).toMatchObject({
      prefer: "split",
      splitDirection: "down",
      focus: false,
      sourcePane: { default: "current_agent_pane", paneParam: "omit" },
    });
    expect(plan.alias.targetAliasHint).toBe("ui_server");
    expect(plan.recommendedActions.map((action) => action.action)).not.toContain("stop");
    expect(plan.recommendedActions[1]).toMatchObject({
      action: "pane_split",
      condition: "Only when the sticky/manual base alias is absent.",
    });
    expect(plan.phases.discover).toContain("reuse it when present and create it only when absent");
    expect(plan.phases.create).toContain("base alias is absent");
    expect(plan.cleanupPolicy.onSuccess).toEqual({
      action: "none",
      requires: "explicit-user-cleanup",
    });
    expect(plan.phases.cleanup).toContain("Do not auto-close");
  });

  it("ignores removed preference fields and omits them on write", () => {
    const preferencesPath = herdrPreferencesPath();
    mkdirSync(path.dirname(preferencesPath), { recursive: true });
    writeFileSync(
      preferencesPath,
      JSON.stringify({
        schemaVersion: 1,
        state: {
          workflowMode: "off",
          defaults: { laneStyle: "tab", splitDirection: "down", preserveFocus: false },
          workflows: {
            generic: { lanes: { tests: { enabled: false, alias: "custom_tests" } } },
          },
        },
      }),
    );

    const preferences = readSfHerdrPreferences();
    expect(preferences.defaults.splitDirection).toBe("down");
    expect(preferences.workflows.generic?.lanes?.tests?.alias).toBe("custom_tests");

    writeSfHerdrPreferences(preferences);
    const raw = JSON.parse(readFileSync(preferencesPath, "utf-8"));
    expect(raw.state.workflowMode).toBeUndefined();
    expect(raw.state.defaults.laneStyle).toBeUndefined();
    expect(raw.state.defaults.preserveFocus).toBeUndefined();
    expect(raw.state.workflows.generic.lanes.tests.enabled).toBeUndefined();
  });
});
