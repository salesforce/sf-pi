/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  registerSfBrowserSetToggleTool,
  SF_BROWSER_SET_TOGGLE_TOOL_NAME,
} from "../lib/sf_browser_set_toggle-tool.ts";

describe("sf_browser_set_toggle registration", () => {
  it("publishes an idempotent explicit-state mutation surface with custom cards", () => {
    const registerTool = vi.fn();
    registerSfBrowserSetToggleTool({ registerTool } as unknown as ExtensionAPI);

    const tool = registerTool.mock.calls[0]?.[0];
    expect(tool.name).toBe(SF_BROWSER_SET_TOGGLE_TOOL_NAME);
    expect(tool.parameters.required).toEqual(expect.arrayContaining(["ref", "desiredState"]));
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(tool.renderCall).toBeTypeOf("function");
    expect(tool.renderResult).toBeTypeOf("function");
  });
});
