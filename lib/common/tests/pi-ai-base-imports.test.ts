/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guardrail for Pi 0.79.9 selective provider base imports.
 *
 * Most SF Pi modules only need neutral pi-ai helpers/types such as StringEnum
 * or ImageContent. Those modules should import from @earendil-works/pi-ai/base
 * so they do not pull provider transport registration into lightweight tool
 * schema code. Provider adapters and provider-focused tests may still import
 * from the root entry point.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SOURCE_ROOTS = ["extensions", "lib"];
const ROOT_PI_AI_IMPORT = /from\s+["']@earendil-works\/pi-ai["']/;

const ROOT_IMPORT_ALLOWED = [
  /^extensions\/sf-llm-gateway-internal\/lib\/discovery\.ts$/,
  /^extensions\/sf-llm-gateway-internal\/lib\/transport-internal\/.*\.ts$/,
  /^extensions\/sf-llm-gateway-internal\/tests\/.*\.test\.ts$/,
];

function listSourceFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  const entries = readdirSync(abs).sort();
  const files: string[] = [];

  for (const entry of entries) {
    if (entry === "node_modules") continue;
    const entryAbs = path.join(abs, entry);
    const rel = path.relative(ROOT, entryAbs).replaceAll(path.sep, "/");
    const stat = statSync(entryAbs);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(rel));
    } else if (entry.endsWith(".ts")) {
      files.push(rel);
    }
  }

  return files;
}

describe("pi-ai base imports", () => {
  it("keeps root pi-ai imports limited to provider adapters", () => {
    const offenders = SOURCE_ROOTS.flatMap(listSourceFiles).filter((file) => {
      const source = readFileSync(path.join(ROOT, file), "utf8");
      return (
        ROOT_PI_AI_IMPORT.test(source) && !ROOT_IMPORT_ALLOWED.some((pattern) => pattern.test(file))
      );
    });

    expect(offenders).toEqual([]);
  });
});
