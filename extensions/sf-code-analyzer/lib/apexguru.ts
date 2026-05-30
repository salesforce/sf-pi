/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit ApexGuru action support. */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import type {
  CodeAnalyzerReportSummary,
  CodeAnalyzerRunJson,
  CodeAnalyzerViolation,
} from "./types.ts";

const POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 60_000;

export async function runApexGuru(input: {
  file: string;
  cwd: string;
  target_org?: string;
  timeout_ms?: number;
  reportFile?: string;
}): Promise<CodeAnalyzerReportSummary> {
  const started = Date.now();
  const file = path.resolve(input.cwd, input.file);
  const conn = await connFromAlias(input.target_org);
  const apiVersion = getApiVersion(conn);
  const content = readFileSync(file, "utf8");
  const request = (await conn.request({
    method: "POST",
    url: `/services/data/v${apiVersion}/apexguru/request`,
    body: JSON.stringify({ classContent: Buffer.from(content).toString("base64") }),
  })) as { status?: string; requestId?: string; message?: string };
  if (request.status?.toLowerCase() !== "new" || !request.requestId) {
    throw new Error(request.message ?? `Unexpected ApexGuru response: ${JSON.stringify(request)}`);
  }

  const payload = await pollApexGuru(
    conn,
    apiVersion,
    request.requestId,
    input.timeout_ms ?? DEFAULT_TIMEOUT_MS,
  );
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
): Promise<{ access: string; message: string; orgId?: string; instanceUrl?: string }> {
  const conn = await connFromAlias(targetOrg);
  const apiVersion = getApiVersion(conn);
  const response = (await conn.request({
    method: "GET",
    url: `/services/data/v${apiVersion}/apexguru/validate`,
  })) as { status?: string; message?: string };
  const status = response.status?.toLowerCase() ?? "unknown";
  const identity = await conn
    .identity()
    .catch(() => undefined as { organization_id?: string } | undefined);
  return {
    access: status === "success" ? "enabled" : status === "failed" ? "eligible" : "ineligible",
    message:
      response.message ??
      (status === "success" ? "ApexGuru access is enabled." : `ApexGuru status: ${status}`),
    orgId: identity?.organization_id,
    instanceUrl: conn.instanceUrl,
  };
}

async function pollApexGuru(
  conn: Awaited<ReturnType<typeof connFromAlias>>,
  apiVersion: string,
  requestId: string,
  timeoutMs: number,
): Promise<{ report: string }> {
  const started = Date.now();
  let last: unknown;
  while (Date.now() - started < timeoutMs) {
    const response = (await conn.request({
      method: "GET",
      url: `/services/data/v${apiVersion}/apexguru/request/${requestId}`,
    })) as { status?: string; report?: string; message?: string };
    last = response;
    const status = response.status?.toLowerCase();
    if (status === "success" && response.report) return { report: response.report };
    if (status === "failed" || status === "error") {
      throw new Error(response.message ?? `ApexGuru ${status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(
    `ApexGuru timed out after ${Math.round(timeoutMs / 1000)}s. Last response: ${JSON.stringify(last)}`,
  );
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

function getApiVersion(conn: Awaited<ReturnType<typeof connFromAlias>>): string {
  return String((conn as unknown as { getApiVersion?: () => string }).getApiVersion?.() ?? "67.0");
}
