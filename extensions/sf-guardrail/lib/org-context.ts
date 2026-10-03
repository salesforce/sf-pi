/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve the target-org context for an incoming bash command.
 *
 * Fast path stays cache-first for the tool_call hot path:
 *   1. If the command has `-o <alias>` or `--target-org <alias>`, that wins.
 *   2. Else, use the default-org alias from the sf-devbar shared cache.
 *   3. If the target matches any known identity for the cached org, use the
 *      cached org type.
 *   4. Otherwise fail closed to production.
 *
 * `resolveOrgContextWithLookup()` is the bounded slow path used only after an
 * org-aware rule would fire because the fast path guessed production. It performs
 * an in-process Salesforce config/auth/org lookup and caches the result by alias
 * so scratch/sandbox aliases do not repeatedly trigger production prompts.
 */
import { findLatestBrowserSnapshotSession } from "../../../lib/common/sf-browser-snapshot-state.ts";
import { getCachedSfEnvironment } from "../../../lib/common/sf-environment/shared-runtime.ts";
import { detectConfig, detectOrg } from "../../../lib/common/sf-environment/detect.ts";
import {
  inferNonProductionOrgTypeFromUrl,
  salesforceOrgHostKey,
} from "../../../lib/common/sf-environment/org-type.ts";
import type { ConfigInfo, OrgInfo } from "../../../lib/common/sf-environment/types.ts";
import { extractTargetOrg, tokenize, tokenizeSimpleCommands } from "./bash-ast.ts";
import type { OrgTypeFilter } from "./types.ts";

export type OrgResolutionSource =
  "cache" | "lookup" | "productionAliases" | "mcpConfig" | "url" | "guessed";

export interface OrgContext {
  /** Alias, username, or org id used on the command (or default if unflagged). */
  alias: string | undefined;
  /** Stable org id when detection provides it. */
  orgId?: string;
  /** Username when detection provides it. */
  username?: string;
  /** Instance URL when authenticated org facts provide it. */
  instanceUrl?: string;
  /** Resolved type, biased to "production" when uncertain. */
  type: OrgTypeFilter;
  /** True when we had to guess — callers should warn/audit this. */
  guessed: boolean;
  /** True when the command supplied -o / --target-org explicitly. */
  explicit: boolean;
  /** Where the org facts came from. */
  source: OrgResolutionSource;
}

const CONFIG_LOOKUP_TIMEOUT_MS = 2_500;
const LOOKUP_TIMEOUT_MS = 10_000;
const lookupCache = new Map<string, OrgContext>();

export function resolveOrgContext(
  command: string,
  cwd: string,
  productionAliases: string[],
): OrgContext {
  const tokens = tokenize(command);
  const explicit = tokens ? extractTargetOrg(tokens) : undefined;
  return resolveOrgContextForTarget(explicit, cwd, productionAliases);
}

export function resolveOrgContextForTarget(
  targetOrg: string | undefined,
  cwd: string,
  productionAliases: string[],
): OrgContext {
  const env = getCachedSfEnvironment(cwd);

  const defaultAlias = env?.org?.alias ?? env?.config?.targetOrg;
  const alias = targetOrg ?? defaultAlias;
  const isExplicit = targetOrg !== undefined;

  if (!alias) {
    return guessedProduction(undefined, isExplicit);
  }

  if (productionAliases.includes(alias)) {
    return {
      alias,
      type: "production",
      guessed: false,
      explicit: isExplicit,
      source: "productionAliases",
    };
  }

  if (env?.org?.detected && matchesCachedOrg(alias, env.org, env.config?.targetOrg)) {
    return fromOrgInfo(alias, env.org, isExplicit, "cache");
  }

  return guessedProduction(alias, isExplicit);
}

export function resolveAgentBrowserOrgContext(
  command: string,
  cwd: string,
  productionAliases: string[],
  sessionId?: string,
): OrgContext {
  const targetOrg = trackedBrowserTarget(command, sessionId);
  if (targetOrg) {
    const tracked = resolveOrgContextForTarget(targetOrg, cwd, productionAliases);
    if (
      !tracked.guessed &&
      (tracked.source === "productionAliases" || browserUrlsMatchOrg(command, tracked))
    ) {
      return tracked;
    }
    return guessedProduction(targetOrg, true);
  }
  return orgContextFromBrowserUrls(command) ?? guessedProduction(undefined, false);
}

export async function resolveAgentBrowserOrgContextWithLookup(
  command: string,
  cwd: string,
  productionAliases: string[],
  sessionId?: string,
): Promise<OrgContext> {
  const targetOrg = trackedBrowserTarget(command, sessionId);
  if (targetOrg) {
    const resolved = await resolveOrgContextForTargetWithLookup(targetOrg, cwd, productionAliases);
    if (
      !resolved.guessed &&
      (resolved.source === "productionAliases" || browserUrlsMatchOrg(command, resolved))
    ) {
      return resolved;
    }
  }
  return orgContextFromBrowserUrls(command, targetOrg) ?? guessedProduction(targetOrg, !!targetOrg);
}

