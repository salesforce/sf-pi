/* SPDX-License-Identifier: Apache-2.0 */
/**
 * File-policy risk gate tests.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: () => true,
  };
});

import { readBundledConfig } from "../lib/config.ts";
import { evaluateFilePolicy } from "../lib/file-policy-gate.ts";

describe("evaluateFilePolicy", () => {
  it("returns a block decision when the policy blocks the current tool", () => {
    const decision = evaluateFilePolicy(
      { kind: "file", toolName: "write", path: "force-app/main/default/destructiveChanges.xml" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toMatchObject({
      action: "block",
      feature: "policies",
      ruleId: "sf-destructive-changes-xml",
      subject: "force-app/main/default/destructiveChanges.xml",
    });
  });

  it("returns no decision when readOnly policy does not block the current tool", () => {
    const decision = evaluateFilePolicy(
      { kind: "file", toolName: "read", path: ".forceignore" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toBeUndefined();
  });

  it("returns no decision for allowed carve-outs", () => {
    const decision = evaluateFilePolicy(
      { kind: "file", toolName: "write", path: ".sfdx/agents/MyAgent/sessions/session.json" },
      "/project",
      readBundledConfig(),
    );

    expect(decision).toBeUndefined();
  });

  it("returns no decision when policies are disabled", () => {
    const config = readBundledConfig();
    config.features.policies = false;

    const decision = evaluateFilePolicy(
      { kind: "file", toolName: "write", path: ".env" },
      "/project",
      config,
    );

    expect(decision).toBeUndefined();
  });
});
