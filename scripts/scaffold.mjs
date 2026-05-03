/* SPDX-License-Identifier: Apache-2.0 */
// Scaffold a new sf-pi extension.
//
// Usage: node scripts/scaffold.mjs --id <extension-id> --category <ui|provider|core> [--name "Display Name"]
//
// Creates:
//   extensions/<id>/
//     index.ts          — entry point with behavior contract template
//     manifest.json     — metadata (source of truth for the catalog)
//     README.md         — per-extension documentation
//     lib/              — implementation modules
//     tests/
//       smoke.test.ts   — basic smoke test (red → green starting point)
//
// Then regenerates catalog/registry.ts and catalog/index.json.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");

// -------------------------------------------------------------------------------------------------
// Parse args
// -------------------------------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { id: "", category: "", name: "" };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--id" && args[i + 1]) {
      result.id = args[++i];
    } else if (args[i] === "--category" && args[i + 1]) {
      result.category = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      result.name = args[++i];
    }
  }

  return result;
}

function toDisplayName(id) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// -------------------------------------------------------------------------------------------------
// Templates
// -------------------------------------------------------------------------------------------------

function indexTs(id, _name) {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ${id} behavior contract
 *
 * - TODO: Describe when this extension activates
 * - TODO: Describe what it does
 * - TODO: Describe when it stays silent
 *
 * Behavior matrix:
 *
 *   Event           | Result
 *   ----------------|--------------------------------------------
 *   session_start   | TODO
 *   turn_start      | TODO
 *   turn_end        | TODO
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // TODO: Register events, commands, tools
  pi.on("session_start", async (_event, ctx) => {
    // Extension loaded
  });
}
`;
}

function manifestJson(id, name, category) {
  return (
    JSON.stringify(
      {
        id,
        name,
        description: `TODO: Describe ${name}`,
        category,
        defaultEnabled: true,
      },
      null,
      2,
    ) + "\n"
  );
}

function readmeMd(id, name) {
  return `# ${name} — Code Walkthrough

## What It Does

TODO: Describe what this extension does.

## Runtime Flow

\`\`\`
Extension loads
  ├─ TODO: describe initialization
  └─ TODO: describe event handlers
\`\`\`

## Key Architecture Decisions

TODO: Explain why things are built the way they are.

## Behavior Matrix

| Event/Trigger | Condition | Result |
|---|---|---|
| session_start | — | TODO |

## File Structure

\`\`\`
extensions/${id}/
  index.ts              ← entry point
  manifest.json         ← metadata
  README.md             ← this file
  lib/                  ← implementation modules
  tests/
    smoke.test.ts       ← basic smoke test
\`\`\`

## Testing Strategy

Run: \`npm test\`
`;
}

function smokeTestTs(id) {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for ${id}.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { describe, it, expect } from "vitest";

describe("${id}", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
`;
}

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

const { id, category, name: rawName } = parseArgs();

if (!id) {
  console.error(
    'Usage: node scripts/scaffold.mjs --id <extension-id> --category <ui|provider|core> [--name "Display Name"]',
  );
  console.error("");
  console.error(
    'Example: node scripts/scaffold.mjs --id sf-code-analyzer --category core --name "SF Code Analyzer"',
  );
  process.exit(1);
}

const validCategories = ["ui", "provider", "core"];
if (!validCategories.includes(category)) {
  console.error(`Invalid category: "${category}". Must be one of: ${validCategories.join(", ")}`);
  process.exit(1);
}

const name = rawName || toDisplayName(id);
const extDir = path.join(EXTENSIONS_DIR, id);

if (existsSync(extDir)) {
  console.error(`❌ Extension directory already exists: extensions/${id}/`);
  process.exit(1);
}

// Create directories
mkdirSync(path.join(extDir, "lib"), { recursive: true });
mkdirSync(path.join(extDir, "tests"), { recursive: true });

// Write files
writeFileSync(path.join(extDir, "index.ts"), indexTs(id, name));
writeFileSync(path.join(extDir, "manifest.json"), manifestJson(id, name, category));
writeFileSync(path.join(extDir, "README.md"), readmeMd(id, name));
writeFileSync(path.join(extDir, "tests", "smoke.test.ts"), smokeTestTs(id));

console.log(`✅ Scaffolded extensions/${id}/`);
console.log(`   index.ts, manifest.json, README.md, lib/, tests/smoke.test.ts`);
console.log("");

// Regenerate catalog
console.log("Regenerating catalog...");
execSync("node scripts/generate-catalog.mjs", { cwd: ROOT, stdio: "inherit" });

console.log("");
console.log("Next steps:");
console.log(`  1. Edit extensions/${id}/manifest.json — update the description`);
console.log(
  `  2. Edit extensions/${id}/README.md and comments — explain the behavior for agents and reviewers`,
);
console.log(`  3. Edit extensions/${id}/index.ts — implement your extension`);
console.log(`  4. Run: npm run format:check — verify formatting`);
console.log(`  5. Run: npm test — your smoke test should pass`);
console.log(`  6. Run: npm run check — verify types`);
