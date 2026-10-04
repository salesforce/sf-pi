/* SPDX-License-Identifier: Apache-2.0 */
/** Fail-fast validation for refs published by the latest session-scoped snapshot. */
import {
  findLatestBrowserSnapshotRefLookup,
  type BrowserSnapshotRefEntry,
  type BrowserSnapshotRefLookup,
} from "../../../lib/common/sf-browser-snapshot-state.ts";

export function requireFreshBrowserRef(
  sessionId: string | undefined,
  ref: string,
): BrowserSnapshotRefEntry {
  return assertFreshBrowserRefLookup(findLatestBrowserSnapshotRefLookup(sessionId, ref), ref);
}

export function assertFreshBrowserRefLookup(
  lookup: BrowserSnapshotRefLookup,
  ref: string,
): BrowserSnapshotRefEntry {
  if (lookup.status === "fresh" && lookup.ref) return lookup.ref;
  if (lookup.status === "stale") {
    throw new Error(
      `SF Browser ref ${ref} is stale because the page changed or the snapshot expired. Run sf_browser_snapshot and retry with a fresh ref.`,
    );
  }
  if (lookup.status === "missing-session") {
    throw new Error(
      `There is no current sf_browser_snapshot for this Pi session. Run sf_browser_snapshot before using ref ${ref}.`,
    );
  }
  throw new Error(
    `Ref ${ref} was not published by the latest sf_browser_snapshot. Snapshot the current page and use one of its refs.`,
  );
}
