/* SPDX-License-Identifier: Apache-2.0 */
/** Characterize the report seam without invoking the dependency's glob-based CoverageReporter. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CoverageReporter, ResultFormat, TestService } from "@salesforce/apex-node";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Apex report writer dependency reachability", () => {
  it("writes test and coverage JSON without invoking the glob-based coverage reporter", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sf-apex-report-security-"));
    dirs.push(dir);
    const coverage = vi
      .spyOn(CoverageReporter.prototype, "generateReports")
      .mockImplementation(() => {
        throw new Error("Glob-based CoverageReporter must not run.");
      });
    const service = new TestService({} as never);
    const result = {
      summary: { testRunId: "example-test-run" },
      tests: [
        {
          outcome: "Pass",
          perClassCoverage: [
            {
              name: "ExampleClass",
              percentage: 100,
              coverage: { coveredLines: [1], uncoveredLines: [] },
            },
          ],
        },
      ],
    };
    const files = await service.writeResultFiles(
      result as never,
      {
        dirPath: dir,
        resultFormats: [ResultFormat.json],
      },
      true,
    );
    expect(coverage).not.toHaveBeenCalled();
    expect(files.some((file) => file.endsWith("-codecoverage.json"))).toBe(true);
    for (const file of files.filter((file) => file.endsWith(".json"))) {
      expect(() => JSON.parse(readFileSync(file, "utf8"))).not.toThrow();
    }
  });
});
