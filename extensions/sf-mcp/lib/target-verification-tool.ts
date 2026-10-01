/* SPDX-License-Identifier: Apache-2.0 */
/** Exact one-use OAuth-org attestation for SObject Hosted MCP mutations. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  canonicalMcpServerName,
  recordMcpTargetAttestation,
} from "../../../lib/common/mcp-target-attestation/store.ts";
import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import { resolveEffectiveMcpServerEntry } from "./mcp-config.ts";

export const SF_MCP_VERIFY_TARGET_TOOL_NAME = "sf_mcp_verify_target";
const ORGANIZATION_QUERY = "SELECT Id, IsSandbox FROM Organization LIMIT 1";
const ATTESTATION_TTL_MS = 2 * 60 * 1000;

const SUPPORTED_MUTATIONS = {
  "salesforce-sobject-mutations": [
    "createSobjectRecord",
    "updateSobjectRecord",
    "updateRelatedRecord",
  ],
  "salesforce-sobject-deletes": ["deleteSobjectRecord", "deleteRelatedRecord"],
  "salesforce-sobject-all": [
    "createSobjectRecord",
    "updateSobjectRecord",
    "updateRelatedRecord",
    "deleteSobjectRecord",
    "deleteRelatedRecord",
  ],
} as const;

type SupportedServerName = keyof typeof SUPPORTED_MUTATIONS;

interface ResolvedServer {
  configuredName: string;
  configFingerprint: string;
  targetType: "production" | "sandbox";
}

interface TargetVerificationDependencies {
  resolveServer(input: {
    cwd: string;
    projectTrusted: boolean;
    serverName: SupportedServerName;
  }): ResolvedServer | undefined;
  resolveCliOrg(input: {
    cwd: string;
    targetOrg: string;
    signal?: AbortSignal;
  }): Promise<{ orgId: string; isSandbox: boolean }>;
  now(): number;
}

const DEFAULT_DEPENDENCIES: TargetVerificationDependencies = {
  resolveServer({ cwd, projectTrusted, serverName }) {
    const entry = resolveEffectiveMcpServerEntry(cwd, serverName, projectTrusted);
    if (!entry || !("url" in entry.config)) return undefined;
    const targetType = classifyHostedEndpoint(entry.config.url);
    if (!targetType) return undefined;
    return {
      configuredName: entry.configuredName,
      configFingerprint: entry.configFingerprint,
      targetType,
    };
  },
  async resolveCliOrg({ cwd, targetOrg, signal }) {
    const session = await connectSalesforce({ cwd, targetOrg, signal });
    const orgId = session.target.orgId ?? (await session.identity({ signal })).org_id;
    return {
      orgId,
      isSandbox: session.target.orgType === "sandbox" || session.target.orgType === "scratch",
    };
  },
  now: () => Date.now(),
};

export function registerMcpTargetVerificationTool(
  pi: ExtensionAPI,
  dependencies: TargetVerificationDependencies = DEFAULT_DEPENDENCIES,
): void {
  pi.registerTool({
    name: SF_MCP_VERIFY_TARGET_TOOL_NAME,
    label: "SF MCP Verify Target",
    description:
      "Verify that one authenticated Salesforce SObject MCP server targets the same org as an explicit Salesforce CLI target. This performs a read-only Organization query through that MCP connection and creates one short-lived attestation for the named next mutation tool. Call it immediately before that mutation; verification is not approval and SF Guardrail still blocks production writes.",
    promptSnippet:
      "Read-only exact-org verification required immediately before Salesforce SObject MCP mutations",
    promptGuidelines: [
      "Before a Salesforce SObject MCP mutation, call sf_mcp_verify_target with the exact server, explicit CLI target org, and next MCP mutation tool; then call that mutation after verification succeeds.",
      "Verification is one-use and expires after two minutes. A mismatch is a hard stop; never switch targets or bypass SF Guardrail.",
    ],
    executionMode: "sequential",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    parameters: Type.Object({
      server_name: StringEnum(Object.keys(SUPPORTED_MUTATIONS) as SupportedServerName[], {
        description: "Configured Salesforce SObject MCP server to verify.",
      }),
      target_org: Type.String({
        description:
          "Explicit Salesforce CLI alias or username whose Organization ID must match the MCP OAuth org.",
        minLength: 1,
      }),
      next_tool: Type.String({
        description:
          "Exact mutation tool that will consume this one-use attestation, such as updateSobjectRecord.",
        minLength: 1,
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const serverName = params.server_name as SupportedServerName;
      assertSupportedMutation(serverName, params.next_tool);
      const server = dependencies.resolveServer({
        cwd: ctx.cwd,
        projectTrusted: ctx.isProjectTrusted(),
        serverName,
      });
      if (!server) {
        throw new Error(
          `${serverName} is not configured as one unambiguous Salesforce Hosted MCP endpoint.`,
        );
      }

      const runtimeTool = `mcp__${canonicalMcpServerName(server.configuredName)}__soqlQuery`;
      const outcome = await ctx.executeTool(runtimeTool, { query: ORGANIZATION_QUERY }, { signal });
      if (outcome.isError) {
        throw new Error(
          "Exact MCP target verification failed: the nested Organization query failed.",
        );
      }
      const mcpOrg = parseOrganizationFingerprint(outcome.result.content);
      const cliOrg = await dependencies.resolveCliOrg({
        cwd: ctx.cwd,
        targetOrg: params.target_org,
        signal,
      });
      if (!sameSalesforceId(mcpOrg.orgId, cliOrg.orgId)) {
        throw new Error(
          "The authenticated MCP OAuth org does not match the explicit Salesforce CLI target.",
        );
      }
      if (mcpOrg.isSandbox !== cliOrg.isSandbox) {
        throw new Error("The MCP and Salesforce CLI targets disagree on sandbox classification.");
      }
      const attestedType = mcpOrg.isSandbox ? "sandbox" : "production";
      if (server.targetType !== attestedType) {
        throw new Error(
          `The configured MCP endpoint is ${server.targetType}, but its authenticated org is ${attestedType}.`,
        );
      }

      const now = dependencies.now();
      recordMcpTargetAttestation({
        sessionId: ctx.sessionManager.getSessionId(),
        serverName: server.configuredName,
        nextTool: params.next_tool,
        configFingerprint: server.configFingerprint,
        orgId: mcpOrg.orgId,
        isSandbox: mcpOrg.isSandbox,
        expiresAt: now + ATTESTATION_TTL_MS,
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Exact MCP target verified for ${serverName}. One ${params.next_tool} call may now proceed to SF Guardrail evaluation.`,
          },
        ],
        details: {
          serverName,
          nextTool: params.next_tool,
          targetType: attestedType,
          expiresAt: now + ATTESTATION_TTL_MS,
        },
      };
    },
  });
}

function assertSupportedMutation(serverName: SupportedServerName, nextTool: string): void {
  const supported = SUPPORTED_MUTATIONS[serverName] as readonly string[];
  if (!supported.includes(nextTool)) {
    throw new Error(`${nextTool} is not an approved mutation tool for ${serverName}.`);
  }
}

function classifyHostedEndpoint(value: string): "production" | "sandbox" | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "api.salesforce.com") return undefined;
    if (url.pathname.startsWith("/platform/mcp/v1/sandbox/platform/sobject-")) {
      return "sandbox";
    }
    if (url.pathname.startsWith("/platform/mcp/v1/platform/sobject-")) {
      return "production";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function parseOrganizationFingerprint(content: readonly { type: string; text?: string }[]): {
  orgId: string;
  isSandbox: boolean;
} {
  const text = content
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  const parsed = tryParseJson(text);
  const found = findOrganizationRecord(parsed);
  if (found) return found;

  const id = text.match(/\b00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\b/)?.[0];
  const sandbox = text.match(/\bIsSandbox\b["'\s:=]+(true|false)/i)?.[1];
  if (!id || !sandbox) {
    throw new Error("The MCP Organization query returned no bounded Id and IsSandbox fingerprint.");
  }
  return { orgId: id, isSandbox: sandbox.toLowerCase() === "true" };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function findOrganizationRecord(value: unknown): { orgId: string; isSandbox: boolean } | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findOrganizationRecord(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.Id === "string" &&
    /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(record.Id) &&
    typeof record.IsSandbox === "boolean"
  ) {
    return { orgId: record.Id, isSandbox: record.IsSandbox };
  }
  for (const child of Object.values(record)) {
    const found = findOrganizationRecord(child);
    if (found) return found;
  }
  return undefined;
}

function sameSalesforceId(left: string, right: string): boolean {
  return left.slice(0, 15) === right.slice(0, 15);
}
