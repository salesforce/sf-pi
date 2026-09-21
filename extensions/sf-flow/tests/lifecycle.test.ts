/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  activateFlowVersion,
  deactivateFlow,
  deployAndActivateFlow,
  flowDefinitionSource,
  getFlowLifecycleStatus,
  stageActiveFlowSource,
  type FlowLifecycleAdapter,
} from "../lib/lifecycle.ts";

const flowFile = path.join(import.meta.dirname, "fixtures", "Autolaunched_Example.flow-meta.xml");

function session(orgType = "developer") {
  return {
    target: {
      alias: "FlowLifecycleDev",
      targetOrg: "FlowLifecycleDev",
      apiVersion: "67.0",
      orgType,
    },
  } as never;
}

function adapter(overrides: Partial<FlowLifecycleAdapter> = {}): FlowLifecycleAdapter {
  return {
    getDefinition: vi.fn().mockResolvedValue({
      ApiName: "Autolaunched_Example",
      IsActive: false,
      ActiveVersionId: null,
      LatestVersionId: "301LATEST",
      VersionNumber: 2,
      ProcessType: "AutoLaunchedFlow",
      TriggerType: null,
      RecordTriggerType: null,
    }),
    getVersion: vi.fn().mockResolvedValue({ VersionNumber: 2, Status: "Draft" }),
    getActiveVersion: vi.fn().mockResolvedValue(undefined),
    getScheduledJobs: vi.fn().mockResolvedValue([]),
    deploy: vi.fn().mockResolvedValue({
      id: "0Af000000000001",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    }),
    ...overrides,
  };
}

const artifacts = {
  writeArtifact: async (kind: string, filename: string) => ({ path: `/tmp/${filename}`, kind }),
};

