/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Command-gate tests — we want to confirm that:
 *   - multi-word patterns ("rm -rf") match when they appear as adjacent tokens
 *   - single-word patterns ("sudo") only match when present as a token, not
 *     when baked into a string literal (`echo "sudo is dangerous"`)
 *   - allowedPatterns short-circuit to allow
 *   - autoDenyPatterns short-circuit to block without prompting
 */
import { describe, expect, it } from "vitest";
import { evaluateCommand } from "../lib/command-gate.ts";
import type { CommandGateConfig } from "../lib/types.ts";

const gate: CommandGateConfig = {
  patterns: [
    { id: "rm-rf", pattern: "rm -rf" },
    { id: "sudo", pattern: "sudo" },
    { id: "git-force", pattern: "git push --force" },
    { id: "sf-org-delete", pattern: "sf org delete" },
  ],
  allowedPatterns: [{ id: "npm-test", pattern: "npm test" }],
  autoDenyPatterns: [{ id: "rm-root", pattern: "rm -rf /" }],
};

describe("evaluateCommand", () => {
  it("confirms multi-word pattern match", () => {
    const out = evaluateCommand("rm -rf tmp/", gate);
    expect(out?.action).toBe("confirm");
    expect(out?.matched.id).toBe("rm-rf");
  });

  it("confirms single-token pattern match", () => {
    const out = evaluateCommand("sudo apt-get install", gate);
    expect(out?.action).toBe("confirm");
    expect(out?.matched.id).toBe("sudo");
  });

  it("does NOT match words hidden inside a string literal", () => {
    const out = evaluateCommand('echo "sudo is bad"', gate);
    expect(out).toBeUndefined();
  });

  it("does NOT match `sf org delete` inside a quoted SOQL string", () => {
    const out = evaluateCommand(
      "sf data query --query \"SELECT Id FROM Account WHERE Description LIKE '%sf org delete%'\"",
      gate,
    );
    expect(out).toBeUndefined();
  });

  it("autoDenyPatterns short-circuit to block without prompting", () => {
    const out = evaluateCommand("rm -rf /", gate);
    expect(out?.action).toBe("autodeny");
  });

  it("allowedPatterns short-circuit to allow", () => {
    const out = evaluateCommand("npm test", gate);
    expect(out?.action).toBe("allow");
  });

  it("returns undefined when no pattern matches", () => {
    expect(evaluateCommand("ls -la", gate)).toBeUndefined();
  });

  it("confirms git push --force", () => {
    expect(evaluateCommand("git push --force origin main", gate)?.matched.id).toBe("git-force");
  });

  it("confirms sf org delete scratch", () => {
    expect(evaluateCommand("sf org delete scratch -o MyScratch", gate)?.matched.id).toBe(
      "sf-org-delete",
    );
  });
});
