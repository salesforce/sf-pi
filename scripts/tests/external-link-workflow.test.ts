/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath: string): string => readFileSync(path.join(ROOT, relativePath), "utf8");

describe("scheduled external-link report", () => {
  it("is weekly, manually dispatchable, report-only, and artifact-backed", () => {
    const workflow = read(".github/workflows/external-link-report.yml");
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };

    expect(workflow).toMatch(/schedule:\s*\n\s*- cron:/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/\npush:/);
    expect(workflow).not.toMatch(/\npull_request:/);
    expect(workflow).toContain("npm run docs:links:report");
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).toContain("if: always()");
    expect(workflow).not.toContain("fail-on-stable-dead");
    expect(pkg.scripts?.["docs:links:report"]).toBe("node scripts/check-external-links.mjs");
  });
});
