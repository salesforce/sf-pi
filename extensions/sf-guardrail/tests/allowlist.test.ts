/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { forgetSession, grant, isAllowed, restore } from "../lib/allowlist.ts";
import { ALLOW_ENTRY_TYPE, ALLOW_REVOKE_ENTRY_TYPE } from "../lib/types.ts";

type PiForGrant = Parameters<typeof grant>[0];
type CtxForRestore = Parameters<typeof restore>[0];

function pi(entries: unknown[]): PiForGrant {
  return {
    appendEntry: (customType: string, data: unknown) => {
      entries.push({ type: "custom", customType, data });
    },
  } as unknown as PiForGrant;
}

function ctx(entries: unknown[]): CtxForRestore {
  return {
    sessionManager: {
      getEntries: () => entries,
    },
  } as unknown as CtxForRestore;
}

describe("allowlist", () => {
  it("restores allows from native Pi session entries", () => {
    const entries: unknown[] = [];
    grant(pi(entries), "rule", "fingerprint");
    restore(ctx(entries));
    expect(isAllowed("rule", "fingerprint")).toBe(true);
    expect((entries[0] as { customType: string }).customType).toBe(ALLOW_ENTRY_TYPE);
  });

  it("revocation tombstone prevents older allows from restoring", () => {
    const entries = [
      {
        type: "custom",
        customType: ALLOW_ENTRY_TYPE,
        data: { ruleId: "rule", fingerprint: "old", grantedAt: 1 },
      },
      {
        type: "custom",
        customType: ALLOW_REVOKE_ENTRY_TYPE,
        data: { revokedAt: 2 },
      },
    ];
    restore(ctx(entries));
    expect(isAllowed("rule", "old")).toBe(false);
  });

  it("forget appends a revocation marker", () => {
    const entries: unknown[] = [];
    forgetSession(pi(entries));
    expect((entries[0] as { customType: string }).customType).toBe(ALLOW_REVOKE_ENTRY_TYPE);
  });
});
