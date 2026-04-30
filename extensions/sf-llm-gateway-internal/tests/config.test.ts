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
  const PATTERN_ANTHROPIC = "sf-llm-gateway-internal-anthropic/*";

  it("adds both gateway patterns to empty array", () => {
    const result = ensureEnabledModelPattern([]);
    expect(result).toEqual([PATTERN, PATTERN_ANTHROPIC]);
  });

  it("adds both gateway patterns when value is undefined", () => {
    const result = ensureEnabledModelPattern(undefined);
    expect(result).toContain(PATTERN);
    expect(result).toContain(PATTERN_ANTHROPIC);
  });

  it("adds both gateway patterns when value is not an array", () => {
    const result = ensureEnabledModelPattern("not-an-array");
    expect(result).toContain(PATTERN);
    expect(result).toContain(PATTERN_ANTHROPIC);
  });

  it("does not duplicate when patterns are already present", () => {
    const result = ensureEnabledModelPattern([PATTERN, PATTERN_ANTHROPIC, "openai/*"]);
    expect(result.filter((s) => s === PATTERN).length).toBe(1);
    expect(result.filter((s) => s === PATTERN_ANTHROPIC).length).toBe(1);
  });

  it("preserves non-gateway patterns", () => {
    const result = ensureEnabledModelPattern(["anthropic/*", "openai/*"]);
    expect(result).toContain("anthropic/*");
    expect(result).toContain("openai/*");
    expect(result).toContain(PATTERN);
    expect(result).toContain(PATTERN_ANTHROPIC);
  });

  it("puts gateway patterns first, OpenAI-compat before Anthropic", () => {
    const result = ensureEnabledModelPattern(["openai/*"]);
    expect(result[0]).toBe(PATTERN);
    expect(result[1]).toBe(PATTERN_ANTHROPIC);
  });
});

// -------------------------------------------------------------------------------------------------
// removeEnabledModelPattern
// -------------------------------------------------------------------------------------------------

describe("removeEnabledModelPattern", () => {
  const PATTERN = "sf-llm-gateway-internal/*";
  const PATTERN_ANTHROPIC = "sf-llm-gateway-internal-anthropic/*";

  it("removes both gateway patterns", () => {
    const result = removeEnabledModelPattern([PATTERN, PATTERN_ANTHROPIC, "openai/*"]);
    expect(result).not.toContain(PATTERN);
    expect(result).not.toContain(PATTERN_ANTHROPIC);
    expect(result).toContain("openai/*");
  });

  it("returns empty array when only the gateway patterns were present", () => {
    const result = removeEnabledModelPattern([PATTERN, PATTERN_ANTHROPIC]);
    expect(result).toEqual([]);
  });

  it("handles undefined input", () => {
    const result = removeEnabledModelPattern(undefined);
    expect(result).toEqual([]);
  });

  it("handles empty array", () => {
    const result = removeEnabledModelPattern([]);
    expect(result).toEqual([]);
  });

  it("is a no-op when no gateway pattern is present", () => {
    const result = removeEnabledModelPattern(["openai/*"]);
    expect(result).toEqual(["openai/*"]);
  });
});

describe("normalizeLegacyGatewayEnabledModels", () => {
  const PATTERN = "sf-llm-gateway-internal/*";
  const PATTERN_ANTHROPIC = "sf-llm-gateway-internal-anthropic/*";

  it("collapses legacy gateway-only exact model entries to both provider wildcards", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([
        "sf-llm-gateway-internal/claude-opus-4-7",
        "sf-llm-gateway-internal/gpt-5",
      ]),
    ).toEqual([PATTERN, PATTERN_ANTHROPIC]);
  });

  it("preserves non-gateway patterns while collapsing legacy gateway entries", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([
        "sf-llm-gateway-internal/gpt-5",
        "openai/*",
        "anthropic/*",
      ]),
    ).toEqual([PATTERN, PATTERN_ANTHROPIC, "openai/*", "anthropic/*"]);
  });

  it("removes redundant exact gateway entries and adds the Anthropic wildcard when missing", () => {
    expect(
      normalizeLegacyGatewayEnabledModels([PATTERN, "sf-llm-gateway-internal/gpt-5", "openai/*"]),
    ).toEqual([PATTERN, PATTERN_ANTHROPIC, "openai/*"]);
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
  it("matches when only the gateway patterns are present", () => {
    expect(isExclusiveEnabledModelPattern(["sf-llm-gateway-internal/*"])).toBe(true);
    expect(
      isExclusiveEnabledModelPattern([
        "sf-llm-gateway-internal/*",
        "sf-llm-gateway-internal-anthropic/*",
      ]),
    ).toBe(true);
    expect(isExclusiveEnabledModelPattern(["sf-llm-gateway-internal/*", "openai/*"])).toBe(false);
    expect(isExclusiveEnabledModelPattern([])).toBe(false);
    expect(isExclusiveEnabledModelPattern(undefined)).toBe(false);
  });
});

describe("snapshotEnabledModelsForExclusiveScope", () => {
  it("captures the non-gateway scope for later restore", () => {
    expect(
      snapshotEnabledModelsForExclusiveScope([
        "sf-llm-gateway-internal/*",
        "sf-llm-gateway-internal-anthropic/*",
        "openai/*",
      ]),
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
  it("prepends both gateway patterns in additive mode", () => {
    expect(applyGatewayModelScope(["openai/*"], false)).toEqual([
      "sf-llm-gateway-internal/*",
      "sf-llm-gateway-internal-anthropic/*",
      "openai/*",
    ]);
  });

  it("replaces the scope entirely in exclusive mode", () => {
    expect(applyGatewayModelScope(["openai/*"], true)).toEqual([
      "sf-llm-gateway-internal/*",
      "sf-llm-gateway-internal-anthropic/*",
    ]);
  });
});

describe("shouldCaptureExclusiveScopeSnapshot", () => {
  it("captures when no snapshot exists yet", () => {
    expect(shouldCaptureExclusiveScopeSnapshot(["openai/*"], undefined)).toBe(true);
  });

  it("does not overwrite an existing snapshot while already in exclusive scope", () => {
    expect(
      shouldCaptureExclusiveScopeSnapshot(
        ["sf-llm-gateway-internal/*", "sf-llm-gateway-internal-anthropic/*"],
        ["openai/*"],
      ),
    ).toBe(false);
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
