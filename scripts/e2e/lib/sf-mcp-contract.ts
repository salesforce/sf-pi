/* SPDX-License-Identifier: Apache-2.0 */
/** Public-safe normalization and comparison for Salesforce DX MCP runtime contracts. */
import { createHash } from "node:crypto";

const TOOL_PREFIX = "mcp__salesforce_dx__";

export interface McpPackageMetadata {
  version: string;
  integrity: string;
  modifiedAt: string;
}

export interface RawObservedTool {
  name: string;
  description?: string;
  parameters?: unknown;
  annotations?: Record<string, unknown>;
}

export interface NormalizedMcpToolContract {
  name: string;
  descriptionHash: string;
  schemaDescriptionHash: string;
  parameters: unknown;
  annotations: Record<string, unknown>;
}

export interface McpContractSnapshot {
  schemaVersion: 1;
  presetId: "salesforce-dx";
  package: {
    name: "@salesforce/mcp";
    version: string;
    integrity: string;
    modifiedAt: string;
  };
  toolsets: ["orgs", "metadata", "data", "users", "testing"];
  allowNonGaTools: false;
  tools: NormalizedMcpToolContract[];
}

export type ContractDriftKind =
  | "package-version"
  | "package-integrity"
  | "tool-added"
  | "tool-removed"
  | "schema"
  | "annotations"
  | "description";

export interface ContractDriftChange {
  kind: ContractDriftKind;
  severity: "review" | "breaking";
  tool?: string;
  message: string;
}

export interface ContractDriftReport {
  status: "clean" | "review" | "breaking";
  baselineVersion: string;
  candidateVersion: string;
  changes: ContractDriftChange[];
}

export function buildContractSnapshot(
  metadata: McpPackageMetadata,
  observedTools: readonly RawObservedTool[],
): McpContractSnapshot {
  const tools = observedTools
    .map((tool) => normalizeTool(tool))
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 1,
    presetId: "salesforce-dx",
    package: {
      name: "@salesforce/mcp",
      version: metadata.version,
      integrity: metadata.integrity,
      modifiedAt: metadata.modifiedAt,
    },
    toolsets: ["orgs", "metadata", "data", "users", "testing"],
    allowNonGaTools: false,
    tools,
  };
}

export function compareContractSnapshots(
  baseline: McpContractSnapshot,
  candidate: McpContractSnapshot,
): ContractDriftReport {
  const changes: ContractDriftChange[] = [];
  if (baseline.package.version !== candidate.package.version) {
    changes.push({
      kind: "package-version",
      severity: "review",
      message: `Package version changed from ${baseline.package.version} to ${candidate.package.version}.`,
    });
  } else if (baseline.package.integrity !== candidate.package.integrity) {
    changes.push({
      kind: "package-integrity",
      severity: "breaking",
      message: `Package integrity changed for published version ${candidate.package.version}.`,
    });
  }

  const before = new Map(baseline.tools.map((tool) => [tool.name, tool]));
  const after = new Map(candidate.tools.map((tool) => [tool.name, tool]));
  for (const name of [...after.keys()].filter((tool) => !before.has(tool)).sort()) {
    changes.push({
      kind: "tool-added",
      severity: "breaking",
      tool: name,
      message: `Unreviewed tool added: ${name}.`,
    });
  }
  for (const name of [...before.keys()].filter((tool) => !after.has(tool)).sort()) {
    changes.push({
      kind: "tool-removed",
      severity: "breaking",
      tool: name,
      message: `Reviewed tool removed: ${name}.`,
    });
  }
  for (const name of [...before.keys()].filter((tool) => after.has(tool)).sort()) {
    const baselineTool = before.get(name);
    const candidateTool = after.get(name);
    if (!baselineTool || !candidateTool) continue;
    if (!sameJson(baselineTool.parameters, candidateTool.parameters)) {
      changes.push({
        kind: "schema",
        severity: "breaking",
        tool: name,
        message: `Input schema changed: ${name}.`,
      });
    }
    if (!sameJson(baselineTool.annotations, candidateTool.annotations)) {
      changes.push({
        kind: "annotations",
        severity: "breaking",
        tool: name,
        message: `MCP annotations changed: ${name}.`,
      });
    }
    if (
      baselineTool.descriptionHash !== candidateTool.descriptionHash ||
      baselineTool.schemaDescriptionHash !== candidateTool.schemaDescriptionHash
    ) {
      changes.push({
        kind: "description",
        severity: "review",
        tool: name,
        message: `Tool or parameter descriptions changed: ${name}.`,
      });
    }
  }

  return {
    status: changes.some((change) => change.severity === "breaking")
      ? "breaking"
      : changes.length > 0
        ? "review"
        : "clean",
    baselineVersion: baseline.package.version,
    candidateVersion: candidate.package.version,
    changes,
  };
}

function normalizeTool(tool: RawObservedTool): NormalizedMcpToolContract {
  if (!tool.name.startsWith(TOOL_PREFIX)) {
    throw new Error(`Unexpected Salesforce DX MCP tool name: ${tool.name}`);
  }
  const parameters = tool.parameters ?? {};
  return {
    name: tool.name.slice(TOOL_PREFIX.length),
    descriptionHash: hash(tool.description ?? ""),
    schemaDescriptionHash: hash(JSON.stringify(schemaDescriptions(parameters))),
    parameters: canonicalize(parameters, true),
    annotations: canonicalize(tool.annotations ?? {}) as Record<string, unknown>,
  };
}

function canonicalize(value: unknown, omitDescriptions = false): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, omitDescriptions));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !omitDescriptions || key !== "description")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item, omitDescriptions)]),
  );
}

function schemaDescriptions(value: unknown, currentPath = "$"): Array<[string, string]> {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => schemaDescriptions(item, `${currentPath}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, item]) =>
      key === "description" && typeof item === "string"
        ? [[`${currentPath}.description`, item] as [string, string]]
        : schemaDescriptions(item, `${currentPath}.${key}`),
    );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
