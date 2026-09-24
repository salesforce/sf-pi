/* SPDX-License-Identifier: Apache-2.0 */
/** API-native Apex lifecycle operation exports. */

export { authorPlan } from "./author.ts";
export { diagnoseFile, diagnoseApexFile, isApexFile, resolveToolPath } from "./diagnostics.ts";
export { normalizeCoverageRows } from "./coverage.ts";
export { parseSourceTarget } from "./source.ts";
export { apexSearch, orgPreflight, testDiscover, testPlan } from "./discovery.ts";

export { classifyAnonymousApex } from "./anonymous.ts";

export { normalizeReportFormats, summarizeTestResults } from "./tests.ts";
export { startTrace, status, stopTrace, traceStatus } from "./trace.ts";

// Native compatibility exports preserve the existing helper signatures.
import type { ApexConnection } from "./api.ts";
import type { SfApexParams, SfApexSessionState } from "./types.ts";
import { nativeApexArtifacts } from "./artifacts.ts";
import * as logs from "./logs.ts";
import * as tests from "./tests.ts";
import * as coverage from "./coverage.ts";
import * as source from "./source.ts";
import * as suites from "./suites.ts";
import * as anonymous from "./anonymous.ts";
export const analyzeLog = (params: SfApexParams) => logs.analyzeLog(params, nativeApexArtifacts);
export const getLog = (conn: ApexConnection, params: SfApexParams, state?: SfApexSessionState) =>
  logs.getLog(conn, params, state, nativeApexArtifacts);
export const latestLog = (conn: ApexConnection, params: SfApexParams, state?: SfApexSessionState) =>
  logs.latestLog(conn, params, state, nativeApexArtifacts);
export const watchLog = (conn: ApexConnection, params: SfApexParams, state?: SfApexSessionState) =>
  logs.watchLog(conn, params, state, nativeApexArtifacts);
export const runTest = (conn: ApexConnection, params: SfApexParams, state?: SfApexSessionState) =>
  tests.runTest(conn, params, state, nativeApexArtifacts);
export const testResult = (
  conn: ApexConnection,
  params: SfApexParams,
  state?: SfApexSessionState,
) => tests.testResult(conn, params, state, nativeApexArtifacts);
export const rerunTest = (conn: ApexConnection, params: SfApexParams, state: SfApexSessionState) =>
  tests.rerunTest(conn, params, state, nativeApexArtifacts);
export const coverageSummary = (conn: ApexConnection, params: SfApexParams) =>
  coverage.coverageSummary(conn, params, nativeApexArtifacts);
export const getApexSource = (conn: ApexConnection, params: SfApexParams) =>
  source.getApexSource(conn, params, nativeApexArtifacts);
export const testSuites = (conn: ApexConnection, params: SfApexParams) =>
  suites.testSuites(conn, params, nativeApexArtifacts);
export const runAnonymous = (conn: ApexConnection, params: SfApexParams) =>
  anonymous.runAnonymous(conn, params, nativeApexArtifacts);
