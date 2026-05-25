/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for shared Herdr workflow profiles and lane planning. */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SF_HERDR_PREFERENCES,
  buildHerdrLanePlan,
  herdrPreferencesPath,
  resolveHerdrProfile,
  type SfHerdrPreferences,
} from "../herdr-profile/store.ts";

describe("herdr-profile store contract", () => {
  it("uses the canonical sf-pi/herdr preferences path", () => {
    expect(herdrPreferencesPath()).toContain("sf-pi/herdr/preferences.json");
  });

  it("resolves opinionated Apex defaults", () => {
    const profile = resolveHerdrProfile(DEFAULT_SF_HERDR_PREFERENCES, "apex");

    expect(profile.workflow).toBe("apex");
    expect(profile.laneStyle).toBe("split");
    expect(profile.splitDirection).toBe("right");
    expect(profile.preserveFocus).toBe(true);
    expect(profile.lanes.tests.alias).toBe("apex_tests");
    expect(profile.lanes.tests.enabled).toBe(true);
    expect(profile.lanes.logs.alias).toBe("apex_logs");
    expect(profile.lanes.logs.lifecycle).toBe("ephemeral");
  });

  it("merges related workflow lane add-ons without replacing primary placement", () => {
    const profile = resolveHerdrProfile(DEFAULT_SF_HERDR_PREFERENCES, "agentscript", ["apex"]);

    expect(profile.workflow).toBe("agentscript");
    expect(profile.relatedWorkflows).toEqual(["apex"]);
    expect(profile.laneStyle).toBe("split");
    expect(profile.lanes.preview.alias).toBe("agent_preview");
    expect(profile.lanes.logs.alias).toBe("apex_logs");
  });

  it("builds phased ephemeral lane plans that close on success and preserve failures", () => {
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
    expect(plan.lane.alias).toBe("agent_preview");
    expect(plan.lane.lifecycle).toBe("ephemeral");
    expect(plan.placement.prefer).toBe("split");
    expect(plan.phases.discover).toContain("herdr.list");
    expect(plan.phases.create).toContain("herdr.pane_split");
    expect(plan.phases.create).toContain("avoid splitting the orchestrator pane more than once");
    expect(plan.phases.run).toContain("Caller supplies the shell command");
    expect(plan.phases.cleanup).toContain("herdr.stop");
    expect(plan.phases.cleanup).toContain("failure or timeout");
  });

  it("plans Apex log tails as just-in-time ephemeral lanes", () => {
    const plan = buildHerdrLanePlan(DEFAULT_SF_HERDR_PREFERENCES, {
      primaryWorkflow: "apex",
      intent: "tail-logs",
      expectedDuration: "short",
    });

    expect(plan.lane.id).toBe("logs");
    expect(plan.lane.alias).toBe("apex_logs");
    expect(plan.lane.lifecycle).toBe("ephemeral");
    expect(plan.phases.discover).toContain("do not create lanes during session setup");
    expect(plan.phases.create).toContain("just in time");
    expect(plan.phases.run).toContain(
      "do not pre-open this lane from session or workflow inference alone",
    );
    expect(plan.phases.observe).toContain("stop the tail");
    expect(plan.notes.join("\n")).toContain(
      "avoid stacking multiple splits off the orchestrator pane",
    );
  });

  it("uses sticky tab placement for long-lived server lanes when configured", () => {
    const preferences: SfHerdrPreferences = {
      ...DEFAULT_SF_HERDR_PREFERENCES,
      workflows: {
        ...DEFAULT_SF_HERDR_PREFERENCES.workflows,
        uiBundle: {
          laneStyle: "tab",
          lanes: {
            server: { enabled: true, alias: "ui_server", lifecycle: "sticky" },
          },
        },
      },
    };

    const plan = buildHerdrLanePlan(preferences, {
      primaryWorkflow: "uiBundle",
      intent: "server",
      expectedDuration: "long",
    });

    expect(plan.lane.alias).toBe("ui_server");
    expect(plan.lane.lifecycle).toBe("sticky");
    expect(plan.placement.prefer).toBe("tab");
    expect(plan.phases.create).toContain("herdr.tab_create");
    expect(plan.phases.cleanup).toContain("Do not auto-close");
  });
});
