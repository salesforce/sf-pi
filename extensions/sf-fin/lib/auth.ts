/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi-owned Fin workspace credentials, one pair per named workspace.
 *
 * - `default` workspace: `/login sf-fin` (personal API token) and
 *   `/login sf-fin-agent` (Fin Agent API key), unchanged for existing users.
 * - Named workspace `<name>`: `/login sf-fin-<name>` and
 *   `/login sf-fin-agent-<name>`.
 *
 * Personal-token login collects the token through SF Pi's shared fixed-mask
 * input, then detects the region by calling `/me` on the fixed regional hosts
 * and stores it as non-secret `credential.env.INTERCOM_REGION`. The region
 * question appears only when detection cannot reach the Fin API. Pi alone
 * persists credentials and `/logout` owns removal. `INTERCOM_TOKEN` /
 * `INTERCOM_REGION` / `FIN_AGENT_API_KEY` remain automation fallbacks for the
 * default workspace only. SF Fin never reads or writes the Fin CLI's own
 * keychain or `~/.intercom` files.
 */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  getPiAuthStorePath,
  hasPiAuthProviderApiKey,
  readPiAuthProviderEnv,
} from "../../../lib/common/pi-auth-status.ts";
import {
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
  type SecureCredentialPromptBridge,
} from "../../../lib/common/secure-credential-prompt.ts";
import { AGENT_API_ENV_KEY } from "./agent-api.ts";
import { agentKeyShapeIssue, sameSecret } from "./agent-key.ts";
import { discoverRegion } from "./region.ts";
import {
  DEFAULT_REGION,
  ENV_REGION,
  ENV_TOKEN,
  FIN_REGIONS,
  type FinRegion,
  type FinTokenSource,
} from "./types.ts";
import { DEFAULT_WORKSPACE, workspaceProviders } from "./workspaces.ts";

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

const isDefault = (workspace: string) => workspace === DEFAULT_WORKSPACE;

