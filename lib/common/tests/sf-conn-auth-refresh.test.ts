/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for shared per-Connection authentication refresh coordination. */

import type { Connection } from "@salesforce/core";
import { describe, expect, test, vi } from "vitest";

import { refreshSalesforceConnectionAuth } from "../sf-conn/auth-refresh.ts";

describe("refreshSalesforceConnectionAuth", () => {
  test("keeps callers on the in-flight refresh after the token changes", async () => {
    let releaseRefresh!: () => void;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const connection = {
      accessToken: "OLD",
      refreshAuth: vi.fn().mockImplementation(async function (this: { accessToken: string }) {
        this.accessToken = "NEW";
        await refreshGate;
      }),
    } as unknown as Connection;

    const first = refreshSalesforceConnectionAuth(connection, "OLD");
    await vi.waitFor(() => {
      expect(
        (connection as unknown as { refreshAuth: ReturnType<typeof vi.fn> }).refreshAuth,
      ).toHaveBeenCalledTimes(1);
      expect((connection as unknown as { accessToken: string }).accessToken).toBe("NEW");
    });
    const second = refreshSalesforceConnectionAuth(connection, "OLD");

    expect(second).toBe(first);
    let secondSettled = false;
    void second?.finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    expect(secondSettled).toBe(false);

    releaseRefresh();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(
      (connection as unknown as { refreshAuth: ReturnType<typeof vi.fn> }).refreshAuth,
    ).toHaveBeenCalledTimes(1);
  });
});
