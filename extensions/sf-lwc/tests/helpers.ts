/* SPDX-License-Identifier: Apache-2.0 */

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function makeLwcFixture(options: { withRunner?: boolean } = {}): Promise<string> {
  const root = path.join(tmpdir(), `sf-lwc-fixture-${randomUUID()}`);
  const bundle = path.join(root, "force-app", "main", "default", "lwc", "helloWorld");
  const tests = path.join(bundle, "__tests__");
  await mkdir(tests, { recursive: true });
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
      "import { LightningElement, api, wire } from 'lwc';",
      "import getContacts from '@salesforce/apex/ContactController.getContacts';",
      "import NAME_FIELD from '@salesforce/schema/Contact.Name';",
      "import LABEL from '@salesforce/label/c.Hello';",
      "export default class HelloWorld extends LightningElement {",
      "  @api recordId;",
      "  @wire(getContacts) contacts;",
      "}",
    ].join("\n"),
  );
  await writeFile(
    path.join(bundle, "helloWorld.html"),
    [
      "<template>",
      '  <lightning-card title="Hello"><c-child-tile></c-child-tile></lightning-card>',
      "</template>",
    ].join("\n"),
  );
  await writeFile(path.join(bundle, "helloWorld.css"), ".hello { color: #fff; margin: 12px; }\n");
  await writeFile(
    path.join(bundle, "helloWorld.js-meta.xml"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">',
      "  <apiVersion>67.0</apiVersion>",
      "  <isExposed>true</isExposed>",
      "  <targets><target>lightning__RecordPage</target></targets>",
      "</LightningComponentBundle>",
    ].join("\n"),
  );
  await writeFile(
    path.join(tests, "helloWorld.test.js"),
    [
      "describe('helloWorld', () => {",
      "  it('renders hello', () => {});",
      "  test('dispatches event', () => {});",
      "});",
    ].join("\n"),
  );
  if (options.withRunner) await writeFakeRunner(root);
  return root;
}

async function writeFakeRunner(root: string): Promise<void> {
  const bin = path.join(root, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  const runner = path.join(bin, process.platform === "win32" ? "lwc-jest.cmd" : "lwc-jest");
  await writeFile(
    runner,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === '--') process.exit(2);
const out = args[args.indexOf('--outputFile') + 1];
const testFile = args[args.indexOf('--runTestsByPath') + 1];
fs.writeFileSync(out, JSON.stringify({
  success: true,
  numTotalTests: 2,
  numPassedTests: 2,
  numFailedTests: 0,
  numPendingTests: 0,
  numTotalTestSuites: 1,
  numPassedTestSuites: 1,
  numFailedTestSuites: 0,
  testResults: [{ name: testFile, assertionResults: [
    { title: 'renders hello', fullName: 'helloWorld renders hello', status: 'passed', failureMessages: [] },
    { title: 'dispatches event', fullName: 'helloWorld dispatches event', status: 'passed', failureMessages: [] }
  ] }]
}, null, 2));
console.log('fake lwc-jest passed');
`,
  );
  await chmod(runner, 0o755);
}
