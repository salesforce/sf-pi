/* SPDX-License-Identifier: Apache-2.0 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  componentInspect,
  componentList,
  fileDiagnose,
  projectScan,
  testDiscover,
  testPlan,
  testRun,
} from "../lib/operations.ts";
import type { SfLwcSessionState } from "../lib/types.ts";
import { makeLwcFixture } from "./helpers.ts";

function digestFrom(
  result: Awaited<ReturnType<typeof componentInspect | typeof projectScan | typeof componentList>>,
) {
  return result.details.digest as {
    status: string;
    sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
  };
}

describe("sf-lwc operation recommendations", () => {
  it("warns and explains when component metadata is missing", async () => {
    const root = await makeLwcFixture();
    await rm(
      path.join(
        root,
        "force-app",
        "main",
        "default",
        "lwc",
        "helloWorld",
        "helloWorld.js-meta.xml",
      ),
    );

    const result = await componentInspect(
      { action: "component.inspect", workspace: root, component: "helloWorld" },
      root,
    );
    const digest = digestFrom(result);

    expect(digest.status).toBe("warning");
    expect(result.content[0].text).toContain("missing js-meta.xml");
    expect(
      digest.sections.find((section) => section.title === "Bundle Health")?.rows[0],
    ).toMatchObject({
      label: "missing-meta",
    });
  });

  it("warns about missing template only for likely UI components", async () => {
    const root = await makeLwcFixture();
    await rm(
      path.join(root, "force-app", "main", "default", "lwc", "helloWorld", "helloWorld.html"),
    );

    const result = await componentInspect(
      { action: "component.inspect", workspace: root, component: "helloWorld" },
      root,
    );
    const digest = digestFrom(result);

    expect(digest.status).toBe("warning");
    expect(result.content[0].text).toContain("missing template file");
  });

  it("does not warn about missing template for a plain JS module bundle", async () => {
    const root = await makeLwcFixture();
    const moduleBundle = path.join(root, "force-app", "main", "default", "lwc", "formatValue");
    await mkdir(moduleBundle, { recursive: true });
    await writeFile(
      path.join(moduleBundle, "formatValue.js"),
      "export function formatValue(value) { return String(value); }\n",
    );
    await writeFile(
      path.join(moduleBundle, "formatValue.js-meta.xml"),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">',
        "  <apiVersion>67.0</apiVersion>",
        "  <isExposed>false</isExposed>",
        "</LightningComponentBundle>",
      ].join("\n"),
    );

    const result = await componentInspect(
      { action: "component.inspect", workspace: root, component: "formatValue" },
      root,
    );
    const digest = digestFrom(result);

    expect(digest.status).toBe("pass");
    expect(result.content[0].text).not.toContain("missing template file");
  });

  it("surfaces bundle health warnings in project scan and component list", async () => {
    const root = await makeLwcFixture();
    await rm(
      path.join(
        root,
        "force-app",
        "main",
        "default",
        "lwc",
        "helloWorld",
        "helloWorld.js-meta.xml",
      ),
    );

    const scan = digestFrom(await projectScan({ action: "project.scan", workspace: root }, root));
    const list = digestFrom(
      await componentList({ action: "component.list", workspace: root }, root),
    );

    expect(scan.status).toBe("warning");
    expect(list.status).toBe("warning");
    expect(
      scan.sections.find((section) => section.title === "Bundle Health")?.rows[0].value,
    ).toContain("missing js-meta.xml");
    expect(
      list.sections.find((section) => section.title === "Bundle Health")?.rows[0].value,
    ).toContain("missing js-meta.xml");
  });

  it("explains file diagnostic failures in compact text", async () => {
    const root = await makeLwcFixture();
    const html = path.join(
      root,
      "force-app",
      "main",
      "default",
      "lwc",
      "helloWorld",
      "helloWorld.html",
    );
    await writeFile(html, "<template><section></template>\n");

    const result = await fileDiagnose(
      { action: "file.diagnose", workspace: root, file: html },
      root,
    );

    expect(result.content[0].text).toContain("Invalid HTML syntax");
  });

  it("explains test plan warnings in compact text", async () => {
    const root = await makeLwcFixture();

    const result = await testPlan(
      { action: "test.plan", workspace: root, component: "missingTest" },
      root,
    );

    expect(result.content[0].text).toContain("No colocated LWC Jest test found for component");
  });

  it("explains test discovery warning when the local Jest runner is missing", async () => {
    const root = await makeLwcFixture();

    const result = await testDiscover({ action: "test.discover", workspace: root }, root);

    expect(result.content[0].text).toContain("no local lwc-jest runner");
  });

  it("returns setup guidance when the local Jest runner is missing", async () => {
    const root = await makeLwcFixture();
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        scripts: { "test:unit": "sfdx-lwc-jest" },
        devDependencies: { "@salesforce/sfdx-lwc-jest": "^7.0.2" },
      }),
    );
    const state: SfLwcSessionState = {};

    const result = await testRun(
      { action: "test.run", workspace: root, component: "helloWorld", timeout_seconds: 10 },
      root,
      state,
    );
    const digest = result.details.digest as {
      title: string;
      status: string;
      primary_reason?: string;
      sections: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
    };
    const setupRows =
      digest.sections.find((section) => section.title === "Setup Guidance")?.rows ?? [];

    expect(digest.title).toBe("LWC Jest");
    expect(digest.status).toBe("fail");
    expect(digest.primary_reason).toContain("local lwc-jest runner not found");
    expect(result.content[0].text).toContain("local lwc-jest runner not found");
    expect(setupRows.find((row) => row.label === "Run from")?.value).toBe(root);
    expect(setupRows.find((row) => row.label === "Copy/paste")?.value).toBe(
      `cd '${root}' && npm install`,
    );
    expect(setupRows.find((row) => row.label === "Dependency")?.value).toBe(
      "@salesforce/sfdx-lwc-jest declared",
    );
    expect(setupRows.find((row) => row.label === "Retry")?.value).toContain("sf_lwc test.run");
    expect(state.lastRunnable?.component).toBe("helloWorld");
  });

  it("recommends LWC authoring and SLDS2 uplift guidance from component style signals", async () => {
    const root = await makeLwcFixture();
    const result = await componentInspect(
      { action: "component.inspect", workspace: root, component: "helloWorld" },
      root,
    );

    expect(result.details.recommended_skills).toEqual([
      "generating-lwc-components",
      "uplifting-components-to-slds2",
    ]);
    expect(result.details.recommended_tools).toEqual(["sf_apex", "sf_soql", "code_analyzer"]);
  });

  it("recommends SLDS2 guidance for CSS diagnostics", async () => {
    const root = await makeLwcFixture();
    const result = await fileDiagnose(
      {
        action: "file.diagnose",
        workspace: root,
        file: "force-app/main/default/lwc/helloWorld/helloWorld.css",
      },
      root,
    );

    expect(result.details.recommended_skills).toEqual([
      "generating-lwc-components",
      "uplifting-components-to-slds2",
    ]);
  });

  it("recommends LWC authoring guidance for local Jest runs", async () => {
    const root = await makeLwcFixture({ withRunner: true });
    const state: SfLwcSessionState = {};
    const result = await testRun(
      { action: "test.run", workspace: root, component: "helloWorld", timeout_seconds: 10 },
      root,
      state,
    );

    expect(result.details.recommended_skills).toEqual(["generating-lwc-components"]);
  });
});
