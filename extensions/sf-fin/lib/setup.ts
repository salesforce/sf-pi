/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unified Fin setup: what each credential unlocks, what is missing, and
 * whether the credentials agree on one workspace.
 *
 * Each credential is optional; setup reports what the ones present unlock and
 * names only what is missing for the capabilities the user wants.
 *
 * Workspace identity, per credential:
 * - Personal token: `GET /me` on its regional host returns the app id and
 *   region (proven).
 * - Intercom MCP sign-in: a read-only `list_articles` call returns records
 *   carrying `workspace_id` (proven when the workspace has an article;
 *   otherwise "signed in, workspace not proven").
 * - Fin Agent API key: the Agent API exposes no workspace id, and `/me`
 *   rejects the key, so it is reported as "access verified, workspace not
 *   provable" rather than claimed to match.
 *
 * Setup is read-only: no conversation, no write, no Operator turn.
 */
import type { DiscoveredIdentity } from "./region.ts";
import type { AgentApiAccess } from "./agent-api.ts";
import type { WorkspaceProfile } from "./workspaces.ts";
import { workspaceProviders } from "./workspaces.ts";

export type Capability = "build" | "operator" | "test";

export const CAPABILITY_LABELS: Record<Capability, string> = {
  build: "Build in Fin (procedures, guidance, connectors, simulations, publish)",
  operator: "Read data and use Fin Operator (Intercom MCP)",
  test: "Test the deployed Fin end to end (Fin Agent API)",
};

export type McpIdentity =
  { state: "not_configured" } | { state: "signed_out" } | { state: "signed_in"; appId?: string };

export interface SetupFacts {
  workspace: WorkspaceProfile;
  cliInstalled: boolean;
  personal:
    | { state: "missing" }
    | { state: "ok"; identity: DiscoveredIdentity }
    | { state: "rejected"; message: string };
  agent: { state: "missing" } | { state: "checked"; access: AgentApiAccess };
  mcp: McpIdentity;
}

export interface SetupStep {
  capability: Capability;
  text: string;
  command?: string;
}

export interface SetupReport {
  ready: Record<Capability, boolean>;
  appId?: string;
  mismatches: string[];
  steps: SetupStep[];
  lines: string[];
}

