/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { verifyBuilder, type BuilderVerifyAdapter } from "../lib/builder-verify.ts";

const timing = { pollMs: 1, deadlineMs: 2000, stableReads: 2 };

function session(record?: { DurableId: string; VersionNumber: number; Status: string }) {
  const query = vi.fn().mockResolvedValue({ records: record ? [record] : [] });
  return {
    session: {
      target: { alias: "dev", targetOrg: "dev", apiVersion: "68.0" },
      connection: { instanceUrl: "https://example.my.salesforce.com" },
      query,
    } as never,
    query,
  };
}

const VERSION = { DurableId: "301000000000001AAA", VersionNumber: 2, Status: "Draft" };

function adapter(snapshots: string[]): BuilderVerifyAdapter & { opened: string[] } {
  const opened: string[] = [];
  let index = 0;
  return {
    opened,
    async open(url) {
      opened.push(url);
    },
    async snapshot() {
      return snapshots[Math.min(index++, snapshots.length - 1)] ?? "";
    },
  };
}

const params = {
  action: "builder.verify" as const,
  target_org: "dev",
  flow_name: "Catalog_Picker",
};

describe("SF Flow builder.verify", () => {
  it("reports zero errors from the Errors panel toggle", async () => {
    const { session: s } = session(VERSION);
    const panel =
      '- button "Save As New Version" [ref=e5]\n- button "Show errors panel" [expanded=false, ref=e83]';
    const browser = adapter([panel, panel]);
    const result = await verifyBuilder({} as never, params, process.cwd(), s, {
      adapter: browser,
      timing,
    });
    expect(browser.opened).toEqual([
      "https://example.my.salesforce.com/builder_platform_interaction/flowBuilder.app?flowId=301000000000001AAA",
    ]);
    expect(result.details).toMatchObject({ ok: true, errors: 0, ready: true, version_number: 2 });
  });

  it("parses plural and singular error counts", async () => {
    const { session: s } = session(VERSION);
    const ten = await verifyBuilder({} as never, params, process.cwd(), s, {
      adapter: adapter(['- button "Show 10 errors" [ref=e1]']),
    });
    const one = await verifyBuilder({} as never, params, process.cwd(), s, {
      adapter: adapter(['- button "Show 1 error" [ref=e1]']),
    });
    expect(ten.details).toMatchObject({ ok: false, errors: 10, ready: false });
    expect(one.details).toMatchObject({ ok: false, errors: 1 });
  });

  it("waits for the canvas before reading the panel", async () => {
    const { session: s } = session(VERSION);
    const browser = adapter(['- heading "Loading"', '- button "Show 2 errors" [ref=e9]']);
    const result = await verifyBuilder({} as never, params, process.cwd(), s, {
      adapter: browser,
      timing,
    });
    expect(result.details).toMatchObject({ errors: 2 });
  });

  it("resolves an exact version number when one is requested", async () => {
    const { session: s, query } = session(VERSION);
    const panel = '- button "Activate" [ref=e2]\n- button "Show errors panel" [ref=e1]';
    await verifyBuilder({} as never, { ...params, version: 2 }, process.cwd(), s, {
      adapter: adapter([panel, panel]),
      timing,
    });
    expect(query.mock.calls[0]?.[0].soql).toContain("VersionNumber = 2");
  });

  it("refuses unknown flows and invalid names", async () => {
    const { session: missing } = session();
    await expect(
      verifyBuilder({} as never, params, process.cwd(), missing, { adapter: adapter([]), timing }),
    ).rejects.toThrow("Flow not found");
    await expect(
      verifyBuilder({} as never, { ...params, flow_name: "bad name" }, process.cwd(), missing, {
        adapter: adapter(['- button "Show errors panel"']),
      }),
    ).rejects.toThrow("exact Flow API name");
  });
});
