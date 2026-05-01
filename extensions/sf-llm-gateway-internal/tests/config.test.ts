/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for gateway config resolution.
 *
 * Covers: normalizeBaseUrl plus the pure enabledModels helpers that control
 * additive vs exclusive gateway scope behavior.
 *
 * These are the most breakable helpers — they determine whether the provider
 * gets registered and which settings patterns are written.
 */
import { describe, it, expect } from "vitest";
import {
  OFF_DEFAULT_MODEL_ID,
  normalizeBaseUrl,
  resolveSavedExclusiveScopeStatus,
} from "../lib/config.ts";
import {
  applyGatewayModelScope,
  ensureEnabledModelPattern,
  isExclusiveEnabledModelPattern,
  normalizeLegacyGatewayEnabledModels,
  removeEnabledModelPattern,
  restoreEnabledModelsSnapshot,
  shouldCaptureExclusiveScopeSnapshot,
  snapshotEnabledModelsForExclusiveScope,
} from "../index.ts";

// -------------------------------------------------------------------------------------------------
// model defaults
// -------------------------------------------------------------------------------------------------

describe("gateway model defaults", () => {
  it("points the off-default at a model the gateway actually serves", () => {
    // `gpt-5.5` used to be here but is not a published gateway model id.
    // Live /v1/models returns gpt-4o, gpt-4o-mini, gpt-5, gpt-5-mini, and the
    // Codex pair. We switch to the bundled openai provider's gpt-5 so the
    // off-switch lands the user on a working model without gateway routing.
    expect(OFF_DEFAULT_MODEL_ID).toBe("gpt-5");
  });
});

// -------------------------------------------------------------------------------------------------
// normalizeBaseUrl
// -------------------------------------------------------------------------------------------------

describe("normalizeBaseUrl", () => {
  it("returns undefined for undefined input", () => {
    expect(normalizeBaseUrl(undefined)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(normalizeBaseUrl("")).toBeUndefined();
  });

  it("returns undefined for whitespace-only string", () => {
    expect(normalizeBaseUrl("   ")).toBeUndefined();
  });

  it("strips trailing slash from https URL", () => {
    expect(normalizeBaseUrl("https://example.com/")).toBe("https://example.com");
  });

  it("keeps path segments intact", () => {
    expect(normalizeBaseUrl("https://gateway.example.com/v1")).toBe(
      "https://gateway.example.com/v1",
    );
  });

  it("normalizes http URL", () => {
    expect(normalizeBaseUrl("http://localhost:8080")).toBe("http://localhost:8080");
  });

  it("returns undefined for non-http protocols", () => {
    expect(normalizeBaseUrl("ftp://example.com")).toBeUndefined();
  });

  it("returns undefined for invalid URL", () => {
    expect(normalizeBaseUrl("not-a-url")).toBeUndefined();
  });

  it("trims whitespace before parsing", () => {
    expect(normalizeBaseUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("preserves port numbers", () => {
    expect(normalizeBaseUrl("https://gateway.local:4443")).toBe("https://gateway.local:4443");
  });
});

// -------------------------------------------------------------------------------------------------
// ensureEnabledModelPattern
// -------------------------------------------------------------------------------------------------

describe("ensureEnabledModelPattern", () => {
  const PATTERN = "sf-llm-gateway-internal/*";

  it("adds the gateway pattern to empty array", () => {
    expect(ensureEnabledModelPattern([])).toEqual([PATTERN]);
  });

  it("adds the gateway pattern when value is undefined", () => {
    expect(ensureEnabledModelPattern(undefined)).toContain(PATTERN);
  });

  it("adds the gateway pattern when value is not an array", () => {
    expect(ensureEnabledModelPattern("not-an-array")).toContain(PATTERN);
  });

  it("does not duplicate when the pattern is already present", () => {
    const result = ensureEnabledModelPattern([PATTERN, "openai/*"]);
    expect(result.filter((s) => s === PATTERN).length).toBe(1);
  });

  it("preserves non-gateway patterns", () => {
    const result = ensureEnabledModelPattern(["anthropic/*", "openai/*"]);
    expect(result).toContain("anthropic/*");
    expect(result).toContain("openai/*");
    expect(result).toContain(PATTERN);
  });

  it("puts the gateway pattern first", () => {
    const result = ensureEnabledModelPattern(["openai/*"]);
    expect(result[0]).toBe(PATTERN);
  });
});

// -------------------------------------------------------------------------------------------------
// removeEnabledModelPattern
// -------------------------------------------------------------------------------------------------

describe("removeEnabledModelPattern", () => {
  const PATTERN = "sf-llm-gateway-internal/*";

  it("removes the gateway pattern", () => {
    const result = removeEnabledModelPattern([PATTERN, "openai/*"]);
    expect(result).not.toContain(PATTERN);
    expect(result).toContain("openai/*");
  });

  it("leaves any retired anthropic-wildcard in place (migrator removes it separately)", () => {
    // The retired sf-llm-gateway-internal-anthropic/* pattern is rewritten
    // by `migrateGatewaySettings()` during session_start, not by this helper.
    const result = removeEnabledModelPattern([
      PATTERN,
      "sf-llm-gateway-internal-anthropic/*",
      "openai/*",
    ]);
    expect(result).toEqual(["sf-llm-gateway-internal-anthropic/*", "openai/*"]);
  });

  it("returns empty array when only the gateway pattern was present", () => {
    expect(removeEnabledModelPattern([PATTERN])).toEqual([]);
  });

  it("handles undefined input", () => {
    expect(removeEnabledModelPattern(undefined)).toEqual([]);
  });

  it("handles empty array", () => {
    expect(removeEnabledModelPattern([])).toEqual([]);
  });

  it("is a no-op when no gateway pattern is present", () => {
    expect(removeEnabledModelPattern(["openai/*"])).toEqual(["openai/*"]);
  });
});

describe("normalizeLegacyGatewayEnabledModels", () => {
  const PATTERN = "sf-llm-gateway-internal/*";

  it("collapses legacy gateway-only exact model entries to the provider wildcard", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([
        "sf-llm-gateway-internal/claude-opus-4-7",
        "sf-llm-gateway-internal/gpt-5",
      ]),
    ).toEqual([PATTERN]);
  });

  it("collapses the retired anthropic sub-provider wildcard to the unified wildcard", () => {
    expect(
      normalizeLegacyGatewayEnabledModels(["sf-llm-gateway-internal-anthropic/*", "openai/*"]),
    ).toEqual([PATTERN, "openai/*"]);
  });

  it("preserves non-gateway patterns while collapsing legacy gateway entries", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([
        "sf-llm-gateway-internal/gpt-5",
        "openai/*",
        "anthropic/*",
      ]),
    ).toEqual([PATTERN, "openai/*", "anthropic/*"]);
  });

  it("removes redundant exact gateway entries next to the wildcard", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([PATTERN, "sf-llm-gateway-internal/gpt-5", "openai/*"]),
    ).toEqual([PATTERN, "openai/*"]);
  });

  it("leaves non-gateway scopes unchanged", () => {
    expect(normalizeLegacyGatewayEnabledModels(["openai/*"])).toEqual(["openai/*"]);
  });

  it("returns undefined when enabledModels is not an array", () => {
    expect(normalizeLegacyGatewayEnabledModels(undefined)).toBeUndefined();
  });
});

