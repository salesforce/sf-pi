/* SPDX-License-Identifier: Apache-2.0 */
/** Credential and endpoint resolution for SF Docs. */
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readPiAuthProviderStatus } from "../../../lib/common/pi-auth-status.ts";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "../../../lib/common/secure-credential-prompt.ts";
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

type ExtensionMode = ExtensionContext["mode"];

export interface SfDocsAuthController {
  provider: ReturnType<typeof createAuthOnlyProvider>;
  bind(ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
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
        login: (interaction) => loginWithSecureCredentialPrompt(promptBridge, interaction),
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          if (saved) return { auth: { apiKey: saved }, source: "Pi saved credential" };
          const env = (await ctx.env(ENV_TOKEN))?.trim();
          return env ? { auth: { apiKey: env }, source: ENV_TOKEN } : undefined;
        },
      },
      oauth: {
        name: "SF Docs compatible credential",
        login: async (interaction) => ({
          type: "oauth",
          access: await promptBridge.prompt(interaction.signal),
          refresh: MANUAL_REFRESH_SENTINEL,
          expires: Date.now() + LONG_LIVED_EXPIRY_MS,
        }),
        refresh: async (credential) => ({
          ...credential,
          expires: Date.now() + LONG_LIVED_EXPIRY_MS,
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
      "Run /login sf-docs in interactive TUI mode; SF Pi masks the token and Pi owns persistence.",
      "For automation, set SF_DOCS_MCP_TOKEN before starting Pi.",
    ].join("\n"),
  };
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
