/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { npmRegistryPackageUrl } from "../../../scripts/lib/npm-registry-url.mjs";
import { markdownTableCell, soqlStringLiteral } from "../../../scripts/lib/text-escape.mjs";

describe("script helper escaping", () => {
  it("escapes SOQL string literal backslashes before quotes", () => {
    expect(soqlStringLiteral("A\\B'C")).toBe("A\\\\B\\'C");
  });

  it("escapes markdown table cell pipes, backslashes, and newlines", () => {
    expect(markdownTableCell("A\\B|C\nD")).toBe("A\\\\B\\|C<br>D");
  });

  it("builds scoped npm registry URLs without partial replacement", () => {
    expect(npmRegistryPackageUrl("@scope/pkg")).toBe("https://registry.npmjs.org/@scope%2Fpkg");
  });
});
