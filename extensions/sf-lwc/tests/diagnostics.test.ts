/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import {
  diagnoseCss,
  diagnoseMetadata,
  diagnoseScript,
  diagnoseTemplate,
} from "../lib/diagnostics.ts";

describe("sf-lwc diagnostics", () => {
  it("catches common lightning namespace typos in templates", () => {
    const diagnostics = diagnoseTemplate(
      "cmp/cmp.html",
      "cmp.html",
      "<template><lighting-button></lighting-button></template>",
    );

    expect(diagnostics.some((diag) => diag.message.includes("Did you mean <lightning-"))).toBe(
      true,
    );
  });

  it("reports JavaScript compiler diagnostics", () => {
    const diagnostics = diagnoseScript(
      "cmp/cmp.js",
      "cmp.js",
      "export default class Cmp { broken( }",
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].source).toBe("lwc-js");
    expect(diagnostics[0].severity).toBe("error");
  });

  it("removes absolute paths from JavaScript compiler diagnostic messages", () => {
    const diagnostics = diagnoseScript(
      "cmp/cmp.js",
      "/tmp/example-project/cmp.js",
      "export default class Cmp { broken( }",
    );

    expect(diagnostics[0].message).not.toContain("/tmp/example-project");
  });

  it("warns when metadata apiVersion is missing", () => {
    const diagnostics = diagnoseMetadata(
      "cmp/cmp.js-meta.xml",
      "<LightningComponentBundle></LightningComponentBundle>",
    );

    expect(diagnostics.some((diag) => diag.message.includes("apiVersion"))).toBe(true);
  });

  it("surfaces lightweight style diagnostics for SLDS2 guidance", () => {
    const diagnostics = diagnoseCss("cmp/cmp.css", ".slds-button { color: #fff; padding: 12px; }");

    expect(diagnostics.map((diag) => diag.message)).toContain(
      "SLDS class override selector detected.",
    );
    expect(diagnostics.some((diag) => diag.message.includes("Hardcoded style value"))).toBe(true);
    expect(diagnostics.every((diag) => diag.severity === "info")).toBe(true);
  });

  it("allows valid self-closing metadata tags", () => {
    const diagnostics = diagnoseMetadata(
      "cmp/cmp.js-meta.xml",
      [
        "<LightningComponentBundle>",
        "  <apiVersion>67.0</apiVersion>",
        "  <supportedFormFactors>",
        '    <supportedFormFactor type="Small" />',
        "  </supportedFormFactors>",
        "</LightningComponentBundle>",
      ].join("\n"),
    );

    expect(diagnostics.filter((diag) => diag.severity === "error")).toEqual([]);
  });
});
