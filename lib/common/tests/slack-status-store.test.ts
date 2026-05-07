/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the shared Slack status store. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetSlackStatusStoreForTests,
  clearSlackStatus,
  getSlackStatus,
  setSlackStatus,
  subscribeSlackStatus,
} from "../slack-status/store.ts";

describe("slack status store", () => {
  afterEach(() => {
    __resetSlackStatusStoreForTests();
  });

  it("stores snapshots and stamps updatedAt", () => {
    setSlackStatus({ kind: "ready", userName: "agent", grantedScopes: 3, requestedScopes: 3 });

    expect(getSlackStatus()).toMatchObject({
      kind: "ready",
      userName: "agent",
      grantedScopes: 3,
      requestedScopes: 3,
    });
    expect(getSlackStatus().updatedAt).toBeTruthy();
  });

  it("notifies subscribers and clears to hidden", () => {
    const listener = vi.fn();
    subscribeSlackStatus(listener);

    setSlackStatus({ kind: "partial-grant", missingScopes: 2 });
    clearSlackStatus();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(getSlackStatus()).toEqual({ kind: "hidden" });
  });
});
