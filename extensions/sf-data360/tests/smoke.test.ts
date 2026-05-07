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
    expect(manifest.tools).toEqual(["d360_api", "d360_metadata", "d360_probe"]);
    expect(manifest.events).toEqual(["session_start", "resources_discover"]);
  });

  it("keeps skill references on disk instead of package-level skill registration", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      pi?: { skills?: unknown };
    };
    expect(packageJson.pi?.skills).toBeUndefined();
  });
});
