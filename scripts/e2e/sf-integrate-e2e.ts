#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/** Check-only by default; optional disposable Headless 360 ECA lifecycle proof. */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { connectSalesforce } from "../../lib/common/sf-conn/index.ts";
import {
  defaultIntegrationAdapter,
  deleteEcaStack,
  inspectEca,
  isCompleteEca,
} from "../../extensions/sf-integrate/lib/metadata.ts";
import {
  applySetup,
  designPlan,
  mcpHandoff,
  orgPreflight,
} from "../../extensions/sf-integrate/lib/operations.ts";
import type { SfIntegrateSessionState } from "../../extensions/sf-integrate/lib/types.ts";
import { resolveHostedOrgBinding } from "../../extensions/sf-mcp/lib/hosted-org-binding.ts";
import { mcpConfigPath } from "../../extensions/sf-mcp/lib/mcp-config.ts";
import { installPreset } from "../../extensions/sf-mcp/lib/service.ts";

const args = process.argv.slice(2);
const targetOrg = flagValue(args, "--org");
const apply = args.includes("--apply");
if (!targetOrg) {
  throw new Error("Usage: npm run e2e:sf-integrate -- --org <non-production-alias> [--apply]");
}

const session = await connectSalesforce({ cwd: process.cwd(), targetOrg });
if (!["sandbox", "scratch", "developer", "trial"].includes(session.target.orgType)) {
  throw new Error(`SF Integrate E2E refuses org type ${session.target.orgType}.`);
}

const suffix = Date.now()
  .toString(36)
  .replace(/[^A-Za-z0-9]/gu, "");
const appName = `SfPiMcpE2E${suffix}`.slice(0, 70);
const state: SfIntegrateSessionState = {
  plans: new Map(),
  inboundPlans: new Map(),
  outboundPlans: new Map(),
};
let runError: unknown;
let cleanupError: unknown;

console.log(`Target: ${session.target.alias ?? targetOrg} · ${session.target.orgType}`);
console.log(`API: ${session.target.apiVersion}`);
console.log(`Fixture: ${appName}`);

try {
  const preflight = await orgPreflight({ action: "org.preflight", target_org: targetOrg }, session);
  if (!preflight.details.ok) throw new Error(preflight.content[0]?.text ?? "Preflight failed");
  console.log("✅ preflight");

  const planned = await designPlan(
    {
      action: "design.plan",
      target_org: targetOrg,
      app_name: appName,
      app_label: "SF Pi MCP E2E",
      contact_email: "admin@example.invalid",
      mcp_preset: "headless-360",
    },
    session,
    state,
  );
  const planId = String(planned.details.plan_id);
  const planHash = String(planned.details.plan_hash);
  const plan = state.plans.get(planId);
  if (!plan) throw new Error("E2E plan was not retained in session state.");
  console.log("✅ plan");

  const check = await defaultIntegrationAdapter.deploy({
    session,
    sources: plan.sources,
    checkOnly: true,
  });
  if (!check.success) {
    throw new Error(
      `Check-only failed: ${check.component_failures.map((failure) => failure.problem).join("; ")}`,
    );
  }
  console.log("✅ check-only");

  if (!apply) {
    console.log("ℹ️ no metadata saved; pass --apply for the disposable create/read/delete proof");
  } else {
    const applied = await applySetup(
      {
        action: "setup.apply",
        target_org: targetOrg,
        app_name: appName,
        plan_id: planId,
        plan_hash: planHash,
        allow_mutation: true,
      },
      session,
      state,
    );
    if (!applied.details.ok) throw new Error(applied.content[0]?.text ?? "Apply failed");
    console.log("✅ apply + resulting-state verification");

    const inspection = await inspectEca(session, appName);
    if (!isCompleteEca(inspection) || !inspection.consumer_key) {
      throw new Error("Created External Client App is incomplete or has no consumer key.");
    }
    console.log("✅ public consumer key available");

    const handoff = await mcpHandoff(
      {
        action: "mcp.handoff",
        target_org: targetOrg,
        app_name: appName,
        mcp_preset: "headless-360",
      },
      session,
    );
    const payload = handoff.details.handoff as
      { consumer_key?: unknown; server_name?: unknown; target?: { org_id?: unknown } } | undefined;
    if (typeof payload?.consumer_key !== "string" || !payload.consumer_key) {
      throw new Error("MCP handoff did not include the public consumer key.");
    }
    if (typeof payload.server_name !== "string" || !payload.server_name) {
      throw new Error("MCP handoff did not include an org-bound server name.");
    }
    if (payload.target?.org_id !== session.target.orgId) {
      throw new Error("MCP handoff target identity did not match the explicit org.");
    }
    console.log("✅ SF MCP handoff");

    const binding = await resolveHostedOrgBinding({
      cwd: process.cwd(),
      targetOrg,
      serverPath: "platform/headless-360",
    });
    const isolatedAgentDir = await mkdtemp(path.join(tmpdir(), "sf-integrate-mcp-"));
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
      const installed = installPreset({
        cwd: process.cwd(),
        scope: "global",
        presetId: "headless-360",
        resolution: "side-by-side",
        connectionName: payload.server_name,
        orgBinding: binding,
        setup: {
          oauthClientId: payload.consumer_key,
          serverUrl: binding.serverUrl,
        },
      });
      if (!installed.ok) throw new Error(installed.message);
      const config = JSON.parse(await readFile(mcpConfigPath(process.cwd(), "global"), "utf8")) as {
        mcpServers?: Record<string, { url?: unknown }>;
      };
      if (config.mcpServers?.[payload.server_name]?.url !== binding.serverUrl) {
        throw new Error("SF MCP did not persist the proved org-pinned endpoint.");
      }
      console.log("✅ org-bound SF MCP native configuration");
    } finally {
      if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      await rm(isolatedAgentDir, { recursive: true, force: true });
    }
  }
} catch (error) {
  runError = error;
} finally {
  if (apply) {
    try {
      const current = await inspectEca(session, appName);
      if (Object.values(current.components).some(Boolean)) {
        await deleteEcaStack(session, appName);
      }
      const after = await inspectEca(session, appName);
      if (Object.values(after.components).some(Boolean)) {
        cleanupError = new Error(`Disposable cleanup failed for ${appName}.`);
      } else {
        console.log("✅ cleanup");
      }
    } catch (error) {
      cleanupError = error;
    }
  }
}

if (runError && cleanupError) {
  throw new AggregateError([runError, cleanupError], "SF Integrate E2E and cleanup both failed.");
}
if (runError) throw runError;
if (cleanupError) throw cleanupError;

function flagValue(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  const value = index >= 0 ? values[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}
