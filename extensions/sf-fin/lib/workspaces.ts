/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Named Fin workspace profiles.
 *
 * A profile is non-secret metadata: a name, its kind (`test` or `prod`), the
 * verified app id and region, and the Pi sign-in names that hold its
 * credentials. Pi alone stores the credentials.
 *
 * - The `default` workspace uses the existing `sf-fin` and `sf-fin-agent`
 *   sign-ins, so current users keep working unchanged.
 * - Any other workspace `<name>` uses `sf-fin-<name>` and `sf-fin-agent-<name>`.
 *   The Intercom MCP connection is `intercom` for default, `intercom-<name>`
 *   otherwise.
 *
 * `prod` workspaces are treated like Salesforce production orgs by SF
 * Guardrail: no session approvals, and Power Tool Mode needs the separate
 * production opt-in.
 */
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import type { FinRegion } from "./types.ts";

export const DEFAULT_WORKSPACE = "default";
export type WorkspaceKind = "test" | "prod";

export interface WorkspaceProfile {
  name: string;
  kind: WorkspaceKind;
  /** Verified from `/me` by setup or doctor; never typed by the user. */
  appId?: string;
  region?: FinRegion;
  workspaceName?: string;
  /** Optional linked Salesforce org alias (lifecycle, later). */
  salesforceOrg?: string;
  verifiedAt?: string;
}

export interface WorkspaceState {
  active: string;
  workspaces: Record<string, WorkspaceProfile>;
}

const NAME_RE = /^[a-z][a-z0-9-]{0,23}$/;
const RESERVED = new Set(["agent", "default", "all", "none"]);

export function workspaceNameIssue(name: string): string | undefined {
  if (!NAME_RE.test(name)) {
    return "Use 1–24 lowercase letters, digits, or hyphens, starting with a letter (for example `test`).";
  }
  if (RESERVED.has(name) || name.startsWith("agent-")) return `"${name}" is reserved.`;
  return undefined;
}

/** Pi sign-in names and the Intercom MCP connection for a workspace. */
export function workspaceProviders(name: string): {
  personal: string;
  agent: string;
  mcpConnection: string;
} {
  if (name === DEFAULT_WORKSPACE) {
    return { personal: "sf-fin", agent: "sf-fin-agent", mcpConnection: "intercom" };
  }
  return {
    personal: `sf-fin-${name}`,
    agent: `sf-fin-agent-${name}`,
    mcpConnection: `intercom-${name}`,
  };
}

export function createWorkspaceStore(pathOverride?: string): StateStore<WorkspaceState> {
  return createStateStore<WorkspaceState>({
    namespace: "sf-fin",
    filename: "workspaces.json",
    schemaVersion: 1,
    defaults: {
      active: DEFAULT_WORKSPACE,
      workspaces: { [DEFAULT_WORKSPACE]: { name: DEFAULT_WORKSPACE, kind: "test" } },
    },
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

/** Read state, always including the default workspace and a valid active name. */
export function readWorkspaces(store: StateStore<WorkspaceState>): WorkspaceState {
  const state = store.read();
  const workspaces = {
    [DEFAULT_WORKSPACE]: { name: DEFAULT_WORKSPACE, kind: "test" as const },
    ...state.workspaces,
  };
  const active = workspaces[state.active] ? state.active : DEFAULT_WORKSPACE;
  return { active, workspaces };
}

export function resolveWorkspace(
  store: StateStore<WorkspaceState>,
  requested?: string,
): { ok: true; profile: WorkspaceProfile } | { ok: false; message: string } {
  const state = readWorkspaces(store);
  const name = requested?.trim() || state.active;
  const profile = state.workspaces[name];
  if (!profile) {
    return {
      ok: false,
      message: `Unknown Fin workspace "${name}". Known: ${Object.keys(state.workspaces).join(", ")}. Add one with /sf-fin workspace add <name>.`,
    };
  }
  return { ok: true, profile };
}

export function addWorkspace(
  store: StateStore<WorkspaceState>,
  name: string,
  kind: WorkspaceKind,
): { ok: true; profile: WorkspaceProfile } | { ok: false; message: string } {
  const issue = workspaceNameIssue(name);
  if (issue) return { ok: false, message: issue };
  const state = readWorkspaces(store);
  if (state.workspaces[name]) return { ok: false, message: `Workspace "${name}" already exists.` };
  const profile: WorkspaceProfile = { name, kind };
  store.write({ ...state, workspaces: { ...state.workspaces, [name]: profile } });
  return { ok: true, profile };
}

export function useWorkspace(
  store: StateStore<WorkspaceState>,
  name: string,
): { ok: true; profile: WorkspaceProfile } | { ok: false; message: string } {
  const state = readWorkspaces(store);
  const profile = state.workspaces[name];
  if (!profile) return { ok: false, message: `Unknown Fin workspace "${name}".` };
  store.write({ ...state, active: name });
  return { ok: true, profile };
}

export function removeWorkspace(
  store: StateStore<WorkspaceState>,
  name: string,
): { ok: true } | { ok: false; message: string } {
  if (name === DEFAULT_WORKSPACE) {
    return { ok: false, message: "The default workspace cannot be removed." };
  }
  const state = readWorkspaces(store);
  if (!state.workspaces[name]) return { ok: false, message: `Unknown Fin workspace "${name}".` };
  const { [name]: _removed, ...rest } = state.workspaces;
  store.write({
    active: state.active === name ? DEFAULT_WORKSPACE : state.active,
    workspaces: rest,
  });
  return { ok: true };
}

/** Record the verified identity; refuses a different app id than the one already bound. */
export function bindWorkspaceIdentity(
  store: StateStore<WorkspaceState>,
  name: string,
  identity: { appId: string; region: FinRegion; workspaceName?: string; at: string },
): { ok: true; profile: WorkspaceProfile } | { ok: false; message: string } {
  const state = readWorkspaces(store);
  const current = state.workspaces[name];
  if (!current) return { ok: false, message: `Unknown Fin workspace "${name}".` };
  if (current.appId && current.appId !== identity.appId) {
    return {
      ok: false,
      message: `Workspace "${name}" is bound to app ${current.appId}, but this credential belongs to app ${identity.appId}. Use the credential for ${current.appId}, or add a separate workspace for ${identity.appId}.`,
    };
  }
  const profile: WorkspaceProfile = {
    ...current,
    appId: identity.appId,
    region: identity.region,
    workspaceName: identity.workspaceName ?? current.workspaceName,
    verifiedAt: identity.at,
  };
  store.write({ ...state, workspaces: { ...state.workspaces, [name]: profile } });
  return { ok: true, profile };
}
