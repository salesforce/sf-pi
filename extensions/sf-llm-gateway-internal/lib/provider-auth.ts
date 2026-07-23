/* SPDX-License-Identifier: Apache-2.0 */
/** Complete-Provider authentication and session-scoped configuration for the Gateway. */
import type { ApiKeyAuth, ApiKeyCredential, AuthContext, AuthResult } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
  API_KEY_ENV,
  LEGACY_API_KEY_ENV,
  getGatewayConfig,
  getGlobalOnlyGatewayConfig,
  globalGatewayConfigPath,
  projectGatewayConfigPath,
  readGatewaySavedConfig,
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
}

export interface GatewayProviderAuthDependencies {
  promptBridge: SecureCredentialPromptBridge;
  getConfig(cwd: string | undefined): GatewayProviderAuthConfig;
  getLegacyProjectApiKey(cwd: string): string | undefined;
  getLegacyGlobalApiKey(): string | undefined;
}

export interface GatewayProviderAuthController {
  auth: ApiKeyAuth;
  bind(cwd: string, ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
  getActiveCwd(): string | undefined;
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
    getLegacyProjectApiKey(cwd) {
      return readGatewaySavedConfig(projectGatewayConfigPath(cwd)).apiKey;
    },
    getLegacyGlobalApiKey() {
      return readGatewaySavedConfig(globalGatewayConfigPath()).apiKey;
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function resolveCredential(
  dependencies: GatewayProviderAuthDependencies,
  cwd: string | undefined,
  ctx: AuthContext,
  credential: ApiKeyCredential | undefined,
): Promise<ResolvedCredential | undefined> {
  const native = nonEmpty(credential?.key);
  if (native) return { apiKey: native, source: "Pi saved credential" };

  const primaryEnv = nonEmpty(await ctx.env(API_KEY_ENV));
  if (primaryEnv) return { apiKey: primaryEnv, source: API_KEY_ENV };

  const legacyEnv = nonEmpty(await ctx.env(LEGACY_API_KEY_ENV));
  if (legacyEnv) return { apiKey: legacyEnv, source: LEGACY_API_KEY_ENV };

  if (cwd) {
    const project = nonEmpty(dependencies.getLegacyProjectApiKey(cwd));
    if (project) return { apiKey: project, source: "legacy project Gateway config" };
  }

  const global = nonEmpty(dependencies.getLegacyGlobalApiKey());
  return global ? { apiKey: global, source: "legacy global Gateway config" } : undefined;
}

export function createGatewayProviderAuth(
  dependencies: GatewayProviderAuthDependencies = createDefaultDependencies(),
): GatewayProviderAuthController {
  let activeCwd: string | undefined;

  const resolve = async (
    ctx: AuthContext,
    credential: ApiKeyCredential | undefined,
  ): Promise<AuthResult | undefined> => {
    const config = dependencies.getConfig(activeCwd);
    const baseUrl = config.baseUrl ? toGatewayRootBaseUrl(config.baseUrl) : undefined;
    if (!config.enabled || !baseUrl) return undefined;

    const resolved = await resolveCredential(dependencies, activeCwd, ctx, credential);
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
      login: (interaction) =>
        loginWithSecureCredentialPrompt(dependencies.promptBridge, interaction),
      async check({ ctx, credential }) {
        const result = await resolve(ctx, credential);
        return result ? { type: "api_key", source: result.source } : undefined;
      },
      resolve: ({ ctx, credential }) => resolve(ctx, credential),
    },

    bind(cwd, ui, mode) {
      activeCwd = cwd;
      dependencies.promptBridge.bind(ui, mode);
    },

    clear() {
      activeCwd = undefined;
      dependencies.promptBridge.clear();
    },

    getActiveCwd() {
      return activeCwd;
    },
  };
}
