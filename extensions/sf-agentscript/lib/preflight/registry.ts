/* SPDX-License-Identifier: Apache-2.0 */
/**
 * TargetResolver registry.
 *
 * Each resolver declares the schemes it handles (`["flow"]`,
 * `["apex","apexRest"]`, etc.) and the registry uses scheme as the
 * lookup key. Schemes not in the registry resolve to `unverifiable` —
 * matches the agentscript compiler's permissive stance ("any scheme is
 * a valid invocation_target_type") while still surfacing the gap to
 * the user.
 */

import { agentforceResolver } from "./resolvers/agentforce.ts";
import { alwaysAvailableResolver } from "./resolvers/always-available.ts";
import { apexResolver } from "./resolvers/apex.ts";
import { externalServiceResolver } from "./resolvers/external-service.ts";
import { flowResolver } from "./resolvers/flow.ts";
import { placeholderResolver } from "./resolvers/placeholder.ts";
import { promptTemplateResolver } from "./resolvers/prompt-template.ts";
import { quickActionResolver } from "./resolvers/quick-action.ts";
import type { TargetResolver } from "./types.ts";

const RESOLVERS: TargetResolver[] = [
  flowResolver,
  apexResolver,
  agentforceResolver,
  externalServiceResolver,
  promptTemplateResolver,
  quickActionResolver,
  alwaysAvailableResolver,
  placeholderResolver,
];

const SCHEME_INDEX = new Map<string, TargetResolver>();
for (const r of RESOLVERS) {
  for (const scheme of r.schemes) {
    if (SCHEME_INDEX.has(scheme)) {
      throw new Error(
        `preflight registry: scheme "${scheme}" is registered by two resolvers — programmer error`,
      );
    }
    SCHEME_INDEX.set(scheme, r);
  }
}

/**
 * Look up the resolver for a scheme. Returns `undefined` when no
 * resolver is registered (caller should classify as `unverifiable`).
 */
export function resolverForScheme(scheme: string): TargetResolver | undefined {
  return SCHEME_INDEX.get(scheme);
}

/**
 * The full list of registered resolvers — exposed for tests + the
 * `agentscript_authoring inspect` doctor surface.
 */
export function listResolvers(): readonly TargetResolver[] {
  return RESOLVERS;
}

/**
 * Every registered scheme. Useful for tests that want to assert
 * nothing was accidentally dropped during a refactor.
 */
export function registeredSchemes(): readonly string[] {
  return [...SCHEME_INDEX.keys()].sort();
}

/**
 * Test-only seam: register an extra resolver. Throws on scheme conflict
 * with an existing resolver. Tests should call `unregisterResolverForTests`
 * in afterEach to clean up.
 */
export function registerResolverForTests(resolver: TargetResolver): void {
  for (const scheme of resolver.schemes) {
    if (SCHEME_INDEX.has(scheme)) {
      throw new Error(`scheme "${scheme}" already registered`);
    }
    SCHEME_INDEX.set(scheme, resolver);
  }
  RESOLVERS.push(resolver);
}

/** Test-only seam: undo `registerResolverForTests`. */
export function unregisterResolverForTests(resolver: TargetResolver): void {
  for (const scheme of resolver.schemes) {
    SCHEME_INDEX.delete(scheme);
  }
  const idx = RESOLVERS.indexOf(resolver);
  if (idx >= 0) RESOLVERS.splice(idx, 1);
}
