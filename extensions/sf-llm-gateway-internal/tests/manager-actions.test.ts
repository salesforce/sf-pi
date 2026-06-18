/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for SF LLM Gateway Manager action mapping. */
import { describe, expect, it } from "vitest";
import { GATEWAY_COMMAND_SURFACE } from "../lib/command-surface.ts";
import { buildGatewayManagerActions } from "../index.ts";

describe("gateway Manager actions", () => {
  it("preserves every command surface action with grouped Manager metadata", () => {
    const actions = buildGatewayManagerActions({} as never);
    const ids = actions.map((action) => action.id);

    for (const item of GATEWAY_COMMAND_SURFACE) {
      if (item.acceptsScope) {
        expect(ids).toContain(`${item.id}:global`);
        expect(ids).toContain(`${item.id}:project`);
      } else {
        expect(ids).toContain(item.id);
      }
    }

    expect(actions.find((action) => action.id === "doctor")?.group).toBe("Discovery & diagnostics");
    expect(actions.find((action) => action.id === "tokens")?.group).toBe("Utilities");
    expect(actions.find((action) => action.id === "status")?.group).toBe("Reference");
  });

  it("closes the Manager before launching the setup overlay", () => {
    const actions = buildGatewayManagerActions({} as never);

    expect(actions.find((action) => action.id === "setup:global")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "setup:project")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "doctor")?.closeBeforeRun).toBeUndefined();
  });

  it("labels scoped actions with their selected scope", () => {
    const pi = {} as never;
    const actions = buildGatewayManagerActions(pi);
    const action = actions.find((candidate) => candidate.id === "on:project");

    // The action should be callable; command behavior is covered by command-parsing tests.
    expect(action).toBeDefined();
    expect(action?.label).toContain("[project]");
    expect(action?.description).toContain("project scope");
    expect(typeof action?.run).toBe("function");
  });
});
