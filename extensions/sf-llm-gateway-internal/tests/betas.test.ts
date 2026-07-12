/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for beta header resolution and aliasing.
 *
 * Beta header logic determines which Anthropic features are enabled by model
 * defaults and which ones are injected explicitly at runtime.
 */
import { describe, expect, it, vi } from "vitest";
import { applyRuntimeBetaHeader, handleBetaCommand } from "../lib/beta-controls.ts";
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

describe("handleBetaCommand", () => {
  it("updates the next request header without re-registering the provider", async () => {
    const pi = {
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
    };
    const emitOutput = vi.fn(async () => undefined);

    await handleBetaCommand(
      pi as never,
      { cwd: "/tmp/project" } as never,
      ["context-1m", "off"],
      emitOutput,
    );

    const headers: Record<string, string | null> = {
      "anthropic-beta":
        "context-1m-2025-08-07,output-128k-2025-02-19,interleaved-thinking-2025-05-14",
    };
    applyRuntimeBetaHeader(headers, "claude-opus-4-6-v1");

    expect(headers["anthropic-beta"]).toBe(
      "output-128k-2025-02-19,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    );
    expect(pi.registerProvider).not.toHaveBeenCalled();
    expect(pi.unregisterProvider).not.toHaveBeenCalled();

    await handleBetaCommand(pi as never, { cwd: "/tmp/project" } as never, ["reset"], emitOutput);
  });
});

describe("applyRuntimeBetaHeader", () => {
  it("overrides stale registered model headers when runtime disables a default beta", () => {
    const headers: Record<string, string | null> = {
      "anthropic-beta":
        "context-1m-2025-08-07,output-128k-2025-02-19,interleaved-thinking-2025-05-14",
    };

    applyRuntimeBetaHeader(headers, "claude-opus-4-6-v1", {
      defaultBetas: new Set(["context-1m-2025-08-07"]),
      extraBetas: new Set(),
    });

    expect(headers["anthropic-beta"]).toBe(
      "context-1m-2025-08-07,fine-grained-tool-streaming-2025-05-14",
    );
  });

  it("deletes stale registered model headers when no beta remains effective", () => {
    const headers: Record<string, string | null> = {
      "anthropic-beta": "interleaved-thinking-2025-05-14",
    };

    applyRuntimeBetaHeader(headers, "claude-sonnet-4-6", {
      defaultBetas: new Set(),
      extraBetas: new Set(),
    });

    expect(headers["anthropic-beta"]).toBeNull();
  });

  it("injects runtime extras without touching non-Anthropic gateway models", () => {
    const anthropicHeaders: Record<string, string | null> = {};
    applyRuntimeBetaHeader(anthropicHeaders, "claude-opus-4-7", {
      defaultBetas: null,
      extraBetas: new Set(["prompt-caching-2024-07-31"]),
    });
    expect(anthropicHeaders["anthropic-beta"]).toBe("prompt-caching-2024-07-31");

    const openAiHeaders: Record<string, string | null> = {};
    applyRuntimeBetaHeader(openAiHeaders, "gpt-5", {
      defaultBetas: null,
      extraBetas: new Set(["prompt-caching-2024-07-31"]),
    });
    expect(openAiHeaders).toEqual({});
  });
});

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
