/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectFontRuntimeStatus } from "../lib/font-status.ts";
import {
  readCachedFontRuntimeStatus,
  writeCachedFontRuntimeStatus,
} from "../lib/font-status-cache.ts";

const PI_AGENT_ENV = "PI_CODING_AGENT_DIR";

let tmpDir: string;
let homeDir: string;
let prevAgent: string | undefined;

beforeEach(() => {
  homeDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-font-home-"));
  tmpDir = path.join(homeDir, ".pi", "agent");
  mkdirSync(tmpDir, { recursive: true });
  prevAgent = process.env[PI_AGENT_ENV];
  process.env[PI_AGENT_ENV] = tmpDir;
});

afterEach(() => {
  if (prevAgent === undefined) delete process.env[PI_AGENT_ENV];
  else process.env[PI_AGENT_ENV] = prevAgent;
  rmSync(homeDir, { recursive: true, force: true });
});

describe("font runtime status", () => {
  it("reports installed when the bundled Regular TTF is present", () => {
    const fontDir = path.join(homeDir, ".local", "share", "fonts");
    mkdirSync(fontDir, { recursive: true });
    writeFileSync(path.join(fontDir, "MesloLGMNerdFontMono-Regular.ttf"), "dummy");

    expect(
      detectFontRuntimeStatus({ platform: "linux", home: homeDir, glyphMode: "emoji" }),
    ).toMatchObject({ kind: "installed", installed: true, supportedPlatform: true });
  });

  it("reports missing on supported platforms when the font is absent", () => {
    expect(
      detectFontRuntimeStatus({ platform: "linux", home: homeDir, glyphMode: "ascii" }),
    ).toMatchObject({ kind: "missing", installed: false, glyphMode: "ascii" });
  });

  it("reports unsupported on Windows", () => {
    expect(
      detectFontRuntimeStatus({ platform: "win32", home: homeDir, glyphMode: "emoji" }),
    ).toMatchObject({ kind: "unsupported", supportedPlatform: false });
  });

  it("round-trips cached status", () => {
    writeCachedFontRuntimeStatus(
      detectFontRuntimeStatus({ platform: "linux", home: homeDir, glyphMode: "ascii" }),
    );
    expect(readCachedFontRuntimeStatus()).toMatchObject({
      kind: "missing",
      glyphMode: "ascii",
      loading: false,
    });
  });
});
