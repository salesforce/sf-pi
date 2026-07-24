/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for pure formatting helpers.
 *
 * Covers: formatTokens, formatUsd, getShortModelLabel
 *
 * These are low-risk but easy to test and useful for regression protection.
 */
import { describe, it, expect } from "vitest";
import { formatTokens, formatUsd, getShortModelLabel } from "../lib/models.ts";

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
// getShortModelLabel
// -------------------------------------------------------------------------------------------------

describe("getShortModelLabel", () => {
  it("returns short label for current default model", () => {
    expect(getShortModelLabel("gpt-5.6-sol")).toBe("GPT-5.6 Sol [1M]");
  });

  it("returns short label for the former Opus 4.8 default", () => {
    expect(getShortModelLabel("claude-opus-4-8")).toBe("Opus 4.8 [1M]");
  });

  it("returns short label for the legacy Opus 4.7 alias", () => {
    expect(getShortModelLabel("claude-opus-4-7-v1")).toBe("Opus 4.7 [1M]");
  });

  it("returns short label for previous Opus model", () => {
    expect(getShortModelLabel("claude-opus-4-6-v1")).toBe("Opus 4.6 [1M]");
  });

  it("returns short label for fallback model", () => {
    expect(getShortModelLabel("claude-sonnet-5")).toBe("Sonnet 5");
  });

  it("returns the raw ID for unknown models", () => {
    expect(getShortModelLabel("claude-custom")).toBe("claude-custom");
  });
});
