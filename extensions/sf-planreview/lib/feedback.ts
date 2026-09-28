/* SPDX-License-Identifier: Apache-2.0 */
/** Attribute Herdr's next-message annotation to one review on the active Pi branch. */
import { reviewSourceChanged } from "./review.ts";
import type { DeliveredReview } from "./retention.ts";

export const REVIEW_ENTRY_TYPE = "sf-planreview-source";

export interface HerdrReviewFeedback {
  text: string;
  deliveredReview?: DeliveredReview;
}

interface ReviewEntry {
  type?: unknown;
  customType?: unknown;
  data?: {
    reviewFile?: unknown;
    sourcePath?: unknown;
    sourceDigest?: unknown;
    label?: unknown;
    paneId?: unknown;
    dataDir?: unknown;
  };
}

export function formatHerdrReviewFeedback(
  text: string,
  branch: readonly unknown[],
): HerdrReviewFeedback | undefined {
  const file = /^# Annotations on ([a-z0-9._-]+-review-[0-9a-f-]{36}\.md)\r?(?:\n|$)/i.exec(
    text,
  )?.[1];
  if (!file) return undefined;
  const record = [...branch].reverse().find((raw) => {
    const entry = raw as ReviewEntry;
    return (
      entry.type === "custom" &&
      entry.customType === REVIEW_ENTRY_TYPE &&
      entry.data?.reviewFile === file
    );
  }) as ReviewEntry | undefined;
  const data = record?.data;
  if (!data || typeof data.label !== "string") {
    return {
      text: `This review could not be matched to this Pi branch. Confirm the source with the reviewer before changing any file.\n\n${text}`,
    };
  }
  const sourcePath = typeof data.sourcePath === "string" ? data.sourcePath : undefined;
  const sourceDigest = typeof data.sourceDigest === "string" ? data.sourceDigest : undefined;
  const stale = reviewSourceChanged({ sourcePath, sourceDigest });
  return {
    text: `Review of ${data.label}${stale ? " (the source changed since review began; recheck before applying feedback)" : ""}:\n\n${text}`,
    deliveredReview:
      typeof data.paneId === "string" && typeof data.dataDir === "string"
        ? { reviewFile: file, paneId: data.paneId, dataDir: data.dataDir }
        : undefined,
  };
}
