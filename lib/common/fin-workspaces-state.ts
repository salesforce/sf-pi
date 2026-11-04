/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Cross-extension view of SF Fin workspace kinds.
 *
 * SF Fin owns `workspaces.json`. SF Guardrail reads only which workspace is
 * active and whether a named workspace is `prod`, so Fin mutations against a
 * production Fin workspace get the same treatment as production Salesforce
 * orgs: no session approvals, and Power Tool Mode needs the separate
 * production opt-in. Holds no credentials.
 */
import { createStateStore } from "./state-store.ts";

export type FinWorkspaceKind = "test" | "prod";

interface WorkspacesShape {
  active?: string;
  workspaces?: Record<string, { kind?: FinWorkspaceKind }>;
}

function store(pathOverride?: string) {
  return createStateStore<WorkspacesShape>({
    namespace: "sf-fin",
    filename: "workspaces.json",
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

/**
 * Kind of the requested (or active) Fin workspace. An unknown named workspace
 * is reported as `unknown`, which Guardrail treats like production.
 */
export function finWorkspaceKind(
  requested?: string,
  pathOverride?: string,
): { name: string; kind: FinWorkspaceKind | "unknown" } {
  const state = store(pathOverride).read();
  const name = requested?.trim() || state.active || "default";
  if (name === "default" && !state.workspaces?.default) return { name, kind: "test" };
  const kind = state.workspaces?.[name]?.kind;
  return { name, kind: kind === "prod" || kind === "test" ? kind : "unknown" };
}

/** MCP connection `intercom` (default) or `intercom_<name>` → workspace name. */
export function finWorkspaceForMcpServer(serverName: string): string {
  if (serverName === "intercom") return "default";
  return serverName.startsWith("intercom_")
    ? serverName.slice("intercom_".length).replace(/_/g, "-")
    : "default";
}
