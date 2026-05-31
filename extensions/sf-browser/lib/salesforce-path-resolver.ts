/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Deterministic Salesforce path resolver for SF Browser.
 *
 * This helper constructs known Lightning URL shapes from structured intent. It
 * does not perform live schema/data verification and only fuzzy-matches within
 * curated Setup Destinations.
 */
import {
  formatKnownSetupDestinations,
  knownSetupDestinations,
  normalizeSetupDestination,
  resolveSetupDestination,
} from "./setup-destinations.ts";

export type SalesforceRoute =
  | { type: "home" }
  | { type: "setup"; destination: string }
  | { type: "object-list"; objectApiName: string }
  | { type: "object-new"; objectApiName: string }
  | { type: "record-view"; objectApiName: string; recordId: string }
  | { type: "list-view"; objectApiName: string; filterName: string }
  | {
      type: "record-related-list";
      objectApiName: string;
      recordId: string;
      relatedListApiName: string;
    };

export interface SalesforcePathResolverInput {
  path?: string;
  setup?: string;
  route?: SalesforceRoute;
}

export interface SetupDestinationCandidate {
  destination: string;
  path: string;
  confidence: number;
}

export type SalesforcePathResolverResult =
  | {
      ok: true;
      path: string;
      kind: "path" | SalesforceRoute["type"];
      destination?: string;
      confidence?: number;
    }
  | {
      ok: false;
      reason:
        | "missing_target"
        | "multiple_targets"
        | "invalid_route"
        | "unknown_setup_destination"
        | "ambiguous_setup_destination";
      message: string;
      candidates?: SetupDestinationCandidate[];
    };

const AUTO_RESOLVE_CONFIDENCE = 0.85;
const AMBIGUOUS_CONFIDENCE = 0.6;
const MIN_AUTO_MARGIN = 0.15;
const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;
const OBJECT_API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function resolveSalesforcePath(
  input: SalesforcePathResolverInput,
): SalesforcePathResolverResult {
  const targetCount = [input.path, input.setup, input.route].filter(
    (value) => value !== undefined && value !== "",
  ).length;
  if (targetCount === 0) {
    return {
      ok: false,
      reason: "missing_target",
      message: "Pass exactly one of path, setup, or route.",
    };
  }
  if (targetCount > 1) {
    return {
      ok: false,
      reason: "multiple_targets",
      message: "Pass exactly one of path, setup, or route.",
    };
  }

  if (input.path) return resolveExplicitPath(input.path);
  if (input.setup) return resolveSetupPath(input.setup);
  return resolveRoute(input.route as SalesforceRoute);
}

export function resolveSalesforcePathOrThrow(input: SalesforcePathResolverInput): string {
  const result = resolveSalesforcePath(input);
  if (isResolvedSalesforcePath(result)) return result.path;
  throw new Error(result.message);
}

export function isResolvedSalesforcePath(
  result: SalesforcePathResolverResult,
): result is Extract<SalesforcePathResolverResult, { ok: true }> {
  return result.ok === true;
}

function resolveExplicitPath(pathValue: string): SalesforcePathResolverResult {
  const trimmed = pathValue.trim();
  if (!trimmed.startsWith("/")) {
    return {
      ok: false,
      reason: "invalid_route",
      message: "Salesforce path must start with '/'.",
    };
  }
  if (hasWhitespaceOrControl(trimmed)) {
    return {
      ok: false,
      reason: "invalid_route",
      message: "Salesforce path cannot contain whitespace or control characters.",
    };
  }
  return { ok: true, path: trimmed, kind: "path" };
}

function resolveRoute(route: SalesforceRoute): SalesforcePathResolverResult {
  if (!route || typeof route !== "object") {
    return invalidRoute("Route must be an object.");
  }

  switch (route.type) {
    case "home":
      return { ok: true, path: "/lightning/page/home", kind: "home" };
    case "setup":
      return resolveSetupPath(route.destination);
    case "object-list": {
      const object = validateObjectApiName(route.objectApiName);
      if (object.valid === false) return object.error;
      return { ok: true, path: `/lightning/o/${object.value}/list`, kind: "object-list" };
    }
    case "object-new": {
      const object = validateObjectApiName(route.objectApiName);
      if (object.valid === false) return object.error;
      return { ok: true, path: `/lightning/o/${object.value}/new`, kind: "object-new" };
    }
    case "record-view": {
      const object = validateObjectApiName(route.objectApiName);
      if (object.valid === false) return object.error;
      const id = validateRecordId(route.recordId);
      if (id.valid === false) return id.error;
      return {
        ok: true,
        path: `/lightning/r/${object.value}/${id.value}/view`,
        kind: "record-view",
      };
    }
    case "list-view": {
      const object = validateObjectApiName(route.objectApiName);
      if (object.valid === false) return object.error;
      const filterName = validatePathToken(route.filterName, "filterName");
      if (filterName.valid === false) return filterName.error;
      return {
        ok: true,
        path: `/lightning/o/${object.value}/list?filterName=${encodeURIComponent(filterName.value)}`,
        kind: "list-view",
      };
    }
    case "record-related-list": {
      const object = validateObjectApiName(route.objectApiName);
      if (object.valid === false) return object.error;
      const id = validateRecordId(route.recordId);
      if (id.valid === false) return id.error;
      const relatedList = validatePathToken(route.relatedListApiName, "relatedListApiName");
      if (relatedList.valid === false) return relatedList.error;
      return {
        ok: true,
        path: `/lightning/r/${object.value}/${id.value}/related/${encodeURIComponent(
          relatedList.value,
        )}/view`,
        kind: "record-related-list",
      };
    }
    default:
      return invalidRoute(
        `Unsupported route type: ${JSON.stringify((route as { type?: unknown }).type)}.`,
      );
  }
}

