/* SPDX-License-Identifier: Apache-2.0 */
/** Complete-Provider authentication and session-scoped configuration for the Gateway. */
import {
  defaultProviderAuthContext,
  type ApiKeyAuth,
  type ApiKeyCredential,
  type AuthContext,
  type AuthResult,
} from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionUIContext,
  ModelRegistry,
} from "@earendil-works/pi-coding-agent";
import {
  API_KEY_ENV,
  BASE_URL_ENV,
  LEGACY_API_KEY_ENV,
  PROVIDER_NAME,
  getGatewayConfig,
  getGlobalOnlyGatewayConfig,
  normalizeBaseUrl,
  type ConfigSource,
} from "./config.ts";
import { toGatewayRootBaseUrl } from "./gateway-url.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "./secure-credential-prompt.ts";

type ExtensionMode = ExtensionContext["mode"];

/** Provider-scoped request metadata; this is not read from process.env. */
export const GATEWAY_RESOLVED_ROOT_ENV = "SF_PI_GATEWAY_RESOLVED_ROOT_URL";

export interface GatewayProviderAuthConfig {
  enabled: boolean;
  baseUrl?: string;
  baseUrlSource?: ConfigSource;
}

export interface GatewayProviderAuthDependencies {
  promptBridge: SecureCredentialPromptBridge;
  getConfig(cwd: string | undefined): GatewayProviderAuthConfig;
}

export interface ResolvedGatewayRuntimeAuth {
  apiKey: string;
  baseUrl: string;
  source: string;
}

export interface GatewayProviderAuthController {
  auth: ApiKeyAuth;
  bind(
    cwd: string,
    ui: ExtensionUIContext,
    mode: ExtensionMode,
    modelRegistry?: ModelRegistry,
  ): void;
  clear(): void;
  getActiveCwd(): string | undefined;
  hasConfiguredCredential(): Promise<boolean>;
  resolveRuntimeAuth(cwd?: string): Promise<ResolvedGatewayRuntimeAuth | undefined>;
}

type ResolvedCredential = {
  apiKey: string;
  source: string;
};

function createDefaultDependencies(): GatewayProviderAuthDependencies {
  return {
    promptBridge: createSecureCredentialPromptBridge(),
    getConfig(cwd) {
      return cwd ? getGatewayConfig(cwd) : getGlobalOnlyGatewayConfig();
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function resolveCredential(
  ctx: AuthContext,
  credential: ApiKeyCredential | undefined,
): Promise<ResolvedCredential | undefined> {
  const native = nonEmpty(credential?.key);
  if (native) return { apiKey: native, source: "Pi saved credential" };

  const primaryEnv = nonEmpty(await ctx.env(API_KEY_ENV));
  if (primaryEnv) return { apiKey: primaryEnv, source: API_KEY_ENV };

  const legacyEnv = nonEmpty(await ctx.env(LEGACY_API_KEY_ENV));
  return legacyEnv ? { apiKey: legacyEnv, source: LEGACY_API_KEY_ENV } : undefined;
}

export function createGatewayProviderAuth(
  dependencies: GatewayProviderAuthDependencies = createDefaultDependencies(),
): GatewayProviderAuthController {
  let activeCwd: string | undefined;
  let activeModelRegistry: ModelRegistry | undefined;

  const resolveForCwd = async (
    cwd: string | undefined,
    ctx: AuthContext,
    credential: ApiKeyCredential | undefined,
  ): Promise<AuthResult | undefined> => {
    const config = dependencies.getConfig(cwd);
    const configuredBaseUrl = config.baseUrl ? toGatewayRootBaseUrl(config.baseUrl) : undefined;
    const credentialBaseUrl = credential?.env?.[BASE_URL_ENV]
      ? normalizeBaseUrl(credential.env[BASE_URL_ENV])
      : undefined;
    const baseUrl =
      config.baseUrlSource === "saved"
        ? configuredBaseUrl
        : (credentialBaseUrl ?? configuredBaseUrl);
    if (!config.enabled || !baseUrl) return undefined;

    const resolved = await resolveCredential(ctx, credential);
    if (!resolved) return undefined;

    return {
      auth: { apiKey: resolved.apiKey },
      env: { [GATEWAY_RESOLVED_ROOT_ENV]: baseUrl },
      source: resolved.source,
    };
  };

  return {
    auth: {
      name: "SF LLM Gateway API key",
      async login(interaction) {
        const config = dependencies.getConfig(activeCwd);
        const currentBaseUrl = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : undefined;
        const entered = await interaction.prompt({
          type: "text",
          message: currentBaseUrl
            ? "SF LLM Gateway root URL (press Enter to keep current)"
            : "SF LLM Gateway root URL",
          placeholder: currentBaseUrl ?? "https://gateway.example.com",
        });
        const baseUrl = normalizeBaseUrl(entered.trim() || currentBaseUrl);
        if (!baseUrl) throw new Error("A valid http:// or https:// Gateway URL is required.");
        const credential = await loginWithSecureCredentialPrompt(
          dependencies.promptBridge,
          interaction,
        );
        return {
          ...credential,
          env: { [BASE_URL_ENV]: baseUrl },
        };
      },
      async check({ ctx, credential }) {
        const result = await resolveForCwd(activeCwd, ctx, credential);
        return result ? { type: "api_key", source: result.source } : undefined;
      },
      resolve: ({ ctx, credential }) => resolveForCwd(activeCwd, ctx, credential),
    },

    bind(cwd, ui, mode, modelRegistry) {
      activeCwd = cwd;
      activeModelRegistry = modelRegistry;
      dependencies.promptBridge.bind(ui, mode);
    },

    clear() {
      activeCwd = undefined;
      activeModelRegistry = undefined;
      dependencies.promptBridge.clear();
    },

    getActiveCwd() {
      return activeCwd;
    },

    async hasConfiguredCredential() {
      if (activeModelRegistry?.getProviderAuthStatus(PROVIDER_NAME).configured) return true;
      return Boolean(await resolveCredential(defaultProviderAuthContext(), undefined));
    },

    async resolveRuntimeAuth(cwd = activeCwd) {
      const result = activeModelRegistry
        ? await activeModelRegistry.getProviderAuth(PROVIDER_NAME)
        : await resolveForCwd(cwd, defaultProviderAuthContext(), undefined);
      const apiKey = nonEmpty(result?.auth.apiKey);
      const baseUrl = result?.env?.[GATEWAY_RESOLVED_ROOT_ENV];
      if (!apiKey || !baseUrl) return undefined;
      return {
        apiKey,
        baseUrl: toGatewayRootBaseUrl(baseUrl),
        source: result.source ?? "configured Gateway credential",
      };
    },
  };
}
