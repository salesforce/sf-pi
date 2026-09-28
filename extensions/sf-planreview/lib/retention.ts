/* SPDX-License-Identifier: Apache-2.0 */
/** Clear only delivered Herdr reviews whose review pane is confirmed closed. */
import type { PlannotatorExec } from "../../../lib/common/plannotator-runtime.ts";
import { cleanupReviewSnapshot } from "./review.ts";

export const REVIEW_DELIVERED_TYPE = "sf-planreview-delivered";

export interface DeliveredReview {
  reviewFile: string;
  paneId: string;
  dataDir: string;
}

export function deliveredReviewsOnBranch(branch: readonly unknown[]): DeliveredReview[] {
  const reviews = new Map<string, DeliveredReview>();
  for (const raw of branch) {
    const entry = raw as { type?: unknown; customType?: unknown; data?: Record<string, unknown> };
    if (entry.type !== "custom" || entry.customType !== REVIEW_DELIVERED_TYPE) continue;
    const { reviewFile, paneId, dataDir } = entry.data ?? {};
    if (
      typeof reviewFile === "string" &&
      typeof paneId === "string" &&
      typeof dataDir === "string"
    ) {
      reviews.set(reviewFile, { reviewFile, paneId, dataDir });
    }
  }
  return [...reviews.values()];
}

export async function cleanupClosedReviews(
  exec: PlannotatorExec,
  pending: Map<string, DeliveredReview>,
): Promise<void> {
  let panes: unknown;
  try {
    const result = await exec("herdr", ["pane", "list"], { timeout: 2_000 });
    if (result.code !== 0) return;
    panes = (JSON.parse(result.stdout) as { result?: { panes?: unknown } }).result?.panes;
  } catch {
    return;
  }
  if (
    !Array.isArray(panes) ||
    !panes.every((pane) => pane && typeof pane === "object" && typeof pane.pane_id === "string")
  )
    return;
  const open = new Set(panes.map((pane: { pane_id: string }) => pane.pane_id));
  for (const [reviewFile, review] of pending) {
    if (open.has(review.paneId)) continue;
    cleanupReviewSnapshot(review);
    pending.delete(reviewFile);
  }
}