export async function resolveOrgContextWithLookup(
  command: string,
  cwd: string,
  productionAliases: string[],
): Promise<OrgContext> {
  const tokens = tokenize(command);
  const explicit = tokens ? extractTargetOrg(tokens) : undefined;
  return resolveOrgContextForTargetWithLookup(explicit, cwd, productionAliases);
}

export async function resolveOrgContextForTargetWithLookup(
  targetOrg: string | undefined,
  cwd: string,
  productionAliases: string[],
): Promise<OrgContext> {
  const fast = resolveOrgContextForTarget(targetOrg, cwd, productionAliases);
  if (!fast.guessed) return fast;

  const alias = targetOrg ?? (await detectDefaultTargetOrg()) ?? fast.alias;
  if (!alias) return fast;

  if (productionAliases.includes(alias)) {
    return {
      alias,
      type: "production",
      guessed: false,
      explicit: fast.explicit,
      source: "productionAliases",
    };
  }

  const cached = lookupCache.get(alias);
  if (cached) return { ...cached, explicit: fast.explicit };

  try {
    const org = await withTimeout(detectOrg(alias), LOOKUP_TIMEOUT_MS);
    if (!org.detected) return fast.alias ? fast : { ...fast, alias };
    const resolved = fromOrgInfo(alias, org, fast.explicit, "lookup");
    lookupCache.set(alias, resolved);
    return resolved;
  } catch {
    return fast.alias ? fast : { ...fast, alias };
  }
}

function matchesCachedOrg(alias: string, org: OrgInfo, configuredTargetOrg?: string): boolean {
  return [configuredTargetOrg, org.alias, org.username, org.orgId].some((value) => value === alias);
}

function fromOrgInfo(
  alias: string,
  org: OrgInfo,
  explicit: boolean,
  source: OrgResolutionSource,
): OrgContext {
  const mapped = mapOrgType(org);
  if (mapped === "unknown") {
    return {
      alias,
      orgId: org.orgId,
      username: org.username,
      type: "production",
      guessed: true,
      explicit,
      source: "guessed",
    };
  }
  return {
    alias,
    orgId: org.orgId,
    username: org.username,
    instanceUrl: org.instanceUrl,
    type: mapped,
    guessed: false,
    explicit,
    source,
  };
}

async function detectDefaultTargetOrg(): Promise<string | undefined> {
  try {
    const config = await withTimeout<ConfigInfo>(detectConfig(), CONFIG_LOOKUP_TIMEOUT_MS);
    return config.hasTargetOrg ? config.targetOrg : undefined;
  } catch {
    return undefined;
  }
}

function guessedProduction(alias: string | undefined, explicit: boolean): OrgContext {
  return { alias, type: "production", guessed: true, explicit, source: "guessed" };
}

function trackedBrowserTarget(command: string, sessionId: string | undefined): string | undefined {
  if (!usesSfPiBrowserSession(command)) return undefined;
  return findLatestBrowserSnapshotSession(sessionId)?.targetOrg;
}

function usesSfPiBrowserSession(command: string): boolean {
  return agentBrowserArgs(command).some((args) =>
    args.some(
      (arg, index) =>
        arg === "--session=sf-pi" || (arg === "--session" && args[index + 1] === "sf-pi"),
    ),
  );
}

function orgContextFromBrowserUrls(command: string, alias?: string): OrgContext | undefined {
  const urls = agentBrowserUrls(command);
  if (!urls.length) return undefined;
  const keys = new Set(urls.map(salesforceOrgHostKey));
  const types = new Set(urls.map(inferNonProductionOrgTypeFromUrl));
  if (keys.has(undefined) || keys.size !== 1 || types.has(undefined) || types.size !== 1) {
    return undefined;
  }
  const type = [...types][0];
  if (!type) return undefined;
  return {
    alias,
    instanceUrl: urls[0],
    type,
    guessed: false,
    explicit: Boolean(alias),
    source: "url",
  };
}

function browserUrlsMatchOrg(command: string, org: OrgContext): boolean {
  const urls = agentBrowserUrls(command);
  if (!urls.length) return true;
  if (!org.instanceUrl) return false;
  const orgKey = salesforceOrgHostKey(org.instanceUrl);
  return Boolean(orgKey) && urls.every((url) => salesforceOrgHostKey(url) === orgKey);
}

function agentBrowserUrls(command: string): string[] {
  return agentBrowserArgs(command)
    .flat()
    .filter((arg) => /^https:\/\//iu.test(arg));
}

function agentBrowserArgs(command: string): string[][] {
  return tokenizeSimpleCommands(command)
    .map(({ tokens }) => {
      if (tokens.head === "agent-browser") return tokens.args;
      if (tokens.head === "npx" && tokens.args[0] === "agent-browser") {
        return tokens.args.slice(1);
      }
      return undefined;
    })
    .filter((args): args is string[] => Boolean(args));
}

function mapOrgType(org: OrgInfo): OrgTypeFilter | "unknown" {
  switch (org.orgType) {
    case "production":
    case "sandbox":
    case "scratch":
    case "developer":
    case "trial":
      return org.orgType;
    default:
      return "unknown";
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out resolving org context")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
