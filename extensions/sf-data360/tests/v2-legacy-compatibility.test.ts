/* SPDX-License-Identifier: Apache-2.0 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const orgCreateMock = vi.fn();
const requestMock = vi.fn();

vi.mock("@salesforce/core", () => ({
  Org: { create: (opts: unknown) => orgCreateMock(opts) },
}));

import { clearConnectionCache } from "../../../lib/common/sf-conn/connection.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { runData360V2Action } from "../lib/v2/dispatcher.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.136.8" },
  project: { detected: true, sourceApiVersion: "67.0" },
  config: { hasTargetOrg: true, targetOrg: "AgentforceSTDM", location: "Global" },
  org: {
    detected: true,
    alias: "AgentforceSTDM",
    username: "agentforce@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "67.0",
  },
  detectedAt: 1,
};

const ctx = { hasUI: false } as never;

describe("Data 360 v2 legacy affordance compatibility", () => {
  beforeEach(() => {
    clearConnectionCache();
    requestMock.mockReset();
    orgCreateMock.mockReset();
    orgCreateMock.mockResolvedValue({ getConnection: () => ({ request: requestMock }) });
  });

  it("covers d360_probe with data360_discover readiness.probe", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "readiness.probe",
        target_org: "AgentforceSTDM",
        dry_run: true,
      },
      env,
      ctx,
      undefined,
    );
    expect(result).toMatchObject({ ok: true, tool: "data360_discover", action: "readiness.probe" });
  });

  it("covers d360 search/examples with catalog search and v2 examples", async () => {
    const search = await runData360V2Action(
      { tool: "data360_discover", action: "catalog.search", params: { query: "dmo mapping" } },
      env,
      ctx,
      undefined,
    );
    expect(search.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "data360_harmonize", action: "dmo_mapping.list" }),
      ]),
    );

    const example = await runData360V2Action(
      {
        tool: "data360_discover",
        action: "examples.get",
        params: { tool: "data360_harmonize", action: "dmo.create", variant: "profile" },
      },
      env,
      ctx,
      undefined,
    );
    expect(example).toMatchObject({ ok: true, capability: "d360_dmo_create" });
  });

  it("covers d360_metadata list_dmos with compact data360_harmonize dmo.list", async () => {
    requestMock.mockResolvedValue({
      metadata: [
        { category: "Profile", displayName: "Account", name: "ssot__Account__dlm" },
        { category: "Engagement", displayName: "Event", name: "Event__dlm" },
      ],
    });

    const result = await runData360V2Action(
      {
        tool: "data360_harmonize",
        action: "dmo.list",
        target_org: "AgentforceSTDM",
        params: { category: "Profile" },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({ ok: true, action: "dmo.list", count: 1, unfilteredCount: 2 });
    expect(result.text).toContain("Found 1 DMOs in category Profile");
    expect(result.text).toContain("ssot__Account__dlm");
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/services/data/v67.0/ssot/metadata-entities?entityType=DataModelObject",
      }),
    );
  });

  it("covers d360_metadata describe_dlo with compact data360_prepare dlo.get", async () => {
    requestMock.mockResolvedValue({
      dataLakeObjects: [
        {
          label: "Example Lake Object",
          name: "Example__dll",
          fields: [{ name: "Id__c", dataType: "Text" }],
        },
      ],
    });

    const result = await runData360V2Action(
      {
        tool: "data360_prepare",
        action: "dlo.get",
        target_org: "AgentforceSTDM",
        params: { dloName: "Example__dll", max_fields: 2 },
      },
      env,
      ctx,
      undefined,
    );

    expect(result).toMatchObject({
      ok: true,
      action: "dlo.get",
      apiName: "Example__dll",
      fieldCount: 1,
    });
    expect(result.text).toContain("Example Lake Object");
    expect(result.text).toContain("Id__c");
  });

  it("covers d360_api with data360_api rest.request dry-run", async () => {
    const result = await runData360V2Action(
      {
        tool: "data360_api",
        action: "rest.request",
        target_org: "AgentforceSTDM",
        dry_run: true,
        params: { method: "GET", path: "/ssot/data-streams" },
      },
      env,
      ctx,
      undefined,
    );
    expect(result).toMatchObject({
      ok: true,
      request: { method: "GET", path: "/services/data/v67.0/ssot/data-streams" },
    });
  });
});
