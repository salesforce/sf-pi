/* SPDX-License-Identifier: Apache-2.0 */
/** Live proof for first-class sf_flow activation, exact-version switching, and cleanup. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  activateFlowVersion,
  deactivateFlow,
  deployAndActivateFlow,
  getFlowLifecycleStatus,
} from "../../extensions/sf-flow/lib/lifecycle.ts";
import type { ToolResult } from "../../extensions/sf-flow/lib/types.ts";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";

const FIXTURE_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow-actions");
const FLOW_NAME = "SfPi_Action_Complex_Apex";
const FLOW_FILE = path.join("force-app", "main", "default", "flows", `${FLOW_NAME}.flow-meta.xml`);
const SCHEDULED_ROOT = path.resolve("scripts/e2e/fixtures/sf-flow-advanced");
const SCHEDULED_FLOW_NAME = "SfPi_Advanced_Scheduled_Pipeline";
const SCHEDULED_FLOW_FILE = path.join(
  "force-app",
  "main",
  "default",
  "flows",
  `${SCHEDULED_FLOW_NAME}.flow-meta.xml`,
);

export interface LifecycleSweepArgs {
  org?: string;
}

export function parseLifecycleSweepArgs(argv: string[]): LifecycleSweepArgs {
  const args: LifecycleSweepArgs = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === "--org") {
      args.org = argv[++index];
      if (!args.org) throw new Error("--org requires an alias or username");
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function requireOk(result: ToolResult, label: string): ToolResult {
  if (result.details.ok !== true) {
    throw new Error(`${label} failed: ${result.content[0]?.text ?? "unknown error"}`);
  }
  return result;
}

function numberDetail(result: ToolResult, key: string): number {
  const value = result.details[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected positive numeric ${key}, received ${String(value)}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const args = parseLifecycleSweepArgs(process.argv.slice(2));
  if (!args.org) {
    throw new Error(
      "Usage: npm run e2e:sf-flow-lifecycle -- --org <dedicated-non-production-alias>",
    );
  }

  const session = await connectSalesforce({ cwd: FIXTURE_ROOT, targetOrg: args.org, fresh: true });
  if (session.target.orgType === "production" || session.target.orgType === "unknown") {
    throw new Error(`Refusing Flow lifecycle sweep for org type ${session.target.orgType}.`);
  }

  const absoluteFile = path.join(FIXTURE_ROOT, FLOW_FILE);
  const sourceBefore = await readFile(absoluteFile, "utf8");
  const mutation = {
    target_org: args.org,
    allow_mutation: true,
  } as const;

  console.log(
    `Target: ${args.org} · type=${session.target.orgType} · API ${session.target.apiVersion} · flow=${FLOW_NAME}`,
  );

  try {
    requireOk(
      await deactivateFlow(
        { action: "lifecycle.deactivate", flow_name: FLOW_NAME, ...mutation },
        session,
      ),
      "initial deactivation",
    );
    const before = requireOk(
      await getFlowLifecycleStatus(
        { action: "lifecycle.status", target_org: args.org, flow_name: FLOW_NAME },
        session,
      ),
      "initial status",
    );
    const existingVersion = numberDetail(before, "latest_version");
    console.log(`✅ lifecycle.status: inactive · latest=v${existingVersion}`);

    const local = requireOk(
      await deployAndActivateFlow(
        { action: "deploy.activate", file: FLOW_FILE, ...mutation },
        FIXTURE_ROOT,
        session,
      ),
      "local deploy and activate",
    );
    const newVersion = numberDetail(local, "active_version");
    if (newVersion <= existingVersion) {
      throw new Error(
        `Expected a new Flow version after local activation; observed v${newVersion}.`,
      );
    }
    console.log(`✅ deploy.activate: local Draft source staged Active · active=v${newVersion}`);

    const switched = requireOk(
      await activateFlowVersion(
        {
          action: "lifecycle.activate",
          flow_name: FLOW_NAME,
          version: existingVersion,
          ...mutation,
        },
        session,
      ),
      "exact version activation",
    );
    if (numberDetail(switched, "active_version") !== existingVersion) {
      throw new Error("Exact-version activation verification returned the wrong version.");
    }
    console.log(`✅ lifecycle.activate: exact existing version v${existingVersion}`);
  } finally {
    requireOk(
      await deactivateFlow(
        { action: "lifecycle.deactivate", flow_name: FLOW_NAME, ...mutation },
        session,
      ),
      "final deactivation",
    );
  }

  const final = requireOk(
    await getFlowLifecycleStatus(
      { action: "lifecycle.status", target_org: args.org, flow_name: FLOW_NAME },
      session,
    ),
    "final status",
  );
  if (final.details.is_active !== false || final.details.active_version !== null) {
    throw new Error(
      "Final lifecycle verification expected an inactive Flow with no active version.",
    );
  }
  if ((final.details.scheduled_jobs as unknown[]).length !== 0) {
    throw new Error("Final lifecycle verification found scheduled-job residue.");
  }
  if ((await readFile(absoluteFile, "utf8")) !== sourceBefore) {
    throw new Error("deploy.activate changed the checked-in Flow source.");
  }
  console.log("✅ lifecycle.deactivate: inactive · ActiveVersionId=null · no scheduled jobs");
  console.log("✅ source integrity: checked-in Draft Flow unchanged");

  await proveScheduledLifecycle(session, args.org);
}

async function proveScheduledLifecycle(
  session: Awaited<ReturnType<typeof connectSalesforce>>,
  targetOrg: string,
): Promise<void> {
  const absoluteFile = path.join(SCHEDULED_ROOT, SCHEDULED_FLOW_FILE);
  const sourceBefore = await readFile(absoluteFile, "utf8");
  const mutation = { target_org: targetOrg, allow_mutation: true } as const;
  try {
    requireOk(
      await deactivateFlow(
        { action: "lifecycle.deactivate", flow_name: SCHEDULED_FLOW_NAME, ...mutation },
        session,
      ),
      "scheduled initial deactivation",
    );
    const activated = requireOk(
      await deployAndActivateFlow(
        { action: "deploy.activate", file: SCHEDULED_FLOW_FILE, ...mutation },
        SCHEDULED_ROOT,
        session,
      ),
      "scheduled local deploy and activate",
    );
    const jobs = activated.details.scheduled_jobs as unknown[] | undefined;
    if (!jobs?.length) {
      throw new Error("Scheduled activation returned no scheduled-job evidence.");
    }
    console.log(
      `✅ scheduled deploy.activate: active=v${numberDetail(activated, "active_version")} · jobs=${jobs.length}`,
    );
  } finally {
    requireOk(
      await deactivateFlow(
        { action: "lifecycle.deactivate", flow_name: SCHEDULED_FLOW_NAME, ...mutation },
        session,
      ),
      "scheduled final deactivation",
    );
  }
  const final = requireOk(
    await getFlowLifecycleStatus(
      {
        action: "lifecycle.status",
        target_org: targetOrg,
        flow_name: SCHEDULED_FLOW_NAME,
      },
      session,
    ),
    "scheduled final status",
  );
  if (final.details.is_active !== false) {
    throw new Error("Scheduled Flow remains active after lifecycle.deactivate.");
  }
  if ((final.details.scheduled_jobs as unknown[]).length !== 0) {
    throw new Error("Scheduled Flow cleanup left CronTrigger residue.");
  }
  if ((await readFile(absoluteFile, "utf8")) !== sourceBefore) {
    throw new Error("Scheduled deploy.activate changed the checked-in Flow source.");
  }
  console.log("✅ scheduled lifecycle.deactivate: inactive · no CronTrigger residue");
}

const invoked = process.argv[1]
  ? import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
  : false;
if (invoked) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
