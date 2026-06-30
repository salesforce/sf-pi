/* SPDX-License-Identifier: Apache-2.0 */

import { createHash, randomBytes } from "node:crypto";

import type { TenantIngestAuthStatus } from "./types.ts";

export type TenantIngestAuthStrategy =
  | "pkce"
  | "refresh_token"
  | "jwt_bearer"
  | "client_credentials";

export interface TenantIngestAuthPlanStep {
  label: string;
  detail: string;
}

export interface TenantIngestExchangeInput {
  loginUrl: string;
  clientId: string;
  redirectUri: string;
  authorizationCode: string;
  codeVerifier: string;
}

export interface TenantIngestPkceStartResult {
  authorization: {
    url: string;
    state: string;
    codeChallengeMethod: "S256";
    redirectUri: string;
    scopes: string[];
  };
  storesSecrets: false;
  secretStorage: "memory_only";
}

export interface TenantIngestExchangeDryRun {
  steps: Array<{ method: "POST"; url?: string; path?: string; bodyFields: string[] }>;
  storesSecrets: false;
  executesNetworkCalls: false;
}

export interface TenantIngestExchangeResult {
  auth: TenantIngestAuthStatus;
  token: { tokenType?: string; expiresIn?: number };
  authSession: { id: string; tenantHost: string; expiresAt?: string };
  storesSecrets: false;
}

export interface TenantIngestAuthPlan {
  strategy: TenantIngestAuthStrategy;
  tokenExchange: TenantIngestTokenExchange;
  steps: TenantIngestAuthPlanStep[];
  storesSecrets: false;
  executesNetworkCalls: false;
}

export interface TenantIngestTokenExchange {
  salesforcePath: "/services/a360/token";
  requiredScopes: string[];
  returns: string[];
}

export interface TenantIngestTokenSession {
  id: string;
  tenantHost: string;
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
}

interface PkceSession {
  loginUrl: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  scopes: string[];
  createdAt: number;
}

const pkceSessions = new Map<string, PkceSession>();
const tokenSessions = new Map<string, TenantIngestTokenSession>();
const DEFAULT_PKCE_SCOPES = ["api", "cdp_ingest_api", "refresh_token"];

/**
 * Placeholder seam for Data Cloud tenant ingest auth.
 *
 * Route A proved that tenant ingest jobs need a Data Cloud token and tenant host,
 * not the normal Salesforce REST instance URL. This v2 slice intentionally keeps
 * that contract explicit while only supporting dry-run request planning.
 */
export function inspectTenantIngestAuth(params: Record<string, unknown>): TenantIngestAuthStatus {
  const tenantHost = typeof params.tenantHost === "string" ? params.tenantHost.trim() : "";
  return {
    required: true,
    status: "not_configured",
    ...(tenantHost ? { tenantHost } : {}),
  };
}

