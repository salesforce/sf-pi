/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { validateFlowCheck, type FlowValidationAdapter } from "../lib/validation.ts";

const flowFile = path.join(
  import.meta.dirname,
  "fixtures",
  "Record_Triggered_Example.flow-meta.xml",
);

describe("SF Flow check-only validation", () => {
  it("validates one exact file without changing it", async () => {
    const before = await readFile(flowFile, "utf8");
    const run = vi.fn<FlowValidationAdapter["run"]>().mockResolvedValue({
      id: "0Af000000000001",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    });

    const result = await validateFlowCheck(
      { action: "validate.check", file: flowFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      {
        adapter: { run },
        writeArtifact: async (kind, filename) => ({ path: `/tmp/${filename}`, kind }),
      },
    );

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        check_only: true,
        file: flowFile,
      }),
    );
    expect(await readFile(flowFile, "utf8")).toBe(before);
    expect(result.details).toMatchObject({
      ok: true,
      check_only: true,
      deployment_performed: false,
    });
  });

  it("returns source-located component failures", async () => {
    const result = await validateFlowCheck(
      { action: "validate.check", file: flowFile, target_org: "sandbox" },
      process.cwd(),
      {} as never,
      {
        adapter: {
          run: async () => ({
            id: "0Af000000000002",
            success: false,
            status: "Failed",
            component_failures: [
              { problem: "Invalid reference", line_number: 12, column_number: 9 },
            ],
            raw: { success: false },
          }),
        },
        writeArtifact: async (kind, filename) => ({ path: `/tmp/${filename}`, kind }),
      },
    );

    expect(result.details.ok).toBe(false);
    expect(result.content[0]?.text).toContain("Invalid reference");
  });
});
