/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi-owned Fin workspace credential.
 *
 * `/login sf-fin` asks for the hosting region, then collects the personal API
 * token through SF Pi's shared fixed-mask input. Pi alone persists the result
 * (API key plus non-secret `credential.env.INTERCOM_REGION`) and `/logout
 * sf-fin` owns removal. `INTERCOM_TOKEN` / `INTERCOM_REGION` remain automation
 * fallbacks. SF Fin never reads or writes the Fin CLI's own keychain or
 * `~/.intercom` files.
 */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  hasPiAuthProviderApiKey,
  readPiAuthProviderEnv,
} from "../../../lib/common/pi-auth-status.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "../../../lib/common/secure-credential-prompt.ts";
import {
  DEFAULT_REGION,
  ENV_REGION,
  ENV_TOKEN,
  FIN_REGIONS,
  PROVIDER_NAME,
  type FinRegion,
  type FinTokenSource,
} from "./types.ts";

type ExtensionMode = ExtensionContext["mode"];

export interface SfFinAuthController {
  provider: ReturnType<typeof createAuthOnlyProvider>;
  bind(ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
}

/** Resolved credential handed only to the CLI runner. Never rendered or logged. */
export interface FinCredential {
  token: string;
  source: Exclude<FinTokenSource, "none">;
  region: FinRegion;
}

export type FinCredentialResult =
  { ok: true; credential: FinCredential } | { ok: false; message: string };

const REGION_LABELS: Record<FinRegion, string> = {
  us: "US — app.intercom.com",
  eu: "EU — app.eu.intercom.com",
  au: "Australia — app.au.intercom.com",
};

export function normalizeRegion(value: string | undefined | null): FinRegion | undefined {
  const normalized = value?.trim().toLowerCase();
  return FIN_REGIONS.find((region) => region === normalized);
}

async function promptRegion(interaction: AuthInteraction): Promise<FinRegion> {
  const current =
    normalizeRegion(readPiAuthProviderEnv(PROVIDER_NAME, ENV_REGION)) ?? DEFAULT_REGION;
  // Put the current (or default) region first so Enter keeps it.
  const ordered = [current, ...FIN_REGIONS.filter((region) => region !== current)];
  const selected = await interaction.prompt({
    type: "select",
    message: "Fin workspace hosting region (from your workspace URL)",
    options: ordered.map((region) => ({ id: region, label: REGION_LABELS[region] })),
  });
  const region = normalizeRegion(selected);
  if (!region) throw new Error(`Unsupported Fin region: choose one of ${FIN_REGIONS.join(", ")}.`);
  return region;
}

export function createSfFinAuthController(
  promptBridge: SecureCredentialPromptBridge = createSecureCredentialPromptBridge({
    title: "SF Fin personal API token",
    description:
      "Create it in Fin under Settings → Personal → API tokens. The value is masked and is not added to the session.",
  }),
): SfFinAuthController {
  const provider = createAuthOnlyProvider({
    id: PROVIDER_NAME,
    name: "SF Fin",
    auth: {
      apiKey: {
        name: "Fin personal API token",
        login: async (interaction) => {
          const region = await promptRegion(interaction);
          const credential = await loginWithSecureCredentialPrompt(promptBridge, interaction);
          return { ...credential, env: { [ENV_REGION]: region } };
        },
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          const envToken = (await ctx.env(ENV_TOKEN))?.trim();
          const token = saved || envToken;
          if (!token) return undefined;
          const region =
            normalizeRegion(credential?.env?.[ENV_REGION]) ??
            normalizeRegion(await ctx.env(ENV_REGION)) ??
            DEFAULT_REGION;
          return {
            auth: { apiKey: token },
            env: { [ENV_REGION]: region },
            source: saved ? "Pi saved credential" : ENV_TOKEN,
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

export const sfFinAuthController = createSfFinAuthController();

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Status-only source detection. Never returns token values. */
export function detectTokenSource(): FinTokenSource {
  if (hasPiAuthProviderApiKey(PROVIDER_NAME)) return "pi-auth";
  return getEnv(ENV_TOKEN) ? "env" : "none";
}

/** Status-only region detection: saved credential env, then automation env, then default. */
export function detectRegion(): { region: FinRegion; source: "pi-auth" | "env" | "default" } {
  const saved = normalizeRegion(readPiAuthProviderEnv(PROVIDER_NAME, ENV_REGION));
  if (saved) return { region: saved, source: "pi-auth" };
  const env = normalizeRegion(getEnv(ENV_REGION));
  if (env) return { region: env, source: "env" };
  return { region: DEFAULT_REGION, source: "default" };
}

export function hasStoredFinCredential(): boolean {
  return hasPiAuthProviderApiKey(PROVIDER_NAME);
}

export function notConnectedMessage(): string {
  return [
    "SF Fin is not connected.",
    `Run /login ${PROVIDER_NAME} in interactive TUI mode; SF Pi asks for the region, then masks the personal API token.`,
    `For automation, set ${ENV_TOKEN} (and optionally ${ENV_REGION}) before starting Pi.`,
  ].join("\n");
}

/** Execution-path resolution: Pi provider auth first, then the automation env fallback. */
export async function getFinCredential(ctx: ExtensionContext): Promise<FinCredentialResult> {
  const getProviderAuth = ctx.modelRegistry.getProviderAuth;
  if (typeof getProviderAuth === "function") {
    try {
      const resolved = await getProviderAuth.call(ctx.modelRegistry, PROVIDER_NAME);
      const token = resolved?.auth?.apiKey?.trim();
      if (token) {
        const source = resolved?.source === ENV_TOKEN ? "env" : "pi-auth";
        const region = normalizeRegion(resolved?.env?.[ENV_REGION]) ?? detectRegion().region;
        return { ok: true, credential: { token, source, region } };
      }
    } catch {
      // Fall through to the automation fallback below.
    }
  }

  const envToken = getEnv(ENV_TOKEN);
  if (envToken) {
    return {
      ok: true,
      credential: { token: envToken, source: "env", region: detectRegion().region },
    };
  }
  return { ok: false, message: notConnectedMessage() };
}
