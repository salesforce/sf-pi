/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import {
  buildExtensionDetailSummary,
  getExtensionReadmePath,
  getExtensionStatus,
  getExtensionStatusLabel,
  getExtensionTestsPath,
} from "../lib/extension-details.ts";
import { buildExtensionStates } from "../index.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("extension detail helpers", () => {
  it("reports enabled and disabled states explicitly", () => {
    const states = buildExtensionStates(new Set(["extensions/sf-ohana-spinner/index.ts"]));
    const spinner = states.find((state) => state.id === "sf-ohana-spinner");
    const slack = states.find((state) => state.id === "sf-slack");

    expect(spinner).toBeDefined();
    expect(slack).toBeDefined();
    expect(getExtensionStatus(spinner!)).toBe("disabled");
    expect(getExtensionStatusLabel(spinner!)).toBe("Disabled");
    expect(getExtensionStatus(slack!)).toBe("enabled");
    expect(getExtensionStatusLabel(slack!)).toBe("Enabled");
  });

  it("reports always-active extensions as locked", () => {
    const states = buildExtensionStates(new Set(["extensions/sf-pi-manager/index.ts"]));
    const manager = states.find((state) => state.id === "sf-pi-manager");

    expect(manager).toBeDefined();
    expect(getExtensionStatus(manager!)).toBe("locked");
    expect(getExtensionStatusLabel(manager!)).toBe("Locked (always active)");
  });

  it("derives repo-relative README and tests paths from the entry file", () => {
    const states = buildExtensionStates(new Set());
    const slack = states.find((state) => state.id === "sf-slack");

    expect(slack).toBeDefined();
    expect(getExtensionReadmePath(slack!)).toBe("extensions/sf-slack/README.md");
    expect(getExtensionTestsPath(slack!)).toBe("extensions/sf-slack/tests");
  });

  it("builds a detail summary with capabilities and availability flags", () => {
    const states = buildExtensionStates(new Set());
    const slack = states.find((state) => state.id === "sf-slack");

    expect(slack).toBeDefined();
    expect(buildExtensionDetailSummary(slack!, PACKAGE_ROOT)).toMatchObject({
      status: "enabled",
      statusLabel: "Enabled",
      readmePath: "extensions/sf-slack/README.md",
      readmeAvailable: true,
      testsPath: "extensions/sf-slack/tests",
      testsAvailable: true,
      commands: ["/sf-slack"],
      providers: ["sf-slack"],
      tools: [
        "slack",
        "slack_time_range",
        "slack_resolve",
        "slack_research",
        "slack_channel",
        "slack_user",
        "slack_file",
        "slack_canvas",
        "slack_send",
      ],
      events: ["session_start", "session_shutdown", "before_agent_start"],
    });
  });
});
