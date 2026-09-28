/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupReviewSnapshot, createReviewSnapshot } from "../lib/review.ts";
import {
  cleanupClosedReviews,
  deliveredReviewsOnBranch,
  REVIEW_DELIVERED_TYPE,
} from "../lib/retention.ts";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
let agentDir: string;
beforeEach(() => {
  agentDir = mkdtempSync(path.join(tmpdir(), "sf-planreview-retention-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});
afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { force: true, recursive: true });
});

describe("delivered Herdr review retention", () => {
  it("restores only delivered reviews on the active branch", () => {
    const review = {
      reviewFile: "reply-review-00000000-0000-4000-8000-000000000000.md",
      paneId: "pane-1",
      dataDir: "/private/reviews/1/data",
    };
    expect(
      deliveredReviewsOnBranch([
        { type: "custom", customType: "sf-planreview-source", data: review },
        { type: "custom", customType: REVIEW_DELIVERED_TYPE, data: review },
        { type: "message", message: { role: "assistant" } },
      ]),
    ).toEqual([review]);
    expect(deliveredReviewsOnBranch([])).toEqual([]);
  });

  it("keeps open, failed, or malformed pane states and removes only confirmed closed reviews", async () => {
    const snapshot = createReviewSnapshot("# Private draft", "reply.md");
    const review = {
      reviewFile: path.basename(snapshot.file),
      paneId: "pane-1",
      dataDir: snapshot.dataDir,
    };
    const pending = new Map([[review.reviewFile, review]]);
    try {
      for (const response of [
        { code: 1, stdout: "" },
        { code: 0, stdout: "not-json" },
        { code: 0, stdout: '{"result":{}}' },
        { code: 0, stdout: '{"result":{"panes":[{}]}}' },
        { code: 0, stdout: '{"result":{"panes":[{"pane_id":"pane-1"}]}}' },
      ]) {
        await cleanupClosedReviews(async () => ({ ...response, stderr: "" }), pending);
        expect(readFileSync(snapshot.file, "utf8")).toContain("Private draft");
      }
      await cleanupClosedReviews(
        async () => ({ code: 0, stdout: '{"result":{"panes":[]}}', stderr: "" }),
        pending,
      );
      expect(pending.size).toBe(0);
      expect(() => readFileSync(snapshot.file)).toThrow();
    } finally {
      cleanupReviewSnapshot(snapshot);
    }
  });
});
