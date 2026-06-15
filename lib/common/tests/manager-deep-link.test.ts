/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Manager Surface deep-link event helper. */
import { describe, expect, it } from "vitest";
import {
  openExtensionInManager,
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../manager-deep-link.ts";

describe("openExtensionInManager", () => {
  it("emits the manager open event and resolves when accepted", async () => {
    let seen: SfPiManagerOpenRequest | undefined;
    const pi = {
      events: {
        emit(eventName: string, request: SfPiManagerOpenRequest) {
          expect(eventName).toBe(SF_PI_MANAGER_OPEN_EVENT);
          seen = request;
          request.accept?.();
          request.resolve?.();
        },
      },
    };
    const ctx = {} as never;

    await expect(
      openExtensionInManager(pi, ctx, { extensionId: "sf-guardrail", view: "settings" }),
    ).resolves.toBe(true);
    expect(seen?.ctx).toBe(ctx);
    expect(seen?.route).toEqual({ extensionId: "sf-guardrail", view: "settings" });
  });

  it("returns false when no manager listener accepts the event", async () => {
    const pi = { events: { emit() {} } };

    await expect(
      openExtensionInManager(pi, {} as never, { extensionId: "sf-guardrail", view: "detail" }),
    ).resolves.toBe(false);
  });
});