function resolveSetupPath(rawDestination: string | undefined): SalesforcePathResolverResult {
  if (!rawDestination?.trim()) return invalidRoute("Setup destination is required.");

  const exact = resolveSetupDestination(rawDestination);
  const normalized = normalizeSetupDestination(rawDestination);
  if (exact) {
    return {
      ok: true,
      path: exact,
      kind: "setup",
      destination: normalized,
      confidence: 1,
    };
  }

  const candidates = fuzzySetupDestinationCandidates(rawDestination);
  const [best, second] = candidates;
  if (best && best.confidence >= AUTO_RESOLVE_CONFIDENCE) {
    const margin = best.confidence - (second?.confidence ?? 0);
    if (margin >= MIN_AUTO_MARGIN || !second || second.confidence < AMBIGUOUS_CONFIDENCE) {
      return {
        ok: true,
        path: best.path,
        kind: "setup",
        destination: best.destination,
        confidence: best.confidence,
      };
    }
  }

  if (candidates.length) {
    return {
      ok: false,
      reason: "ambiguous_setup_destination",
      message: `Setup destination ${JSON.stringify(rawDestination)} is ambiguous. Choose one of: ${candidates
        .map((candidate) => candidate.destination)
        .join(", ")}.`,
      candidates,
    };
  }

  return {
    ok: false,
    reason: "unknown_setup_destination",
    message: `Unknown setup destination ${JSON.stringify(rawDestination)}. Known destinations: ${formatKnownSetupDestinations()}`,
  };
}

function fuzzySetupDestinationCandidates(rawDestination: string): SetupDestinationCandidate[] {
  const normalized = normalizeSetupDestination(rawDestination);
  const compact = compactKey(normalized);
  const tokens = tokenVariants(normalized);
  return knownSetupDestinations()
    .map((destination) => {
      const path = resolveSetupDestination(destination) as string;
      return { destination, path, confidence: scoreSetupDestination(destination, compact, tokens) };
    })
    .filter((candidate) => candidate.confidence >= AMBIGUOUS_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence || a.destination.localeCompare(b.destination))
    .slice(0, 5);
}

function scoreSetupDestination(
  destination: string,
  inputCompact: string,
  inputTokens: string[],
): number {
  const destinationCompact = compactKey(destination);
  if (destinationCompact === inputCompact) return 0.98;
  if (destination.includes(inputCompact) || destinationCompact.includes(inputCompact)) return 0.9;
  if (inputCompact.includes(destinationCompact)) return 0.88;

  if (!inputTokens.length) return 0;
  const matched = inputTokens.filter((token) => destinationCompact.includes(token)).length;
  if (matched === inputTokens.length && inputTokens.length > 1) return 0.86;
  if (matched > 0) return Math.min(0.8, 0.55 + matched / inputTokens.length / 4);
  return 0;
}

function tokenVariants(normalized: string): string[] {
  const out = new Set<string>();
  for (const token of normalized
    .split("-")
    .map(compactKey)
    .filter((item) => item.length >= 3)) {
    out.add(token);
    if (token.endsWith("s") && token.length > 3) out.add(token.slice(0, -1));
  }
  return [...out];
}

function compactKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function validateObjectApiName(
  value: string | undefined,
): { valid: true; value: string } | { valid: false; error: SalesforcePathResolverResult } {
  const trimmed = value?.trim() ?? "";
  if (!OBJECT_API_NAME_RE.test(trimmed)) {
    return { valid: false, error: invalidRoute(`Invalid objectApiName ${JSON.stringify(value)}.`) };
  }
  return { valid: true, value: trimmed };
}

function validateRecordId(
  value: string | undefined,
): { valid: true; value: string } | { valid: false; error: SalesforcePathResolverResult } {
  const trimmed = value?.trim() ?? "";
  if (!SALESFORCE_ID_RE.test(trimmed)) {
    return {
      valid: false,
      error: invalidRoute("recordId must be a 15 or 18 character Salesforce id."),
    };
  }
  return { valid: true, value: trimmed };
}

function validatePathToken(
  value: string | undefined,
  field: string,
): { valid: true; value: string } | { valid: false; error: SalesforcePathResolverResult } {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || hasWhitespaceOrControl(trimmed) || /[/?#]/.test(trimmed)) {
    return { valid: false, error: invalidRoute(`Invalid ${field} ${JSON.stringify(value)}.`) };
  }
  return { valid: true, value: trimmed };
}

function hasWhitespaceOrControl(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f) return true;
  }
  return false;
}

function invalidRoute(message: string): SalesforcePathResolverResult {
  return { ok: false, reason: "invalid_route", message };
}
