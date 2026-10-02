/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it } from "vitest";

import { captureObservedMcpTools } from "../lib/observed-tools.ts";
import { getPreset } from "../lib/presets.ts";
import {
  applyToolExposurePolicy,
  buildToolExposurePolicy,
  customizeToolExposure,
  toolPolicyWarnings,
} from "../lib/tool-policy.ts";

afterEach(() => captureObservedMcpTools([]));

describe("SF MCP tool exposure policy", () => {
  it("builds a read-only profile that hides mixed and write tools", () => {
    const policy = buildToolExposurePolicy(getPreset("headless-360"), "read-only");

    expect(policy.exposures).toEqual({
      discover: "codemode",
      describe: "codemode",
      dispatch: "hidden",
      dispatch_readonly: "codemode",
    });
  });

  it("keeps recommended defaults behavior-compatible and quarantine fully hidden", () => {
    const preset = getPreset("data360");

    expect(buildToolExposurePolicy(preset, "recommended").exposures).toEqual({
      search: "codemode",
      payload_examples: "codemode",
      execute: "codemode",
    });
    expect(buildToolExposurePolicy(preset, "quarantine").exposures).toEqual({
      search: "hidden",
      payload_examples: "hidden",
      execute: "hidden",
    });
  });

  it("turns a per-tool override into a custom policy and warns on risky direct exposure", () => {
    const preset = getPreset("headless-360");
    const custom = customizeToolExposure(
      preset,
      buildToolExposurePolicy(preset, "read-only"),
      "dispatch",
      "direct",
    );

    expect(custom.profile).toBe("custom");
    expect(custom.exposures.dispatch).toBe("direct");
    expect(toolPolicyWarnings(preset, custom)).toEqual([
      expect.stringContaining("dispatch uses Direct exposure with Mixed risk"),
    ]);
  });

  it("reconstructs custom overrides from native configuration after reload", () => {
    const preset = getPreset("headless-360");
    const custom = customizeToolExposure(
      preset,
      buildToolExposurePolicy(preset, "recommended"),
      "dispatch",
      "deferred",
    );
    const config = applyToolExposurePolicy(
      preset,
      { url: "https://example.test/mcp", exposure: "hidden" },
      custom,
    );

    expect(buildToolExposurePolicy(preset, "custom", config).exposures).toEqual(custom.exposures);
  });

  it("locks observed unapproved tools and unavailable documented tools hidden", () => {
    captureObservedMcpTools([
      { name: "mcp__salesforce_headless_360__discover", exposure: "codemode" },
      { name: "mcp__salesforce_headless_360__unexpected_write", exposure: "hidden" },
    ]);

    const policy = buildToolExposurePolicy(getPreset("headless-360"), "all-approved");

    expect(policy.locked).toEqual(["unexpected_write"]);
    expect(policy.unavailable).toEqual(["describe", "dispatch", "dispatch_readonly"]);
    expect(policy.exposures).toEqual({
      discover: "codemode",
      describe: "hidden",
      dispatch: "hidden",
      dispatch_readonly: "hidden",
    });
  });

  it("applies an exact policy without changing unrelated connection fields", () => {
    const preset = getPreset("data360");
    const policy = buildToolExposurePolicy(preset, "read-only");
    const config = applyToolExposurePolicy(
      preset,
      {
        url: "https://api.salesforce.com/platform/mcp/v1/data/sandbox/data360",
        oauth: {
          clientId: "public-client",
          callbackPort: 8765,
          authServerMetadataUrl: "https://login.example.test/.well-known/openid-configuration",
        },
        enabled: false,
        timeout: 120,
        exposure: "codemode",
      },
      policy,
    );

    expect(config).toMatchObject({
      oauth: {
        clientId: "public-client",
        callbackPort: 8765,
        authServerMetadataUrl: "https://login.example.test/.well-known/openid-configuration",
      },
      enabled: false,
      timeout: 120,
      exposure: "hidden",
      toolExposure: {
        search: "codemode",
        payload_examples: "codemode",
        execute: "hidden",
      },
    });
  });
});
