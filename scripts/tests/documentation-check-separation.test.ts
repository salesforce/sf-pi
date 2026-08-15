/* SPDX-License-Identifier: Apache-2.0 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type CheckOutput = {
  ok: boolean;
  findings: Array<{ level: string; file: string; message: string }>;
};

function runCheck(script: string): CheckOutput {
  return JSON.parse(
    execFileSync(process.execPath, [script, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  ) as CheckOutput;
}

describe("documentation and architecture check separation", () => {
  it("keeps source architecture findings out of docs health", () => {
    const docs = runCheck("scripts/docs-health.mjs");
    const architecture = runCheck("scripts/check-architecture.mjs");

    expect(docs.findings.some((finding) => /\bLOC\b/.test(finding.message))).toBe(false);
    expect(architecture.findings.some((finding) => /\bLOC\b/.test(finding.message))).toBe(true);
    expect(architecture.ok).toBe(true);
  });
});
