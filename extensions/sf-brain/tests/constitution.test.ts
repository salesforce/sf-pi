/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import {
  CONSTITUTION_ENTRY_TYPE,
  CONSTITUTION_OPEN_TAG,
  constitutionAddendumPath,
  loadConstitution,
  readBundledConstitution,
  shouldInjectConstitution,
} from "../lib/constitution.ts";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-constitution-"));
});

afterEach(() => rmSync(tempAgentDir, { recursive: true, force: true }));

describe("Salesforce Engineering Constitution", () => {
  it("keeps the bundled constitution present with or without sf CLI", () => {
    const installed = loadConstitution({ cliInstalled: true });
    const missing = loadConstitution({ cliInstalled: false });

    expect(installed).toContain(CONSTITUTION_OPEN_TAG);
    expect(installed).toContain("SALESFORCE-FIRST INTERPRETATION");
    expect(installed).toContain("BEHAVIOR-PROOF-FIRST DEVELOPMENT");
    expect(missing).toContain(CONSTITUTION_OPEN_TAG);
    expect(missing).toContain("<sf_cli_status>");
    expect(missing).not.toContain("brew install");
    expect(CONSTITUTION_ENTRY_TYPE).toBe("sf-brain-constitution");
  });

  it("routes every tool owner directly to its installed manifest-declared operating guide", () => {
    const bundled = readBundledConstitution();
    const constitution = loadConstitution({ cliInstalled: true });
    const extensionsRoot = path.resolve(import.meta.dirname, "../..");
    const packageRoot = path.resolve(extensionsRoot, "..");
    const manifests = readdirSync(extensionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        JSON.parse(readFileSync(path.join(extensionsRoot, entry.name, "manifest.json"), "utf8")),
      )
      .filter((manifest) => (manifest.tools?.length ?? 0) > 0);
    const expectedRelative = manifests
      .map((manifest) => `extensions/${manifest.id}/${manifest.docs.agentGuide}`)
      .sort();
    const actualRelative = [...bundled.matchAll(/extensions\/(sf-[a-z0-9-]+)\/(AGENT_GUIDE\.md)/g)]
      .map((match) => `extensions/${match[1]}/${match[2]}`)
      .sort();

    expect(actualRelative).toEqual(expectedRelative);
    expect(bundled).toContain("{{SF_PI_PACKAGE_ROOT}}");
    expect(constitution).not.toContain("{{SF_PI_PACKAGE_ROOT}}");
    for (const manifest of manifests) {
      const guide = path.join(packageRoot, "extensions", manifest.id, manifest.docs.agentGuide);
      expect(constitution).toContain(guide);
      expect(existsSync(guide), guide).toBe(true);
    }
    expect(constitution).not.toContain("SF_REFERENCE_MAP.md");
  });

  it("refreshes stale bundled guidance after reload without reinjecting unchanged or addendum-only content", () => {
    const current = loadConstitution({ cliInstalled: true });
    const session = (content?: string) => ({
      buildContextEntries: (): SessionEntry[] =>
        content === undefined
          ? []
          : [
              {
                id: "existing",
                parentId: null,
                timestamp: new Date().toISOString(),
                type: "custom_message",
                customType: CONSTITUTION_ENTRY_TYPE,
                content,
                display: false,
              },
            ],
    });

    expect(shouldInjectConstitution(session(current))).toBe(false);
    expect(shouldInjectConstitution(session(`${current}user addendum`))).toBe(false);
    expect(
      shouldInjectConstitution(
        session(current.replace("material Salesforce solution design", "prior bundled guidance")),
      ),
    ).toBe(true);
    expect(shouldInjectConstitution(session())).toBe(true);
  });

  it("always keeps the bundled constitution and appends user guidance", () => {
    const dir = path.dirname(constitutionAddendumPath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(constitutionAddendumPath(), "Prefer project-specific test suites.\n");

    const content = loadConstitution({ cliInstalled: true });
    const packageRoot = path.resolve(import.meta.dirname, "../../..");
    expect(content).toContain(
      readBundledConstitution().replaceAll("{{SF_PI_PACKAGE_ROOT}}", packageRoot).trim(),
    );
    expect(content).toContain("<sf_user_constitution_addendum>");
    expect(content).toContain("Prefer project-specific test suites.");
  });

  it("routes material Salesforce architecture through current docs without forcing routine or Pi-only work", () => {
    const content = loadConstitution({ cliInstalled: true });

    expect(content).toContain("material Salesforce solution design or architecture review");
    expect(content).toContain("`sf_docs` in the `architect` collection (`current`)");
    expect(content).toContain("Salesforce Docs guide for source selection");
    expect(content).toContain("Skip routine edits");
    expect(content).toContain("installed Pi documentation");
    expect(content).toContain("If `sf_docs` is unavailable or retrieval fails");
    expect(content).toContain(
      "official architect.salesforce.com pages through available web access",
    );
    expect(content).toContain("Stop once the relevant evidence answers the decision");
    expect(content).toContain("If neither works, report the evidence gap");
    expect(content).toContain("silently enable a disabled capability");
  });

  it("makes terminal-safe visual communication part of the bundled baseline", () => {
    const content = loadConstitution({ cliInstalled: true });

    expect(content).toContain("7. SIMPLE, VISUAL COMMUNICATION");
    expect(content).toContain("Applies to chat responses only");
    expect(content).toContain("Use the most specific supported Mermaid form");
    expect(content).toContain("top-level fenced block");
    expect(content).toContain("6–8 nodes");
    expect(content).toContain("Prefer `TD` or `TB`");
    expect(content).toContain("editable or durable Salesforce diagram");
    expect(content).toContain("`tldraw_canvas`");
    expect(content).toContain("✅ done/pass");
    expect(content).not.toContain("<sf_display_capabilities>");
  });

  it("does not read the legacy replacement-style SF_KERNEL.md", () => {
    const legacy = path.join(tempAgentDir, "sf-brain", "SF_KERNEL.md");
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, "LEGACY REPLACEMENT CONTENT\n");

    const content = loadConstitution({ cliInstalled: true });
    expect(content).not.toContain("LEGACY REPLACEMENT CONTENT");
    expect(content).toContain(CONSTITUTION_OPEN_TAG);
  });
});
