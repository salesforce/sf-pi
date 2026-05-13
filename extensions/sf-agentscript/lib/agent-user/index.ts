/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public surface of the agent-user module.
 *
 * Read primitives + the quick `checkAgentUserStatus` summary land here in
 * PR1. Diagnose (PR2) and provision (PR3) layer on top without changing
 * what's already exported.
 *
 * Doc: skills/sf-ai-agentscript/references/agent-user-setup.md.
 */

export { getDigitalAgentLicense, type DigitalAgentLicenseCheck } from "./license.ts";
export {
  findEinsteinAgentUsers,
  findUserByUsername,
  getEinsteinAgentUserProfileId,
  type AgentUserRow,
} from "./users.ts";
export {
  listPermissionSetAssignments,
  findPermissionSetByName,
  listClassAccessForUser,
  SYSTEM_AGENT_PS_NAME,
  type PermissionSetAssignmentRow,
  type ClassAccessRow,
} from "./permset.ts";
export { checkAgentUserStatus, type AgentUserStatus, type AgentUserStatusInput } from "./status.ts";
export {
  readAgentConfigSlice,
  readAgentConfigSliceFromSource,
  type AgentConfigSlice,
  type AgentConfigSliceFailure,
} from "./agent-config.ts";
export {
  runDiagnose,
  type DiagnoseReport,
  type DiagnoseCheck,
  type DiagnoseCheckId,
  type DiagnoseApexAction,
  type DiagnoseStatus,
  type RunDiagnoseInput,
} from "./diagnose.ts";
export {
  runProvision,
  type ProvisionReport,
  type ProvisionStep,
  type ProvisionStepId,
  type ProvisionStepAction,
  type RunProvisionInput,
} from "./provision.ts";
export { synthesizeCustomPS, type SynthesizeCustomPSResult } from "./custom-ps.ts";
export { createAgentUser, type CreateAgentUserInput, type CreateAgentUserResult } from "./users.ts";
export {
  assignPermissionSet,
  type AssignPermissionSetInput,
  type AssignPermissionSetResult,
} from "./permset.ts";
export {
  deployPermissionSet,
  type DeployPermissionSetInput,
  type DeployPermissionSetResult,
} from "./deploy.ts";
