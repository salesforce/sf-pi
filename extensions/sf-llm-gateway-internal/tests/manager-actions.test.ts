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
      expect(ids).toContain(item.id);
    }

    expect(actions.find((action) => action.id === "doctor")?.group).toBe("Discovery & diagnostics");
    expect(actions.find((action) => action.id === "tokens")?.group).toBe("Utilities");
    expect(actions.find((action) => action.id === "status")?.group).toBe("Reference");
  });

  it("marks scoped commands without duplicating global/project action rows", () => {
    const actions = buildGatewayManagerActions({} as never);
    const scopedIds = GATEWAY_COMMAND_SURFACE.filter((item) => item.acceptsScope).map(
      (item) => item.id,
    );

    for (const id of scopedIds) {
      expect(actions.filter((action) => action.id === id)).toHaveLength(1);
      expect(actions.find((action) => action.id === id)?.acceptsScope).toBe(true);
      expect(actions.some((action) => action.id === `${id}:global`)).toBe(false);
      expect(actions.some((action) => action.id === `${id}:project`)).toBe(false);
    }
  });

  it("closes the Manager before launching the setup overlay", () => {
    const actions = buildGatewayManagerActions({} as never);

    expect(actions.find((action) => action.id === "setup")?.closeBeforeRun).toBe(true);
    expect(actions.find((action) => action.id === "doctor")?.closeBeforeRun).toBeUndefined();
  });

  it("keeps scoped actions callable through the Manager scope parameter", () => {
    const pi = {} as never;
    const actions = buildGatewayManagerActions(pi);
    const action = actions.find((candidate) => candidate.id === "on");

    // The action should be callable; command behavior is covered by command-parsing tests.
    expect(action).toBeDefined();
    expect(action?.label).toBe("Enable gateway defaults");
    expect(action?.acceptsScope).toBe(true);
    expect(typeof action?.run).toBe("function");
  });
});
