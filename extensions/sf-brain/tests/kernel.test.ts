/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Unit tests for the kernel loader.
 *
 * Covers:
 * - CLI installed returns the bundled kernel with the canonical header.
 * - CLI missing returns the short install stub, independent of any override.
 * - A user override replaces the bundled kernel when CLI is installed.
 * - An empty or unreadable override falls back silently to the bundled kernel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  KERNEL_HEADER,
  KERNEL_MISSING_CLI_HEADER,
  loadKernel,
  readBundledKernel,
} from "../lib/kernel.ts";

let tempAgentDir: string;

vi.mock("@mariozechner/pi-coding-agent", () => ({
  // getAgentDir is called by lib/common/pi-paths.ts. Return a per-test temp dir
  // so we can drop override files into a controlled location.
  getAgentDir: () => tempAgentDir,
}));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-test-"));
});

afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

describe("loadKernel", () => {
  it("returns the bundled kernel when CLI is installed and no override exists", () => {
    const body = loadKernel({ cliInstalled: true });
    expect(body.startsWith(KERNEL_HEADER)).toBe(true);
    expect(body).toBe(readBundledKernel());
  });

  it("returns the install stub when CLI is missing", () => {
    const body = loadKernel({ cliInstalled: false });
    expect(body.startsWith(KERNEL_MISSING_CLI_HEADER)).toBe(true);
    expect(body).toContain("brew install --cask salesforce-cli");
    expect(body).toContain("npm install -g @salesforce/cli");
  });

  it("returns the install stub even when an override file is present", () => {
    const overrideDir = path.join(tempAgentDir, "sf-brain");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(path.join(overrideDir, "SF_KERNEL.md"), "[Custom Kernel]\nrule 1.\n", "utf8");

    const body = loadKernel({ cliInstalled: false });
    expect(body.startsWith(KERNEL_MISSING_CLI_HEADER)).toBe(true);
    expect(body).not.toContain("[Custom Kernel]");
  });

  it("loads a user override when CLI is installed", () => {
    const overrideDir = path.join(tempAgentDir, "sf-brain");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(
      path.join(overrideDir, "SF_KERNEL.md"),
      "[Custom Kernel]\noverride wins.\n",
      "utf8",
    );

    const body = loadKernel({ cliInstalled: true });
    expect(body.startsWith("[Custom Kernel]")).toBe(true);
    expect(body).toContain("override wins.");
    expect(body).not.toBe(readBundledKernel());
  });

  it("falls back to the bundled kernel when the override is empty", () => {
    const overrideDir = path.join(tempAgentDir, "sf-brain");
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(path.join(overrideDir, "SF_KERNEL.md"), "   \n\n", "utf8");

    const body = loadKernel({ cliInstalled: true });
    expect(body).toBe(readBundledKernel());
  });
});

describe("bundled SF_KERNEL.md", () => {
  it("covers every rule the kernel design requires", () => {
    const body = readBundledKernel();
    // Section-by-section smoke so the bundled body never silently drops a rule.
    expect(body).toContain("RETRIEVE BEFORE EDIT, DESCRIBE BEFORE QUERY");
    expect(body).toContain("PICK THE RIGHT API");
    expect(body).toContain("`sf org api` IS YOUR UNIVERSAL REST TOOL");
    expect(body).toContain("PIN THE API VERSION");
    expect(body).toContain("ALWAYS --json, PIPE THROUGH jq");
    expect(body).toContain("NAME THE ORG EXPLICITLY");
    expect(body).toContain("ANONYMOUS APEX IS YOUR PRIMARY VERIFICATION TOOL");
    expect(body).toContain("POWER MOVES");
    expect(body).toContain("ORG SAFETY");
    expect(body).toContain("DEFER TO LOADED SKILLS");
    expect(body).toContain("CLI NOT INSTALLED");
  });

  it("references the canonical source-deploy-retrieve metadata registry under Rule 1", () => {
    // The registry + support matrix links are the authoritative answer to
    // -m <Type>:<Name> lookups and source-tracking coverage questions.
    // Keep this assertion loose (URL substring only) so we don't churn on
    // formatting changes inside the bullet.
    const body = readBundledKernel();
    expect(body).toContain(
      "https://github.com/forcedotcom/source-deploy-retrieve/blob/main/src/registry/metadataRegistry.json",
    );
    expect(body).toContain(
      "https://github.com/forcedotcom/source-deploy-retrieve/blob/main/METADATA_SUPPORT.md",
    );
  });
});
