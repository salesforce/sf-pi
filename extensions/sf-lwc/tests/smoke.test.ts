/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { SF_LWC_TOOL_NAME } from "../lib/sf-lwc-tool.ts";

describe("sf-lwc smoke", () => {
  it("exports the expected family tool name", () => {
    expect(SF_LWC_TOOL_NAME).toBe("sf_lwc");
  });
});
