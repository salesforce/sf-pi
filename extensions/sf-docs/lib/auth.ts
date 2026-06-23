/* SPDX-License-Identifier: Apache-2.0 */
/** Credential and endpoint resolution for SF Docs. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { existsSync, readFileSync } from "node:fs";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  DEFAULT_ENDPOINT,
  ENV_ENDPOINT,
  ENV_TOKEN,
  LONG_LIVED_EXPIRY_MS,
  MANUAL_REFRESH_SENTINEL,
  PROVIDER_NAME,
  type EndpointResolution,
  type TokenResolution,
  type TokenSource,
} from "./types.ts";

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function authStorePath(): string {
  return globalAgentPath("auth.json");
}

export function readPiAuthToken(path = authStorePath()): string | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      { access?: string; token?: string }
    >;
    const token = parsed?.[PROVIDER_NAME]?.access || parsed?.[PROVIDER_NAME]?.token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function resolveTokenCandidates(candidates: {
  piAuthToken?: string | null;
  envToken?: string | null;
}): TokenResolution | null {
  const piAuthToken = candidates.piAuthToken?.trim();
  if (piAuthToken) return { source: "pi-auth", token: piAuthToken };
  const envToken = candidates.envToken?.trim();
  if (envToken) return { source: "env", token: envToken };
  return null;
}

export function resolveConfiguredToken(): TokenResolution | null {
  return resolveTokenCandidates({ piAuthToken: readPiAuthToken(), envToken: getEnv(ENV_TOKEN) });
}

export function detectTokenSource(): TokenSource {
  return resolveConfiguredToken()?.source ?? "none";
}

export async function getDocsToken(
  ctx: ExtensionContext,
): Promise<
  { ok: true; token: string; source: Exclude<TokenSource, "none"> } | { ok: false; message: string }
> {
  const configured = resolveConfiguredToken();
  if (configured) return { ok: true, token: configured.token, source: configured.source };

  const token = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_NAME);
  if (token?.trim()) return { ok: true, token: token.trim(), source: "pi-auth" };

  return {
    ok: false,
    message: [
      "SF Docs is not connected.",
      "Connect from /sf-docs, or set SF_DOCS_MCP_TOKEN for automation.",
    ].join("\n"),
  };
}

export function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.slice(0, 6)}…${token.slice(-5)}`;
}

export function resolveEndpoint(): EndpointResolution {
  const raw = getEnv(ENV_ENDPOINT);
  if (!raw) return { source: "default", endpoint: DEFAULT_ENDPOINT };
  const parsed = normalizeEndpoint(raw);
  if (parsed.ok === true) {
    return { source: "env", endpoint: parsed.endpoint, warning: parsed.warning };
  }
  return { source: "default", endpoint: DEFAULT_ENDPOINT, warning: parsed.error };
}

export function normalizeEndpoint(
  raw: string,
): { ok: true; endpoint: string; warning?: string } | { ok: false; error: string } {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: `${ENV_ENDPOINT} must use http:// or https://.` };
    }
    if (url.username || url.password) {
      return { ok: false, error: `${ENV_ENDPOINT} must not include username or password.` };
    }
    url.hash = "";
    url.search = "";
    const endpoint = url.toString().replace(/\/+$/, "/");
    return {
      ok: true,
      endpoint,
      warning: url.protocol === "http:" ? `${ENV_ENDPOINT} is using plain HTTP.` : undefined,
    };
  } catch {
    return { ok: false, error: `${ENV_ENDPOINT} is not a valid URL.` };
  }
}

export async function loginSfDocs(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const pasted = await callbacks.onPrompt({
    message: `Paste your SF Docs MCP token. Pi stores it locally for ${PROVIDER_NAME}; set ${ENV_TOKEN} for automation instead.`,
  });
  const token = pasted.trim();
  if (!token) throw new Error("No SF Docs token provided.");
  return {
    refresh: MANUAL_REFRESH_SENTINEL,
    access: token,
    expires: Date.now() + LONG_LIVED_EXPIRY_MS,
  };
}

export async function refreshSfDocsToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  return { ...credentials, expires: Date.now() + LONG_LIVED_EXPIRY_MS };
}
