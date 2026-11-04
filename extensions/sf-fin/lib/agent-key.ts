/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fin Agent API key safety: storage, source detection, and cached checks.
 *
 * The key is a second Pi-owned credential (`/login sf-fin-agent`), held to the
 * same rules as the personal token (ADR 0087 proof set) plus two of its own:
 *
 * - Separation: it must not be the personal token. The two have different
 *   scopes and lifecycles; one value in both slots would let a CLI-scoped
 *   admin token reach the Agent API path (and vice versa) and makes revoking
 *   one silently break the other. Login rejects a key equal to the saved
 *   personal token; doctor reports a match found in any source.
 * - Transport: the key is sent only as an HTTPS Authorization header to the
 *   region's fixed Fin Agent API host; it never reaches the CLI, argv, child
 *   environments, logs, status files, or tool output.
 *
 * Cached status records only the last access outcome and its time, never key
 * material or a fingerprint of it.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { ExtensionDoctorCheck } from "../../../lib/common/doctor/registry.ts";
import { hasPiAuthProviderApiKey } from "../../../lib/common/pi-auth-status.ts";
import { createStateStore, type StateStore } from "../../../lib/common/state-store.ts";
import { AGENT_API_ENV_KEY, AGENT_API_PROVIDER, type AgentApiAccess } from "./agent-api.ts";
import { PROVIDER_NAME } from "./types.ts";

export type AgentKeySource = "pi-auth" | "env" | "none";

/** Last observed Agent API access outcome; no key material. */
export interface AgentKeyStatus {
  lastCheckedAt?: string;
  lastAccess?: AgentApiAccess["state"] | "same_as_personal_token";
  toolCount?: number;
}

/**
 * Per-workspace Agent API status. The default workspace keeps the original
 * `agent-api-status.json`; a named workspace uses `agent-api-status-<name>.json`.
 * A value containing a path separator is a test path override.
 */
export function createAgentKeyStatusStore(workspaceOrPath?: string): StateStore<AgentKeyStatus> {
  const isPath = workspaceOrPath?.includes("/") || workspaceOrPath?.includes("\\");
  const pathOverride = isPath ? workspaceOrPath : undefined;
  const workspace = isPath ? undefined : workspaceOrPath;
  return createStateStore<AgentKeyStatus>({
    namespace: "sf-fin",
    filename:
      !workspace || workspace === "default"
        ? "agent-api-status.json"
        : `agent-api-status-${workspace}.json`,
    schemaVersion: 1,
    defaults: {},
    mode: 0o600,
    ...(pathOverride ? { pathOverride } : {}),
  });
}

/** Status-only source detection. Never returns key values. */
export function detectAgentKeySource(env: NodeJS.ProcessEnv = process.env): AgentKeySource {
  if (hasPiAuthProviderApiKey(AGENT_API_PROVIDER)) return "pi-auth";
  return env[AGENT_API_ENV_KEY]?.trim() ? "env" : "none";
}

/**
 * Constant-time comparison of two secrets via fixed-length digests, so
 * neither length nor content leaks through timing. Empty values never match.
 */
export function sameSecret(a: string | undefined, b: string | undefined): boolean {
  const left = a?.trim();
  const right = b?.trim();
  if (!left || !right) return false;
  const da = createHash("sha256").update(left).digest();
  const db = createHash("sha256").update(right).digest();
  return timingSafeEqual(da, db);
}

/** Shape check for a pasted key: rejects empty, whitespace, and obvious non-keys. */
export function agentKeyShapeIssue(key: string): string | undefined {
  const value = key.trim();
  if (!value) return "The Fin Agent API key is empty.";
  if (/\s/.test(value)) return "The Fin Agent API key contains spaces or line breaks.";
  if (/^bearer\s/i.test(key.trim())) return "Paste only the key, without the `Bearer ` prefix.";
  if (value.length < 20) return "That value is too short to be a Fin Agent API key.";
  return undefined;
}

export function agentKeyStatusLines(
  status: AgentKeyStatus,
  source: AgentKeySource = detectAgentKeySource(),
): string[] {
  const lines = [
    `- Fin Agent API key: ${
      source === "pi-auth"
        ? `saved by /login ${AGENT_API_PROVIDER}`
        : source === "env"
          ? `${AGENT_API_ENV_KEY} environment variable`
          : "not saved (optional; needed only for sf_fin agent)"
    }`,
  ];
  if (status.lastAccess) {
    lines.push(
      `- Fin Agent API access: ${status.lastAccess}${status.lastCheckedAt ? ` at ${status.lastCheckedAt}` : ""}`,
    );
  }
  return lines;
}

/** Cached-only `/sf-pi doctor` contribution: no network, no key read. */
export function agentKeyCachedCheck(
  status: AgentKeyStatus,
  source: AgentKeySource = detectAgentKeySource(),
): ExtensionDoctorCheck {
  if (source === "none") {
    return {
      id: "fin.agent-api",
      severity: "info",
      title: "Fin Agent API key not saved",
      detail:
        "Optional. Needed only for sf_fin agent end-to-end runs. Generate it in Fin under Fin AI Agent → Deploy → Fin Agent API.",
      fix: `/login ${AGENT_API_PROVIDER}`,
    };
  }
  const label =
    source === "pi-auth" ? `saved by /login ${AGENT_API_PROVIDER}` : `${AGENT_API_ENV_KEY} env`;
  switch (status.lastAccess) {
    case "granted":
      return {
        id: "fin.agent-api",
        severity: "ok",
        title: `Fin Agent API: access granted (${label})`,
        detail: `${status.toolCount ?? "?"} tools at ${status.lastCheckedAt ?? "unknown time"}.`,
      };
    case "same_as_personal_token":
      return {
        id: "fin.agent-api",
        severity: "error",
        title: "Fin Agent API key is the personal API token",
        detail: `Use the separate Fin Agent API key; the personal token belongs to /login ${PROVIDER_NAME}.`,
        fix: `/login ${AGENT_API_PROVIDER}`,
      };
    case "wrong_key":
    case "auth_failed":
      return {
        id: "fin.agent-api",
        severity: "error",
        title: `Fin Agent API key rejected (${status.lastAccess})`,
        detail: `Last checked ${status.lastCheckedAt ?? "unknown"}. Generate a new key in Fin and save it again.`,
        fix: `/login ${AGENT_API_PROVIDER}`,
      };
    case "not_granted":
      return {
        id: "fin.agent-api",
        severity: "warn",
        title: "Fin Agent API not granted for this workspace",
        detail: "Request it in Fin under Settings → Integrations → Fin Agent API.",
      };
    default:
      return {
        id: "fin.agent-api",
        severity: "info",
        title: `Fin Agent API key ${label}; access not checked yet`,
        detail: "Run sf_fin action='agent' operation='access' (no conversation, not billable).",
      };
  }
}
