/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import {
  DEFAULT_TRACE_MINUTES,
  MAX_TRACE_MINUTES,
  startTrace,
  stopTrace,
  traceStatus,
} from "../lib/trace.ts";
import type { SfApexSessionState } from "../lib/types.ts";

const USER_ID = "005000000000001AAA";
const DEBUG_LEVEL_ID = "7dl000000000001AAA";
const MANAGED_TRACE_ID = "7tf000000000001AAA";
const EXTERNAL_TRACE_ID = "7tf000000000002AAA";
const FUTURE = "2099-01-01T00:00:00.000Z";

interface FakeTraceState {
  debugLevels: Array<Record<string, unknown>>;
  traceFlags: Array<Record<string, unknown>>;
  patchIds: string[];
  deleteIds: string[];
  hideCreatedTraceFromReadback?: boolean;
}

describe("trace defaults", () => {
  it("keeps trace windows bounded", () => {
    expect(DEFAULT_TRACE_MINUTES).toBe(30);
    expect(MAX_TRACE_MINUTES).toBe(120);
  });
});

describe("managed trace lifecycle", () => {
  it("refuses to replace an external active trace", async () => {
    const state = fakeState({ traceFlags: [externalTrace()] });
    const sessionState: SfApexSessionState = {};

    await expect(
      startTrace(
        fakeSession(state),
        { action: "trace.start", target_org: "ExampleOrg", duration_minutes: 10 },
        sessionState,
      ),
    ).rejects.toThrow("external active trace flag");

    expect(state.patchIds).toEqual([]);
    expect(state.traceFlags).toEqual([externalTrace()]);
    expect(sessionState.lastTraceFlagIds).toBeUndefined();
  });

  it("refreshes only the managed trace", async () => {
    const state = fakeState({ traceFlags: [managedTrace(), externalTrace()] });

    const result = await startTrace(fakeSession(state), {
      action: "trace.start",
      target_org: "ExampleOrg",
      duration_minutes: 10,
    });

    expect(result.details.ok).toBe(true);
    expect(state.patchIds).toEqual([MANAGED_TRACE_ID]);
    expect(state.traceFlags.find((row) => row.Id === EXTERNAL_TRACE_ID)?.ExpirationDate).toBe(
      FUTURE,
    );
    expect(result.details.trace_flag).toMatchObject({ Id: MANAGED_TRACE_ID });
  });

  it("stops only the session-owned managed trace and preserves external traces", async () => {
    const state = fakeState({ traceFlags: [managedTrace(), externalTrace()] });
    const sessionState: SfApexSessionState = { lastTraceFlagIds: [MANAGED_TRACE_ID] };

    const result = await stopTrace(
      fakeSession(state),
      { action: "trace.stop", target_org: "ExampleOrg" },
      sessionState,
    );

    expect(state.deleteIds).toEqual([MANAGED_TRACE_ID]);
    expect(state.traceFlags.map((row) => row.Id)).toEqual([EXTERNAL_TRACE_ID]);
    expect(result.details.verification).toMatchObject({
      status: "verified",
      observed: { remaining_managed: 0, external_preserved: 1 },
    });
    expect(sessionState.lastTraceFlagIds).toEqual([]);
  });

  it("falls back to stopping all managed traces after session state is lost", async () => {
    const secondManagedId = "7tf000000000003AAA";
    const state = fakeState({
      traceFlags: [managedTrace(), { ...managedTrace(), Id: secondManagedId }, externalTrace()],
    });

    await stopTrace(fakeSession(state), { action: "trace.stop", target_org: "ExampleOrg" });

    expect(state.deleteIds.sort()).toEqual([MANAGED_TRACE_ID, secondManagedId].sort());
    expect(state.traceFlags.map((row) => row.Id)).toEqual([EXTERNAL_TRACE_ID]);
  });

  it("partitions managed and external trace flags in status", async () => {
    const state = fakeState({ traceFlags: [managedTrace(), externalTrace()] });

    const result = await traceStatus(fakeSession(state), {
      action: "trace.status",
      target_org: "ExampleOrg",
    });

    expect(result.details.active_trace_flags).toHaveLength(1);
    expect(result.details.external_active_trace_flags).toHaveLength(1);
    expect(result.content[0]?.text).toContain("Managed Apex trace flags: 1");
  });

  it("rejects invalid trace durations before mutation", async () => {
    const state = fakeState();

    await expect(
      startTrace(fakeSession(state), {
        action: "trace.start",
        target_org: "ExampleOrg",
        duration_minutes: 0,
      }),
    ).rejects.toThrow("duration_minutes must be an integer from 1 to 120");

    expect(state.patchIds).toEqual([]);
    expect(state.traceFlags).toEqual([]);
  });

  it("fails when a created trace cannot be read back", async () => {
    const state = fakeState({ hideCreatedTraceFromReadback: true });

    await expect(
      startTrace(fakeSession(state), {
        action: "trace.start",
        target_org: "ExampleOrg",
        duration_minutes: 10,
      }),
    ).rejects.toThrow("trace verification failed");
  });

  it("creates and reads back the managed debug level when absent", async () => {
    const state = fakeState({ debugLevels: [] });

    const result = await startTrace(fakeSession(state), {
      action: "trace.start",
      target_org: "ExampleOrg",
      duration_minutes: 10,
    });

    expect(state.debugLevels).toHaveLength(1);
    expect(result.details.debug_level).toMatchObject({
      Id: DEBUG_LEVEL_ID,
      DeveloperName: "SF_PI_APEX",
      ApexCode: "FINEST",
    });
  });

  it("reports observed settings for an existing managed debug level", async () => {
    const state = fakeState({
      debugLevels: [managedDebugLevel({ ApexCode: "DEBUG", Database: "WARN" })],
    });

    const result = await startTrace(fakeSession(state), {
      action: "trace.start",
      target_org: "ExampleOrg",
      duration_minutes: 10,
    });

    expect(result.details.debug_level).toMatchObject({
      Id: DEBUG_LEVEL_ID,
      ApexCode: "DEBUG",
      Database: "WARN",
    });
  });
});

