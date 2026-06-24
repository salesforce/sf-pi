/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for compact sf_herdr_plan text rendering. */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SF_HERDR_PREFERENCES,
  buildHerdrLanePlan,
} from "../../../lib/common/herdr-profile/store.ts";
import { renderHerdrLanePlan } from "../lib/sf_herdr_plan-tool.ts";

describe("renderHerdrLanePlan", () => {
  it("renders a compact fresh ephemeral card", () => {
    const plan = buildHerdrLanePlan(DEFAULT_SF_HERDR_PREFERENCES, {
      intent: "verify",
      primaryWorkflow: "generic",
      confidence: 1,
      reason: "Workflow supplied by caller: generic.",
    });

    const rendered = renderHerdrLanePlan(plan, { inHerdrPane: true });

    expect(rendered).toContain("🐑 SF Herdr plan  deploy · verify · fresh ephemeral");
    expect(rendered).toContain("Workflow  generic (100%)");
    expect(rendered).toContain("target deploy_<shortid>");
    expect(rendered).toContain("Action path");
    expect(rendered).toContain("herdr.pane_split");
    expect(rendered).toContain("herdr.watch/read");
    expect(rendered).toContain("stop/close after Workflow Success Condition");
    expect(rendered).not.toContain("Recommended Herdr actions:");
    expect(rendered).not.toContain("Phases:");
  });

  it("renders sticky lane cleanup without auto-stop", () => {
    const plan = buildHerdrLanePlan(DEFAULT_SF_HERDR_PREFERENCES, {
      intent: "server",
      primaryWorkflow: "uiBundle",
      confidence: 1,
    });

    const rendered = renderHerdrLanePlan(plan, { inHerdrPane: false });

    expect(rendered).toContain("server · server · sticky");
    expect(rendered).toContain("Herdr pane environment not detected");
    expect(rendered).toContain("manual cleanup");
    expect(rendered).toContain("no automatic cleanup; explicit user cleanup required");
  });
});
