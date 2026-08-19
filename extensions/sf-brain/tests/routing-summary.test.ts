/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatSfPiRoutingSummary,
  SF_PI_ROUTING_CLOSE_TAG,
  SF_PI_ROUTING_OPEN_TAG,
} from "../lib/routing-summary.ts";

let tempAgentDir: string;
const cwdDirs: string[] = [];

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-routing-agent-"));
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
  for (const dir of cwdDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeCwd(disabledFiles: string[] = []): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-brain-routing-cwd-"));
  cwdDirs.push(cwd);
  mkdirSync(path.join(cwd, ".pi"), { recursive: true });
  writeFileSync(
    path.join(cwd, ".pi", "settings.json"),
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

describe("SF Pi Routing Summary", () => {
  it("keeps the all-enabled summary tiny and does not repeat the extension catalog", () => {
    const summary = formatSfPiRoutingSummary(makeCwd());

    expect(summary.startsWith(SF_PI_ROUTING_OPEN_TAG)).toBe(true);
    expect(summary.endsWith(SF_PI_ROUTING_CLOSE_TAG)).toBe(true);
    expect(summary).toContain(
      "Family tools perform the action. Skills are supplemental playbooks; they do not own the turn.",
    );
    expect(summary).toContain("Disabled capability owners: none.");
    expect(summary).not.toContain("Extension map:");
    expect(summary).not.toContain("sf-ohana-spinner");
    expect(summary.split("\n").length).toBeLessThanOrEqual(5);
  });

  it("lists only disabled capability owners and their enablement path", () => {
    const summary = formatSfPiRoutingSummary(
      makeCwd(["extensions/sf-apex/index.ts", "extensions/sf-agentscript/index.ts"]),
    );

    expect(summary).toContain("- sf-agentscript — Agentforce Agent Script");
    expect(summary).toContain("Enable: /sf-pi enable sf-agentscript");
    expect(summary).toContain("- sf-apex — Apex lifecycle");
    expect(summary).toContain("Enable: /sf-pi enable sf-apex");
    expect(summary).not.toContain("- sf-soql");
  });
});
