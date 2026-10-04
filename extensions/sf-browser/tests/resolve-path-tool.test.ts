/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerSfBrowserResolvePathTool } from "../lib/sf_browser_resolve_path-tool.ts";

function registeredTool() {
  const registerTool = vi.fn();
  registerSfBrowserResolvePathTool({ registerTool } as unknown as ExtensionAPI);
  return registerTool.mock.calls[0]![0];
}

describe("sf_browser_resolve_path outcomes", () => {
  it("returns the canonical destination for an exact alias", async () => {
    const result = await registeredTool().execute(
      "call-1",
      { target: { type: "setup", destination: "External Client App Manager" } },
      undefined,
      undefined,
      {} as never,
    );

    expect(result).toMatchObject({
      details: {
        ok: true,
        destination: "external-client-apps",
      },
    });
  });

  it("returns needs-choice for an ambiguous destination without claiming failure", async () => {
    const result = await registeredTool().execute(
      "call-1",
      { target: { type: "setup", destination: "apps" } },
      undefined,
      undefined,
      {} as never,
    );

    expect(result).toMatchObject({
      details: { ok: false, status: "needs-choice", reason: "ambiguous_setup_destination" },
    });
    expect(result.isError).not.toBe(true);
  });

  it("fails explicitly for an unsupported destination", async () => {
    const result = await registeredTool().execute(
      "call-1",
      { target: { type: "setup", destination: "zzzz-unmapped" } },
      undefined,
      undefined,
      {} as never,
    );

    expect(result).toMatchObject({
      isError: true,
      details: { ok: false, status: "unsupported", reason: "unknown_setup_destination" },
    });
  });
});
