/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the shared SF Docs status store. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDocsStatusStoreForTests,
  clearDocsStatus,
  getDocsStatus,
  setDocsStatus,
  subscribeDocsStatus,
} from "../docs-status/store.ts";

describe("docs status store", () => {
  afterEach(() => {
    __resetDocsStatusStoreForTests();
  });

  it("stores snapshots and stamps updatedAt", () => {
    setDocsStatus({ kind: "ready" });

    expect(getDocsStatus()).toMatchObject({ kind: "ready" });
    expect(getDocsStatus().updatedAt).toBeTruthy();
  });

  it("notifies subscribers and clears to hidden", () => {
    const listener = vi.fn();
    subscribeDocsStatus(listener);

    setDocsStatus({ kind: "setup" });
    clearDocsStatus();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getDocsStatus()).toEqual({ kind: "hidden" });
  });
});