async function promptRegion(interaction: AuthInteraction, provider: string): Promise<FinRegion> {
  const current = normalizeRegion(readPiAuthProviderEnv(provider, ENV_REGION)) ?? DEFAULT_REGION;
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

export interface PersonalAuthOptions {
  workspace?: string;
  /** Test seam for region discovery. */
  fetch?: typeof fetch;
}

export function createSfFinAuthController(
  promptBridge: SecureCredentialPromptBridge = createSecureCredentialPromptBridge({
    title: "SF Fin personal API token",
    description:
      "Create it in Fin under Settings → Personal → API tokens. The value is masked and is not added to the session.",
  }),
  options: PersonalAuthOptions = {},
): SfFinAuthController {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const id = workspaceProviders(workspace).personal;
  const provider = createAuthOnlyProvider({
    id,
    name: isDefault(workspace) ? "SF Fin" : `SF Fin (${workspace})`,
    auth: {
      apiKey: {
        name: isDefault(workspace)
          ? "Fin personal API token"
          : `Fin personal API token (${workspace})`,
        login: async (interaction) => {
          const credential = await loginWithSecureCredentialPrompt(promptBridge, interaction);
          const token = credential.key.trim();
          if (!token) throw new Error("The personal API token is empty.");
          const discovered = await discoverRegion(token, {
            fetch: options.fetch,
            signal: interaction.signal,
          });
          if (discovered.ok === false && discovered.reason === "rejected_everywhere") {
            throw new Error(discovered.message);
          }
          const region = discovered.ok
            ? discovered.identity.region
            : await promptRegion(interaction, id);
          if (discovered.ok) {
            interaction.notify({
              type: "info",
              message: `Detected ${region.toUpperCase()} workspace${discovered.identity.workspaceName ? ` "${discovered.identity.workspaceName}"` : ""}.`,
            });
          }
          return { ...credential, key: token, env: { [ENV_REGION]: region } };
        },
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          const envToken = isDefault(workspace) ? (await ctx.env(ENV_TOKEN))?.trim() : undefined;
          const token = saved || envToken;
          if (!token) return undefined;
          const region =
            normalizeRegion(credential?.env?.[ENV_REGION]) ??
            (isDefault(workspace) ? normalizeRegion(await ctx.env(ENV_REGION)) : undefined) ??
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
export function detectTokenSource(workspace: string = DEFAULT_WORKSPACE): FinTokenSource {
  if (hasPiAuthProviderApiKey(workspaceProviders(workspace).personal)) return "pi-auth";
  return isDefault(workspace) && getEnv(ENV_TOKEN) ? "env" : "none";
}

/** Status-only region detection: saved credential env, then automation env, then default. */
export function detectRegion(workspace: string = DEFAULT_WORKSPACE): {
  region: FinRegion;
  source: "pi-auth" | "env" | "default";
} {
  const saved = normalizeRegion(
    readPiAuthProviderEnv(workspaceProviders(workspace).personal, ENV_REGION),
  );
  if (saved) return { region: saved, source: "pi-auth" };
  const env = isDefault(workspace) ? normalizeRegion(getEnv(ENV_REGION)) : undefined;
  if (env) return { region: env, source: "env" };
  return { region: DEFAULT_REGION, source: "default" };
}

export function hasStoredFinCredential(workspace: string = DEFAULT_WORKSPACE): boolean {
  return hasPiAuthProviderApiKey(workspaceProviders(workspace).personal);
}

export function notConnectedMessage(workspace: string = DEFAULT_WORKSPACE): string {
  const login = `/login ${workspaceProviders(workspace).personal}`;
  return [
    isDefault(workspace)
      ? "SF Fin is not connected."
      : `Fin workspace "${workspace}" is not connected.`,
    `Run ${login} in interactive TUI mode; SF Pi masks the personal API token and detects the region.`,
    ...(isDefault(workspace)
      ? [`For automation, set ${ENV_TOKEN} (and optionally ${ENV_REGION}) before starting Pi.`]
      : []),
  ].join("\n");
}

/** Execution-path resolution: Pi provider auth first, then the automation env fallback. */
export async function getFinCredential(
  ctx: ExtensionContext,
  workspace: string = DEFAULT_WORKSPACE,
): Promise<FinCredentialResult> {
  const provider = workspaceProviders(workspace).personal;
  const getProviderAuth = ctx.modelRegistry.getProviderAuth;
  if (typeof getProviderAuth === "function") {
    try {
      const resolved = await getProviderAuth.call(ctx.modelRegistry, provider);
      const token = resolved?.auth?.apiKey?.trim();
      if (token) {
        const source = resolved?.source === ENV_TOKEN ? "env" : "pi-auth";
        const region =
          normalizeRegion(resolved?.env?.[ENV_REGION]) ?? detectRegion(workspace).region;
        return { ok: true, credential: { token, source, region } };
      }
    } catch {
      // Fall through to the automation fallback below.
    }
  }

  const envToken = isDefault(workspace) ? getEnv(ENV_TOKEN) : undefined;
  if (envToken) {
    return {
      ok: true,
      credential: { token: envToken, source: "env", region: detectRegion(workspace).region },
    };
  }
  return { ok: false, message: notConnectedMessage(workspace) };
}

/**
 * Fin Agent API key: a separate Pi provider per workspace. The Fin Agent API
 * uses its own workspace key, distinct from the personal token the Fin CLI
 * uses, so the two are stored and revoked independently. It is sent only as
 * an HTTPS Authorization header, never to the CLI.
 */
export function createSfFinAgentAuthController(
  promptBridge: SecureCredentialPromptBridge = createSecureCredentialPromptBridge({
    title: "SF Fin Agent API key",
    description:
      "Generate it in Fin under Fin AI Agent → Deploy → Fin Agent API (after access is granted). It is separate from the personal API token. The value is masked and is not added to the session.",
  }),
  options: { workspace?: string } = {},
): SfFinAuthController {
  const workspace = options.workspace ?? DEFAULT_WORKSPACE;
  const providers = workspaceProviders(workspace);
  const provider = createAuthOnlyProvider({
    id: providers.agent,
    name: isDefault(workspace) ? "SF Fin Agent API" : `SF Fin Agent API (${workspace})`,
    auth: {
      apiKey: {
        name: isDefault(workspace) ? "Fin Agent API key" : `Fin Agent API key (${workspace})`,
        login: async (interaction) => {
          const credential = await loginWithSecureCredentialPrompt(promptBridge, interaction);
          // Fail before Pi persists anything: malformed keys and the personal
          // token pasted into the wrong slot are rejected at login.
          const issue = agentKeyShapeIssue(credential.key);
          if (issue) throw new Error(issue);
          if (sameSecret(credential.key, readSavedPersonalToken(providers.personal))) {
            throw new Error(
              `That is the personal API token used by /login ${providers.personal}. Paste the separate Fin Agent API key from Fin AI Agent → Deploy → Fin Agent API.`,
            );
          }
          return { ...credential, key: credential.key.trim() };
        },
        resolve: async ({ ctx, credential }) => {
          const saved = credential?.key?.trim();
          const envKey = isDefault(workspace)
            ? (await ctx.env(AGENT_API_ENV_KEY))?.trim()
            : undefined;
          const key = saved || envKey;
          if (!key) return undefined;
          return {
            auth: { apiKey: key },
            source: saved ? "Pi saved credential" : AGENT_API_ENV_KEY,
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

export const sfFinAgentAuthController = createSfFinAgentAuthController();

/**
 * The saved personal token, read only for the login-time separation check and
 * compared in constant time; it is never returned to callers outside this file.
 */
function readSavedPersonalToken(provider: string): string | undefined {
  try {
    const path = getPiAuthStorePath();
    if (!existsSync(path)) return undefined;
    const credential = readStoredCredential(provider, path) as { key?: unknown } | undefined;
    return typeof credential?.key === "string" ? credential.key : undefined;
  } catch {
    return undefined;
  }
}

export async function getFinAgentApiKey(
  ctx: ExtensionContext,
  workspace: string = DEFAULT_WORKSPACE,
): Promise<{ ok: true; key: string; region: FinRegion } | { ok: false; message: string }> {
  const region = detectRegion(workspace).region;
  const provider = workspaceProviders(workspace).agent;
  const getProviderAuth = ctx.modelRegistry.getProviderAuth;
  if (typeof getProviderAuth === "function") {
    try {
      const resolved = await getProviderAuth.call(ctx.modelRegistry, provider);
      const key = resolved?.auth?.apiKey?.trim();
      if (key) return { ok: true, key, region };
    } catch {
      // Fall through to the automation fallback below.
    }
  }
  const envKey = isDefault(workspace) ? getEnv(AGENT_API_ENV_KEY) : undefined;
  if (envKey) return { ok: true, key: envKey, region };
  return {
    ok: false,
    message: [
      isDefault(workspace)
        ? "No Fin Agent API key is saved."
        : `No Fin Agent API key is saved for workspace "${workspace}".`,
      "The Fin Agent API is granted per workspace on request (Settings → Integrations → Fin Agent API). Once granted, generate the key under Fin AI Agent → Deploy → Fin Agent API.",
      `Then run /login ${provider} in interactive TUI mode (masked)${isDefault(workspace) ? `, or set ${AGENT_API_ENV_KEY} for automation` : ""}.`,
    ].join("\n"),
  };
}
