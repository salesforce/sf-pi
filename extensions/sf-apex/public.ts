/* SPDX-License-Identifier: Apache-2.0 */
/** Apex's programmatic boundary. Importing it does not load Pi or start services. */
export { executeApex, type ApexExecutionContext } from "./lib/execute.ts";
export { Params as apexToolSchema, apexActions } from "./lib/schema.ts";
export {
  createApexArtifactWriter,
  type ApexArtifactWriter,
  type ApexArtifactWriterOptions,
} from "./lib/artifact-writer.ts";
export type { ApexDiagnosticsProvider } from "./lib/diagnostic-result.ts";
export {
  createApexDiagnosticsClient,
  type ApexDiagnosticsClient,
  type ApexDiagnosticsClientOptions,
} from "./lib/diagnostics-client.ts";
export {
  apexInputSchema,
  apexInputSchemas,
  apexDetailsSchemas,
  type ApexInput,
  type ApexDetails,
} from "./lib/contracts.ts";
export type {
  SfApexAction as ApexAction,
  SfApexParams as ApexToolInput,
  SfApexSessionState as ApexSessionState,
  ApexArtifact,
} from "./lib/types.ts";
export {
  callApex,
  invokeApex,
  createApexClient,
  type ApexClient,
  type ApexCallOptions,
  type ApexClientOptions,
  type ApexToolResult,
  type ApexCallResult,
  type ApexCallErrorCode,
} from "./lib/client.ts";
