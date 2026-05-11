/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Integration tests for the dispatch flow.
 *
 * Wires `checkActionTargets` to a fake Connection that responds with
 * scheme-specific rows, then asserts the aggregated
 * `CheckActionTargetsResult` carries the right per-target verdicts.
 */

import { describe, expect, it, vi } from "vitest";
import type { Connection } from "@salesforce/core";
import { checkActionTargets } from "../../lib/preflight/index.ts";
import type { ComponentSummary } from "../../lib/inspect.ts";

/**
 * Build a Connection that returns rows based on which sObject the SOQL
 * referenced (parsed out of the URL). Resolvers that miss the sObject
 * lookup get `[]` and produce missing/unverifiable verdicts.
 */
function fakeConn(byObject: Record<string, Array<Record<string, string>>>) {
  const handler = vi.fn(async (options: { url: string }) => {
    const url = decodeURIComponent(options.url);
    for (const [sobject, rows] of Object.entries(byObject)) {
      if (url.includes(`FROM ${sobject}`)) return { records: rows };
    }
    return { records: [] };
  });
  return { request: handler } as unknown as Connection;
}

describe("checkActionTargets dispatch", () => {
  it("routes flow + apex + agentforce + externalService through their resolvers", async () => {
    const conn = fakeConn({
      FlowDefinitionView: [{ ApiName: "Foo" }],
      ApexClass: [{ Name: "Bar" }],
      BotDefinition: [{ DeveloperName: "Sub_Agent" }],
      ExternalServiceRegistration: [{ DeveloperName: "Svc" }],
    });
    const actions: ComponentSummary[] = [
      { name: "a", target: "flow://Foo" },
      { name: "b", target: "apex://Bar" },
      { name: "c", target: "agentforce://Sub_Agent" },
      { name: "d", target: "externalService://Svc" },
    ];
    const result = await checkActionTargets(conn, actions);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(4);
    expect(result.missing).toBe(0);
    expect(result.unverifiable).toBe(0);
    for (const t of result.targets) {
      expect(t.status).toBe("ok");
      expect(t.metadata_label).toBeTruthy();
    }
  });

  it("flags missing names per resolver, allows partial pass", async () => {
    const conn = fakeConn({
      FlowDefinitionView: [{ ApiName: "Found" }],
      ApexClass: [],
    });
    const result = await checkActionTargets(conn, [
      { name: "ok_flow", target: "flow://Found" },
      { name: "miss_flow", target: "flow://Missing" },
      { name: "miss_apex", target: "apex://Foo" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(false);
    expect(result.resolved).toBe(1);
    expect(result.missing).toBe(2);
    const byName = new Map(result.targets.map((t) => [t.name, t]));
    expect(byName.get("ok_flow")?.status).toBe("ok");
    expect(byName.get("miss_flow")?.status).toBe("missing");
    expect(byName.get("miss_flow")?.metadata_label).toBe("Flow");
    expect(byName.get("miss_apex")?.status).toBe("missing");
    expect(byName.get("miss_apex")?.metadata_label).toBe("ApexClass");
  });

  it("standardInvocableAction:// always resolves without a network call", async () => {
    const conn = fakeConn({});
    const result = await checkActionTargets(conn, [
      { name: "x", target: "standardInvocableAction://emailSimple" },
      { name: "y", target: "https://example.com/webhook" },
      { name: "z", target: "mcp://server-ping" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(3);
    expect(result.missing).toBe(0);
  });

  it("placeholder:// always counts as missing (matches compiler warning)", async () => {
    const conn = fakeConn({});
    const result = await checkActionTargets(conn, [
      { name: "stub", target: "placeholder://TODO" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(false);
    expect(result.missing).toBe(1);
    expect(result.targets[0].status).toBe("missing");
    expect(result.targets[0].metadata_label).toBe("Placeholder (compiler stub)");
  });

  it("unknown schemes are reported as unverifiable but don't block", async () => {
    const conn = fakeConn({});
    const result = await checkActionTargets(conn, [
      { name: "x", target: "futureScheme://Foo" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(true);
    expect(result.unverifiable).toBe(1);
    expect(result.targets[0].status).toBe("unverifiable");
    expect(result.targets[0].detail).toMatch(/no resolver registered/);
  });

  it("dedups bucketed queries — same scheme + same name only emits one IN-list entry", async () => {
    const handler = vi.fn(async () => ({ records: [{ ApiName: "X" }] }));
    const conn = { request: handler } as unknown as Connection;
    const result = await checkActionTargets(conn, [
      { name: "a", target: "flow://X" },
      { name: "b", target: "flow://X" },
      { name: "c", target: "flow://X" },
    ] as ComponentSummary[]);
    expect(result.resolved).toBe(3);
    expect(handler).toHaveBeenCalledTimes(1);
    const firstCall = handler.mock.calls[0] as unknown as Array<{ url: string }>;
    const url = decodeURIComponent(firstCall[0].url);
    const occurrences = (url.match(/'X'/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