export function startTenantIngestPkce(
  params: Record<string, unknown>,
): TenantIngestPkceStartResult {
  const loginUrl = normalizeUrl(requiredString(params.loginUrl, "loginUrl"));
  const clientId = requiredString(params.clientId, "clientId");
  const redirectUri = requiredString(params.redirectUri, "redirectUri");
  const scopes = normalizeScopes(params.scopes);
  const state = randomBase64Url(24);
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = base64Url(createHash("sha256").update(codeVerifier).digest());
  const url = new URL(`${loginUrl}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  pkceSessions.set(state, {
    loginUrl,
    clientId,
    redirectUri,
    codeVerifier,
    scopes,
    createdAt: Date.now(),
  });
  return {
    authorization: {
      url: url.toString(),
      state,
      codeChallengeMethod: "S256",
      redirectUri,
      scopes,
    },
    storesSecrets: false,
    secretStorage: "memory_only",
  };
}

export function tenantIngestTokenExchange(): TenantIngestTokenExchange {
  return {
    salesforcePath: "/services/a360/token",
    requiredScopes: ["cdp_ingest_api"],
    returns: ["Data Cloud access token", "tenant instance URL"],
  };
}

export function planTenantIngestExchange(
  params: Record<string, unknown>,
): TenantIngestExchangeDryRun {
  const input = parsePkceExchangeInput(params);
  return {
    storesSecrets: false,
    executesNetworkCalls: false,
    steps: [
      {
        method: "POST",
        url: `${input.loginUrl}/services/oauth2/token`,
        bodyFields: ["grant_type", "client_id", "redirect_uri", "code", "code_verifier"],
      },
      {
        method: "POST",
        path: "/services/a360/token",
        bodyFields: ["grant_type", "subject_token", "subject_token_type"],
      },
    ],
  };
}

export async function exchangePkceForTenantIngestAuth(
  params: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
): Promise<TenantIngestExchangeResult> {
  const input = parsePkceExchangeInput(params);
  const salesforceToken = await exchangePkceForSalesforceToken(input, fetchFn);
  const dataCloudToken = await exchangeSalesforceTokenForDataCloudToken(
    salesforceToken.instanceUrl,
    salesforceToken.accessToken,
    fetchFn,
  );
  const tenantHost = hostFromUrl(dataCloudToken.instanceUrl);
  const authSession = storeTenantIngestSession({
    tenantHost,
    accessToken: dataCloudToken.accessToken,
    tokenType: dataCloudToken.tokenType,
    expiresIn: dataCloudToken.expiresIn,
  });
  return {
    auth: {
      required: true,
      status: "ready",
      tenantHost,
    },
    token: { tokenType: dataCloudToken.tokenType, expiresIn: dataCloudToken.expiresIn },
    authSession,
    storesSecrets: false,
  };
}

export function planTenantIngestAuth(params: Record<string, unknown>): TenantIngestAuthPlan {
  const strategy = normalizeStrategy(params.strategy);
  return {
    strategy,
    tokenExchange: tenantIngestTokenExchange(),
    storesSecrets: false,
    executesNetworkCalls: false,
    steps: [
      {
        label: "Choose or create an OAuth client",
        detail: `Use ${strategy} with a connected app or external client app that can request Data Cloud scopes.`,
      },
      {
        label: "Request cdp_ingest_api scope",
        detail:
          "The Salesforce access token must include cdp_ingest_api before /services/a360/token exchange.",
      },
      {
        label: "Exchange through /services/a360/token",
        detail:
          "Exchange the scoped Salesforce token for a Data Cloud token and tenant instance URL.",
      },
      {
        label: "Bind tenant host to ingest-job actions",
        detail:
          "Use the tenant host only for /api/v1/ingest/jobs requests; do not confuse it with the Salesforce instance URL.",
      },
    ],
  };
}

async function exchangePkceForSalesforceToken(
  input: TenantIngestExchangeInput,
  fetchFn: typeof fetch,
): Promise<{ accessToken: string; instanceUrl: string }> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.authorizationCode,
    code_verifier: input.codeVerifier,
  });
  const response = await fetchFn(`${input.loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await parseJsonResponse(response);
  const accessToken = requiredStringField(json, "access_token", "Salesforce OAuth token response");
  const instanceUrl = requiredStringField(json, "instance_url", "Salesforce OAuth token response");
  return { accessToken, instanceUrl };
}

export function listTenantIngestTokenSessions(): Array<{
  id: string;
  tenantHost: string;
  expiresAt?: string;
}> {
  const sessions: Array<{ id: string; tenantHost: string; expiresAt?: string }> = [];
  for (const [id, session] of tokenSessions.entries()) {
    if (session.expiresAt && session.expiresAt <= Date.now()) {
      tokenSessions.delete(id);
      continue;
    }
    sessions.push({
      id,
      tenantHost: session.tenantHost,
      ...(session.expiresAt ? { expiresAt: new Date(session.expiresAt).toISOString() } : {}),
    });
  }
  return sessions;
}

export function clearTenantIngestTokenSessions(id?: string): number {
  if (id) return tokenSessions.delete(id) ? 1 : 0;
  const count = tokenSessions.size;
  tokenSessions.clear();
  return count;
}

export function getTenantIngestTokenSession(
  id: string | undefined,
): TenantIngestTokenSession | undefined {
  if (!id) return undefined;
  const session = tokenSessions.get(id);
  if (!session) return undefined;
  if (session.expiresAt && session.expiresAt <= Date.now()) {
    tokenSessions.delete(id);
    return undefined;
  }
  return session;
}

function storeTenantIngestSession(input: {
  tenantHost: string;
  accessToken: string;
  tokenType?: string;
  expiresIn?: number;
}): TenantIngestExchangeResult["authSession"] {
  const id = randomBase64Url(24);
  const expiresAt = input.expiresIn ? Date.now() + input.expiresIn * 1000 : undefined;
  tokenSessions.set(id, { id, ...input, expiresAt });
  return {
    id,
    tenantHost: input.tenantHost,
    ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
  };
}

async function exchangeSalesforceTokenForDataCloudToken(
  instanceUrl: string,
  salesforceAccessToken: string,
  fetchFn: typeof fetch,
): Promise<{ accessToken: string; instanceUrl: string; tokenType?: string; expiresIn?: number }> {
  const body = new URLSearchParams({
    grant_type: "urn:salesforce:grant-type:external:cdp",
    subject_token: salesforceAccessToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
  });
  const response = await fetchFn(`${instanceUrl}/services/a360/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = await parseJsonResponse(response);
  return {
    accessToken: requiredStringField(json, "access_token", "Data Cloud token response"),
    instanceUrl: requiredStringField(json, "instance_url", "Data Cloud token response"),
    tokenType: typeof json.token_type === "string" ? json.token_type : undefined,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : undefined,
  };
}

async function parseJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const body = (await response.json()) as unknown;
  if (!response.ok)
    throw new Error(`Data Cloud ingest auth exchange failed HTTP ${response.status}`);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Data Cloud ingest auth exchange returned a non-object JSON response.");
  }
  return body as Record<string, unknown>;
}

function parsePkceExchangeInput(params: Record<string, unknown>): TenantIngestExchangeInput {
  const strategy = normalizeStrategy(params.strategy);
  if (strategy !== "pkce") throw new Error("Only PKCE auth exchange is implemented in this slice.");
  const authorizationCode = requiredString(params.authorizationCode, "authorizationCode");
  if (typeof params.pkceState === "string" && params.pkceState.trim()) {
    const session = pkceSessions.get(params.pkceState.trim());
    if (!session)
      throw new Error("Unknown or expired PKCE state. Start a new auth.pkce_start flow.");
    return { ...session, authorizationCode };
  }
  return {
    loginUrl: normalizeUrl(requiredString(params.loginUrl, "loginUrl")),
    clientId: requiredString(params.clientId, "clientId"),
    redirectUri: requiredString(params.redirectUri, "redirectUri"),
    authorizationCode,
    codeVerifier: requiredString(params.codeVerifier, "codeVerifier"),
  };
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    const scopes = value
      .filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      .map((entry) => entry.trim());
    return scopes.length ? [...new Set(scopes)] : DEFAULT_PKCE_SCOPES;
  }
  if (typeof value === "string" && value.trim()) {
    return [...new Set(value.split(/\s+/).filter(Boolean))];
  }
  return DEFAULT_PKCE_SCOPES;
}

function randomBase64Url(bytes: number): string {
  return base64Url(randomBytes(bytes));
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function hostFromUrl(value: string): string {
  const trimmed = value.trim();
  return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).host;
}

function requiredStringField(obj: Record<string, unknown>, field: string, context: string): string {
  const value = obj[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${context} missing ${field}.`);
  return value.trim();
}

function requiredString(value: unknown, key: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Missing required parameter '${key}'.`);
  return value.trim();
}

function normalizeStrategy(value: unknown): TenantIngestAuthStrategy {
  if (
    value === "refresh_token" ||
    value === "jwt_bearer" ||
    value === "client_credentials" ||
    value === "pkce"
  ) {
    return value;
  }
  return "pkce";
}
