/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Named-user JWT bootstrap for Einstein AI Agent SFAP endpoints.
 *
 * The normal sf CLI org token is sufficient for instance REST, SOQL, Connect,
 * and the Evaluation API, but `/einstein/ai-agent/*` routes require a JWT
 * minted by the org-local Agentforce bootstrap endpoint:
 *
 *   GET {instanceUrl}/agentforce/bootstrap/nameduser
 *   Cookie: sid={orgAccessToken}
 *
 * This mirrors the hidden auth step used by Salesforce's `sf agent preview`
 * implementation without importing `@salesforce/agents` at runtime.
 */

import type { AuthInfo as AuthInfoType, Connection as ConnectionType } from "@salesforce/core";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";

let corePromise:
  | Promise<{
      AuthInfo: typeof AuthInfoType;
      Connection: typeof ConnectionType;
    }>
  | undefined;

const JWT_EXPIRY_SAFETY_MS = 60_000;
const JWT_NO_EXP_FALLBACK_TTL_MS = 5 * 60_000;

interface AgentApiAuthCacheEntry {
  promise: Promise<AgentApiAuthResult>;
  expiresAtMs?: number;
}

const agentApiAuthCache = new Map<string, AgentApiAuthCacheEntry>();

async function loadSfCore() {
  corePromise ??= import("@salesforce/core").then(({ AuthInfo, Connection }) => ({
    AuthInfo,
    Connection,
  }));
  return corePromise;
}

export interface AgentApiAuthResult {
  conn: ConnectionType;
  username: string;
  instanceUrl: string;
  tokenKind: "named-user-jwt";
  /** In-memory cache status for local operation timings. Never persisted. */
  cache: "hit" | "miss";
}

export interface JwtValidationResult {
  isValid: boolean;
  hasRequiredFields: boolean;
  missingFields: string[];
  isExpired: boolean;
  expiresAt?: string;
  issuedAt?: string;
  subject?: string;
  issuer?: string;
  appId?: string;
  scopes?: string[];
}

interface BootstrapResponse {
  access_token?: string;
}

function decodeBase64UrlJson(part: string): Record<string, unknown> {
  const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as Record<string, unknown>;
}

export function validateNamedUserJwt(token: string | undefined): JwtValidationResult {
  if (!token) {
    return {
      isValid: false,
      hasRequiredFields: false,
      missingFields: ["token"],
      isExpired: false,
    };
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return {
      isValid: false,
      hasRequiredFields: false,
      missingFields: ["invalid JWT format - expected 3 parts"],
      isExpired: false,
    };
  }

  try {
    const payload = decodeBase64UrlJson(parts[1]);
    const missingFields = ["sub", "iss"].filter((field) => !payload[field]);
    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;
    const expiresAtDate = exp ? new Date(exp * 1000) : undefined;
    const issuedAtDate = iat ? new Date(iat * 1000) : undefined;
    const isExpired = expiresAtDate ? expiresAtDate.getTime() <= Date.now() : false;
    const scope = typeof payload.scope === "string" ? payload.scope : undefined;
    const hasRequiredFields = missingFields.length === 0;
    return {
      isValid: hasRequiredFields && !isExpired,
      hasRequiredFields,
      missingFields,
      isExpired,
      expiresAt: expiresAtDate?.toISOString(),
      issuedAt: issuedAtDate?.toISOString(),
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
      issuer: typeof payload.iss === "string" ? payload.iss : undefined,
      appId: typeof payload.sfdc_app_id === "string" ? payload.sfdc_app_id : undefined,
      scopes: scope ? scope.split(/\s+/).filter(Boolean) : undefined,
    };
  } catch {
    return {
      isValid: false,
      hasRequiredFields: false,
      missingFields: ["JWT payload parse error"],
      isExpired: false,
    };
  }
}

/**
 * Upgrade a connection to the named-user JWT expected by `/einstein/ai-agent/*`.
 * Mutates only the supplied connection. Callers that need to keep a normal org
 * token should pass an isolated connection (see `connForAgentApi`).
 */
