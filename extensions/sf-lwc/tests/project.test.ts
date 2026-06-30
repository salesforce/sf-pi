/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { inspectComponent } from "../lib/component.ts";
import { scanProject } from "../lib/project.ts";
import { makeLwcFixture } from "./helpers.ts";

describe("sf-lwc project scan", () => {
  it("scans only SFDX package directories for LWC bundles", async () => {
    const root = await makeLwcFixture();
    const scan = await scanProject(root);

    expect(scan.project.sourceApiVersion).toBe("67.0");
    expect(scan.project.packageDirs.map((pkg) => pkg.path)).toEqual(["force-app"]);
    expect(scan.bundles).toHaveLength(1);
    expect(scan.bundles[0].name).toBe("helloWorld");
    expect(scan.bundles[0].metadata?.isExposed).toBe(true);
    expect(scan.bundles[0].testFiles).toHaveLength(1);
  });

  it("inspects component local shape and handoff hints", async () => {
    const root = await makeLwcFixture();
    const { inspection } = await inspectComponent({ workspace: root, component: "helloWorld" });

    expect(inspection.publicApi).toEqual(["recordId"]);
    expect(inspection.apexImports).toEqual(["ContactController.getContacts"]);
    expect(inspection.schemaImports).toEqual(["Contact.Name"]);
    expect(inspection.labelImports).toEqual(["c.Hello"]);
    expect(inspection.childComponents).toEqual(["child-tile"]);
    expect(inspection.lightningTags).toEqual(["lightning-card"]);
    expect(inspection.styleSignals).toContain("css-file");
    expect(inspection.styleSignals).toContain("hardcoded-style-value");
  });
});
