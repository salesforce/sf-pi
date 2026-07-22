/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the live SF Pi extension context injected by sf-brain. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";

import {
  formatSfPiExtensionContext,
  isHerdrWorkflowModeActive,
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
      activeTools: ["agentscript_authoring", "agentscript_preview"],
      activeSkills: ["sf-data360", "generating-apex"],
    });

    expect(context.startsWith(SF_PI_EXTENSIONS_OPEN_TAG)).toBe(true);
    expect(context.endsWith(SF_PI_EXTENSIONS_CLOSE_TAG)).toBe(true);
    expect(context).toContain("SF Pi bundled-extension routing priority");
    expect(context).toContain("follow the latest one");
    expect(context).toContain("Status: 21/21 bundled extensions enabled.");
    expect(context).toContain("Active SF skills remain fallback/workflow guidance: sf-data360");
    expect(context).toContain("- sf-agentscript (enabled)");
    expect(context).toContain("Agentforce Agent Script authoring");
    expect(context).toContain("active tools: agentscript_authoring, agentscript_preview");
    expect(context).toContain("- sf-data360 (enabled)");
    expect(context).toContain("- sf-docs (enabled)");
    expect(context).toContain("official Salesforce documentation and product/reference research");
    expect(context).toContain("before web_search or code_search");
    expect(context).toContain("- sf-herdr (enabled)");
    expect(context).toContain("- sf-lwc (enabled)");
    expect(context).toContain("Local-native Lightning Web Component lifecycle workflows");
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

  it("renders Proactive Herdr Guidance only when requested", () => {
    const inactiveContext = formatSfPiExtensionContext(makeCwd(), {
      activeTools: ["read", "bash", "herdr"],
    });
    const activeContext = formatSfPiExtensionContext(makeCwd(), {
      activeTools: ["read", "bash", "herdr"],
      herdrWorkflowMode: true,
    });

    expect(inactiveContext).not.toContain("Proactive Herdr Guidance");
    expect(activeContext).toContain("Proactive Herdr Guidance: active.");
    expect(activeContext).toContain("Use the `herdr` tool for long-running");
    expect(activeContext).toContain('herdr(action="list")');
    expect(activeContext).toContain('herdr(action="pane_split")');
    expect(activeContext).toContain('herdr(action="run")');
    expect(activeContext).toContain("SF Herdr plans lane placement and lifecycle only");
    expect(activeContext).toContain("fall back to normal SF Pi operation");
  });
});

describe("isHerdrWorkflowModeActive", () => {
  it("requires active-control Herdr env and the active herdr tool", () => {
    const env = {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "pane-1",
    };

    expect(isHerdrWorkflowModeActive({ env, activeTools: ["read", "herdr"] })).toBe(true);
    expect(isHerdrWorkflowModeActive({ env, activeTools: ["read"] })).toBe(false);
    expect(
      isHerdrWorkflowModeActive({
        env: { ...env, HERDR_ENV: "0" },
        activeTools: ["read", "herdr"],
      }),
    ).toBe(false);
    expect(
      isHerdrWorkflowModeActive({
        env: { ...env, HERDR_PANE_ID: "" },
        activeTools: ["read", "herdr"],
      }),
    ).toBe(false);
  });

  it("does not require the passive Herdr socket bridge", () => {
    expect(
      isHerdrWorkflowModeActive({
        env: { HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" },
        activeTools: ["herdr"],
      }),
    ).toBe(true);
  });
});

describe("shouldInjectSfPiExtensionContext", () => {
  function sessionWithContext(content: string): SessionManager {
    const session = SessionManager.inMemory();
    session.appendCustomMessageEntry(SF_PI_EXTENSIONS_ENTRY_TYPE, content, false);
    return session;
  }

  it("skips injection when a live matching context already exists", () => {
    const context = formatSfPiExtensionContext(makeCwd());

    expect(shouldInjectSfPiExtensionContext(sessionWithContext(context), context)).toBe(false);
  });

  it("injects again when Proactive Herdr Guidance is no longer active", () => {
    const cwd = makeCwd();
    const herdrContext = formatSfPiExtensionContext(cwd, {
      activeTools: ["read", "herdr"],
      herdrWorkflowMode: true,
    });
    const normalContext = formatSfPiExtensionContext(cwd, { activeTools: ["read", "herdr"] });
    expect(shouldInjectSfPiExtensionContext(sessionWithContext(herdrContext), normalContext)).toBe(
      true,
    );
  });

  it("injects again when the live context changed", () => {
    const context = formatSfPiExtensionContext(makeCwd());
    expect(shouldInjectSfPiExtensionContext(sessionWithContext(`${context}\nold`), context)).toBe(
      true,
    );
  });
});
