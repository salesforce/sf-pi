/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  formatDimensionNote,
  isEditToolResult,
  isWriteToolResult,
  parseSkillBlock,
  withFileMutationQueue,
} from "../pi-sdk-compat.ts";

describe("Pi SDK compatibility helpers", () => {
  it("recognizes edit and write tool results by public tool name", () => {
    expect(isEditToolResult({ toolName: "edit" } as never)).toBe(true);
    expect(isWriteToolResult({ toolName: "write" } as never)).toBe(true);
    expect(isEditToolResult({ toolName: "read" } as never)).toBe(false);
  });

  it("parses Pi skill invocation blocks", () => {
    expect(
      parseSkillBlock('<skill name="sf-apex" location="/tmp/SKILL.md">\nBody\n</skill>\n\nRun it'),
    ).toEqual({
      name: "sf-apex",
      location: "/tmp/SKILL.md",
      content: "Body",
      userMessage: "Run it",
    });
  });

  it("formats resized-image coordinate guidance", () => {
    expect(
      formatDimensionNote({
        wasResized: true,
        originalWidth: 2000,
        originalHeight: 1000,
        width: 1000,
        height: 500,
      }),
    ).toContain("Multiply coordinates by 2.00");
  });

  it("serializes operations targeting the same file", async () => {
    const order: string[] = [];
    const first = withFileMutationQueue("/tmp/sf-pi-omp-queue-test", async () => {
      order.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("first:end");
    });
    const second = withFileMutationQueue("/tmp/sf-pi-omp-queue-test", async () => {
      order.push("second");
    });

    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });
});
