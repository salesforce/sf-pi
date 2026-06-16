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

  it("routes the no-args UI command to the SF Pi Manager detail page", () => {
    expect(source).toContain('openDevbarInManager(ctx, "detail")');
    expect(source).not.toContain("handleDevbarPanel");
    expect(source).not.toContain('title: "📊 SF DevBar — status & controls"');
  });

  it("registers Manager detail actions for the old panel features", () => {
    expect(source).toContain('registerManagerDetailActions(pi, "sf-devbar"');
    expect(source).toContain('id: "status"');
    expect(source).toContain('id: "refresh"');
    expect(source).toContain('id: "toggle-bars"');
    expect(source).toContain('id: "help"');
  });
});
