/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the transcript emission policy.
 */
import { describe, it, expect } from "vitest";
import { shouldEmitTranscriptRow } from "../lib/transcript.ts";

describe("shouldEmitTranscriptRow", () => {
  it("balanced: emits on error", () => {
    expect(shouldEmitTranscriptRow("error", "balanced", false)).toBe(true);
  });

  it("balanced: emits on error->clean transition", () => {
    expect(shouldEmitTranscriptRow("transition-clean", "balanced", false)).toBe(true);
  });

  it("balanced: stays silent on plain clean", () => {
    expect(shouldEmitTranscriptRow("clean", "balanced", false)).toBe(false);
  });

  it("balanced: stays silent on checking/idle", () => {
    expect(shouldEmitTranscriptRow("checking", "balanced", false)).toBe(false);
    expect(shouldEmitTranscriptRow("idle", "balanced", false)).toBe(false);
  });

  it("balanced: emits first unavailable, silent after", () => {
    expect(shouldEmitTranscriptRow("unavailable", "balanced", false)).toBe(true);
    expect(shouldEmitTranscriptRow("unavailable", "balanced", true)).toBe(false);
  });

  it("verbose: emits on every status except still suppresses duplicate unavailable is caller's job", () => {
    expect(shouldEmitTranscriptRow("error", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("clean", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("transition-clean", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("checking", "verbose", true)).toBe(true);
    expect(shouldEmitTranscriptRow("idle", "verbose", true)).toBe(true);
  });
});