function fakeState(overrides: Partial<FakeTraceState> = {}): FakeTraceState {
  return {
    debugLevels: [managedDebugLevel()],
    traceFlags: [],
    patchIds: [],
    deleteIds: [],
    ...overrides,
  };
}

function managedDebugLevel(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: DEBUG_LEVEL_ID,
    DeveloperName: "SF_PI_APEX",
    MasterLabel: "SF_PI_APEX",
    ApexCode: "FINEST",
    ApexProfiling: "INFO",
    Callout: "INFO",
    Database: "INFO",
    System: "DEBUG",
    Validation: "INFO",
    Visualforce: "INFO",
    Workflow: "INFO",
    ...overrides,
  };
}

function managedTrace(): Record<string, unknown> {
  return {
    Id: MANAGED_TRACE_ID,
    TracedEntityId: USER_ID,
    LogType: "DEVELOPER_LOG",
    DebugLevelId: DEBUG_LEVEL_ID,
    StartDate: "2026-01-01T00:00:00.000Z",
    ExpirationDate: FUTURE,
  };
}

function externalTrace(): Record<string, unknown> {
  return {
    Id: EXTERNAL_TRACE_ID,
    TracedEntityId: USER_ID,
    LogType: "DEVELOPER_LOG",
    DebugLevelId: "7dl000000000099AAA",
    StartDate: "2026-01-01T00:00:00.000Z",
    ExpirationDate: FUTURE,
  };
}

function fakeSession(state: FakeTraceState): SalesforceSession {
  const target = Object.freeze({
    targetOrg: "ExampleOrg",
    alias: "ExampleOrg",
    username: "user@example.invalid",
    orgId: "00D000000000001AAA",
    instanceUrl: "https://example.sandbox.my.salesforce.com",
    orgType: "sandbox" as const,
    apiVersion: "68.0",
    maxApiVersion: "68.0",
    versionSource: "org-latest" as const,
  });
  let createdTraceId: string | undefined;

  return {
    target,
    connection: {} as SalesforceSession["connection"],
    identity: vi.fn(async () => ({
      org_id: target.orgId,
      instance_url: target.instanceUrl,
      user_id: USER_ID,
    })),
    path: vi.fn((resource: string) => `/services/data/v68.0${resource}`),
    continueRequest: vi.fn() as SalesforceSession["continueRequest"],
    query: vi.fn(async ({ soql }: { soql: string }) => {
      let records: Array<Record<string, unknown>> = [];
      if (soql.includes("FROM DebugLevel")) {
        const id = soql.match(/WHERE Id = '([^']+)'/u)?.[1];
        records = id
          ? state.debugLevels.filter((row) => row.Id === id)
          : state.debugLevels.filter((row) => row.DeveloperName === "SF_PI_APEX");
      } else if (soql.includes("FROM TraceFlag")) {
        const id = soql.match(/WHERE Id = '([^']+)'/u)?.[1];
        records = state.traceFlags.filter(
          (row) =>
            (!id || row.Id === id) &&
            !(state.hideCreatedTraceFromReadback && row.Id === createdTraceId),
        );
      }
      return {
        records: structuredClone(records),
        totalSize: records.length,
        done: true,
        truncated: false,
        target,
      };
    }) as SalesforceSession["query"],
    request: vi.fn(async (input: { method: string; path: string; body?: unknown }) => {
      const id = input.path.split("/").pop();
      if (input.method === "POST" && input.path.endsWith("/TraceFlag")) {
        createdTraceId = "7tf000000000004AAA";
        state.traceFlags.push({ Id: createdTraceId, ...(input.body as Record<string, unknown>) });
        return {
          status: 201,
          path: input.path,
          body: { id: createdTraceId, success: true, errors: [] },
        };
      }
      if (input.method === "POST" && input.path.endsWith("/DebugLevel")) {
        const created = managedDebugLevel({ Id: DEBUG_LEVEL_ID, ...(input.body as object) });
        state.debugLevels.push(created);
        return {
          status: 201,
          path: input.path,
          body: { id: DEBUG_LEVEL_ID, success: true, errors: [] },
        };
      }
      if (input.method === "PATCH" && id) {
        state.patchIds.push(id);
        const row = state.traceFlags.find((candidate) => candidate.Id === id);
        if (row) Object.assign(row, input.body);
        return { status: 204, path: input.path, body: undefined };
      }
      if (input.method === "DELETE" && id) {
        state.deleteIds.push(id);
        state.traceFlags = state.traceFlags.filter((row) => row.Id !== id);
        return { status: 204, path: input.path, body: undefined };
      }
      throw new Error(`Unexpected request: ${input.method} ${input.path}`);
    }) as unknown as SalesforceSession["request"],
  };
}
