/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety classification for direct Data 360 REST calls.
 *
 * The tool intentionally allows the LLM to compose endpoint paths on the fly,
 * so this module keeps deterministic rails around methods and known mutating
 * action paths. Unknown POST/PATCH/PUT calls are treated as writes and require
 * confirmation on production or unresolved orgs.
 */

import type { OrgType } from "../../../lib/common/sf-environment/types.ts";
import { normalizeD360Path } from "./path.ts";

export type D360Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type D360SafetyLevel =
  | "read"
  | "query"
  | "validate"
  | "test"
  | "create"
  | "update"
  | "run"
  | "publish"
  | "deploy"
  | "delete";

export interface D360SafetyDecision {
  level: D360SafetyLevel;
  requiresConfirmation: boolean;
  reason: string;
}

const SAFE_POST_PATTERNS = [
  /\/connect\/search\/metadata\/results$/i,
  /\/ssot\/query(?:-sql|v2)?$/i,
  /\/ssot\/data-transforms-validation$/i,
  /\/actions\/(?:validate|count)$/i,
  /\/connections(?:\/[^/]+)?\/actions\/test$/i,
  /\/connections\/[^/]+\/schema\/actions\/test$/i,
  /\/connections\/[^/]+\/(?:database-schemas|databases|objects)$/i,
  /\/connections\/[^/]+\/objects\/[^/]+\/(?:fields|preview)$/i,
  /\/machine-learning\/predict$/i,
  /\/machine-learning\/(?:alerts|query-setup-fields|query-data-profile|query-outcome|query-row-count)$/i,
];

const ALWAYS_CONFIRM_POST_PATTERNS: Array<{ pattern: RegExp; level: D360SafetyLevel }> = [
  { pattern: /\/actions\/publish(?:$|\/)/i, level: "publish" },
  {
    pattern: /\/actions\/(?:run|run-now|refresh|refresh-status|retry|cancel)(?:$|\/)/i,
    level: "run",
  },
  { pattern: /\/actions\/(?:deactivate|enable|disable)(?:$|\/)/i, level: "update" },
  { pattern: /\/connections(?:\/[^/]+)?\/actions\/[^/]+$/i, level: "run" },
  { pattern: /\/run-now(?:$|\/)/i, level: "run" },
  { pattern: /\/run(?:$|\/)/i, level: "run" },
  { pattern: /\/undeploy(?:$|\/)/i, level: "deploy" },
  // Group the alternatives so the trailing `$` anchor applies to BOTH
  // `/deployment` and `/update-components`, not just the second branch.
  { pattern: /\/(?:deployment|update-components)$/i, level: "deploy" },
  { pattern: /\/ssot\/data-kits\/[^/]+$/i, level: "deploy" },
  { pattern: /\/signing-key$/i, level: "update" },
];

export function classifyD360Request(
  method: D360Method,
  path: string,
  orgType: OrgType | "unknown",
): D360SafetyDecision {
  const normalized = stripQueryAndHash(normalizeD360Path(path));
  const productionLike = orgType === "production" || orgType === "unknown";

  if (method === "GET") {
    return { level: "read", requiresConfirmation: false, reason: "GET requests are read-only." };
  }

  if (method === "DELETE") {
    return {
      level: "delete",
      requiresConfirmation: true,
      reason: "DELETE requests can permanently remove Data 360 configuration or data.",
    };
  }

  if (method === "PATCH" || method === "PUT") {
    return {
      level: "update",
      requiresConfirmation: productionLike,
      reason: productionLike
        ? "PATCH/PUT requests update Data 360 resources and require confirmation for production or unresolved orgs."
        : "PATCH/PUT requests update Data 360 resources.",
    };
  }

  for (const safe of SAFE_POST_PATTERNS) {
    if (safe.test(normalized)) {
      const level =
        normalized.includes("query") ||
        normalized.includes("predict") ||
        normalized.includes("count")
          ? "query"
          : normalized.includes("test")
            ? "test"
            : normalized.includes("validate")
              ? "validate"
              : "read";
      return {
        level,
        requiresConfirmation: false,
        reason: "This POST path is classified as query, validation, search, or test-only.",
      };
    }
  }

  for (const entry of ALWAYS_CONFIRM_POST_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      return {
        level: entry.level,
        requiresConfirmation: true,
        reason: "This POST action can run, publish, deploy, or undeploy Data 360 resources.",
      };
    }
  }

  return {
    level: "create",
    requiresConfirmation: productionLike,
    reason: productionLike
      ? "Unclassified POST requests may create or mutate Data 360 resources and require confirmation for production or unresolved orgs."
      : "Unclassified POST requests may create or mutate Data 360 resources.",
  };
}

export function normalizeMethod(method: string): D360Method {
  const upper = method.trim().toUpperCase();
  if (["GET", "POST", "PATCH", "PUT", "DELETE"].includes(upper)) {
    return upper as D360Method;
  }
  throw new Error(`Unsupported Data 360 method: ${method}`);
}

function stripQueryAndHash(path: string): string {
  return path.split(/[?#]/, 1)[0] || "/";
}
