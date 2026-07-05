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
 * org-aware rule would fire because the fast path guessed production for an
 * explicit target. It performs an in-process Salesforce auth/org lookup and
 * caches the result by alias so scratch/sandbox aliases do not repeatedly
 * trigger production prompts.
 */
import { getCachedSfEnvironment } from "../../../lib/common/sf-environment/shared-runtime.ts";
import { detectOrg } from "../../../lib/common/sf-environment/detect.ts";
import type { OrgInfo } from "../../../lib/common/sf-environment/types.ts";
import { extractTargetOrg, tokenize } from "./bash-ast.ts";
import type { OrgTypeFilter } from "./types.ts";

export type OrgResolutionSource = "cache" | "lookup" | "productionAliases" | "guessed";

export interface OrgContext {
  /** Alias, username, or org id used on the command (or default if unflagged). */
  alias: string | undefined;
  /** Stable org id when detection provides it. */
  orgId?: string;
  /** Username when detection provides it. */
  username?: string;
  /** Resolved type, biased to "production" when uncertain. */
  type: OrgTypeFilter;
  /** True when we had to guess — callers should warn/audit this. */
  guessed: boolean;
  /** True when the command supplied -o / --target-org explicitly. */
  explicit: boolean;
  /** Where the org facts came from. */
  source: OrgResolutionSource;
}

const LOOKUP_TIMEOUT_MS = 2_500;
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
  if (!fast.guessed || !fast.explicit || !fast.alias) return fast;

  const cached = lookupCache.get(fast.alias);
  if (cached) return cached;

  try {
    const org = await withTimeout(detectOrg(fast.alias), LOOKUP_TIMEOUT_MS);
    if (!org.detected) return fast;
    const resolved = fromOrgInfo(fast.alias, org, true, "lookup");
    lookupCache.set(fast.alias, resolved);
    return resolved;
  } catch {
    return fast;
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
    type: mapped,
    guessed: false,
    explicit,
    source,
  };
}

function guessedProduction(alias: string | undefined, explicit: boolean): OrgContext {
  return { alias, type: "production", guessed: true, explicit, source: "guessed" };
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
