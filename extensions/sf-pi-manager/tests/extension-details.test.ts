/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  buildExtensionDetailSummary,
  getExtensionReadmePath,
  getExtensionStatus,
  getExtensionStatusLabel,
  getExtensionTestsPath,
} from "../lib/extension-details.ts";
import { buildExtensionStates } from "../index.ts";
import { SfPiOverlayComponent } from "../lib/overlay.ts";
import {
  iconForCommandGroup,
  iconForExtension,
  resolveUiGlyphs,
} from "../../../lib/common/ui-glyphs.ts";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..");
const stubTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

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

  it("renders extension details as a user control page without developer metadata sections", () => {
    const states = buildExtensionStates(new Set());
    const herdr = states.find((state) => state.id === "sf-herdr");
    expect(herdr).toBeDefined();

    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      () => undefined,
      {} as never,
      {} as never,
      () => [],
      () => undefined,
      { extensionId: "sf-herdr", view: "detail" },
    );

    const rendered = overlay.render(120).join("\n");
    expect(rendered).toContain(
      `${iconForExtension("sf-herdr", resolveUiGlyphs("/tmp/project"))} SF Herdr`,
    );
    expect(rendered).toContain("Actions");
    expect(rendered).not.toContain("Bundle");
    expect(rendered).not.toContain("Capabilities");
    expect(rendered).not.toContain("extensions/sf-herdr/index.ts");
    expect(rendered).not.toContain("sf_herdr_plan");
  });

  it("renders Manager detail actions under group headings", () => {
    const states = buildExtensionStates(new Set());
    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      () => undefined,
      {} as never,
      {} as never,
      () => [
        {
          id: "status",
          label: "Status",
          description: "Show status",
          group: "Diagnostics",
          run: () => undefined,
        },
        {
          id: "setup",
          label: "Setup",
          description: "Install setup",
          group: "Setup",
          run: () => undefined,
        },
      ],
      () => undefined,
      { extensionId: "sf-feedback", view: "detail" },
    );

    const rendered = overlay.render(120).join("\n");

    const glyphs = resolveUiGlyphs("/tmp/project");
    expect(rendered).toContain(`${iconForCommandGroup("Diagnostics", glyphs)} Diagnostics`);
    expect(rendered).toContain(`${iconForCommandGroup("Setup", glyphs)} Setup`);
    expect(rendered).toContain(`${iconForCommandGroup("Lifecycle", glyphs)} Lifecycle`);
  });

  it("renders scoped Manager actions once with the selected Manager scope", () => {
    const states = buildExtensionStates(new Set());
    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      () => undefined,
      {} as never,
      {} as never,
      () => [
        {
          id: "setup",
          label: "Setup gateway",
          description: "Configure gateway credentials",
          acceptsScope: true,
          run: () => undefined,
        },
      ],
      () => undefined,
      { extensionId: "sf-feedback", view: "detail" },
    );

    expect(overlay.render(120).join("\n")).toContain("Setup gateway [global]");

    overlay.handleInput("s");

    expect(overlay.render(120).join("\n")).toContain("Setup gateway [project]");
  });

  it("passes the selected Manager scope to in-place actions", () => {
    const states = buildExtensionStates(new Set());
    const calls: string[] = [];
    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      () => undefined,
      {} as never,
      {} as never,
      () => [
        {
          id: "setup",
          label: "Setup gateway",
          description: "Configure gateway credentials",
          acceptsScope: true,
          run: () => undefined,
        },
      ],
      (_action, scope) => {
        calls.push(scope);
      },
      { extensionId: "sf-feedback", view: "detail" },
    );

    overlay.handleInput("s");
    overlay.handleInput("\x1b[B"); // Skip built-in Settings row on configurable extensions.
    overlay.handleInput("\r");

    expect(calls).toEqual(["project"]);
  });

  it("returns close-before-run manager actions after closing the overlay", () => {
    const states = buildExtensionStates(new Set());
    let result: unknown;
    const action = {
      id: "open",
      label: "Open",
      description: "Open external UI",
      closeBeforeRun: true,
      run: () => undefined,
    };

    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      (value) => {
        result = value;
      },
      {} as never,
      {} as never,
      () => [action],
      () => undefined,
      { extensionId: "sf-feedback", view: "detail" },
    );

    overlay.handleInput("s");
    overlay.handleInput("\x1b[B"); // Skip built-in Settings row on configurable extensions.
    overlay.handleInput("\r");

    expect(result).toMatchObject({
      scope: "project",
      runActionAfterClose: { extensionId: "sf-feedback", actionId: "open" },
    });
  });

  it("keeps long detail pages within the viewport while navigating actions", () => {
    const states = buildExtensionStates(new Set());
    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 12,
      () => undefined,
      {} as never,
      {} as never,
      () =>
        Array.from({ length: 12 }, (_, i) => ({
          id: `action-${i}`,
          label: `Action ${i}`,
          description: `Description ${i}`,
          group: "Many actions",
          run: () => undefined,
        })),
      () => undefined,
      { extensionId: "sf-feedback", view: "detail" },
    );

    const first = overlay.render(100);
    expect(first.length).toBeLessThanOrEqual(12);
    expect(first.join("\n")).toContain("10-15/48");
    expect(first.join("\n")).toContain("Settings");

    for (let i = 0; i < 9; i++) overlay.handleInput("\x1b[B");
    const second = overlay.render(100).join("\n");
    expect(second).toContain("Action 8");
    expect(second).not.toContain("Settings");
  });

  it("scrolls long settings pages with PageDown", async () => {
    const custom = {
      id: "sf-test",
      name: "SF Test",
      description: "Test extension",
      file: "extensions/sf-test/index.ts",
      category: "assistive",
      defaultEnabled: true,
      enabled: true,
      configurable: true,
      getConfigPanel: async () =>
        (() => ({
          focused: false,
          handleInput: () => undefined,
          invalidate: () => undefined,
          render: () => [],
          renderContent: () => Array.from({ length: 24 }, (_, i) => ` row ${i + 1}`),
        })) as never,
    } as never;
    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      [custom],
      [custom],
      "global",
      () => 12,
      () => undefined,
      {} as never,
      {} as never,
      () => [],
      () => undefined,
      { extensionId: "sf-test", view: "settings" },
    );

    await Promise.resolve();
    const first = overlay.render(100).join("\n");
    expect(first).toContain("row 1");
    expect(first).toContain("PageUp/PageDown scroll");
    expect(first).not.toContain("row 20");

    overlay.handleInput("\x1b[6~");
    const second = overlay.render(100).join("\n");
    expect(second).toContain("row 5");
    expect(second).not.toContain("row 1");
  });

  it("closes direct deep-linked extension details on escape instead of returning to the list", () => {
    const states = buildExtensionStates(new Set());
    let closed = false;

    const overlay = new SfPiOverlayComponent(
      stubTheme,
      "0.0.0-test",
      PACKAGE_ROOT,
      "/tmp/project",
      states,
      states,
      "global",
      () => 40,
      () => {
        closed = true;
      },
      {} as never,
      {} as never,
      () => [],
      () => undefined,
      { extensionId: "sf-feedback", view: "detail" },
    );

    overlay.handleInput("\u001b");

    expect(closed).toBe(true);
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
        "slack_schedule",
      ],
      events: ["session_start", "session_shutdown", "before_agent_start"],
    });
  });
});
