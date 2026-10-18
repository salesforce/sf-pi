/* SPDX-License-Identifier: Apache-2.0 */
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readJsonFile, writeJsonFile } from "../sf-pi-settings.ts";

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(tmpdir(), "sf-pi-settings-proof-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("private atomic Pi settings writes", () => {
  it("writes complete JSON privately and removes staging files", () => {
    const file = path.join(dir, "nested", "settings.json");
    writeJsonFile(file, { theme: "sf-dark", unrelated: { retained: true } });
    expect(readJsonFile(file)).toEqual({ theme: "sf-dark", unrelated: { retained: true } });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(file))).toEqual(["settings.json"]);
  });

  it("leaves the previous settings intact when staging fails", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, '{"previous":true}\n');
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
      throw new Error("simulated write failure");
    });
    expect(() => writeJsonFile(file, { replacement: true })).toThrow("simulated write failure");
    expect(readJsonFile(file)).toEqual({ previous: true });
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("preserves the previous settings and cleans staging when rename fails", () => {
    const file = path.join(dir, "settings.json");
    fs.writeFileSync(file, '{"previous":true}\n');
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("simulated rename failure");
    });
    expect(() => writeJsonFile(file, { replacement: true })).toThrow("simulated rename failure");
    expect(readJsonFile(file)).toEqual({ previous: true });
    expect(fs.readdirSync(dir)).toEqual(["settings.json"]);
  });

  it("publishes only complete replacements to readers", () => {
    const file = path.join(dir, "settings.json");
    writeJsonFile(file, { previous: true });
    const originalRename = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementationOnce((from, to) => {
      expect(readJsonFile(file)).toEqual({ previous: true });
      originalRename(from, to);
      expect(readJsonFile(file)).toEqual({ replacement: true });
    });
    writeJsonFile(file, { replacement: true });
  });

  it.skipIf(process.platform === "win32")(
    "replaces a destination symlink without writing its target",
    () => {
      const target = path.join(dir, "other.json");
      const file = path.join(dir, "settings.json");
      fs.writeFileSync(target, '{"untouched":true}\n');
      fs.symlinkSync(target, file);
      writeJsonFile(file, { replacement: true });
      expect(readJsonFile(target)).toEqual({ untouched: true });
      expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
      expect(readJsonFile(file)).toEqual({ replacement: true });
    },
  );
});
