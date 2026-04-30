/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for pure formatting helpers.
 *
 * Covers: formatTokens, formatUsd, maskApiKey, getShortModelLabel
 *
 * These are low-risk but easy to test and useful for regression protection.
 */
import { describe, it, expect } from "vitest";
import { formatTokens, formatUsd, getShortModelLabel } from "../lib/models.ts";
import { maskApiKey } from "../lib/config.ts";

// -------------------------------------------------------------------------------------------------
// formatTokens
// -------------------------------------------------------------------------------------------------

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_000_000)).toBe("1.0M");
  });

  it("formats hundred-thousands as K", () => {
    expect(formatTokens(200_000)).toBe("200.0K");
  });

  it("formats thousands", () => {
    expect(formatTokens(8_192)).toBe("8.2K");
  });

  it("formats small values as rounded integers", () => {
    expect(formatTokens(500)).toBe("500");
  });

  it("returns '0' for zero", () => {
    expect(formatTokens(0)).toBe("0");
  });

  it("returns '0' for negative values", () => {
    expect(formatTokens(-100)).toBe("0");
  });

  it("returns '0' for NaN", () => {
    expect(formatTokens(NaN)).toBe("0");
  });

  it("returns '0' for Infinity", () => {
    expect(formatTokens(Infinity)).toBe("0");
  });
});

// -------------------------------------------------------------------------------------------------
// formatUsd
// -------------------------------------------------------------------------------------------------

describe("formatUsd", () => {
  it("formats small amounts with two decimals", () => {
    expect(formatUsd(12.5)).toBe("$12.50");
  });

  it("formats zero", () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("formats large amounts without decimals", () => {
    expect(formatUsd(1500)).toBe("$1500");
  });

  it("formats amounts just under 1000 with decimals", () => {
    expect(formatUsd(999.99)).toBe("$999.99");
  });

  it("returns $0.00 for NaN", () => {
    expect(formatUsd(NaN)).toBe("$0.00");
  });
});

// -------------------------------------------------------------------------------------------------
// maskApiKey
// -------------------------------------------------------------------------------------------------

describe("maskApiKey", () => {
  it("masks a normal-length key showing first and last 4 chars", () => {
    const result = maskApiKey("sk-ant-1234567890abcdef");
    expect(result).toBe("sk-a…cdef");
  });

  it("masks a short key entirely", () => {
    const result = maskApiKey("abc");
    expect(result).toBe("****");
  });

  it("masks an 8-char key entirely", () => {
    const result = maskApiKey("12345678");
    expect(result).toBe("********");
  });

  it("masks a 9-char key with first/last 4", () => {
    const result = maskApiKey("123456789");
    expect(result).toBe("1234…6789");
  });
});

// -------------------------------------------------------------------------------------------------
// getShortModelLabel
// -------------------------------------------------------------------------------------------------

describe("getShortModelLabel", () => {
  it("returns short label for current default model", () => {
    expect(getShortModelLabel("claude-opus-4-7")).toBe("Opus 4.7 [1M]");
  });

  it("returns short label for the legacy Opus 4.7 alias", () => {
    expect(getShortModelLabel("claude-opus-4-7-v1")).toBe("Opus 4.7 [1M]");
  });

  it("returns short label for previous default model", () => {
    expect(getShortModelLabel("claude-opus-4-6-v1")).toBe("Opus 4.6 [1M]");
  });

  it("returns short label for fallback model", () => {
    expect(getShortModelLabel("claude-sonnet-4-6")).toBe("Sonnet 4.6");
  });

  it("returns the raw ID for unknown models", () => {
    expect(getShortModelLabel("claude-custom")).toBe("claude-custom");
  });
});
