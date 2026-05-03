/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolve the target-org context for an incoming bash command.
 *
 * The contract is deliberately simple:
 *   1. If the command has `-o <alias>` or `--target-org <alias>`, that wins.
 *   2. Else, use the default-org alias from the sf-devbar shared cache.
 *   3. Org *type* comes from the same cached `[Salesforce Environment]`
 *      snapshot. If the alias isn't the default, we don't re-detect (we'd
 *      need an sf CLI call and we need this hook to stay hot); instead we
 *      consult `productionAliases` from config and otherwise fall back to
 *      "unknown".
 *   4. "unknown" maps to "production" for safety reasons — fail-closed.
 *
 * Why read the cache instead of calling sf CLI here:
 *   - tool_call is on the hot path; spawning sf must not block it.
 *   - sf-devbar already populates the cache on session_start.
 *   - For alias values that differ from the default, we trade accuracy for
 *     latency and bias toward production. Users who regularly target a
 *     non-default production alias should list it in `productionAliases`.
 */
import { getCachedSfEnvironment } from "../../../lib/common/sf-environment/shared-runtime.ts";
import type { OrgInfo } from "../../../lib/common/sf-environment/types.ts";
import { extractTargetOrg, tokenize } from "./bash-ast.ts";
import type { OrgTypeFilter } from "./types.ts";

export interface OrgContext {
  /** Alias or username used on the command (or default if unflagged). */
  alias: string | undefined;
  /** Resolved type, biased to "production" when uncertain. */
  type: OrgTypeFilter;
  /** True when we had to guess — callers may want to warn the user. */
  guessed: boolean;
}

export function resolveOrgContext(
  command: string,
  cwd: string,
  productionAliases: string[],
): OrgContext {
  const tokens = tokenize(command);
  const explicit = tokens ? extractTargetOrg(tokens) : undefined;
  const env = getCachedSfEnvironment(cwd);

  const defaultAlias = env?.org?.alias ?? env?.config?.targetOrg;
  const alias = explicit ?? defaultAlias;

  if (!alias) {
    // No alias at all — treat as production per the fail-closed rule.
    return { alias: undefined, type: "production", guessed: true };
  }

  // User-listed prod aliases always trump detection.
  if (productionAliases.includes(alias)) {
    return { alias, type: "production", guessed: false };
  }

  // If the command alias matches the default, we already know the type
  // from the cached OrgInfo. Otherwise it's ambiguous.
  if (env?.org?.alias && alias === env.org.alias) {
    return { alias, type: mapOrgType(env.org), guessed: false };
  }

  // Different alias from default, not in the user's production list, no
  // detection data → fail closed.
  return { alias, type: "production", guessed: true };
}

function mapOrgType(org: OrgInfo): OrgTypeFilter {
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
