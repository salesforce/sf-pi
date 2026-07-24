/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Token resolution and auth provider registration for sf-slack.
 *
 * Resolution precedence is:
 *
 *   1. Existing Pi auth through `ctx.modelRegistry.getApiKeyForProvider()`.
 *   2. Environment variable (SLACK_USER_TOKEN) for automation / CI.
 *
 * Interactive credential entry uses SF Pi's fixed-mask component while Pi owns
 * credential persistence and logout.
 *
 * Config/status surfaces without ExtensionContext use a shared status-only
 * auth-store adapter that never returns token values.
 *
 */
import type { OAuthCredentials } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readPiAuthProviderStatus } from "../../../lib/common/pi-auth-status.ts";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "../../../lib/common/secure-credential-prompt.ts";
import {
  PROVIDER_NAME,
  SLACK_API_BASE,
  LONG_LIVED_EXPIRY_MS,
  MANUAL_REFRESH_SENTINEL,
  ENV_TOKEN,
  ENV_CLIENT_ID,
  ENV_CLIENT_SECRET,
  ENV_SCOPES,
  DEFAULT_SCOPES,
  type SlackToolResult,
} from "./types.ts";

type ExtensionMode = ExtensionContext["mode"];

export interface SfSlackAuthController {
  provider: ReturnType<typeof createAuthOnlyProvider>;
  bind(ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
}

export function createSfSlackAuthController(
  promptBridge: SecureCredentialPromptBridge = createSecureCredentialPromptBridge({
    title: "SF Slack credential",
  }),
): SfSlackAuthController {
  const provider = createAuthOnlyProvider({
    id: PROVIDER_NAME,
    name: "SF Slack",
    auth: {
      apiKey: {
        name: "SF Slack user token",
        login: (interaction) => loginWithSecureCredentialPrompt(promptBridge, interaction),
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          if (saved) return { auth: { apiKey: saved }, source: "Pi saved credential" };
          const env = (await ctx.env(ENV_TOKEN))?.trim();
          return env ? { auth: { apiKey: env }, source: ENV_TOKEN } : undefined;
        },
      },
      oauth: {
        name: "SF Slack compatible credential",
        login: async (interaction) => ({
          type: "oauth",
          access: await promptBridge.prompt(interaction.signal),
          refresh: MANUAL_REFRESH_SENTINEL,
          expires: Date.now() + LONG_LIVED_EXPIRY_MS,
        }),
        refresh: async (credential) => ({
          ...(await refreshSlackToken(credential)),
          type: "oauth",
        }),
        toAuth: async (credential) => {
          const access = credential.access?.trim();
          return access ? { apiKey: access } : {};
        },
      },
    },
  });

  return {
    provider,
    bind: (ui, mode) => promptBridge.bind(ui, mode),
    clear: () => promptBridge.clear(),
  };
}

export const sfSlackAuthController = createSfSlackAuthController();

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

// ─── Token source detection (for runtime + status display) ─────────────────────

export type TokenSource = "env" | "pi-auth" | "none";

export interface TokenResolution {
  source: Exclude<TokenSource, "none">;
  token: string;
}

export function resolveTokenCandidates(candidates: {
  piAuthToken?: string | null;
  envToken?: string | null;
}): TokenResolution | null {
  // Pi auth store is the canonical persistent source; env var is the
  // explicit automation/CI fallback.
  const orderedSources: TokenResolution[] = [
    { source: "pi-auth", token: candidates.piAuthToken || "" },
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
  return resolveTokenCandidates({ envToken: getEnv(ENV_TOKEN) });
}

export function detectTokenSource(): TokenSource {
  if (readPiAuthProviderStatus(PROVIDER_NAME).configured) return "pi-auth";
  return resolveConfiguredToken()?.source || "none";
}

/** Full token resolution: Pi auth storage first, then automation env fallback. */
export async function getSlackToken(
  ctx: ExtensionContext,
): Promise<
  { ok: true; token: string; source: Exclude<TokenSource, "none"> } | { ok: false; message: string }
> {
  const token = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_NAME);
  if (token?.trim()) {
    return { ok: true, token: token.trim(), source: "pi-auth" };
  }

  const configuredToken = resolveConfiguredToken();
  if (configuredToken) {
    return { ok: true, token: configuredToken.token, source: configuredToken.source };
  }

  return {
    ok: false,
    message: [
      "Slack auth is not configured.",
      "Run /login sf-slack in interactive TUI mode, then /sf-slack refresh.",
      `For automation, set ${ENV_TOKEN}=xoxp-... before starting Pi.`,
    ].join("\n"),
  };
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

// ─── Credential metadata helpers ───────────────────────────────────────────────

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
      }),
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
