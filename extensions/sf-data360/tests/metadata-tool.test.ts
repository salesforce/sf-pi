/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  buildMetadataExecutionPlan,
  summarizeMetadataOutput,
  type D360MetadataInput,
} from "../lib/metadata-tool.ts";

describe("sf-data360 metadata helper", () => {
  it("builds compact list and describe paths", () => {
    expect(buildMetadataExecutionPlan({ action: "list_dmos" })).toMatchObject({
      path: "/ssot/metadata-entities?entityType=DataModelObject",
      kind: "list",
      entityType: "DataModelObject",
    });
    expect(
      buildMetadataExecutionPlan({ action: "describe_dmo", api_name: "ssot__Account__dlm" }),
    ).toMatchObject({
      path: "/ssot/data-model-objects/ssot__Account__dlm",
      kind: "describe",
      entityType: "DataModelObject",
    });
    expect(buildMetadataExecutionPlan({ action: "list_dlos" })).toMatchObject({
      path: "/ssot/metadata-entities?entityType=DataLakeObject",
      entityType: "DataLakeObject",
    });
  });

  it("requires api_name for describe actions", () => {
    expect(() => buildMetadataExecutionPlan({ action: "describe_dmo" })).toThrow(
      "requires api_name",
    );
  });

  it("summarizes DMO lists with category filters", () => {
    const input: D360MetadataInput = { action: "list_dmos", category: "Profile" };
    const raw = JSON.stringify({
      metadata: [
        {
          category: "Engagement",
          displayName: "AI Agent Interaction",
          name: "ssot__AiAgentInteraction__dlm",
        },
        { category: "Profile", displayName: "Account", name: "ssot__Account__dlm" },
      ],
    });

    const summary = summarizeMetadataOutput(input, raw, "/tmp/raw.json");

    expect(summary.details).toMatchObject({ count: 1, unfilteredCount: 2, category: "Profile" });
    expect(summary.text).toContain("Found 1 DMOs in category Profile.");
    expect(summary.text).toContain("`ssot__Account__dlm`");
    expect(summary.text).not.toContain("ssot__AiAgentInteraction__dlm");
  });

  it("summarizes one DMO description and caps fields", () => {
    const input: D360MetadataInput = {
      action: "describe_dmo",
      api_name: "ssot__AiAgentSession__dlm",
      max_fields: 1,
    };
    const raw = JSON.stringify({
      label: "AI Agent Session",
      name: "ssot__AiAgentSession__dlm",
      category: "PROFILE",
      dataSpaceName: "default",
      isEnabled: true,
      isSegmentable: true,
      isEditable: true,
      fields: [
        { name: "ssot__Id__c", label: "AI Agent Session Id", type: "Text", isPrimaryKey: true },
        { name: "ssot__StartTimestamp__c", label: "Start Timestamp", type: "DateTime" },
      ],
    });

    const summary = summarizeMetadataOutput(input, raw, "/tmp/raw.json");

    expect(summary.details).toMatchObject({ fieldCount: 2, shownFieldCount: 1 });
    expect(summary.text).toContain("Fields: 2 (showing 1)");
    expect(summary.text).toContain("`ssot__Id__c`");
    expect(summary.text).not.toContain("ssot__StartTimestamp__c");
  });

  it("unwraps one DLO description response", () => {
    const input: D360MetadataInput = {
      action: "describe_dlo",
      api_name: "Example__dll",
      max_fields: 2,
    };
    const raw = JSON.stringify({
      dataLakeObjects: [
        {
          label: "Example Lake Object",
          name: "Example__dll",
          category: "Other",
          fields: [{ name: "Id__c", label: "Id", type: "Text" }],
        },
      ],
    });

    const summary = summarizeMetadataOutput(input, raw, "/tmp/raw.json");

    expect(summary.details).toMatchObject({ apiName: "Example__dll", fieldCount: 1 });
    expect(summary.text).toContain("Example Lake Object");
    expect(summary.text).toContain("`Id__c`");
  });
});
