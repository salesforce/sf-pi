/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  extractNodeRuntimeFloor,
  isNodeRuntimeSupported,
  NODE_RUNTIME_FLOOR,
  parseSemanticVersion,
} from "../runtime-floor.ts";

const EXPECTED_FLOOR = "22.19.0";

describe("Node Runtime Floor", () => {
  it("reads the canonical floor from package metadata", () => {
    expect(NODE_RUNTIME_FLOOR).toBe(EXPECTED_FLOOR);
  });

  it("extracts >= ranges as normalized semantic versions", () => {
    expect(extractNodeRuntimeFloor(">=22.19")).toBe("22.19.0");
    expect(extractNodeRuntimeFloor(">=22.19.1")).toBe("22.19.1");
  });

  it("parses v-prefixed versions", () => {
    expect(parseSemanticVersion("v22.19.0")).toEqual({ major: 22, minor: 19, patch: 0 });
  });

  it("accepts equal or newer Node versions only", () => {
    expect(isNodeRuntimeSupported("v22.19.0", EXPECTED_FLOOR)).toBe(true);
    expect(isNodeRuntimeSupported("v22.20.0", EXPECTED_FLOOR)).toBe(true);
    expect(isNodeRuntimeSupported("v23.0.0", EXPECTED_FLOOR)).toBe(true);
    expect(isNodeRuntimeSupported("v22.18.9", EXPECTED_FLOOR)).toBe(false);
    expect(isNodeRuntimeSupported("v20.99.99", EXPECTED_FLOOR)).toBe(false);
  });
});
