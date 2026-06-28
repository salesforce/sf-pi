/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { SF_SOQL_TOOL_NAME } from "../lib/sf-soql-tool.ts";

describe("sf-soql smoke", () => {
  it("exports the expected family tool name", () => {
    expect(SF_SOQL_TOOL_NAME).toBe("sf_soql");
  });
});
