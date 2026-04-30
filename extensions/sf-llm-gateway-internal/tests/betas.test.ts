/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for beta header resolution and aliasing.
 *
 * Beta header logic determines which Anthropic features are enabled by model
 * defaults and which ones are injected explicitly at runtime.
 */
import { describe, expect, it } from "vitest";
import { normalizeBetaValue, resolveBetaAlias, resolveEffectiveBetas } from "../lib/models.ts";

// -------------------------------------------------------------------------------------------------
// resolveBetaAlias / normalizeBetaValue
// -------------------------------------------------------------------------------------------------

describe("resolveBetaAlias", () => {
  it("resolves short aliases to full values", () => {
    expect(resolveBetaAlias("context-1m")).toBe("context-1m-2025-08-07");
    expect(resolveBetaAlias("128k")).toBe("output-128k-2025-02-19");
    expect(resolveBetaAlias("interleaved")).toBe("interleaved-thinking-2025-05-14");
    expect(resolveBetaAlias("cache")).toBe("prompt-caching-2024-07-31");
  });

  it("returns undefined for unknown aliases", () => {
    expect(resolveBetaAlias("unknown-beta")).toBeUndefined();
  });
});

describe("normalizeBetaValue", () => {
  it("normalizes aliases to canonical values", () => {
    expect(normalizeBetaValue("context-1m")).toBe("context-1m-2025-08-07");
  });

  it("keeps raw beta values so arbitrary injections are possible", () => {
    expect(normalizeBetaValue("compact-2026-01-12")).toBe("compact-2026-01-12");
    expect(normalizeBetaValue("my-custom-beta-2099-01-01")).toBe("my-custom-beta-2099-01-01");
  });
});

// -------------------------------------------------------------------------------------------------
// resolveEffectiveBetas
// -------------------------------------------------------------------------------------------------

describe("resolveEffectiveBetas", () => {
  it("returns model defaults when no overrides are active", () => {
    const defaults = ["context-1m-2025-08-07", "output-128k-2025-02-19"];
    const result = resolveEffectiveBetas(defaults, null, new Set());
    expect(result).toEqual(defaults);
  });

  it("filters model defaults when an allow-list override is present", () => {
    const defaults = [
      "context-1m-2025-08-07",
      "output-128k-2025-02-19",
      "interleaved-thinking-2025-05-14",
    ];
    const result = resolveEffectiveBetas(
      defaults,
      new Set(["context-1m-2025-08-07", "interleaved-thinking-2025-05-14"]),
      new Set(),
    );
    expect(result).toEqual(["context-1m-2025-08-07", "interleaved-thinking-2025-05-14"]);
  });

  it("adds injected betas on top of filtered defaults", () => {
    const defaults = ["interleaved-thinking-2025-05-14"];
    const result = resolveEffectiveBetas(
      defaults,
      new Set(["interleaved-thinking-2025-05-14"]),
      new Set(["prompt-caching-2024-07-31"]),
    );
    expect(result).toEqual(["interleaved-thinking-2025-05-14", "prompt-caching-2024-07-31"]);
  });
});
