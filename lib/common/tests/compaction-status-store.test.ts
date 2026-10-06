/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetCompactionStatusStoreForTests,
  getCompactionStatus,
  setCompactionStatus,
  subscribeCompactionStatus,
} from "../compaction-status/store.ts";

afterEach(() => {
  __resetCompactionStatusStoreForTests();
});

describe("compaction status store", () => {
  it("shares the latest render-safe snapshot with subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCompactionStatus(listener);

    setCompactionStatus({
      kind: "dedicated",
      model: "sf-llm-gateway/example-model",
      modelLabel: "Example Model",
      contextWindow: 1_000_000,
      source: "global",
    });

    expect(getCompactionStatus()).toMatchObject({
      kind: "dedicated",
      model: "sf-llm-gateway/example-model",
      contextWindow: 1_000_000,
    });
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });
});
