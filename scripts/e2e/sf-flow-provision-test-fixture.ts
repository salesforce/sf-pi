/* SPDX-License-Identifier: Apache-2.0 */
/** Check-only or deploy the dedicated public-safe SF Flow test fixture. */

import path from "node:path";
import { ComponentSet } from "@salesforce/source-deploy-retrieve";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import { analyzeFlowFile } from "../../extensions/sf-flow/lib/analyzer.ts";

const FIXTURE_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow");
const FLOW_FILE = path.join(
  FIXTURE_ROOT,
  "force-app/main/default/flows/SfPi_Flow_Test_Fixture.flow-meta.xml",
);
const TEST_FILE = path.join(
  FIXTURE_ROOT,
  "force-app/main/default/flowtests/SfPi_Flow_Test_Fixture_Happy_Path.flowtest-meta.xml",
);

interface Args {
  org?: string;
  deploy: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { deploy: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--org") args.org = argv[++index];
    else if (argv[index] === "--deploy") args.deploy = true;
  }
  return args;
}

async function runDeploy(
  components: ComponentSet,
  connection: Parameters<ComponentSet["deploy"]>[0]["usernameOrConnection"],
  checkOnly: boolean,
) {
  const job = await components.deploy({
    usernameOrConnection: connection,
    apiOptions: { checkOnly, rollbackOnError: true, testLevel: "NoTestRun" },
  });
  const result = await job.pollStatus(1_000, 180);
  const response = result.response;
  if (response.success !== true) {
    const raw = response.details?.componentFailures as unknown;
    const failures = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    const messages = failures
      .slice(0, 10)
      .map((failure) => String((failure as { problem?: unknown }).problem ?? "unknown failure"));
    throw new Error(
      `${checkOnly ? "Check-only validation" : "Fixture deployment"} failed: ${messages.join(" | ")}`,
    );
  }
  console.log(
    `✅ ${checkOnly ? "check-only" : "deploy"}: succeeded · components=${response.numberComponentsDeployed ?? 0}`,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-provision -- --org <non-production-alias> [--deploy]",
    );
  }
  const local = await analyzeFlowFile(path.relative(FIXTURE_ROOT, FLOW_FILE), FIXTURE_ROOT, {
    profile: "review",
  });
  if (local.summary.high || local.summary.moderate) {
    throw new Error(
      `Local fixture diagnosis is not ready: high=${local.summary.high} moderate=${local.summary.moderate}`,
    );
  }

  const session = await connectSalesforce({
    cwd: process.cwd(),
    targetOrg: args.org,
    fresh: true,
  });
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(
      `Refusing Flow test fixture provisioning for org type ${session.target.orgType}.`,
    );
  }
  if (Number.parseFloat(session.target.apiVersion) < 66) {
    throw new Error("The fixture requires API 66.0 or later for autolaunched Flow tests.");
  }

  const components = ComponentSet.fromSource([FLOW_FILE, TEST_FILE]);
  components.apiVersion = session.target.apiVersion;
  components.sourceApiVersion = session.target.apiVersion;
  console.log(
    `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · mode=${args.deploy ? "check+deploy" : "check-only"}`,
  );
  await runDeploy(components, session.connection, true);
  if (!args.deploy) {
    console.log("Plan complete. Re-run with --deploy to provision the reversible test fixture.");
    return;
  }
  await runDeploy(components, session.connection, false);
  console.log("Fixture provisioned: SfPi_Flow_Test_Fixture and SfPi_Flow_Test_Fixture_Happy_Path.");
}

await main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
