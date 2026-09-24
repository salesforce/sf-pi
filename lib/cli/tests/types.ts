/* SPDX-License-Identifier: Apache-2.0 */
/** Compile-only consumer proof; no top-level calls or side effects. */
import {
  callApex,
  createApexClient,
  type ApexClient,
  type ApexCallResult,
  type ApexToolResult,
  type ApexDetails,
} from "../../../extensions/sf-apex/public.ts";
async function consumer() {
  const apex: ApexClient = createApexClient({ workspace: "/workspace", targetOrg: "ExampleOrg" });
  const source: ApexCallResult<"apex.source.get"> = await apex.call({
    action: "apex.source.get",
    class_names: ["Example"],
  });
  const evidence: ApexToolResult<"apex.source.get"> | undefined = source.result;
  const details: ApexDetails<"apex.source.get"> | undefined = evidence?.details;
  const name: string | undefined = source.result?.details.sources?.[0]?.name;
  const coverage = await callApex({ action: "coverage.summary", targets: ["Example"] });
  const percent: number | undefined = coverage.result?.details.coverage?.[0]?.pct;
  const diagnostics = await apex.call({ action: "diagnose.file", file: "Example.cls" });
  for (const finding of diagnostics.result?.details.diagnostics ?? []) {
    const line: number = finding.range.start.line;
    const message: string = finding.message;
    // @ts-expect-error Diagnostic coordinates are numbers.
    const wrongLine: string = finding.range.end.character;
    void [line, message, wrongLine];
  }
  for (const artifact of source.result?.details.artifacts ?? []) {
    const file: string = artifact.path;
    // @ts-expect-error Artifact paths are strings.
    const wrongPath: number = artifact.path;
    void [file, wrongPath];
  }
  await apex.call({ action: "test.run", tests: ["ExampleTest.testOne"] }, { allowEffects: true });
  // @ts-expect-error Anonymous Apex requires a body.
  await apex.call({ action: "anon.run" });
  // @ts-expect-error diagnose.file requires a file or target.
  await callApex({ action: "diagnose.file" });
  // @ts-expect-error Apex-only public API.
  await callApex({ action: "lwc.create" });
  // @ts-expect-error Coverage percentages are numbers.
  const wrong: string = coverage.result?.details.coverage?.[0]?.pct;
  return { name, percent, wrong, details };
}
void consumer;
