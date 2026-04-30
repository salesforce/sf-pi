/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Token resolution and auth provider registration for sf-slack.
 *
 * Token resolution priority:
 *   1. Pi auth store (~/.pi/agent/auth.json via /login sf-slack) — recommended default
 *   2. macOS Keychain (hardware-backed) — optional local secret storage on macOS
 *   3. Environment variable (SLACK_USER_TOKEN) — best for automation / CI
 */
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  PROVIDER_NAME,
  SLACK_API_BASE,
  LONG_LIVED_EXPIRY_MS,
  MANUAL_REFRESH_SENTINEL,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  ENV_TOKEN,
  ENV_CLIENT_ID,
  ENV_CLIENT_SECRET,
  ENV_REDIRECT_URI,
  ENV_SCOPES,
  DEFAULT_SCOPES,
  type SlackToolResult,
} from "./types.ts";

interface SlackOAuthResponse {
  ok?: boolean;
  error?: string;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  authed_user?: {
    access_token?: string;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function oauthScopes(): string {
  return getEnv(ENV_SCOPES) || DEFAULT_SCOPES;
}

// ─── Local token sources ────────────────────────────────────────────────────────

/** Read token from macOS Keychain (optional local secret storage on macOS). */
function getTokenFromKeychain(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const token = execSync(
      `security find-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 },
    ).trim();
    return token || null;
  } catch {
    return null;
  }
}

// ─── Token source detection (for runtime + status display) ─────────────────────

export type TokenSource = "keychain" | "env" | "pi-auth" | "none";

export interface TokenResolution {
  source: Exclude<TokenSource, "none">;
  token: string;
}

function getPiAuthStorePath(): string {
  return globalAgentPath("auth.json");
}

export function readPiAuthToken(authPath: string): string | null {
  if (!existsSync(authPath)) return null;

  try {
    const authData = JSON.parse(readFileSync(authPath, "utf-8")) as Record<
      string,
      {
        access?: string;
        token?: string;
      }
    >;
    const entry = authData?.[PROVIDER_NAME];
    const token = entry?.access || entry?.token;
    return typeof token === "string" && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

export function getTokenFromPiAuthStore(): string | null {
  return readPiAuthToken(getPiAuthStorePath());
}

export function resolveTokenCandidates(candidates: {
  piAuthToken?: string | null;
  keychainToken?: string | null;
  envToken?: string | null;
}): TokenResolution | null {
  // Keep `/login sf-slack` as the default path. If users configure multiple
  // sources, Pi-managed auth wins so status and runtime behavior stay simple.
  const orderedSources: TokenResolution[] = [
    { source: "pi-auth", token: candidates.piAuthToken || "" },
    { source: "keychain", token: candidates.keychainToken || "" },
    { source: "env", token: candidates.envToken || "" },
  ];

  for (const candidate of orderedSources) {
    const token = candidate.token.trim();
    if (token) {
      return { source: candidate.source, token };
    }
  }

  return null;
}

export function resolveConfiguredToken(): TokenResolution | null {
  return resolveTokenCandidates({
    piAuthToken: getTokenFromPiAuthStore(),
    keychainToken: getTokenFromKeychain(),
    envToken: getEnv(ENV_TOKEN),
  });
}

export function detectTokenSource(): TokenSource {
  return resolveConfiguredToken()?.source || "none";
}

/** Resolve token from local, status-friendly sources without needing an extension ctx. */
export function resolveTokenFromConfiguredSources(): string | null {
  return resolveConfiguredToken()?.token || null;
}

/** Full token resolution: local sources first, then model-registry fallback. */
export async function getSlackToken(
  ctx: ExtensionContext,
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  const configuredToken = resolveConfiguredToken();
  if (configuredToken) {
    return { ok: true, token: configuredToken.token };
  }

  const token = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_NAME);
  if (!token) {
    return {
      ok: false,
      message: [
        "Slack auth is not configured.",
        "Recommended setup:",
        `1. Run /login ${PROVIDER_NAME}`,
        `2. Or store in macOS Keychain: security add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w "xoxp-your-token" -U`,
        `3. Or set ${ENV_TOKEN}=xoxp-... for automation`,
      ].join("\n"),
    };
  }

  return { ok: true, token };
}

/** Auth guard helper for tool execute functions. */
export async function requireAuth(
  ctx: ExtensionContext,
): Promise<{ ok: true; token: string } | { ok: false; result: SlackToolResult }> {
  const auth = await getSlackToken(ctx);
  if (!auth.ok) {
    const failedAuth = auth as { ok: false; message: string };
    return {
      ok: false,
      result: {
        content: [{ type: "text", text: failedAuth.message }],
        details: { ok: false, reason: "missing_auth" },
      },
    };
  }

  return {
    ok: true,
    token: auth.token,
  };
}

// ─── Token display helpers ──────────────────────────────────────────────────────

export function maskToken(token: string): string {
  if (token.length <= 12) return "***";
  return `${token.substring(0, 6)}…${token.substring(token.length - 4)}`;
}

export function formatExpiry(expiresMs: number): string {
  const now = Date.now();
  if (expiresMs <= 0) return "unknown";
  const remaining = expiresMs - now;
  if (remaining <= 0) return "EXPIRED";
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  if (days > 365) return `~${Math.floor(days / 365)} years (long-lived token)`;
  if (days > 30) return `~${Math.floor(days / 30)} months`;
  if (days > 0) return `${days} day${days > 1 ? "s" : ""}`;
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  const minutes = Math.floor(remaining / (1000 * 60));
  return `${minutes} minute${minutes > 1 ? "s" : ""}`;
}

// ─── OAuth provider callbacks ───────────────────────────────────────────────────

export async function loginSlack(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const clientId = getEnv(ENV_CLIENT_ID);
  const clientSecret = getEnv(ENV_CLIENT_SECRET);
  const redirectUri = getEnv(ENV_REDIRECT_URI);

  if (clientId && clientSecret && redirectUri) {
    const state = globalThis.crypto?.randomUUID?.() || `${Date.now()}`;
    const authParams = new URLSearchParams({
      client_id: clientId,
      scope: oauthScopes(),
      redirect_uri: redirectUri,
      user_scope: oauthScopes(),
      state,
    });

    callbacks.onAuth({
      url: `https://slack.com/oauth/v2/authorize?${authParams.toString()}`,
      instructions: "Authenticate with Slack, then paste the callback URL.",
    });

    const callbackUrl = (
      await callbacks.onPrompt({ message: "Paste the full Slack callback URL:" })
    ).trim();
    const code = new URL(callbackUrl).searchParams.get("code");
    if (!code) throw new Error("No OAuth code found in callback URL.");

    const tokenResponse = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    const data = (await tokenResponse.json()) as SlackOAuthResponse;
    if (!tokenResponse.ok || !data.ok) {
      throw new Error(
        data.error || `Slack OAuth exchange failed with HTTP ${tokenResponse.status}`,
      );
    }

    const accessToken = data.authed_user?.access_token || data.access_token;
    if (!accessToken) throw new Error("Slack OAuth did not return an access token.");

    const expiresIn = Number(data.expires_in || 0);
    return {
      refresh: data.refresh_token || MANUAL_REFRESH_SENTINEL,
      access: accessToken,
      expires:
        expiresIn > 0
          ? Date.now() + expiresIn * 1000 - 5 * 60 * 1000
          : Date.now() + LONG_LIVED_EXPIRY_MS,
    };
  }

