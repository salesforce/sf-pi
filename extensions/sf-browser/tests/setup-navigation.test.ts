/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  findSetupCategory,
  findSetupItemCandidates,
  findSetupMenuEntry,
  setupMenuEntryLabels,
  setupNavigationLabels,
} from "../lib/setup-navigation.ts";
import {
  registerSfBrowserNavigateSetupTool,
  SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME,
} from "../lib/sf_browser_navigate_setup-tool.ts";

const snapshot = [
  '- button "Setup" [expanded=true, ref=e1]',
  '- menuitem "Setup Opens in a new tab" [ref=e2]',
  '- menuitem "Data Cloud Setup Opens in a new tab" [ref=e3]',
  '- searchbox "Quick Find" [ref=e4]',
  '- treeitem "Identity" [level=1, expanded=false, ref=e5]',
  '  - button "Expand" [ref=e6]',
  '  - link "Identity" [ref=e7]',
  '- treeitem "Security" [level=1, expanded=true, ref=e8]',
  '  - button "Collapse" [ref=e9]',
  '  - link "Security" [ref=e10]',
  '  - treeitem "CORS" [level=2, ref=e11]',
  '    - link "CORS" [ref=e12]',
  '  - treeitem "Health Check" [level=2, selected, ref=e13]',
  '    - link "Health Check" [ref=e14]',
].join("\n");

describe("Setup semantic navigation", () => {
  it("finds categories with their actual expansion and link controls", () => {
    expect(findSetupCategory(snapshot, "Identity")).toMatchObject({
      label: "Identity",
      treeRef: "e5",
      expansionRef: "e6",
      linkRef: "e7",
      expanded: false,
    });
  });

  it("finds exact child items with their parent category", () => {
    expect(findSetupItemCandidates(snapshot, "Health Check", "Security")).toEqual([
      expect.objectContaining({
        label: "Health Check",
        category: "Security",
        treeRef: "e13",
        linkRef: "e14",
        selected: true,
      }),
    ]);
  });

  it("finds exact global Setup menu entries without the new-tab suffix", () => {
    expect(findSetupMenuEntry(snapshot, "Data Cloud Setup")).toMatchObject({
      label: "Data Cloud Setup",
      ref: "e3",
    });
    expect(setupMenuEntryLabels(snapshot)).toEqual(["Setup", "Data Cloud Setup"]);
  });

  it("returns bounded visible labels for not-found diagnostics", () => {
    expect(setupNavigationLabels(snapshot, 4)).toEqual([
      "Identity",
      "Security",
      "CORS",
      "Health Check",
    ]);
  });
});

describe("sf_browser_navigate_setup registration", () => {
  it("publishes a read-only discriminated Setup navigation surface", () => {
    const registerTool = vi.fn();
    registerSfBrowserNavigateSetupTool({ registerTool } as unknown as ExtensionAPI);

    const tool = registerTool.mock.calls[0]?.[0];
    expect(tool.name).toBe(SF_BROWSER_NAVIGATE_SETUP_TOOL_NAME);
    expect(tool.parameters.required).toEqual(expect.arrayContaining(["target"]));
    expect(tool.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });
});
