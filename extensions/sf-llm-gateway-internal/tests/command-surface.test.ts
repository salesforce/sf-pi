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
    ).toEqual([
      "setup",
      "import-claude",
      "onboard",
      "on",
      "off",
      "remove-legacy-token",
      "set-default",
    ]);
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
    const values = completions.map((item) => item.value.trimEnd());

    for (const item of GATEWAY_COMMAND_SURFACE) {
      expect(values).toContain(item.id);
      const completion = completions.find((entry) => entry.value.trimEnd() === item.id);
      expect(completion?.description).toBe(item.description);
    }
  });

  it("completes commands that previously drifted out of the autocomplete list", () => {
    const valuesFor = (prefix: string) =>
      getGatewayArgumentCompletions(prefix)?.map((item) => item.value.trimEnd());
    expect(valuesFor("tok")).toContain("tokens");
    expect(valuesFor("onb")).toContain("onboard");
    expect(valuesFor("open")).toContain("open-token");
    expect(valuesFor("imp")).toContain("import-claude");
    expect(valuesFor("lat")).toContain("latency-probe");
  });

  it("appends a space when completing commands that have scoped children", () => {
    expect(getGatewayArgumentCompletions("set")?.map((item) => item.value)).toContain("setup ");
  });

  it("completes scoped command targets after a trailing space", () => {
    expect(getGatewayArgumentCompletions("setup ")?.map((item) => item.value)).toEqual([
      "setup global",
      "setup project",
    ]);
  });

  it("returns full argument-tail values for scoped commands", () => {
    expect(getGatewayArgumentCompletions("setup g")?.map((item) => item.value)).toEqual([
      "setup global",
    ]);
    expect(getGatewayArgumentCompletions("on p")?.map((item) => item.value)).toEqual([
      "on project",
    ]);
  });

  it("uses canonical command ids when completing scopes after aliases", () => {
    expect(getGatewayArgumentCompletions("enable p")?.map((item) => item.value)).toEqual([
      "on project",
    ]);
  });
});