export function evaluateSetup(facts: SetupFacts, wanted: Capability[]): SetupReport {
  const p = workspaceProviders(facts.workspace.name);
  const personalOk = facts.personal.state === "ok";
  const appId =
    facts.workspace.appId ??
    (facts.personal.state === "ok" ? facts.personal.identity.appId : undefined);

  const mismatches: string[] = [];
  if (
    facts.personal.state === "ok" &&
    facts.workspace.appId &&
    facts.personal.identity.appId !== facts.workspace.appId
  ) {
    mismatches.push(
      `The personal token belongs to app ${facts.personal.identity.appId}, but workspace "${facts.workspace.name}" is bound to app ${facts.workspace.appId}.`,
    );
  }
  if (facts.mcp.state === "signed_in" && facts.mcp.appId && appId && facts.mcp.appId !== appId) {
    mismatches.push(
      `The Intercom MCP connection ${p.mcpConnection} is signed in to app ${facts.mcp.appId}, not ${appId}.`,
    );
  }

  const agentGranted = facts.agent.state === "checked" && facts.agent.access.state === "granted";
  const ready: Record<Capability, boolean> = {
    build: facts.cliInstalled && personalOk && mismatches.length === 0,
    operator: facts.mcp.state === "signed_in" && mismatches.length === 0,
    test: agentGranted,
  };

  const steps: SetupStep[] = [];
  if (wanted.includes("build")) {
    if (!facts.cliInstalled)
      steps.push({
        capability: "build",
        text: "Install the Fin CLI.",
        command: "sf_fin action='install'",
      });
    if (facts.personal.state !== "ok")
      steps.push({
        capability: "build",
        text:
          facts.personal.state === "rejected"
            ? `${facts.personal.message} Then save it again.`
            : "Create a personal API token in Fin (Settings → Personal → API tokens) and save it; the region is detected automatically.",
        command: `/login ${p.personal}`,
      });
  }
  if (wanted.includes("operator") && facts.mcp.state !== "signed_in") {
    steps.push({
      capability: "operator",
      text:
        facts.mcp.state === "not_configured"
          ? `Add the Intercom MCP connection ${p.mcpConnection} (sf_mcp preset intercom), then sign in.`
          : `Sign in to the Intercom MCP connection ${p.mcpConnection}.`,
      command: `/mcp login ${p.mcpConnection}`,
    });
  }
  if (wanted.includes("test") && !agentGranted) {
    const access = facts.agent.state === "checked" ? facts.agent.access : undefined;
    steps.push({
      capability: "test",
      text:
        access?.state === "not_granted"
          ? "Request Fin Agent API access in Fin (Settings → Integrations → Fin Agent API)."
          : access?.state === "wrong_key" || access?.state === "auth_failed"
            ? "The saved Fin Agent API key was rejected; generate a new one under Fin AI Agent → Deploy → Fin Agent API and save it."
            : "Generate the Fin Agent API key under Fin AI Agent → Deploy → Fin Agent API and save it (copy and paste).",
      command: access?.state === "not_granted" ? undefined : `/login ${p.agent}`,
    });
  }

  const tick = (ok: boolean) => (ok ? "✅" : "—");
  const lines = [
    `Fin workspace "${facts.workspace.name}" (${facts.workspace.kind})${appId ? ` · app ${appId}` : ""}${
      facts.personal.state === "ok" ? ` · ${facts.personal.identity.region.toUpperCase()}` : ""
    }${facts.workspace.workspaceName ? ` · ${facts.workspace.workspaceName}` : ""}`,
    "",
    "Credential | Status | Workspace",
    `Personal token (/login ${p.personal}) | ${
      facts.personal.state === "ok"
        ? "✅ valid"
        : facts.personal.state === "rejected"
          ? "❌ rejected"
          : "— not saved"
    } | ${facts.personal.state === "ok" ? `app ${facts.personal.identity.appId} (proven)` : "—"}`,
    `Intercom MCP (${p.mcpConnection}) | ${
      facts.mcp.state === "signed_in"
        ? "✅ signed in"
        : facts.mcp.state === "signed_out"
          ? "— signed out"
          : "— not configured"
    } | ${
      facts.mcp.state === "signed_in"
        ? facts.mcp.appId
          ? `app ${facts.mcp.appId} (proven)`
          : "not provable yet (no workspace data to read)"
        : "—"
    }`,
    `Fin Agent API key (/login ${p.agent}) | ${
      facts.agent.state === "missing"
        ? "— not saved"
        : facts.agent.access.state === "granted"
          ? "✅ access granted"
          : `❌ ${facts.agent.access.state}`
    } | ${agentGranted ? "not provable (the Agent API exposes no workspace id)" : "—"}`,
    `Fin CLI | ${facts.cliInstalled ? "✅ installed" : "— not installed"} | —`,
    "",
    "Capability | Ready",
    ...(Object.keys(CAPABILITY_LABELS) as Capability[]).map(
      (c) => `${CAPABILITY_LABELS[c]} | ${tick(ready[c])}`,
    ),
  ];
  if (mismatches.length) lines.push("", ...mismatches.map((m) => `❌ ${m}`));
  if (steps.length) {
    lines.push("", "Next steps (only for what you asked for):");
    for (const [i, step] of steps.entries()) {
      lines.push(`${i + 1}. ${step.text}${step.command ? ` → ${step.command}` : ""}`);
    }
  } else if (mismatches.length === 0) {
    lines.push("", "✅ Nothing missing for the requested capabilities.");
  }
  return { ready, appId, mismatches, steps, lines };
}

/** Read the workspace id from Intercom MCP `list_articles` output (untrusted text). */
export function workspaceIdFromMcpText(text: string): string | undefined {
  return /"workspace_id"\s*:\s*"([a-z0-9]{4,16})"/i.exec(text)?.[1];
}
