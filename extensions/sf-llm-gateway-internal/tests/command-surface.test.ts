/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the gateway command-surface metadata used by completions,
 * no-args panel rows, and help output.
 */
import { describe, expect, it } from "vitest";
import { GATEWAY_COMMAND_SURFACE, getGatewayArgumentCompletions } from "../lib/command-surface.ts";

describe("gateway command surface", () => {
  it("identifies scoped command-surface actions", () => {
    expect(
      GATEWAY_COMMAND_SURFACE.filter((item) => item.acceptsScope).map((item) => item.id),
    ).toEqual(["setup", "import-claude", "onboard", "on", "off", "set-default"]);
  });

  it("has descriptions for every surfaced command", () => {
    for (const item of GATEWAY_COMMAND_SURFACE) {
      expect(item.description.trim().length).toBeGreaterThan(20);
      expect(item.label.trim().length).toBeGreaterThan(0);
      expect(item.usage.trim().length).toBeGreaterThan(0);
    }
  });

  it("offers every command as a first-token completion with descriptions", () => {
    const completions = getGatewayArgumentCompletions("") ?? [];
    const values = completions.map((item) => item.value);

    for (const item of GATEWAY_COMMAND_SURFACE) {
      expect(values).toContain(item.id);
      const completion = completions.find((entry) => entry.value === item.id);
      expect(completion?.description).toBe(item.description);
    }
  });

  it("completes commands that previously drifted out of the autocomplete list", () => {
    expect(getGatewayArgumentCompletions("tok")?.map((item) => item.value)).toContain("tokens");
    expect(getGatewayArgumentCompletions("onb")?.map((item) => item.value)).toContain("onboard");
    expect(getGatewayArgumentCompletions("open")?.map((item) => item.value)).toContain(
      "open-token",
    );
    expect(getGatewayArgumentCompletions("imp")?.map((item) => item.value)).toContain(
      "import-claude",
    );
    expect(getGatewayArgumentCompletions("lat")?.map((item) => item.value)).toContain(
      "latency-probe",
    );
  });

  it("completes beta aliases after a trailing space", () => {
    const completions = getGatewayArgumentCompletions("beta ") ?? [];
    expect(completions.map((item) => item.value)).toContain("reset");
    expect(completions.length).toBeGreaterThan(1);
  });

  it("completes scoped command targets after a trailing space", () => {
    expect(getGatewayArgumentCompletions("setup ")?.map((item) => item.value)).toEqual([
      "global",
      "project",
    ]);
  });
});