// -------------------------------------------------------------------------------------------------
// Exclusive scope helpers
// -------------------------------------------------------------------------------------------------

describe("isExclusiveEnabledModelPattern", () => {
  it("matches when only the gateway pattern is present", () => {
    expect(isExclusiveEnabledModelPattern(["sf-llm-gateway-internal/*"])).toBe(true);
    expect(isExclusiveEnabledModelPattern(["sf-llm-gateway-internal/*", "openai/*"])).toBe(false);
    expect(isExclusiveEnabledModelPattern([])).toBe(false);
    expect(isExclusiveEnabledModelPattern(undefined)).toBe(false);
  });
});

describe("snapshotEnabledModelsForExclusiveScope", () => {
  it("captures the non-gateway scope for later restore", () => {
    expect(
      snapshotEnabledModelsForExclusiveScope(["sf-llm-gateway-internal/*", "openai/*"]),
    ).toEqual(["openai/*"]);
  });

  it("returns null when no explicit enabledModels were set", () => {
    expect(snapshotEnabledModelsForExclusiveScope(undefined)).toBeNull();
  });
});

describe("restoreEnabledModelsSnapshot", () => {
  it("restores a saved enabledModels array", () => {
    expect(restoreEnabledModelsSnapshot(["openai/*"])).toEqual(["openai/*"]);
  });

  it("returns undefined when the original scope was unset", () => {
    expect(restoreEnabledModelsSnapshot(null)).toBeUndefined();
  });
});

describe("applyGatewayModelScope", () => {
  it("prepends the gateway pattern in additive mode", () => {
    expect(applyGatewayModelScope(["openai/*"], false)).toEqual([
      "sf-llm-gateway-internal/*",
      "openai/*",
    ]);
  });

  it("replaces the scope entirely in exclusive mode", () => {
    expect(applyGatewayModelScope(["openai/*"], true)).toEqual(["sf-llm-gateway-internal/*"]);
  });
});

describe("shouldCaptureExclusiveScopeSnapshot", () => {
  it("captures when no snapshot exists yet", () => {
    expect(shouldCaptureExclusiveScopeSnapshot(["openai/*"], undefined)).toBe(true);
  });

  it("does not overwrite an existing snapshot while already in exclusive scope", () => {
    expect(shouldCaptureExclusiveScopeSnapshot(["sf-llm-gateway-internal/*"], ["openai/*"])).toBe(
      false,
    );
  });
});

// -------------------------------------------------------------------------------------------------
// Saved scope status resolution
// -------------------------------------------------------------------------------------------------

describe("resolveSavedExclusiveScopeStatus", () => {
  it("prefers an explicit project saved mode", () => {
    expect(
      resolveSavedExclusiveScopeStatus({ exclusiveScope: true }, { exclusiveScope: false }),
    ).toEqual({
      project: "exclusive",
      global: "additive",
      effective: "exclusive",
      effectiveSource: "project",
    });
  });

  it("inherits from global when the project has no explicit mode", () => {
    expect(resolveSavedExclusiveScopeStatus({}, { exclusiveScope: true })).toEqual({
      project: "inherit",
      global: "exclusive",
      effective: "exclusive",
      effectiveSource: "global",
    });
  });

  it("falls back to additive defaults when nothing is saved", () => {
    expect(resolveSavedExclusiveScopeStatus({}, {})).toEqual({
      project: "inherit",
      global: "inherit",
      effective: "additive",
      effectiveSource: "default",
    });
  });
});