  const token = (
    await callbacks.onPrompt({
      message:
        `Paste a Slack user token (xoxp-...). ` +
        `Pi will store it for ${PROVIDER_NAME}, or you can set ${ENV_TOKEN} for automation instead:`,
    })
  ).trim();
  if (!token) throw new Error("No Slack token provided.");

  return {
    refresh: MANUAL_REFRESH_SENTINEL,
    access: token,
    expires: Date.now() + LONG_LIVED_EXPIRY_MS,
  };
}

export async function refreshSlackToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const clientId = getEnv(ENV_CLIENT_ID);
  const clientSecret = getEnv(ENV_CLIENT_SECRET);

  if (
    credentials.refresh &&
    credentials.refresh !== MANUAL_REFRESH_SENTINEL &&
    clientId &&
    clientSecret
  ) {
    const response = await fetch(`${SLACK_API_BASE}/oauth.v2.access`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credentials.refresh,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    const data = (await response.json()) as SlackOAuthResponse;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Slack token refresh failed with HTTP ${response.status}`);
    }

    const accessToken = data.authed_user?.access_token || data.access_token;
    if (!accessToken) throw new Error("Slack refresh did not return an access token.");
    const expiresIn = Number(data.expires_in || 0);

    return {
      refresh: data.refresh_token || credentials.refresh,
      access: accessToken,
      expires:
        expiresIn > 0
          ? Date.now() + expiresIn * 1000 - 5 * 60 * 1000
          : Date.now() + LONG_LIVED_EXPIRY_MS,
    };
  }

  return {
    ...credentials,
    expires: Date.now() + LONG_LIVED_EXPIRY_MS,
  };
}
