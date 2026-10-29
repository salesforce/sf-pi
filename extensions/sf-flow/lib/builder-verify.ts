/* SPDX-License-Identifier: Apache-2.0 */
/**
 * builder.verify: read the Flow Builder Errors panel for one Flow version.
 *
 * Draft check-only validation and even the Active lane miss defects that only
 * Flow Builder's client-side validator reports (for example unsupported
 * cross-object field paths). This action opens the Builder for one exact version
 * in the shared agent-browser session, reads the accessibility snapshot, and
 * returns the Errors panel count. It never clicks, edits, saves, or activates.
 *
 * Extensions stay self-contained, so this module drives agent-browser directly
 * with the same shared session name sf-browser uses, rather than importing it.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { buildFlowDigest, row, section, toolResultFromDigest } from "./digest.ts";
import type { SfFlowParams, ToolResult } from "./types.ts";

const SF_BROWSER_SESSION = "sf-pi";
const OPEN_TIMEOUT_MS = 60_000;
const SNAPSHOT_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 1_000;
const READY_DEADLINE_MS = 60_000;
// The Builder renders the toolbar and a transient "errors panel" (zero) state
// for a few seconds before validation finishes and any real count appears. A
// zero reading is trusted only after it holds for this many consecutive polls
// past toolbar-ready, i.e. roughly a six-second validation settle window.
const STABLE_READS = 6;
const FLOW_API_NAME = /^[A-Za-z][A-Za-z0-9_]*$/u;
const VERSION_ID = /^[A-Za-z0-9]{15,18}$/u;
// The Builder error toggle reads "Show N errors", "Show 1 error", or "Show errors panel" at zero.
const ERROR_BUTTON = /Show (\d+) errors?|Show errors panel/u;

export interface BuilderVerifyAdapter {
  open(url: string): Promise<void>;
  snapshot(): Promise<string>;
}

export interface BuilderVerifyResult {
  errors: number | null;
  ready: boolean;
  version_id: string;
  version_number?: number;
  status?: string;
  builder_url: string;
  snapshot_observed: boolean;
}

export async function verifyBuilder(
  pi: ExtensionAPI,
  params: SfFlowParams,
  cwd: string,
  session: SalesforceSession,
  dependencies: { adapter?: BuilderVerifyAdapter; timing?: BuilderVerifyTiming } = {},
): Promise<ToolResult> {
  const flowName = params.flow_name?.trim();
  if (!flowName || !FLOW_API_NAME.test(flowName)) {
    throw new Error("flow_name must be an exact Flow API name for builder.verify");
  }
  const version = await resolveVersion(session, flowName, params.version);
  if (!version) {
    throw new Error(
      params.version
        ? `Flow version not found: ${flowName} v${params.version}`
        : `Flow not found in the target org: ${flowName}`,
    );
  }
  const instance = (session.connection as { instanceUrl?: string } | undefined)?.instanceUrl;
  if (!instance) throw new Error("Salesforce session has no instance URL for the Builder URL.");
  const builderUrl = `${instance.replace(/\/$/u, "")}/builder_platform_interaction/flowBuilder.app?flowId=${version.id}`;

  const adapter = dependencies.adapter ?? defaultBuilderVerifyAdapter(pi, cwd);
  await adapter.open(builderUrl);
  const { errors, observed } = await readErrorCount(adapter, dependencies.timing);
  const result: BuilderVerifyResult = {
    errors,
    ready: errors === 0,
    version_id: version.id,
    version_number: version.versionNumber,
    status: version.status,
    builder_url: builderUrl,
    snapshot_observed: observed,
  };

  const status = errors === 0 ? "pass" : errors === null ? "warning" : "fail";
  const digest = buildFlowDigest({
    action: "builder.verify",
    kind: "flow_builder_verify",
    status,
    icon: errors === 0 ? "✅" : errors === null ? "⚠️" : "❌",
    title: `Flow Builder Verify · ${errors === null ? "not observed" : errors === 0 ? "0 errors" : `${errors} error${errors === 1 ? "" : "s"}`}`,
    org: {
      alias: session.target.alias ?? params.target_org,
      api_version: session.target.apiVersion,
    },
    meta: [flowName, ...(version.versionNumber ? [`v${version.versionNumber}`] : [])],
    rail: [
      { kind: "REST", target: "FlowVersionView", detail: "exact version" },
      { kind: "Browser", target: "flowBuilder.app", detail: "read-only snapshot" },
    ],
    sections: [
      section("🔎", "Builder", [
        row("🏷️", "API Name", flowName),
        row("🔢", "Version", version.versionNumber),
        row("🧾", "Saved status", version.status),
        row(
          errors === null ? "⚠️" : errors === 0 ? "✅" : "❌",
          "Builder errors",
          errors === null ? "panel not observed" : String(errors),
        ),
        row("🔗", "URL", builderUrl),
      ]),
      section("🛡️", "Mutation", [row("✅", "Performed", "none · read-only")]),
    ],
    next_step:
      errors === null
        ? "Open the URL manually and read the Errors panel; the snapshot did not expose it."
        : errors === 0
          ? "Flow Builder reports no errors. Run the smallest relevant Flow test or runtime proof."
          : "Open the URL, read each listed error, fix it in the local file, and re-run diagnose.file.",
  });
  return toolResultFromDigest(digest, { ...result });
}

interface ResolvedVersion {
  id: string;
  versionNumber?: number;
  status?: string;
}

async function resolveVersion(
  session: SalesforceSession,
  flowName: string,
  version?: number,
): Promise<ResolvedVersion | undefined> {
  const versionFilter =
    version !== undefined && Number.isInteger(version) && version > 0
      ? ` AND VersionNumber = ${version}`
      : "";
  const result = await session.query<{
    DurableId?: string;
    VersionNumber?: number;
    Status?: string;
  }>({
    soql: `SELECT DurableId, VersionNumber, Status FROM FlowVersionView WHERE FlowDefinitionView.ApiName = '${flowName}'${versionFilter} ORDER BY VersionNumber DESC LIMIT 1`,
    api: "rest",
    maxRows: 1,
  });
  const record = result.records[0];
  if (!record?.DurableId || !VERSION_ID.test(record.DurableId)) return undefined;
  return { id: record.DurableId, versionNumber: record.VersionNumber, status: record.Status };
}

export interface BuilderVerifyTiming {
  pollMs?: number;
  deadlineMs?: number;
  stableReads?: number;
}

async function readErrorCount(
  adapter: BuilderVerifyAdapter,
  timing: BuilderVerifyTiming = {},
): Promise<{ errors: number | null; observed: boolean }> {
  const pollMs = timing.pollMs ?? READY_POLL_MS;
  const stableReads = timing.stableReads ?? STABLE_READS;
  const deadline = Date.now() + (timing.deadlineMs ?? READY_DEADLINE_MS);
  let observed = false;
  let lastCount: number | undefined;
  let stable = 0;
  while (Date.now() < deadline) {
    const snapshot = await adapter.snapshot();
    const canvasReady = /Save As New Version|Activate/u.test(snapshot);
    if (canvasReady) observed = true;
    const match = snapshot.match(ERROR_BUTTON);
    // A non-zero count is authoritative immediately; a zero reading
    // ("errors panel") is trusted only after the canvas is ready and the
    // count repeats, because the toolbar renders before validation runs.
    if (match) {
      const count = match[1] ? Number(match[1]) : 0;
      if (count > 0) return { errors: count, observed: true };
      if (canvasReady) {
        stable = count === lastCount ? stable + 1 : 1;
        lastCount = count;
        if (stable >= stableReads) return { errors: 0, observed: true };
      }
    }
    await delay(pollMs);
  }
  return { errors: lastCount ?? null, observed };
}

function defaultBuilderVerifyAdapter(pi: ExtensionAPI, cwd: string): BuilderVerifyAdapter {
  const base = ["--session", SF_BROWSER_SESSION, "--session-name", SF_BROWSER_SESSION];
  return {
    async open(url) {
      await pi.exec("agent-browser", [...base, "open", url], { cwd, timeout: OPEN_TIMEOUT_MS });
    },
    async snapshot() {
      const result = await pi.exec("agent-browser", [...base, "snapshot", "-i"], {
        cwd,
        timeout: SNAPSHOT_TIMEOUT_MS,
      });
      return result.stdout ?? "";
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
