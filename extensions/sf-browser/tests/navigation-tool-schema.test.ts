/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerSfBrowserOpenOrgTool } from "../lib/sf_browser_open_org-tool.ts";
import { registerSfBrowserResolvePathTool } from "../lib/sf_browser_resolve_path-tool.ts";

function schemaFor(register: (pi: ExtensionAPI) => void) {
  const registerTool = vi.fn();
  register({ registerTool } as unknown as ExtensionAPI);
  return registerTool.mock.calls[0]![0].parameters;
}

describe("SF Browser navigation tool schemas", () => {
  it.each([
    ["open", registerSfBrowserOpenOrgTool],
    ["resolve", registerSfBrowserResolvePathTool],
  ] as const)("exposes one required target on %s", (_name, register) => {
    const schema = schemaFor(register);

    expect(schema.required).toContain("target");
    expect(schema.properties.target).toBeDefined();
    expect(schema.properties.path).toBeUndefined();
    expect(schema.properties.setup).toBeUndefined();
    expect(schema.properties.route).toBeUndefined();
  });
});
