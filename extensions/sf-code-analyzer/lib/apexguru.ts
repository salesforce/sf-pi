/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit ApexGuru action support through the shared Salesforce Connection Module. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectSalesforce, type SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import type {
  CodeAnalyzerReportSummary,
  CodeAnalyzerRunJson,
  CodeAnalyzerViolation,
} from "./types.ts";

const POLL_INTERVAL_MS = 1_000;
export const DEFAULT_APEXGURU_TIMEOUT_MS = 60_000;

export async function runApexGuru(input: {
  file: string;
  cwd: string;
  target_org?: string;
  timeout_ms?: number;
  /** Internal absolute deadline shared with validation. */
  deadline_ms?: number;
  reportFile?: string;
}): Promise<CodeAnalyzerReportSummary> {
  const started = Date.now();
  const totalTimeout = input.timeout_ms ?? DEFAULT_APEXGURU_TIMEOUT_MS;
  const deadline = input.deadline_ms ?? started + totalTimeout;
  const remaining = () => remainingTime(deadline, totalTimeout);
  const file = path.resolve(input.cwd, input.file);
  const session = await connectSalesforce({
    cwd: input.cwd,
    targetOrg: input.target_org,
    timeoutMs: remaining(),
  });
  const content = readFileSync(file, "utf8");
  const response = await session.request<{
    status?: string;
    requestId?: string;
    message?: string;
  }>({
    method: "POST",
    path: "/apexguru/request",
    body: { classContent: Buffer.from(content).toString("base64") },
    timeoutMs: remaining(),
  });
  if (response.status >= 400) {
    throw new Error(`ApexGuru request failed HTTP ${response.status}.`);
  }
  const request = response.body;
  if (request.status?.toLowerCase() !== "new" || !request.requestId) {
    throw new Error(
      request.message ?? `Unexpected ApexGuru status: ${request.status ?? "unknown"}`,
    );
  }

  const payload = await pollApexGuru(session, request.requestId, deadline, totalTimeout);
  const rawViolations = JSON.parse(Buffer.from(payload.report, "base64").toString("utf8")) as Array<
    Omit<CodeAnalyzerViolation, "engine"> & { resources?: string[]; tags?: string[] }
  >;
  const violations: CodeAnalyzerViolation[] = rawViolations.map((violation) => ({
    ...violation,
    engine: "apexguru",
    tags: violation.tags ?? [],
    locations: violation.locations.map((loc) => ({ ...loc, file })),
    fixes: violation.fixes?.map((fix) => ({ ...fix, location: { ...fix.location, file } })),
    suggestions: violation.suggestions?.map((suggestion) => ({
      ...suggestion,
      location: { ...suggestion.location, file },
    })),
  }));
  const run: CodeAnalyzerRunJson = {
    runDir: input.cwd,
    violationCounts: buildViolationCounts(violations),
    versions: { apexguru: "org-service" },
    violations,
  };
  if (input.reportFile) {
    writeFileSync(input.reportFile, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }
  return {
    kind: "run",
    ok: true,
    source: "apexguru",
    command: `ApexGuru ${file}`,
    durationMs: Date.now() - started,
    reportFile: input.reportFile,
    outputFiles: input.reportFile ? [input.reportFile] : undefined,
    targets: [file],
    selectors: ["apexguru"],
    exitCode: 0,
    run,
  };
}

export async function validateApexGuru(
  targetOrg?: string,
  cwd = process.cwd(),
  timeoutMs = DEFAULT_APEXGURU_TIMEOUT_MS,
): Promise<{
  access: string;
  message: string;
  orgId?: string;
  userId?: string;
  instanceUrl?: string;
  apiVersion?: string;
  targetOrg?: string;
}> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => remainingTime(deadline, timeoutMs);
  const session = await connectSalesforce({ cwd, targetOrg, timeoutMs: remaining() });
  const response = await session.request<{ status?: string; message?: string }>({
    method: "GET",
    path: "/apexguru/validate",
    timeoutMs: remaining(),
  });
  if (response.status >= 400)
    throw new Error(`ApexGuru validation failed HTTP ${response.status}.`);
  const status = response.body.status?.toLowerCase() ?? "unknown";
  const identity = await session.identity({ timeoutMs: remaining() }).catch(() => undefined);
  return {
    access: status === "success" ? "enabled" : status === "failed" ? "eligible" : "ineligible",
    message:
      response.body.message ??
      (status === "success" ? "ApexGuru access is enabled." : `ApexGuru status: ${status}`),
    orgId: identity?.org_id,
    userId: identity?.user_id,
    instanceUrl: session.target.instanceUrl,
    apiVersion: session.target.apiVersion,
    targetOrg,
  };
}

async function pollApexGuru(
  session: SalesforceSession,
  requestId: string,
  deadline: number,
  totalTimeout: number,
): Promise<{ report: string }> {
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    const remaining = remainingTime(deadline, totalTimeout);
    const response = await session.request<{ status?: string; report?: string; message?: string }>({
      method: "GET",
      path: `/apexguru/request/${encodeURIComponent(requestId)}`,
      timeoutMs: remaining,
    });
    if (response.status >= 400) throw new Error(`ApexGuru poll failed HTTP ${response.status}.`);
    const status = response.body.status?.toLowerCase();
    lastStatus = status ?? "unknown";
    if (status === "success" && response.body.report) return { report: response.body.report };
    if (status === "failed" || status === "error") {
      throw new Error(response.body.message ?? `ApexGuru ${status}`);
    }
    const sleepMs = Math.min(POLL_INTERVAL_MS, deadline - Date.now());
    if (sleepMs > 0) await new Promise((resolve) => setTimeout(resolve, sleepMs));
  }
  throw new Error(
    `ApexGuru timed out after ${Math.round(totalTimeout / 1000)}s. Last status: ${lastStatus}`,
  );
}

function remainingTime(deadline: number, totalTimeout: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(`ApexGuru timed out after ${Math.round(totalTimeout / 1000)}s.`);
  }
  return remaining;
}

function buildViolationCounts(
  violations: CodeAnalyzerViolation[],
): NonNullable<CodeAnalyzerRunJson["violationCounts"]> {
  const counts = { total: violations.length, sev1: 0, sev2: 0, sev3: 0, sev4: 0, sev5: 0 };
  for (const violation of violations) {
    const key = `sev${violation.severity}` as keyof typeof counts;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}
