/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Salesforce-aware org opening for SF Browser.
 *
 * The only Salesforce operation here is `sf org open --url-only --json`, run
 * after explicit tool/command intent. The session-bearing URL is passed to
 * agent-browser but never echoed back to the model.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { buildExecFn } from "../../../lib/common/exec-adapter.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { DEFAULT_SF_OPEN_TIMEOUT_MS } from "./constants.ts";
import { redactText, redactUrl } from "./redaction.ts";
import {
  isResolvedSalesforcePath,
  resolveSalesforcePath,
  type SalesforceRoute,
} from "./salesforce-path-resolver.ts";
import { resolveVerifiedRoutePath, type VerifiedRouteResult } from "./salesforce-route-verifier.ts";

export interface OpenOrgInput {
  target_org?: string;
  path?: string;
  setup?: string;
  route?: SalesforceRoute;
  purpose?: string;
}

export interface OpenOrgUrlResult {
  targetOrg: string;
  path?: string;
  url: string;
  verifiedRoute?: VerifiedRouteResult;
}

export async function resolveOpenOrgUrl(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
  signal?: AbortSignal,
): Promise<OpenOrgUrlResult> {
  const targetOrg = await resolveTargetOrg(pi, ctx, input.target_org);
  if (!targetOrg) {
    throw new Error(
      "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
    );
  }

  const resolvedPath = await resolveOpenPathForBrowser(targetOrg, input);
  const pathValue = resolvedPath.path;
  const args = ["org", "open", "--url-only", "--json", "-o", targetOrg];
  if (pathValue) args.push("--path", pathValue);

  const result = await pi.exec("sf", args, {
    cwd: ctx.cwd,
    signal,
    timeout: DEFAULT_SF_OPEN_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const details = redactText([result.stderr, result.stdout].filter(Boolean).join("\n").trim());
    throw new Error(`sf org open failed for ${targetOrg}.\n${details}`);
  }

  const url = extractUrlFromSfOpen(result.stdout);
  if (!url) throw new Error("sf org open did not return a URL in JSON output.");
  return { targetOrg, path: pathValue, url, verifiedRoute: resolvedPath.verifiedRoute };
}

export async function resolveTargetOrg(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  explicit?: string,
): Promise<string | undefined> {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;

  const cached = getCachedSfEnvironment(ctx.cwd);
  const cachedOrg = orgFromEnv(cached);
  if (cachedOrg) return cachedOrg;

  const env = await getSharedSfEnvironment(buildExecFn(pi, ctx.cwd), ctx.cwd);
  return orgFromEnv(env);
}

export function resolveOpenPath(input: OpenOrgInput): string | undefined {
  if (!input.path && !input.setup && !input.route) return undefined;
  const result = resolveSalesforcePath({
    path: input.path,
    setup: input.setup,
    route: input.route,
  });
  if (isResolvedSalesforcePath(result)) return result.path;
  throw new Error(result.message);
}

async function resolveOpenPathForBrowser(
  targetOrg: string,
  input: OpenOrgInput,
): Promise<{ path?: string; verifiedRoute?: VerifiedRouteResult }> {
  if (!input.route) return { path: resolveOpenPath(input) };
  // Data Cloud routes resolve against the local verified Destination Pack, like
  // setup destinations; they are known Lightning paths and need no API check.
  if (input.route.type === "data-cloud") return { path: resolveOpenPath(input) };
  const verifiedRoute = await resolveVerifiedRoutePath(targetOrg, input.route);
  return { path: verifiedRoute.path, verifiedRoute };
}

export function summarizeOpenTarget(targetOrg: string, pathValue: string | undefined): string {
  return [
    `Opened Salesforce org in agent-browser.`,
    `Target org: ${targetOrg}`,
    `Path: ${pathValue || "/"}`,
  ].join("\n");
}

export function redactedOpenUrl(url: string): string {
  return redactUrl(url) ?? "<redacted>";
}

function orgFromEnv(env: SfEnvironment | null): string | undefined {
  return env?.config.targetOrg ?? env?.org.alias ?? env?.org.username;
}

function extractUrlFromSfOpen(stdout: string): string | undefined {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown };
    const result = parsed.result;
    if (typeof result === "string") return result;
    if (result && typeof result === "object") {
      const candidate = result as Record<string, unknown>;
      for (const key of ["url", "orgUrl", "frontdoorUrl"]) {
        if (typeof candidate[key] === "string") return candidate[key] as string;
      }
    }
  } catch {
    const trimmed = stdout.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  }
  return undefined;
}
