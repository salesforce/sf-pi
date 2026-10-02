/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildSfBrainManagerActions } from "../lib/instruction-surface-manager.ts";

describe("SF Brain Manager actions", () => {
  it("opens a read-only Instruction Surface diagnostic panel", () => {
    const pi = {
      getAllTools: () => [{ name: "sf_apex", description: "Apex", parameters: { type: "object" } }],
    };
    const actions = buildSfBrainManagerActions(pi as never, {
      sfPiPackageRoot: "/repo",
      sfPiToolNames: ["sf_apex"],
      piRuntimeVersion: "0.82.1",
      sfPiVersion: "1.0.0",
    });

    expect(actions.map((action) => action.id)).toEqual([
      "display-capabilities",
      "instruction-surface",
      "visual-response-audit",
    ]);
    expect(actions[0]).toMatchObject({
      id: "display-capabilities",
      label: "Display capabilities",
      group: "Diagnostics",
      acceptsScope: false,
    });
    expect(actions[1]).toMatchObject({
      id: "instruction-surface",
      label: "Instruction surface",
      group: "Diagnostics",
      acceptsScope: false,
    });
    expect(actions[2]).toMatchObject({
      id: "visual-response-audit",
      label: "Visual response audit",
      group: "Diagnostics",
      acceptsScope: false,
    });
    expect(actions.every((action) => action.createPanel)).toBe(true);
  });
});
