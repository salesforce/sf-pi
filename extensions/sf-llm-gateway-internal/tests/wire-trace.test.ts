/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the opt-in wire trace module.
 *
 * Covers the pieces we can exercise without mutating global fetch — the
 * enable/disable toggle and the trace file path helper. `installWireTrace`
 * itself installs a global fetch wrapper that is process-scoped and not
 * reversible, so we only verify its environment gating (no-op when env is
 * unset) and leave the wrapper behavior to manual debugging sessions.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { getWireTraceFile, installWireTrace, isWireTraceEnabled } from "../lib/wire-trace.ts";

const TRACE_ENV = "SF_LLM_GATEWAY_INTERNAL_TRACE";

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env[TRACE_ENV];
  delete process.env[TRACE_ENV];
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env[TRACE_ENV];
  } else {
    process.env[TRACE_ENV] = originalEnv;
  }
});

describe("isWireTraceEnabled", () => {
  it("returns false when the env var is unset", () => {
    expect(isWireTraceEnabled()).toBe(false);
  });

  it("returns false when the env var is set to anything other than '1'", () => {
    process.env[TRACE_ENV] = "true";
    expect(isWireTraceEnabled()).toBe(false);

    process.env[TRACE_ENV] = "0";
    expect(isWireTraceEnabled()).toBe(false);

    process.env[TRACE_ENV] = "";
    expect(isWireTraceEnabled()).toBe(false);
  });

  it("returns true when the env var is exactly '1'", () => {
    process.env[TRACE_ENV] = "1";
    expect(isWireTraceEnabled()).toBe(true);
  });
});

describe("getWireTraceFile", () => {
  it("returns a stable path under Pi's global agent directory", () => {
    const expected = path.join(getAgentDir(), "sf-llm-gateway-internal.trace.jsonl");
    expect(getWireTraceFile()).toBe(expected);
  });
});

describe("installWireTrace", () => {
  it("is a no-op when the env var is unset", () => {
    // No mutation of global fetch should happen; the return value says so.
    expect(installWireTrace("https://example.com")).toBe(false);
  });

  it("is a no-op when the env var is set to something other than '1'", () => {
    process.env[TRACE_ENV] = "true";
    expect(installWireTrace("https://example.com")).toBe(false);
  });
});
