/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { validateExtensionReadmeContract } from "../lib/readme-contract.mjs";

const MANIFEST = {
  commands: ["/sf-example"],
  configurable: true,
  docs: {
    safety: ["Read-only."],
    referenceRoots: [{ path: "docs", index: "docs/README.md", role: "current" }],
  },
};

const VALID = `# SF Example

## What It Does

Explains current behavior.

## Commands

\`/sf-example\` opens the extension.

## Configuration

The Manager stores one preference.

## Safety and Data Boundaries

The extension is read-only.

## References

See [references](./docs/README.md).

## Troubleshooting

**The command is unavailable:** Enable the extension.

## File Structure

<!-- GENERATED:file-structure:start -->

\`\`\`
extensions/sf-example/
\`\`\`

<!-- GENERATED:file-structure:end -->
`;

describe("extension README contract", () => {
  it("accepts populated conditional sections in canonical order", () => {
    expect(validateExtensionReadmeContract(VALID, MANIFEST)).toEqual([]);
  });

  it("rejects aliases, editor-only headings, and a non-final file map", () => {
    const source = VALID.replace("## Commands", "## Command Surface")
      .replace("## Configuration", "## Settings")
      .replace("## Troubleshooting", "## Key Architecture Decisions")
      .concat("\n## Notes\n\nMore prose.\n");

    expect(validateExtensionReadmeContract(source, MANIFEST)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Rename "## Command Surface"'),
        expect.stringContaining('Rename "## Settings"'),
        expect.stringContaining('Move editor-only "## Key Architecture Decisions"'),
        expect.stringContaining("Missing required section: ## Commands"),
        expect.stringContaining("Missing required section: ## Configuration"),
        expect.stringContaining("## File Structure must be the final H2 section"),
      ]),
    );
  });

  it("does not force absent conditional sections", () => {
    const source = `# Passive Extension

## What It Does

Works automatically.

## File Structure

\`index.ts\`
`;
    expect(
      validateExtensionReadmeContract(source, { commands: [], configurable: false, docs: {} }),
    ).toEqual([]);
  });
});
