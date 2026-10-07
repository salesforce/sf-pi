/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/query-v3.ts", () => ({
  isQueryV3Action: (action: string) => action === "query.sql.run",
  runQueryV3: vi.fn(async () => {
    throw new Error("Data 360 token exchange failed HTTP 400: invalid_scope");
  }),
  runDirectData360Request: vi.fn(),
}));

import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runSfData360Action } from "../lib/sdk.ts";

const env = {
  cli: { installed: true },
  project: { detected: false, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "ExampleData360Org" },
  org: { detected: true, alias: "ExampleData360Org", orgType: "sandbox", apiVersion: "67.0" },
  detectedAt: 1,
} as SfEnvironment;

const ctx = { cwd: process.cwd(), hasUI: false } as never;

describe("sf_data360 strict Query API V3 failure", () => {
  it("returns a failed Query API V3 result instead of inventing a Connect transport", async () => {
    await expect(
      runSfData360Action(
        {
          action: "query.sql.run",
          target_org: "ExampleData360Org",
          params: { sql: "SELECT 1", transport: "query_v3" },
        },
        env,
        ctx,
      ),
    ).resolves.toMatchObject({
      ok: false,
      action: "query.sql.run",
      namespace: "query",
      transport: "query-v3",
      error: expect.stringContaining("invalid_scope"),
    });
  });
});
