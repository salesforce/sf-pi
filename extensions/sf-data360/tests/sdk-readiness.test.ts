/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/actions/dispatcher.ts", () => ({
  runData360Action: vi.fn(async () => ({
    ok: true,
    action: "readiness.probe",
    state: "partial",
    probes: [
      { name: "data_spaces", state: "enabled_populated" },
      { name: "dmo_catalog", state: "enabled_populated" },
      { name: "data_kits", state: "cli_error", message: "HTTP 500" },
      { name: "personalization_org", state: "feature_gated", message: "HTTP 403" },
      { name: "agent_platform_tracing_dlo", state: "not_found", message: "HTTP 404" },
    ],
    summary: "Data 360 readiness: partial",
  })),
}));

vi.mock("../lib/query-v3.ts", () => ({
  isQueryV3Action: () => false,
  runQueryV3: vi.fn(async () => {
    throw new Error("Data 360 token exchange failed HTTP 400: invalid_scope");
  }),
  runDirectData360Request: vi.fn(),
}));

vi.mock("../lib/actions/ingest/auth.ts", () => ({
  listData360TenantTokenSessions: vi.fn(() => []),
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

describe("sf_data360 readiness capability matrix", () => {
  it("reports transport and phase-specific gaps instead of overstating ready", async () => {
    const result = await runSfData360Action(
      { action: "discover.readiness.probe", target_org: "ExampleData360Org", params: {} },
      env,
      ctx,
    );

    expect(result).toMatchObject({
      state: "partial",
      readiness: "partial",
      capabilities: expect.arrayContaining([
        expect.objectContaining({ name: "connect_api", state: "ready" }),
        expect.objectContaining({
          name: "query_api_v3",
          state: "blocked",
          reason: expect.stringContaining("invalid_scope"),
        }),
        expect.objectContaining({ name: "ingestion_api", state: "auth_required" }),
        expect.objectContaining({ name: "agent_platform_tracing", state: "unavailable" }),
        expect.objectContaining({ name: "personalization", state: "feature_gated" }),
        expect.objectContaining({ name: "data_kits", state: "platform_error" }),
      ]),
      missingSurfaces: expect.arrayContaining([
        "Query API V3",
        "Ingestion API",
        "Agent Platform Tracing",
        "Personalization",
        "DataKits",
      ]),
    });
  });
});