export async function upgradeConnectionToNamedUserJwt(
  conn: ConnectionType,
): Promise<ConnectionType> {
  const authFields = conn.getAuthInfoFields?.() as { refreshToken?: string } | undefined;
  if (authFields?.refreshToken) {
    try {
      await conn.refreshAuth();
    } catch (err) {
      throw new Error(
        `Agent API auth bootstrap failed while refreshing org auth: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  const opts = conn.getConnectionOptions() as { accessToken?: string; instanceUrl?: string };
  const accessToken = opts.accessToken;
  const instanceUrl = opts.instanceUrl;
  if (!instanceUrl) throw new Error("Agent API auth bootstrap failed: missing instanceUrl.");
  if (!accessToken) throw new Error("Agent API auth bootstrap failed: missing org access token.");

  // The bootstrap endpoint authenticates with the org sid cookie, not the
  // Authorization bearer header. Remove the bearer token before this one call
  // so jsforce doesn't send two competing auth mechanisms.
  delete (conn as unknown as { accessToken?: string }).accessToken;

  let response: BootstrapResponse;
  try {
    response = await conn.request<BootstrapResponse>(
      {
        method: "GET",
        url: `${instanceUrl}/agentforce/bootstrap/nameduser`,
        headers: {
          "Content-Type": "application/json",
          Cookie: `sid=${accessToken}`,
        },
      } as Parameters<typeof conn.request>[0],
      { retry: { maxRetries: 3 } } as Parameters<typeof conn.request>[1],
    );
  } catch (err) {
    throw new Error(
      `Agent API auth bootstrap failed at /agentforce/bootstrap/nameduser: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  const jwt = response.access_token;
  const validation =
    typeof jwt === "string" ? validateNamedUserJwt(jwt) : validateNamedUserJwt(undefined);
  if (!validation.isValid) {
    const reasons = [
      ...validation.missingFields,
      validation.isExpired ? "expired" : undefined,
    ].filter(Boolean);
    throw new Error(
      "Agent API auth bootstrap failed: nameduser endpoint did not return a valid JWT access_token" +
        (reasons.length > 0 ? ` (${reasons.join(", ")})` : "") +
        ". If using a custom connected app, ensure it grants chatbot_api, sfap_api, and web scopes.",
    );
  }
  (conn as unknown as { accessToken: string }).accessToken = jwt;
  return conn;
}

/**
 * Resolve a fresh isolated connection for `/einstein/ai-agent/*` calls.
 *
 * We intentionally do not mutate the cached normal org connection because the
 * same command may still need normal org REST/SOQL afterward.
 */
export async function connForAgentApi(targetOrg?: string): Promise<AgentApiAuthResult> {
  const baseConn = await connFromAlias(targetOrg);
  const username = baseConn.getUsername?.();
  if (!username) {
    throw new Error("Agent API auth bootstrap failed: could not resolve org username.");
  }

  const key = agentApiAuthCacheKey(baseConn, targetOrg, username);
  const cached = agentApiAuthCache.get(key);
  if (cached && isCacheEntryUsable(cached)) {
    try {
      const result = await cached.promise;
      if (isCacheEntryUsable(cached)) return { ...result, cache: "hit" };
    } catch {
      agentApiAuthCache.delete(key);
    }
  } else if (cached) {
    agentApiAuthCache.delete(key);
  }

  const entry: AgentApiAuthCacheEntry = {
    promise: createAgentApiConnection(baseConn, username).catch((err) => {
      agentApiAuthCache.delete(key);
      throw err;
    }),
  };
  agentApiAuthCache.set(key, entry);
  const result = await entry.promise;
  entry.expiresAtMs = agentApiJwtExpiresAtMs(result.conn);
  return { ...result, cache: "miss" };
}

async function createAgentApiConnection(
  baseConn: ConnectionType,
  username: string,
): Promise<AgentApiAuthResult> {
  const { AuthInfo, Connection } = await loadSfCore();
  const authInfo = await AuthInfo.create({ username });
  const conn = await Connection.create({ authInfo });
  try {
    conn.setApiVersion(baseConn.getApiVersion());
  } catch {
    /* best-effort: Connection defaults to the org/api default */
  }
  await upgradeConnectionToNamedUserJwt(conn);
  return {
    conn,
    username,
    instanceUrl: conn.instanceUrl,
    tokenKind: "named-user-jwt",
    cache: "miss",
  };
}

function agentApiAuthCacheKey(
  conn: ConnectionType,
  targetOrg: string | undefined,
  username: string,
): string {
  const opts = conn.getConnectionOptions?.() as { instanceUrl?: string } | undefined;
  const instanceUrl = conn.instanceUrl ?? opts?.instanceUrl ?? "<unknown-instance>";
  let apiVersion = "<unknown-api>";
  try {
    apiVersion = conn.getApiVersion?.() ?? apiVersion;
  } catch {
    /* best-effort */
  }
  return [targetOrg ?? "<default>", username, instanceUrl, apiVersion].join("::");
}

function isCacheEntryUsable(entry: AgentApiAuthCacheEntry): boolean {
  if (entry.expiresAtMs === undefined) return true;
  return entry.expiresAtMs - JWT_EXPIRY_SAFETY_MS > Date.now();
}

function agentApiJwtExpiresAtMs(conn: ConnectionType): number {
  const token = (conn as unknown as { accessToken?: string }).accessToken;
  const validation = validateNamedUserJwt(token);
  if (validation.expiresAt) {
    const parsed = Date.parse(validation.expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now() + JWT_NO_EXP_FALLBACK_TTL_MS;
}

export function clearAgentApiAuthCache(): void {
  agentApiAuthCache.clear();
}

export function agentApiAuthCacheSize(): number {
  return agentApiAuthCache.size;
}
