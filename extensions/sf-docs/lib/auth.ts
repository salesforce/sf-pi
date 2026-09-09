/* SPDX-License-Identifier: Apache-2.0 */
/** Credential and endpoint resolution for SF Docs. */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  readPiAuthProviderEnv,
  readPiAuthProviderStatus,
} from "../../../lib/common/pi-auth-status.ts";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "../../../lib/common/secure-credential-prompt.ts";
import {
  ENV_ENDPOINT,
  ENV_TOKEN,
  LONG_LIVED_EXPIRY_MS,
  MANUAL_REFRESH_SENTINEL,
  PROVIDER_NAME,
  type EndpointResolution,
  type TokenResolution,
  type TokenSource,
} from "./types.ts";

type ExtensionMode = ExtensionContext["mode"];

export interface SfDocsAuthController {
  provider: ReturnType<typeof createAuthOnlyProvider>;
  bind(ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
}

export type DocsAuthFailureReason = "missing_auth" | "missing_endpoint" | "invalid_endpoint";

export type DocsAuthResult =
  | {
      ok: true;
      token: string;
      source: Exclude<TokenSource, "none">;
      endpoint: string;
      endpointSource: Exclude<EndpointResolution["source"], "none">;
    }
  | { ok: false; message: string; reason: DocsAuthFailureReason };

async function promptDocsEndpoint(interaction: AuthInteraction): Promise<string> {
  const current = readPiAuthProviderEnv(PROVIDER_NAME, ENV_ENDPOINT);
  const entered = (
    await interaction.prompt({
      type: "text",
      message: current
        ? "SF Docs endpoint URL (press Enter to keep current)"
        : "SF Docs endpoint URL",
      placeholder: current ?? "https://docs.example.com",
    })
  ).trim();
  const candidate = entered || current;
  if (!candidate) throw new Error("A valid http:// or https:// Docs endpoint is required.");
  const parsed = normalizeEndpoint(candidate);
  if (parsed.ok === false) throw new Error(parsed.error);
  return parsed.endpoint;
}

function readCredentialEnv(credential: unknown, name: string): string | undefined {
  if (!credential || typeof credential !== "object") return undefined;
  const env = (credential as { env?: unknown }).env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return undefined;
  const value = (env as Record<string, unknown>)[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createSfDocsAuthController(
  promptBridge: SecureCredentialPromptBridge = createSecureCredentialPromptBridge({
    title: "SF Docs credential",
  }),
): SfDocsAuthController {
  const provider = createAuthOnlyProvider({
    id: PROVIDER_NAME,
    name: "SF Docs",
    auth: {
      apiKey: {
        name: "SF Docs token",
        login: async (interaction) => {
          const endpoint = await promptDocsEndpoint(interaction);
          const credential = await loginWithSecureCredentialPrompt(promptBridge, interaction);
          return { ...credential, env: { [ENV_ENDPOINT]: endpoint } };
        },
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          const envToken = (await ctx.env(ENV_TOKEN))?.trim();
          const token = saved || envToken;
          if (!token) return undefined;
          const endpointRaw = credential?.env?.[ENV_ENDPOINT] || (await ctx.env(ENV_ENDPOINT));
          const parsed = endpointRaw ? normalizeEndpoint(endpointRaw) : undefined;
          return {
            auth: {
              apiKey: token,
              ...(parsed?.ok === true ? { baseUrl: parsed.endpoint } : {}),
            },
            ...(parsed?.ok === true ? { env: { [ENV_ENDPOINT]: parsed.endpoint } } : {}),
            source: saved ? "Pi saved credential" : ENV_TOKEN,
          };
        },
      },
      oauth: {
        name: "SF Docs compatible credential",
        login: async (interaction) => {
          const endpoint = await promptDocsEndpoint(interaction);
          return {
            type: "oauth",
            access: await promptBridge.prompt(interaction.signal),
            refresh: MANUAL_REFRESH_SENTINEL,
            expires: Date.now() + LONG_LIVED_EXPIRY_MS,
            env: { [ENV_ENDPOINT]: endpoint },
          };
        },
        refresh: async (credential) => ({
          ...credential,
          expires: Date.now() + LONG_LIVED_EXPIRY_MS,
        }),
        toAuth: async (credential) => {
          const access = credential.access?.trim();
          const parsed = readCredentialEnv(credential, ENV_ENDPOINT);
          const endpoint = parsed ? normalizeEndpoint(parsed) : undefined;
          return {
            ...(access ? { apiKey: access } : {}),
            ...(endpoint?.ok === true ? { baseUrl: endpoint.endpoint } : {}),
          };
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

export const sfDocsAuthController = createSfDocsAuthController();

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
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
  return resolveTokenCandidates({ envToken: getEnv(ENV_TOKEN) });
}

export function detectTokenSource(): TokenSource {
  if (readPiAuthProviderStatus(PROVIDER_NAME).configured) return "pi-auth";
  return resolveConfiguredToken()?.source ?? "none";
}

export function isDocsConfigured(): boolean {
  return detectTokenSource() !== "none" && resolveEndpoint().ok === true;
}

export async function getDocsToken(
  ctx: ExtensionContext,
): Promise<
  { ok: true; token: string; source: Exclude<TokenSource, "none"> } | { ok: false; message: string }
> {
  const token = await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_NAME);
  if (token?.trim()) return { ok: true, token: token.trim(), source: "pi-auth" };

  const configured = resolveConfiguredToken();
  if (configured) return { ok: true, token: configured.token, source: configured.source };

  return {
    ok: false,
    message: [
      "SF Docs is not connected.",
      "Run /login sf-docs in interactive TUI mode; SF Pi prompts for the endpoint URL then masks the token.",
      `For automation, set ${ENV_TOKEN} and ${ENV_ENDPOINT} before starting Pi.`,
    ].join("\n"),
  };
}

async function readEndpointFromProviderAuth(
  ctx: ExtensionContext,
): Promise<EndpointResolution | null> {
  const getProviderAuth = ctx.modelRegistry.getProviderAuth;
  if (typeof getProviderAuth !== "function") return null;
  try {
    const result = await getProviderAuth(PROVIDER_NAME);
    const raw = result?.env?.[ENV_ENDPOINT] ?? result?.auth?.baseUrl;
    if (!raw?.trim()) return null;
    const parsed = normalizeEndpoint(raw);
    if (parsed.ok === true) {
      return { ok: true, source: "pi-auth", endpoint: parsed.endpoint, warning: parsed.warning };
    }
    return { ok: false, source: "pi-auth", error: parsed.error };
  } catch {
    return null;
  }
}

export async function getDocsAuth(ctx: ExtensionContext): Promise<DocsAuthResult> {
  const token = await getDocsToken(ctx);
  const endpoint = (await readEndpointFromProviderAuth(ctx)) ?? resolveEndpoint();
  if (token.ok === false) {
    return { ok: false, message: token.message, reason: "missing_auth" };
  }
  if (endpoint.ok === false) {
    return {
      ok: false,
      message: endpoint.error,
      reason: endpoint.source === "none" ? "missing_endpoint" : "invalid_endpoint",
    };
  }
  return {
    ok: true,
    token: token.token,
    source: token.source,
    endpoint: endpoint.endpoint,
    endpointSource: endpoint.source,
  };
}

export function resolveEndpoint(): EndpointResolution {
  const fromCredential = readPiAuthProviderEnv(PROVIDER_NAME, ENV_ENDPOINT);
  if (fromCredential) {
    const parsed = normalizeEndpoint(fromCredential);
    if (parsed.ok === true) {
      return { ok: true, source: "pi-auth", endpoint: parsed.endpoint, warning: parsed.warning };
    }
    return { ok: false, source: "pi-auth", error: parsed.error };
  }
  const raw = getEnv(ENV_ENDPOINT);
  if (!raw) {
    return {
      ok: false,
      source: "none",
      error: [
        "SF Docs endpoint is not configured.",
        "Run /login sf-docs in interactive TUI mode; SF Pi prompts for the endpoint URL then masks the token.",
        `For automation, set ${ENV_ENDPOINT} before starting Pi.`,
      ].join("\n"),
    };
  }
  const parsed = normalizeEndpoint(raw);
  if (parsed.ok === true) {
    return { ok: true, source: "env", endpoint: parsed.endpoint, warning: parsed.warning };
  }
  return { ok: false, source: "env", error: parsed.error };
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
    if (url.protocol === "http:" && !isLoopbackHost(url.hostname)) {
      return {
        ok: false,
        error: `${ENV_ENDPOINT} must use HTTPS unless the host is loopback.`,
      };
    }
    url.hash = "";
    url.search = "";
    const endpoint = url.toString().replace(/\/+$/, "/");
    return {
      ok: true,
      endpoint,
      warning: url.protocol === "http:" ? `${ENV_ENDPOINT} is using loopback HTTP.` : undefined,
    };
  } catch {
    return { ok: false, error: `${ENV_ENDPOINT} is not a valid URL.` };
  }
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") return true;
  const match = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
  return Boolean(match && match.slice(1).every((part) => Number(part) <= 255));
}
