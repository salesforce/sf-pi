/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.ts"),
  "utf-8",
);

describe("sf-devbar", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("reads the registered no-devbar flag without a CLI prefix", () => {
    expect(source).toContain("pi.getFlag(FLAG_NAME) === true");
    expect(source).not.toContain("pi.getFlag(`--${FLAG_NAME}`)");
  });
});
