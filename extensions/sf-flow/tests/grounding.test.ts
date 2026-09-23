/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { buildAuthoringPlan } from "../lib/author.ts";
import {
  collectCustomActionSummaries,
  CUSTOM_ACTION_CATEGORIES,
  groundAuthoringContext,
  type AuthorGroundingAdapter,
} from "../lib/grounding.ts";
import { groundOmniAuthoringContext, type OmniGroundingAdapter } from "../lib/omni-grounding.ts";

function omniAdapter(): OmniGroundingAdapter {
  return {
    listServiceChannels: vi.fn(async () => [
      {
        developer_name: "Messaging_Channel",
        label: "Messaging",
        detail: "MessagingSession",
      },
    ]),
    listQueues: vi.fn(async () => [{ developer_name: "Support_Queue", label: "Support Queue" }]),
    listRoutingConfigurations: vi.fn(async () => [
      {
        developer_name: "Support_Routing",
        label: "Support Routing",
        detail: "MostAvailable",
      },
    ]),
    listSkills: vi.fn(async () => [{ developer_name: "Billing", label: "Billing" }]),
    listAgents: vi.fn(async () => [
      { developer_name: "routing.agent@example.invalid", label: "Routing Agent" },
    ]),
  };
}

function adapter(): AuthorGroundingAdapter {
  return {
    describeObject: vi.fn(async (name) => ({
      api_name: name,
      label: name,
      fields: [
        { name: "Id", label: "Record ID", type: "id", reference_to: [] },
        { name: "Name", label: "Account Name", type: "string", reference_to: [] },
        { name: "Status__c", label: "Status", type: "picklist", reference_to: [] },
        { name: "OwnerId", label: "Owner", type: "reference", reference_to: ["User"] },
      ],
    })),
    listActions: vi.fn(async () => [
      {
        name: "sendNotification",
        label: "Send Notification",
        type: "STANDARD",
        url: "/actions/standard/sendNotification",
      },
      {
        name: "otherAction",
        label: "Other Action",
        type: "APEX",
        url: "/actions/custom/apex/otherAction",
      },
    ]),
    describeAction: vi.fn(async (action) => ({
      ...action,
      description: "Sends a notification.",
      inputs: [{ name: "title", type: "STRING", required: true }],
      outputs: [{ name: "notificationId", type: "STRING" }],
    })),
    listSubflows: vi.fn(async () => [
      {
        api_name: "Send_Account_Notification",
        label: "Send Account Notification",
        active_version_id: "301000000000001",
        latest_version_id: "301000000000001",
      },
      {
        api_name: "Unrelated_Helper",
        label: "Unrelated Helper",
        active_version_id: "301000000000002",
        latest_version_id: "301000000000002",
      },
    ]),
    describeSubflow: vi.fn(async (flow) => ({
      ...flow,
      inputs: [{ name: "accountId", data_type: "String", is_collection: false }],
      outputs: [{ name: "result", data_type: "String", is_collection: false }],
    })),
  };
}

