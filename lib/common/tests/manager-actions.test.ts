/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Manager Surface action registry. */
import { describe, expect, it, vi } from "vitest";
import {
  getManagerDetailActions,
  registerManagerDetailActions,
  runManagerDetailAction,
} from "../manager-actions.ts";

describe("manager detail actions", () => {
  it("registers and runs extension-owned actions", async () => {
    const run = vi.fn();
    const ctx = {} as never;

    registerManagerDetailActions("test-extension", [
      { id: "audit", label: "Audit", description: "Show audit", run },
    ]);

    expect(getManagerDetailActions("test-extension")).toMatchObject([
      { id: "audit", label: "Audit", description: "Show audit" },
    ]);
    await expect(runManagerDetailAction("test-extension", "audit", ctx)).resolves.toBe(true);
    expect(run).toHaveBeenCalledWith(ctx);
  });

  it("returns false for unknown actions", async () => {
    await expect(runManagerDetailAction("missing-extension", "audit", {} as never)).resolves.toBe(
      false,
    );
  });
});
