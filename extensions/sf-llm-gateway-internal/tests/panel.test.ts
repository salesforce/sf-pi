/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the gateway grouped action panel inventory.
 *
 * The runtime component is manually QA'd in Pi, but the pure row builder keeps
 * group labels, scope hints, and command-surface coverage from drifting.
 */
import { describe, expect, it } from "vitest";
import { GATEWAY_COMMAND_SURFACE } from "../lib/command-surface.ts";
import { buildGatewayGroupedActionItems } from "../lib/panel.ts";

describe("gateway grouped panel actions", () => {
  it("groups actions without baking group names into the visible action label", () => {
    const actions = buildGatewayGroupedActionItems("global");
    expect(actions.some((item) => item.group === "Setup")).toBe(true);
    expect(actions.some((item) => item.group === "Discovery & diagnostics")).toBe(true);
    expect(actions.some((item) => item.group === "Utilities")).toBe(true);
    expect(actions.every((item) => !item.label.includes(" — "))).toBe(true);
  });

  it("includes every command-surface action plus scope switching and close", () => {
    const actions = buildGatewayGroupedActionItems("project");
    const values = actions.map((item) => item.value);

    expect(values).toContain("switch-scope");
    expect(values).toContain("close");
    for (const surface of GATEWAY_COMMAND_SURFACE) {
      expect(values).toContain(surface.id);
    }
  });

  it("adds scope hints only to scoped actions", () => {
    const actions = buildGatewayGroupedActionItems("project");
    expect(actions.find((item) => item.value === "setup")?.label).toContain("[project]");
    expect(actions.find((item) => item.value === "doctor")?.label).not.toContain("[project]");
  });
});