describe("org-grounded Flow authoring", () => {
  it("grounds bounded Omni-Channel service channels and routing choices", async () => {
    const fake = omniAdapter();
    const result = await groundOmniAuthoringContext(
      {} as never,
      {
        action: "author.plan",
        target_org: "test-org",
        intent: "Route a messaging work item using skills",
        flow_type: "omni-channel",
        omni_destination: "skills",
      },
      { adapter: fake },
    );

    expect(result).toMatchObject({
      target_org: "test-org",
      service_channels: [expect.objectContaining({ developer_name: "Messaging_Channel" })],
      queues: [],
      routing_configurations: [expect.objectContaining({ developer_name: "Support_Routing" })],
      skills: [expect.objectContaining({ developer_name: "Billing" })],
      agents: [],
      coverage: { gaps: [] },
    });
  });

  it("reports destination-specific Omni-Channel readiness gaps", async () => {
    const empty: OmniGroundingAdapter = {
      listServiceChannels: vi.fn(async () => []),
      listQueues: vi.fn(async () => []),
      listRoutingConfigurations: vi.fn(async () => []),
      listSkills: vi.fn(async () => []),
      listAgents: vi.fn(async () => []),
    };
    const result = await groundOmniAuthoringContext(
      {} as never,
      {
        action: "author.plan",
        target_org: "test-org",
        intent: "Route work using skills",
        flow_type: "omni-channel",
        omni_destination: "skills",
      },
      { adapter: empty },
    );

    expect(result.coverage.gaps.map((gap) => gap.area)).toEqual(
      expect.arrayContaining(["service_channels", "skills", "routing_configurations"]),
    );
  });

  it("adds Omni-Channel grounding choices to author.plan", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        target_org: "test-org",
        intent: "Route a messaging work item directly to an agent with Omni-Channel",
        flow_type: "omni-channel",
        omni_destination: "agent",
      },
      process.cwd(),
      {} as never,
      { omniAdapter: omniAdapter() },
    );

    expect(result.details.grounding).toMatchObject({
      target_org: "test-org",
      service_channels: [expect.objectContaining({ label: "Messaging" })],
    });
    expect(result.details.digest).toMatchObject({
      sections: expect.arrayContaining([
        expect.objectContaining({ title: "Grounded Omni-Channel" }),
        expect.objectContaining({
          title: "Queue Choices",
          rows: [expect.objectContaining({ label: "Support Queue" })],
        }),
        expect.objectContaining({
          title: "Agent Choices",
          rows: [expect.objectContaining({ label: "Routing Agent" })],
        }),
      ]),
    });
  });

  it("walks hierarchical Quick Action and Email Alert action indexes", async () => {
    const responses = new Map<string, unknown>([
      ["/actions/custom/quickAction", { Account: "/actions/custom/quickAction/Account" }],
      [
        "/actions/custom/quickAction/Account",
        {
          actions: [
            {
              name: "Account.Public_Action",
              label: "Public Action",
              type: "QUICK_ACTION",
              url: "/actions/custom/quickAction/Account/Public_Action",
            },
          ],
        },
      ],
    ]);

    const actions = await collectCustomActionSummaries("/actions/custom/quickAction", async (url) =>
      responses.get(url),
    );

    expect(actions).toEqual([
      expect.objectContaining({ name: "Account.Public_Action", type: "QUICK_ACTION" }),
    ]);
    expect(CUSTOM_ACTION_CATEGORIES).toEqual(
      expect.arrayContaining([
        "apex",
        "externalService",
        "quickAction",
        "emailAlert",
        "generateAiAgentResponse",
      ]),
    );
  });
  it("grounds object fields, matching actions, and matching subflow contracts", async () => {
    const fake = adapter();
    const result = await groundAuthoringContext(
      {} as never,
      {
        action: "author.plan",
        target_org: "test-org",
        intent: "When account status changes, send an account notification",
        object: "Account",
        flow_type: "record-triggered",
      },
      { adapter: fake },
    );

    expect(result.object).toMatchObject({ api_name: "Account" });
    expect(result.object?.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(["Id", "Name", "Status__c"]),
    );
    expect(result.actions).toEqual([
      expect.objectContaining({
        name: "sendNotification",
        inputs: [expect.objectContaining({ name: "title", required: true })],
      }),
    ]);
    expect(result.subflows).toEqual([
      expect.objectContaining({
        api_name: "Send_Account_Notification",
        inputs: [expect.objectContaining({ name: "accountId" })],
        outputs: [expect.objectContaining({ name: "result" })],
      }),
    ]);
    expect(result.coverage.gaps).toEqual([]);
  });

  it("adds grounding evidence to author.plan only when an org session is supplied", async () => {
    const fake = adapter();
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        target_org: "test-org",
        intent: "When an account status changes, send an account notification after save",
        flow_type: "record-triggered",
        trigger_timing: "after-save",
        record_event: "update",
        object: "Account",
      },
      process.cwd(),
      {} as never,
      { adapter: fake },
    );

    expect(result.details.grounding).toMatchObject({
      target_org: "test-org",
      object: { api_name: "Account" },
    });
    expect(result.content[0]?.text).toContain("Grounded Org");
    expect(result.details.digest).toMatchObject({
      sections: expect.arrayContaining([
        expect.objectContaining({
          title: "Action Contracts",
          rows: expect.arrayContaining([
            expect.objectContaining({
              label: "sendNotification",
              value: expect.stringContaining("title*"),
            }),
          ]),
        }),
      ]),
    });
  });
});
