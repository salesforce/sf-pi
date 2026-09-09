/* SPDX-License-Identifier: Apache-2.0 */
/** Endpoint-only Pi login and resolution for the unauthenticated SF Docs service. */
import type { AuthInteraction } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readPiAuthProviderEnv } from "../../../lib/common/pi-auth-status.ts";
import { createAuthOnlyProvider } from "../../../lib/common/auth-only-provider.ts";
import {
  ENV_ENDPOINT,
  PROVIDER_NAME,
  type EndpointResolution,
  type EndpointSource,
} from "./types.ts";

export type DocsEndpointFailureReason = "missing_endpoint" | "invalid_endpoint";

export type DocsEndpointResult =
  | {
      ok: true;
      endpoint: string;
      source: Exclude<EndpointSource, "none">;
    }
  | { ok: false; message: string; reason: DocsEndpointFailureReason };

async function promptDocsEndpoint(interaction: AuthInteraction): Promise<string> {
  const current = readPiAuthProviderEnv(PROVIDER_NAME, ENV_ENDPOINT) ?? getEnv(ENV_ENDPOINT);
  const entered = (
    await interaction.prompt({
      type: "text",
      message: current
        ? "SF Docs endpoint URL (press Enter to keep current)"
        : "SF Docs endpoint URL",
      placeholder: current ?? "https://docs.example.com/",
    })
  ).trim();
  const candidate = entered || current;
  if (!candidate) throw new Error("A valid http:// or https:// Docs endpoint is required.");
  const parsed = normalizeEndpoint(candidate);
  if (parsed.ok === false) throw new Error(parsed.error);
  return parsed.endpoint;
}

export function createSfDocsProvider() {
  return createAuthOnlyProvider({
    id: PROVIDER_NAME,
    name: "SF Docs",
    auth: {
      apiKey: {
        name: "SF Docs endpoint",
        login: async (interaction) => ({
          type: "api_key",
          env: { [ENV_ENDPOINT]: await promptDocsEndpoint(interaction) },
        }),
        resolve: async ({ ctx, credential }) => {
          const raw = credential?.env?.[ENV_ENDPOINT] ?? (await ctx.env(ENV_ENDPOINT));
          if (!raw?.trim()) return undefined;
          const parsed = normalizeEndpoint(raw);
          if (parsed.ok === false) throw new Error(parsed.error);
          return {
            auth: { baseUrl: parsed.endpoint },
            env: { [ENV_ENDPOINT]: parsed.endpoint },
            source: credential?.env?.[ENV_ENDPOINT] ? "Pi saved endpoint" : ENV_ENDPOINT,
          };
        },
      },
    },
  });
}

export const sfDocsProvider = createSfDocsProvider();

function getEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
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

export async function getDocsEndpoint(ctx: ExtensionContext): Promise<DocsEndpointResult> {
  const endpoint = (await readEndpointFromProviderAuth(ctx)) ?? resolveEndpoint();
  if (endpoint.ok === false) {
    return {
      ok: false,
      message: endpoint.error,
      reason: endpoint.source === "none" ? "missing_endpoint" : "invalid_endpoint",
    };
  }
  return {
    ok: true,
    endpoint: endpoint.endpoint,
    source: endpoint.source,
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
        "Run /login sf-docs in interactive TUI mode and enter the internally supplied endpoint URL.",
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
