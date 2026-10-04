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
import { generateSalesforceFrontdoorUrl } from "../../../lib/common/sf-conn/index.ts";
import {
  getCachedSfEnvironment,
  getSharedSfEnvironment,
} from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";
import { DEFAULT_SF_OPEN_TIMEOUT_MS } from "./constants.ts";
import { redactText, redactUrl } from "./redaction.ts";
import { planSalesforceNavigation } from "./navigation-intent.ts";
import {
  isResolvedSalesforcePath,
  resolveSalesforcePath,
  type SalesforceNavigationTarget,
  type SalesforceRoute,
} from "./salesforce-path-resolver.ts";
import { resolveVerifiedRoutePath, type VerifiedRouteResult } from "./salesforce-route-verifier.ts";

export interface OpenOrgInput {
  target_org?: string;
  /** Model-facing single navigation target. */
  target?: SalesforceNavigationTarget;
  /** Legacy/internal inputs retained for commands and the hardening harness. */
  path?: string;
  setup?: string;
  route?: SalesforceRoute;
  purpose?: string;
}

export type SalesforceOrgOpenMethod =
  "same-org-direct" | "in-process-singleaccess" | "sf-cli-fallback";

export interface OpenOrgPlan {
  targetOrg: string;
  path?: string;
  verifiedRoute?: VerifiedRouteResult;
}

export interface OpenOrgUrlResult extends OpenOrgPlan {
  url: string;
  openMethod: SalesforceOrgOpenMethod;
  fallbackReason?: string;
}

export async function resolveOpenOrgPlan(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
): Promise<OpenOrgPlan> {
  const targetOrg = await resolveTargetOrg(pi, ctx, input.target_org);
  if (!targetOrg) {
    throw new Error(
      "No Salesforce target org is configured. Pass target_org or set sf config target-org.",
    );
  }
  const resolvedPath = await resolveOpenPathForBrowser(targetOrg, input, ctx.cwd);
  return { targetOrg, path: resolvedPath.path, verifiedRoute: resolvedPath.verifiedRoute };
}

export async function resolveOpenOrgUrl(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: OpenOrgInput,
  signal?: AbortSignal,
): Promise<OpenOrgUrlResult> {
  return resolveOpenOrgUrlFromPlan(pi, ctx, await resolveOpenOrgPlan(pi, ctx, input), signal);
}

export async function resolveOpenOrgUrlFromPlan(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  plan: OpenOrgPlan,
  signal?: AbortSignal,
): Promise<OpenOrgUrlResult> {
  try {
    const url = await resolveInProcessFrontdoorUrl(ctx.cwd, plan.targetOrg, plan.path, signal);
    return { ...plan, url, openMethod: "in-process-singleaccess" };
  } catch (error) {
    if (signal?.aborted) throw error;
    const fallbackReason = conciseFallbackReason(error);
    const url = await resolveSfCliFallbackUrl(pi, ctx, plan.targetOrg, plan.path, signal);
    return { ...plan, url, openMethod: "sf-cli-fallback", fallbackReason };
  }
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
  if (!input.target && !input.path && !input.setup && !input.route) return undefined;
  const result = resolveSalesforcePath({
    target: input.target,
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
  cwd: string,
): Promise<{ path?: string; verifiedRoute?: VerifiedRouteResult }> {
  if (!input.target && !input.route) return { path: resolveOpenPath(input) };
  const plan = planSalesforceNavigation({
    target: input.target,
    path: input.path,
    setup: input.setup,
    route: input.route,
  });
  if (plan.resolution === "local" || !plan.route) return { path: plan.path };
  const verifiedRoute = await resolveVerifiedRoutePath(targetOrg, plan.route, cwd);
  return { path: verifiedRoute.path, verifiedRoute };
}

async function resolveInProcessFrontdoorUrl(
  cwd: string,
  targetOrg: string,
  pathValue: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const url = await generateSalesforceFrontdoorUrl({
    cwd,
    targetOrg,
    path: pathValue,
    signal,
    timeoutMs: DEFAULT_SF_OPEN_TIMEOUT_MS,
  });
  if (!/^https:\/\//iu.test(url)) {
    throw new Error("Salesforce single-access URL response was not an HTTPS URL.");
  }
  return url;
}

async function resolveSfCliFallbackUrl(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  targetOrg: string,
  pathValue: string | undefined,
  signal: AbortSignal | undefined,
): Promise<string> {
  const args = ["org", "open", "--url-only", "--json", "-o", targetOrg];
  if (pathValue) args.push("--path", pathValue);
  const result = await pi.exec("sf", args, {
    cwd: ctx.cwd,
    signal,
    timeout: DEFAULT_SF_OPEN_TIMEOUT_MS,
  });
  if (result.code !== 0) {
    const details = formatSfCliOpenFailure(result.stdout, result.stderr);
    throw new Error(`sf org open fallback failed for ${targetOrg}.\n${details}`);
  }
  const url = extractUrlFromSfOpen(result.stdout);
  if (!url) throw new Error("sf org open fallback did not return a URL in JSON output.");
  return url;
}

function formatSfCliOpenFailure(stdout: string, stderr: string): string {
  for (const raw of [stdout, stderr]) {
    try {
      const parsed = JSON.parse(raw) as {
        name?: unknown;
        message?: unknown;
        actions?: unknown;
      };
      const name = typeof parsed.name === "string" ? parsed.name : undefined;
      const message = typeof parsed.message === "string" ? parsed.message : undefined;
      const actions = Array.isArray(parsed.actions)
        ? parsed.actions.filter((item): item is string => typeof item === "string").slice(0, 3)
        : [];
      const lines = [name, message, ...actions.map((action) => `Recovery: ${action}`)].filter(
        (line): line is string => Boolean(line),
      );
      if (lines.length) return redactText(lines.join("\n"));
    } catch {
      // Fall through to bounded plain-text output.
    }
  }
  const text = redactText([stderr, stdout].filter(Boolean).join("\n").trim());
  return text.length > 1_000 ? `${text.slice(0, 999)}…` : text;
}

function conciseFallbackReason(error: unknown): string {
  const message = redactText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/gu, " ")
    .trim();
  return message.length > 300 ? `${message.slice(0, 299)}…` : message;
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
