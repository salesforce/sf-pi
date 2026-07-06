/* SPDX-License-Identifier: Apache-2.0 */
/** Local-only E2E harness for sf-lwc. No Salesforce org required. */

import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  componentInspect,
  componentList,
  fileDiagnose,
  projectScan,
  status,
  testDiscover,
  testPlan,
  testRun,
} from "../../extensions/sf-lwc/lib/operations.ts";
import type { ToolResult } from "../../extensions/sf-lwc/lib/types.ts";

async function main() {
  const workspace = await makeFixture();
  const state = {};

  console.log("\n=== 1. Status and scan ===");
  await expectText(
    "status",
    status({ action: "status", workspace }, process.cwd()),
    "SF LWC Status",
  );
  await expectText(
    "project.scan",
    projectScan({ action: "project.scan", workspace }, process.cwd()),
    "LWC Project Scan",
  );
  await expectText(
    "component.list",
    componentList({ action: "component.list", workspace }, process.cwd()),
    "LWC Components",
  );

  console.log("\n=== 2. Inspect and diagnose ===");
  await expectText(
    "component.inspect",
    componentInspect(
      { action: "component.inspect", workspace, component: "helloWorld" },
      process.cwd(),
    ),
    "LWC Component · helloWorld",
  );
  await expectText(
    "file.diagnose clean",
    fileDiagnose(
      {
        action: "file.diagnose",
        workspace,
        file: "force-app/main/default/lwc/helloWorld/helloWorld.html",
      },
      process.cwd(),
    ),
    "LWC File Diagnostics",
  );
  const badFile = "force-app/main/default/lwc/helloWorld/bad.html";
  await writeFile(
    path.join(workspace, badFile),
    "<template><lighting-button></lighting-button></template>",
  );
  await expectText(
    "file.diagnose typo",
    fileDiagnose({ action: "file.diagnose", workspace, file: badFile }, process.cwd()),
    "LWC File Diagnostics",
  );

  console.log("\n=== 3. Local test lifecycle ===");
  await expectText(
    "test.discover",
    testDiscover({ action: "test.discover", workspace }, process.cwd()),
    "LWC Test Discovery",
  );
  await expectText(
    "test.plan",
    testPlan({ action: "test.plan", workspace, component: "helloWorld" }, process.cwd()),
    "LWC Test Plan",
  );
  await expectText(
    "test.run",
    testRun(
      { action: "test.run", workspace, component: "helloWorld", timeout_seconds: 10 },
      process.cwd(),
      state,
    ),
    "LWC Jest",
  );

  console.log("\nSF LWC local E2E passed.");
}

async function expectText(label: string, promise: Promise<ToolResult>, expected: string) {
  const result = await promise;
  const text = result.content[0]?.text ?? "";
  if (!text.includes(expected)) throw new Error(`${label} did not include ${expected}: ${text}`);
  console.log(`  ✓ ${label} — ${text}`);
}

async function makeFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "sf-lwc-e2e-"));
  const bundle = path.join(root, "force-app", "main", "default", "lwc", "helloWorld");
  const tests = path.join(bundle, "__tests__");
  const bin = path.join(root, "node_modules", ".bin");
  await mkdir(tests, { recursive: true });
  await mkdir(bin, { recursive: true });
  await writeFile(
    path.join(root, "sfdx-project.json"),
    JSON.stringify(
      { packageDirectories: [{ path: "force-app", default: true }], sourceApiVersion: "67.0" },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(bundle, "helloWorld.js"),
    [
      "import { LightningElement, api } from 'lwc';",
      "import getContacts from '@salesforce/apex/ContactController.getContacts';",
      "export default class HelloWorld extends LightningElement { @api recordId; }",
    ].join("\n"),
  );
  await writeFile(
    path.join(bundle, "helloWorld.html"),
    '<template><lightning-card title="Hello"></lightning-card></template>',
  );
  await writeFile(
    path.join(bundle, "helloWorld.js-meta.xml"),
    [
      "<LightningComponentBundle>",
      "  <apiVersion>67.0</apiVersion>",
      "  <isExposed>true</isExposed>",
      "  <targets><target>lightning__RecordPage</target></targets>",
      "</LightningComponentBundle>",
    ].join("\n"),
  );
  const testFile = path.join(tests, "helloWorld.test.js");
  await writeFile(testFile, "it('renders hello', () => {});\n");
  const runner = path.join(bin, "lwc-jest");
  await writeFile(
    runner,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--') {
  console.error('sf-lwc must pass direct lwc-jest args without npm separator');
  process.exit(2);
}
const out = args[args.indexOf('--outputFile') + 1];
const testFile = args[args.indexOf('--runTestsByPath') + 1];
fs.writeFileSync(out, JSON.stringify({
  success: true,
  numTotalTests: 1,
  numPassedTests: 1,
  numFailedTests: 0,
  numPendingTests: 0,
  numTotalTestSuites: 1,
  numPassedTestSuites: 1,
  numFailedTestSuites: 0,
  testResults: [{ name: testFile, assertionResults: [{ title: 'renders hello', fullName: 'helloWorld renders hello', status: 'passed', failureMessages: [] }] }]
}, null, 2));
console.log('fake lwc-jest passed');
`,
  );
  await chmod(runner, 0o755);
  return root;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
