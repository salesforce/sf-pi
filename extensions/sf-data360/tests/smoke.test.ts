/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sf-data360 extension smoke", () => {
  const manifest = JSON.parse(readFileSync("extensions/sf-data360/manifest.json", "utf8")) as {
    defaultEnabled?: boolean;
    configurable?: boolean;
    tools?: string[];
    events?: string[];
  };

  it("is enabled by default and exposes the expected runtime surfaces", () => {
    expect(manifest.defaultEnabled).toBe(true);
    expect(manifest.configurable).toBe(true);
    expect(manifest.tools).toEqual([
      "data360_discover",
      "data360_connect",
      "data360_prepare",
      "data360_harmonize",
      "data360_segment",
      "data360_activate",
      "data360_query",
      "data360_semantic",
      "data360_observe",
      "data360_orchestrate",
      "data360_api",
    ]);
    expect(manifest.events).toEqual(["session_start", "session_shutdown", "resources_discover"]);
  });

  it("keeps skill references on disk instead of package-level skill registration", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi?: { skills?: unknown };
    };
    expect(packageJson.pi?.skills).toBeUndefined();
  });
});
