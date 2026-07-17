/* SPDX-License-Identifier: Apache-2.0 */
/** Guardrails for slash-command autocomplete implementations.
 *
 * Pi replaces the full argument tail after `/command ` when a completion is
 * accepted. These source-level checks keep new extensions from reintroducing
 * last-token completion patterns that can silently truncate user input.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function listTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (fullPath.includes(`${path.sep}tests${path.sep}`)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) files.push(...listTypeScriptFiles(fullPath));
    else if (fullPath.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "last-token split in getArgumentCompletions",
    pattern: /prefix\.trim\(\)\.split\(\/\\s\+\/\)\.at\(-1\)/,
  },
  {
    name: "raw prefix.toLowerCase() completion matching",
    pattern: /const\s+lower\s*=\s*prefix\.toLowerCase\(\)/,
  },
];

describe("slash-command autocomplete source patterns", () => {
  it("does not use known argument-tail truncation patterns", () => {
    const offenders: string[] = [];

    for (const file of listTypeScriptFiles("extensions")) {
      const source = readFileSync(file, "utf8");
      for (const { name, pattern } of FORBIDDEN_PATTERNS) {
        if (pattern.test(source)) offenders.push(`${file}: ${name}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
