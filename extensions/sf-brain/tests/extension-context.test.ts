/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the live SF Pi extension context injected by sf-brain. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatSfPiExtensionContext,
  SF_PI_EXTENSIONS_CLOSE_TAG,
  SF_PI_EXTENSIONS_ENTRY_TYPE,
  SF_PI_EXTENSIONS_OPEN_TAG,
  shouldInjectSfPiExtensionContext,
} from "../lib/extension-context.ts";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return {
    ...actual,
    getAgentDir: () => tempAgentDir,
  };
});

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-extension-context-agent-"));
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

function makeCwd(disabledFiles: string[] = []): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-brain-extension-context-cwd-"));
  const configDir = path.join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    path.join(configDir, "settings.json"),
    `${JSON.stringify({
      packages: [
        {
          source: "git:github.com/salesforce/sf-pi",
          extensions: ["extensions/*/index.ts", ...disabledFiles.map((file) => `!${file}`)],
        },
      ],
    })}\n`,
  );
  return cwd;
}

describe("formatSfPiExtensionContext", () => {
  it("lists every bundled extension with routing priority guidance", () => {
    const context = formatSfPiExtensionContext(makeCwd(), {
      activeTools: ["agentscript_compile", "agentscript_inspect"],
      activeSkills: ["sf-data360", "generating-apex"],
    });

    expect(context.startsWith(SF_PI_EXTENSIONS_OPEN_TAG)).toBe(true);
    expect(context.endsWith(SF_PI_EXTENSIONS_CLOSE_TAG)).toBe(true);
    expect(context).toContain("SF Pi bundled-extension routing priority");
    expect(context).toContain("follow the latest one");
    expect(context).toContain("Status: 15/15 bundled extensions enabled.");
    expect(context).toContain("Active SF skills remain fallback/workflow guidance: sf-data360");
    expect(context).toContain("- sf-agentscript (enabled)");
    expect(context).toContain("Agentforce Agent Script authoring");
    expect(context).toContain("active tools: agentscript_compile, agentscript_inspect");
    expect(context).toContain("- sf-data360 (enabled)");
    expect(context).toContain("- sf-pi-manager (always-on)");
  });

  it("marks disabled best-fit extensions with an enable suggestion", () => {
    const context = formatSfPiExtensionContext(
      makeCwd(["extensions/sf-agentscript/index.ts", "extensions/sf-slack/index.ts"]),
      { activeTools: ["read", "bash"] },
    );

    expect(context).toContain("Disabled now: sf-agentscript, sf-slack");
    expect(context).toContain("- sf-agentscript (disabled)");
    expect(context).toContain("Suggest: /sf-pi enable sf-agentscript.");
    expect(context).toContain("- sf-slack (disabled)");
    expect(context).toContain("Suggest: /sf-pi enable sf-slack.");
  });
});

describe("shouldInjectSfPiExtensionContext", () => {
  it("skips injection when a live matching context already exists", () => {
    const context = formatSfPiExtensionContext(makeCwd());
    const entries = [
      {
        id: "1",
        type: "custom_message",
        customType: SF_PI_EXTENSIONS_ENTRY_TYPE,
        content: context,
      },
    ];

    expect(shouldInjectSfPiExtensionContext(entries as never, context)).toBe(false);
  });

  it("injects again when the live context changed", () => {
    const context = formatSfPiExtensionContext(makeCwd());
    const entries = [
      {
        id: "1",
        type: "custom_message",
        customType: SF_PI_EXTENSIONS_ENTRY_TYPE,
        content: `${context}\nold`,
      },
    ];

    expect(shouldInjectSfPiExtensionContext(entries as never, context)).toBe(true);
  });
});
