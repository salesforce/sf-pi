/* SPDX-License-Identifier: Apache-2.0 */
/** One Apex dispatcher shared by native Pi and standalone SDK callers. */
import type {
  ConnectSalesforceOptions,
  SalesforceSession,
} from "../../../lib/common/sf-conn/index.ts";
import type { ApexArtifactWriter } from "./artifact-writer.ts";
import type { ApexDiagnosticsProvider } from "./diagnostic-result.ts";
import type { SfApexParams, SfApexSessionState, ToolResult } from "./types.ts";

export interface ApexExecutionContext {
  cwd: string;
  signal?: AbortSignal;
  state: SfApexSessionState;
  artifacts: ApexArtifactWriter;
  connect(options: ConnectSalesforceOptions): Promise<SalesforceSession>;
  diagnostics?: ApexDiagnosticsProvider;
}

const unavailableDiagnostics: ApexDiagnosticsProvider = async () => ({
  diagnostics: [],
  unavailable: {
    language: "apex",
    available: false,
    detail: "No Apex diagnostics provider was supplied.",
  },
});

/** Host adapters own authorization, state persistence, and operation-error translation. */
export async function executeApex(
  params: SfApexParams,
  ctx: ApexExecutionContext,
): Promise<ToolResult> {
  if (params.action === "author.plan") return (await import("./author.ts")).authorPlan(params);
  if (params.action === "diagnose.file")
    return (await import("./diagnostic-result.ts")).diagnoseFile(
      params,
      ctx.cwd,
      ctx.diagnostics ?? unavailableDiagnostics,
    );
  if (params.action === "log.analyze")
    return (await import("./logs.ts")).analyzeLog(params, ctx.artifacts);

  let conn: SalesforceSession;
  try {
    conn = await ctx.connect({ cwd: ctx.cwd, targetOrg: params.target_org, signal: ctx.signal });
  } catch (error) {
    return (await import("./errors.ts")).apexErrorResult(params, error);
  }
  switch (params.action) {
    case "status":
      return (await import("./trace.ts")).status(conn, params);
    case "org.preflight":
      return (await import("./discovery.ts")).orgPreflight(conn, params);
    case "apex.search":
      return (await import("./discovery.ts")).apexSearch(conn, params);
    case "test.discover":
      return (await import("./discovery.ts")).testDiscover(conn, params);
    case "test.plan":
      return (await import("./discovery.ts")).testPlan(conn, params);
    case "test.suites":
      return (await import("./suites.ts")).testSuites(conn, params, ctx.artifacts);
    case "coverage.summary":
      return (await import("./coverage.ts")).coverageSummary(conn, params, ctx.artifacts);
    case "apex.source.get":
      return (await import("./source.ts")).getApexSource(conn, params, ctx.artifacts);
    case "trace.start":
      return (await import("./trace.ts")).startTrace(conn, params, ctx.state);
    case "trace.stop":
      return (await import("./trace.ts")).stopTrace(conn, params, ctx.state);
    case "trace.status":
      return (await import("./trace.ts")).traceStatus(conn, params);
    case "log.latest":
      return (await import("./logs.ts")).latestLog(conn, params, ctx.state, ctx.artifacts);
    case "log.get":
      return (await import("./logs.ts")).getLog(conn, params, ctx.state, ctx.artifacts);
    case "log.watch":
      return (await import("./logs.ts")).watchLog(conn, params, ctx.state, ctx.artifacts);
    case "anon.run":
      return (await import("./anonymous.ts")).runAnonymous(conn, params, ctx.artifacts);
    case "test.run":
      return (await import("./tests.ts")).runTest(
        conn,
        params,
        ctx.state,
        ctx.artifacts,
        ctx.signal,
      );
    case "test.result":
      return (await import("./tests.ts")).testResult(conn, params, ctx.state, ctx.artifacts);
    case "test.rerun":
      return (await import("./tests.ts")).rerunTest(
        conn,
        params,
        ctx.state,
        ctx.artifacts,
        ctx.signal,
      );
    default:
      return {
        content: [{ type: "text", text: `Unsupported sf_apex action: ${params.action}` }],
        details: { ok: false, action: params.action },
      };
  }
}