describe("SF Flow lifecycle", () => {
  it("stages Active Flow source without changing unrelated metadata", () => {
    const source = "<Flow><status>Draft</status><label>Example</label></Flow>";

    expect(stageActiveFlowSource(source)).toBe(
      "<Flow><status>Active</status><label>Example</label></Flow>",
    );
    expect(() => stageActiveFlowSource("<Flow><label>Missing</label></Flow>")).toThrow(
      "exactly one Flow status",
    );
    expect(flowDefinitionSource(7)).toContain("<activeVersionNumber>7</activeVersionNumber>");
    expect(flowDefinitionSource(0)).toContain("<activeVersionNumber>0</activeVersionNumber>");
  });

  it("returns lifecycle status from the canonical adapter without mutation", async () => {
    const lifecycle = adapter({
      getDefinition: vi.fn().mockResolvedValue({
        ApiName: "Autolaunched_Example",
        IsActive: true,
        ActiveVersionId: "301ACTIVE",
        LatestVersionId: "301LATEST",
        VersionNumber: 4,
        ProcessType: "AutoLaunchedFlow",
        TriggerType: null,
        RecordTriggerType: null,
      }),
      getActiveVersion: vi.fn().mockResolvedValue({ VersionNumber: 3, Status: "Active" }),
    });

    const result = await getFlowLifecycleStatus(
      {
        action: "lifecycle.status",
        target_org: "FlowLifecycleDev",
        flow_name: "Autolaunched_Example",
      },
      session(),
      { adapter: lifecycle, ...artifacts },
    );

    expect(result.details).toMatchObject({
      ok: true,
      flow_name: "Autolaunched_Example",
      is_active: true,
      active_version: 3,
      latest_version: 4,
      mutation_performed: false,
    });
    expect(lifecycle.deploy).not.toHaveBeenCalled();
  });

  it("uses canonical REST FlowDefinitionView and FlowVersionView queries", async () => {
    const query = vi.fn().mockImplementation(async (input: { soql: string }) => {
      if (input.soql.includes("FROM FlowDefinitionView")) {
        return {
          records: [
            {
              ApiName: "Autolaunched_Example",
              IsActive: false,
              ActiveVersionId: null,
              LatestVersionId: "301LATEST",
              VersionNumber: 4,
              ProcessType: "AutoLaunchedFlow",
              TriggerType: null,
              RecordTriggerType: null,
            },
          ],
        };
      }
      return { records: [] };
    });
    const liveSession = {
      target: {
        alias: "FlowLifecycleDev",
        targetOrg: "FlowLifecycleDev",
        apiVersion: "67.0",
        orgType: "developer",
      },
      query,
    } as never;

    await getFlowLifecycleStatus(
      {
        action: "lifecycle.status",
        target_org: "FlowLifecycleDev",
        flow_name: "Autolaunched_Example",
      },
      liveSession,
      artifacts,
    );

    expect(query).toHaveBeenCalledTimes(3);
    for (const [input] of query.mock.calls) expect(input.api).toBe("rest");
    expect(query.mock.calls[0]?.[0].soql).toContain(
      "SELECT ApiName, Label, IsActive, ActiveVersionId, LatestVersionId, VersionNumber",
    );
    expect(query.mock.calls[0]?.[0].soql).not.toContain("DeveloperName");
    expect(query.mock.calls[1]?.[0].soql).toContain("FROM FlowVersionView");
  });

  it("check-validates, deploys, and verifies a temporary Active copy while preserving source", async () => {
    const before = await readFile(flowFile, "utf8");
    const deploy = vi.fn<FlowLifecycleAdapter["deploy"]>().mockResolvedValue({
      id: "0Af000000000002",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    });
    const lifecycle = adapter({
      deploy,
      getDefinition: vi.fn().mockResolvedValue({
        ApiName: "Autolaunched_Example",
        IsActive: true,
        ActiveVersionId: "301ACTIVE",
        LatestVersionId: "301ACTIVE",
        VersionNumber: 3,
        ProcessType: "AutoLaunchedFlow",
        TriggerType: null,
        RecordTriggerType: null,
      }),
      getActiveVersion: vi.fn().mockResolvedValue({ VersionNumber: 3, Status: "Active" }),
    });

    const result = await deployAndActivateFlow(
      {
        action: "deploy.activate",
        target_org: "FlowLifecycleDev",
        file: flowFile,
        allow_mutation: true,
      },
      process.cwd(),
      session(),
      { adapter: lifecycle, ...artifacts },
    );

    expect(deploy).toHaveBeenCalledTimes(2);
    expect(deploy.mock.calls.map(([input]) => input.check_only)).toEqual([true, false]);
    expect(deploy.mock.calls[0]?.[0]).toMatchObject({
      component_type: "Flow",
      full_name: "Autolaunched_Example",
    });
    expect(deploy.mock.calls[0]?.[0].source).toContain("<status>Active</status>");
    expect(await readFile(flowFile, "utf8")).toBe(before);
    expect(result.details).toMatchObject({
      ok: true,
      flow_name: "Autolaunched_Example",
      active_version: 3,
      deployment_performed: true,
      source_changed: false,
    });
  });

  it("does not deploy when Active check-only validation fails", async () => {
    const deploy = vi.fn<FlowLifecycleAdapter["deploy"]>().mockResolvedValueOnce({
      id: "0Af000000000003",
      success: false,
      status: "Failed",
      component_failures: [{ problem: "Active validation failed" }],
      raw: { success: false },
    });
    const lifecycle = adapter({ deploy });

    const result = await deployAndActivateFlow(
      {
        action: "deploy.activate",
        target_org: "FlowLifecycleDev",
        file: flowFile,
        allow_mutation: true,
      },
      process.cwd(),
      session(),
      { adapter: lifecycle, ...artifacts },
    );

    expect(deploy).toHaveBeenCalledTimes(1);
    expect(result.details).toMatchObject({ ok: false, deployment_performed: false });
    expect(result.content[0]?.text).toContain("Active validation failed");
  });

  it("activates one exact existing org version and verifies that exact version", async () => {
    const deploy = vi.fn<FlowLifecycleAdapter["deploy"]>().mockResolvedValue({
      id: "0Af000000000004",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    });
    const lifecycle = adapter({
      deploy,
      getVersion: vi.fn().mockResolvedValue({ VersionNumber: 2, Status: "Obsolete" }),
      getDefinition: vi.fn().mockResolvedValue({
        ApiName: "Autolaunched_Example",
        IsActive: true,
        ActiveVersionId: "301V2",
        LatestVersionId: "301LATEST",
        VersionNumber: 4,
        ProcessType: "AutoLaunchedFlow",
        TriggerType: null,
        RecordTriggerType: null,
      }),
      getActiveVersion: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({ VersionNumber: 2, Status: "Active" }),
    });

    const result = await activateFlowVersion(
      {
        action: "lifecycle.activate",
        target_org: "FlowLifecycleDev",
        flow_name: "Autolaunched_Example",
        version: 2,
        allow_mutation: true,
      },
      session(),
      { adapter: lifecycle, ...artifacts },
    );

    expect(deploy).toHaveBeenCalledTimes(2);
    expect(deploy.mock.calls[0]?.[0]).toMatchObject({
      component_type: "FlowDefinition",
      full_name: "Autolaunched_Example",
      check_only: true,
    });
    expect(deploy.mock.calls[0]?.[0].source).toContain(
      "<activeVersionNumber>2</activeVersionNumber>",
    );
    expect(result.details).toMatchObject({ ok: true, active_version: 2 });
  });

  it("deactivates deterministically and treats an inactive Flow as an idempotent no-op", async () => {
    const deploy = vi.fn<FlowLifecycleAdapter["deploy"]>().mockResolvedValue({
      id: "0Af000000000005",
      success: true,
      status: "Succeeded",
      component_failures: [],
      raw: { success: true },
    });
    const getDefinition = vi
      .fn<FlowLifecycleAdapter["getDefinition"]>()
      .mockResolvedValueOnce({
        ApiName: "Autolaunched_Example",
        IsActive: true,
        ActiveVersionId: "301ACTIVE",
        LatestVersionId: "301LATEST",
        VersionNumber: 4,
        ProcessType: "AutoLaunchedFlow",
        TriggerType: null,
        RecordTriggerType: null,
      })
      .mockResolvedValue({
        ApiName: "Autolaunched_Example",
        IsActive: false,
        ActiveVersionId: null,
        LatestVersionId: "301LATEST",
        VersionNumber: 4,
        ProcessType: "AutoLaunchedFlow",
        TriggerType: null,
        RecordTriggerType: null,
      });
    const lifecycle = adapter({ deploy, getDefinition });

    const first = await deactivateFlow(
      {
        action: "lifecycle.deactivate",
        target_org: "FlowLifecycleDev",
        flow_name: "Autolaunched_Example",
        allow_mutation: true,
      },
      session(),
      { adapter: lifecycle, ...artifacts },
    );

    expect(deploy).toHaveBeenCalledTimes(2);
    expect(deploy.mock.calls[0]?.[0].source).toContain(
      "<activeVersionNumber>0</activeVersionNumber>",
    );
    expect(first.details).toMatchObject({ ok: true, is_active: false, deployment_performed: true });

    const inactive = adapter();
    const second = await deactivateFlow(
      {
        action: "lifecycle.deactivate",
        target_org: "FlowLifecycleDev",
        flow_name: "Autolaunched_Example",
        allow_mutation: true,
      },
      session(),
      { adapter: inactive, ...artifacts },
    );
    expect(inactive.deploy).not.toHaveBeenCalled();
    expect(second.details).toMatchObject({
      ok: true,
      is_active: false,
      deployment_performed: false,
      idempotent: true,
    });
  });

  it("requires explicit mutation intent and refuses production or unknown orgs", async () => {
    const lifecycle = adapter();
    await expect(
      activateFlowVersion(
        {
          action: "lifecycle.activate",
          target_org: "FlowLifecycleDev",
          flow_name: "Autolaunched_Example",
          version: 2,
        },
        session(),
        { adapter: lifecycle, ...artifacts },
      ),
    ).rejects.toThrow("allow_mutation=true");

    await expect(
      activateFlowVersion(
        {
          action: "lifecycle.activate",
          target_org: "Production",
          flow_name: "Autolaunched_Example",
          version: 2,
          allow_mutation: true,
        },
        session("production"),
        { adapter: lifecycle, ...artifacts },
      ),
    ).rejects.toThrow("Refusing Flow lifecycle mutation for org type production");
  });
});
