/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REVIEW_ENTRY_TYPE, formatHerdrReviewFeedback } from "../lib/feedback.ts";
import { fileReviewSnapshot } from "../lib/review.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Herdr review provenance", () => {
  it("connects an annotation to its exact source and warns when that source changed", () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "sf-planreview-feedback-"));
    dirs.push(cwd);
    const previous = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
    try {
      const original = path.join(cwd, "plan.md");
      writeFileSync(original, "# Original plan\n");
      const review = fileReviewSnapshot(cwd, "plan.md");
      const feedback = `# Annotations on ${path.basename(review.file)}\n\n## Annotation 1\nPlease revisit this step.`;
      const branch = [
        {
          type: "custom",
          customType: REVIEW_ENTRY_TYPE,
          data: {
            reviewFile: path.basename(review.file),
            sourcePath: review.sourcePath,
            sourceDigest: review.sourceDigest,
            label: "plan.md",
            paneId: "review-pane",
            dataDir: review.dataDir,
          },
        },
      ];
      expect(formatHerdrReviewFeedback(feedback, branch)?.text).toContain("Review of plan.md:");
      expect(formatHerdrReviewFeedback(feedback, branch)?.deliveredReview).toEqual({
        reviewFile: path.basename(review.file),
        paneId: "review-pane",
        dataDir: review.dataDir,
      });
      writeFileSync(original, "# Updated plan\n");
      expect(formatHerdrReviewFeedback(feedback, branch)?.text).toContain(
        "source changed since review began",
      );
      expect(formatHerdrReviewFeedback("an unrelated user message", branch)).toBeUndefined();
      expect(formatHerdrReviewFeedback(feedback, [])?.text).toContain(
        "could not be matched to this Pi branch",
      );
      expect(formatHerdrReviewFeedback(feedback, [])?.deliveredReview).toBeUndefined();
    } finally {
      if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previous;
    }
  });
});
