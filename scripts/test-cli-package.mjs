/* SPDX-License-Identifier: Apache-2.0 */
/** Install the Apex API alone, then its CLI, outside the repository without Pi. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const root = process.cwd();
const temp = mkdtempSync(path.join(os.tmpdir(), "sf-apex-cli-package-"));
const env = { ...process.env, npm_config_cache: path.join(temp, "cache") };
function run(command, args, cwd = temp) {
  return execFileSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
try {
  run(process.execPath, ["scripts/build-cli.mjs"], root);
  const packed = {};
  for (const name of ["apex", "cli"]) {
    const pack = JSON.parse(
      run("npm", [
        "pack",
        path.join(root, "packages", name),
        "--json",
        "--ignore-scripts",
        "--registry=https://registry.npmjs.org/",
      ]),
    )[0];
    packed[name] = path.join(temp, pack.filename);
    assert.ok(pack.files.some((file) => file.path === "LICENSE.txt"));
    if (name === "cli") {
      assert.ok(!pack.files.some((file) => /\.d\.ts$|dist\/index\.js|AGENT_GUIDE/.test(file.path)));
    }
  }
  const apexPackage = JSON.parse(
    readFileSync(path.join(root, "packages/apex/package.json"), "utf8"),
  );
  const cliPackage = JSON.parse(readFileSync(path.join(root, "packages/cli/package.json"), "utf8"));
  assert.deepEqual(cliPackage.dependencies, { "@sf-pi/apex": apexPackage.version });
  writeFileSync(path.join(temp, "package.json"), '{"private":true,"type":"module"}\n');
  const install = (tarball) =>
    run("npm", [
      "install",
      tarball,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--registry=https://registry.npmjs.org/",
    ]);
  install(packed.apex);
  let lock = readFileSync(path.join(temp, "package-lock.json"), "utf8");
  assert.doesNotMatch(
    lock,
    /@sf-pi\/cli|@earendil-works\/|pi-coding-agent|pi-tui|@lwc\/|@salesforce\/soql-/,
  );
  writeFileSync(
    path.join(temp, "consumer.mjs"),
    `
    import assert from 'node:assert/strict';
    import { createApexClient, callApex } from '@sf-pi/apex';
    const client = createApexClient({ workspace: process.cwd() });
    const result = await client.call({ action: 'author.plan', target: 'Example.cls' });
    assert.equal(result.ok, true);
    assert.equal((await callApex({ action: 'anon.run', body: 'System.debug(1);' })).error.code, 'AUTHORIZATION');
  `,
  );
  run(process.execPath, [path.join(temp, "consumer.mjs")]);
  writeFileSync(
    path.join(temp, "consumer.ts"),
    `
    import {
      createApexClient, callApex, createApexArtifactWriter, createApexDiagnosticsClient,
      type ApexClient, type ApexCallResult, type ApexInput, type ApexToolResult,
      type ApexDetails, type ApexArtifactWriter, type ApexDiagnosticsClient,
    } from '@sf-pi/apex';
    const client: ApexClient = createApexClient();
    const input: ApexInput<'apex.source.get'> = { action: 'apex.source.get', class_names: ['Example'] };
    const result: ApexCallResult<'apex.source.get'> = await client.call(input);
    const evidence: ApexToolResult<'apex.source.get'> | undefined = result.result;
    const details: ApexDetails<'apex.source.get'> | undefined = evidence?.details;
    const writer: ApexArtifactWriter = createApexArtifactWriter('/unused');
    const diagnostics: ApexDiagnosticsClient = createApexDiagnosticsClient();
    const name: string | undefined = result.result?.details.sources?.[0]?.name;
    const diagnosed = await client.call({ action: 'diagnose.file', file: 'Example.cls' });
    for (const finding of diagnosed.result?.details.diagnostics ?? []) {
      const line: number = finding.range.start.line;
      const message: string = finding.message;
      // @ts-expect-error Diagnostic coordinates are numbers.
      const wrongLine: string = finding.range.end.character;
    }
    for (const artifact of result.result?.details.artifacts ?? []) {
      const path: string = artifact.path;
      // @ts-expect-error Artifact paths are strings.
      const wrongPath: number = artifact.path;
    }
    // @ts-expect-error Anonymous Apex requires a body.
    await callApex({ action: 'anon.run' });
    // @ts-expect-error Source names are strings.
    const count: number = result.result?.details.sources?.[0]?.name;
  `,
  );
  run(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--target",
    "ES2022",
    "--module",
    "NodeNext",
    "--moduleResolution",
    "NodeNext",
    "consumer.ts",
  ]);
  install(packed.cli);
  lock = readFileSync(path.join(temp, "package-lock.json"), "utf8");
  assert.doesNotMatch(lock, /@earendil-works\/|pi-coding-agent|pi-tui|@lwc\/|@salesforce\/soql-/);
  const binary = path.join(temp, "node_modules/@sf-pi/cli/dist/sf-pi.js");
  const list = JSON.parse(
    run(process.execPath, [binary, "tools", "list", "--available", "--json"]),
  );
  assert.deepEqual(
    list.tools.map((tool) => tool.name),
    ["sf_apex"],
  );
  const described = JSON.parse(
    run(process.execPath, [binary, "tools", "describe", "sf_apex", "--json"]),
  );
  assert.equal(statSync(described.guidePath).isFile(), true);
  assert.equal(described.actions["diagnose.file"].available, true);
  assert.deepEqual(Object.keys(described.actionDetailsSchemas), Object.keys(described.actions));
  writeFileSync(
    path.join(temp, "sample.log"),
    "12:00:00.0 (1)|EXECUTION_STARTED\n12:00:00.0 (2)|EXECUTION_FINISHED",
  );
  for (const input of [
    { action: "author.plan", intent: "Create a focused service" },
    { action: "log.analyze", file: "sample.log" },
  ]) {
    const result = JSON.parse(
      run(process.execPath, [
        binary,
        "call",
        "sf_apex",
        "--input",
        JSON.stringify(input),
        "--workspace",
        temp,
        "--artifact-dir",
        path.join(temp, "artifacts"),
      ]),
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    for (const artifact of result.result.details.artifacts ?? [])
      assert.equal(statSync(artifact.path).isFile(), true);
  }
  console.log(
    "Clean tarball installs: standalone Apex API and types, CLI package dependency, discovery, planning and log artifacts passed; no Pi packages installed.",
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
