/* SPDX-License-Identifier: Apache-2.0 */
/** API-native Apex lifecycle operation exports. */

export { authorPlan } from "./author.ts";
export { diagnoseFile, diagnoseApexFile, isApexFile, resolveToolPath } from "./diagnostics.ts";
export { apexSearch, coverageSummary, orgPreflight, testDiscover, testPlan } from "./discovery.ts";
export { analyzeLog, getLog, latestLog, watchLog } from "./logs.ts";
export { classifyAnonymousApex, runAnonymous } from "./anonymous.ts";
export { rerunTest, runTest, summarizeTestResults, testResult } from "./tests.ts";
export { startTrace, status, stopTrace, traceStatus } from "./trace.ts";
