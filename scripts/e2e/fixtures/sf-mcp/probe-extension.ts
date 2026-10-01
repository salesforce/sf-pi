/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only live probe used only by scripts/e2e/sf-mcp-e2e.ts. */
import { Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";

const USERNAME_TOOL = "mcp__salesforce_dx__get_username";
const QUERY_TOOL = "mcp__salesforce_dx__run_soql_query";
const HIDDEN_TOOLS = [
  "mcp__salesforce_dx__resume_tool_operation",
  "mcp__salesforce_dx__assign_permission_set",
  "mcp__salesforce_dx__deploy_metadata",
  "mcp__salesforce_dx__retrieve_metadata",
  "mcp__salesforce_dx__run_agent_test",
  "mcp__salesforce_dx__run_apex_test",
] as const;
const QUERY = "SELECT IsSandbox FROM Organization LIMIT 1";

const probeTool = defineTool({
  name: "sf_mcp_e2e_probe",
  label: "SF MCP read-only E2E probe",
  description:
    "Run the fixed read-only Salesforce DX MCP target-resolution and Organization classification probe.",
  parameters: Type.Object({}, { additionalProperties: false }),

  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    if (!ctx) throw new Error("SF MCP E2E probe requires an extension tool context.");
    const org = requiredEnv("SF_MCP_E2E_ORG");
    const project = path.resolve(requiredEnv("SF_MCP_E2E_PROJECT"));
    assertCallableSurface(ctx);

    const username = await ctx.executeTool(USERNAME_TOOL, {
      defaultTargetOrg: true,
      directory: project,
    });
    if (username.isError) {
      throw new Error("Salesforce DX MCP get_username failed.");
    }
    const resolved = resolvedTarget(resultText(username.result.content));
    if (resolved.value !== org || resolved.location !== "Local") {
      throw new Error("Salesforce DX MCP did not resolve the explicit local target org.");
    }

    const query = await ctx.executeTool(QUERY_TOOL, {
      query: QUERY,
      usernameOrAlias: org,
      directory: project,
      useToolingApi: false,
    });
    if (query.isError) {
      throw new Error("Salesforce DX MCP run_soql_query failed.");
    }
    const queryText = resultText(query.result.content);
    if (!/IsSandbox[\s\S]{0,500}\bfalse\b/i.test(queryText)) {
      throw new Error("Salesforce DX MCP query did not prove IsSandbox=false.");
    }

    return {
      content: [
        {
          type: "text" as const,
          text: "SF_MCP_E2E_PASS: target resolution and bounded Organization query passed.",
        },
      ],
      details: {
        marker: "SF_MCP_E2E_PASS",
        usernameResolved: true,
        isSandbox: false,
        hiddenToolsCallable: false,
      },
    };
  },
});

export default function sfMcpE2eProbe(pi: ExtensionAPI): void {
  pi.registerTool(probeTool);
}

function assertCallableSurface(ctx: ExtensionToolContext): void {
  const callable = new Set(ctx.tools.map((tool) => tool.name));
  const exposedHidden = HIDDEN_TOOLS.filter((tool) => callable.has(tool));
  if (exposedHidden.length > 0) {
    throw new Error(
      `Mutation or mixed Salesforce DX MCP tools are callable: ${exposedHidden.join(", ")}.`,
    );
  }
}

function resultText(content: Array<{ type: string; text?: string }>): string {
  return content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
}

function resolvedTarget(value: string): { value?: unknown; location?: unknown } {
  const marker = "- Full config: ";
  const start = value.indexOf(marker);
  const end = value.indexOf("\n\n", start + marker.length);
  if (start < 0 || end < 0) {
    throw new Error("Salesforce DX MCP get_username returned an unrecognized result.");
  }
  try {
    return JSON.parse(value.slice(start + marker.length, end)) as {
      value?: unknown;
      location?: unknown;
    };
  } catch {
    throw new Error("Salesforce DX MCP get_username returned invalid target metadata.");
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
