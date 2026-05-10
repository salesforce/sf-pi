/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Hardening: relative paths supplied by the LLM must NOT be allowed to
 * escape the workspace via `..` traversal. Absolute paths are trusted
 * because the user typed them, but absolute paths containing literal `..`
 * segments are also rejected as a defense-in-depth measure.
 */

import path from "node:path";
import { describe, expect, test } from "vitest";
import { PathEscapeError, resolveToolPath } from "../lib/file-classify.ts";
import { safeResolveToolPath, isToolError } from "../lib/tool-types.ts";

const WORKSPACE = path.resolve("/tmp/sf-agentscript-test-workspace");

describe("resolveToolPath workspace containment", () => {
  test("relative path inside workspace resolves cleanly", () => {
    const out = resolveToolPath("force-app/main/default/bundles/X.agent", WORKSPACE);
    expect(out.startsWith(WORKSPACE + path.sep)).toBe(true);
    expect(out.endsWith("/X.agent")).toBe(true);
  });

  test("relative path with ../ that escapes the workspace is rejected", () => {
    expect(() => resolveToolPath("../../etc/hosts.agent", WORKSPACE)).toThrow(PathEscapeError);
  });

  test("absolute path outside workspace is allowed (user typed it explicitly)", () => {
    const out = resolveToolPath("/tmp/outside.agent", WORKSPACE);
    expect(out).toBe("/tmp/outside.agent");
  });

  test("absolute path with literal `..` segment is rejected", () => {
    expect(() => resolveToolPath("/tmp/../etc/hosts.agent", WORKSPACE)).toThrow(PathEscapeError);
  });

  test("`@`-prefixed relative path is anchored to workspace", () => {
    const out = resolveToolPath("@bundles/A.agent", WORKSPACE);
    expect(out).toBe(path.join(WORKSPACE, "bundles/A.agent"));
  });

  test("`@`-prefixed escape path is still rejected", () => {
    expect(() => resolveToolPath("@../../etc/hosts.agent", WORKSPACE)).toThrow(PathEscapeError);
  });
});

describe("safeResolveToolPath returns clean tool errors", () => {
  test("missing path → INVALID_PARAMS", () => {
    const out = safeResolveToolPath(undefined, WORKSPACE);
    expect("ok" in out && out.ok === true).toBe(false);
    if ("details" in out && isToolError(out.details)) {
      expect(out.details.error).toBe("INVALID_PARAMS");
    }
  });

  test("escape attempt → INVALID_PATH with safe message", () => {
    const out = safeResolveToolPath("../../etc/hosts.agent", WORKSPACE);
    expect("absPath" in out).toBe(false);
    if ("details" in out && isToolError(out.details)) {
      expect(out.details.error.startsWith("INVALID_PATH")).toBe(true);
      expect(out.details.suggestion).toContain("absolute");
    }
  });

  test("good relative path → resolved absolute path inside workspace", () => {
    const out = safeResolveToolPath("bundles/X.agent", WORKSPACE);
    expect("absPath" in out && out.ok === true).toBe(true);
    if ("absPath" in out) {
      expect(out.absPath.startsWith(WORKSPACE + path.sep)).toBe(true);
    }
  });
});
