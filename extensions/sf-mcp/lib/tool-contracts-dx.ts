/* SPDX-License-Identifier: Apache-2.0 */
/** Official GA tools from the configured Salesforce DX core toolsets. */
import { defineTools } from "./tool-contract-types.ts";

export const SALESFORCE_DX_TOOLS = defineTools([
  [
    "get_username",
    "Determine the appropriate Salesforce username or alias, including defaults and Dev Hubs.",
    "Org identity",
    "read",
  ],
  [
    "resume_tool_operation",
    "Resume a long-running operation that another Salesforce DX MCP tool did not complete.",
    "Operation lifecycle",
    "mixed",
  ],
  ["list_all_orgs", "List all configured Salesforce orgs.", "Org discovery", "read"],
  ["run_soql_query", "Run a SOQL query against a Salesforce org.", "Record query", "read"],
  [
    "assign_permission_set",
    "Assign a permission set to the current user or another user.",
    "User access management",
    "write",
  ],
  [
    "deploy_metadata",
    "Deploy metadata from the Salesforce DX project to an authorized org.",
    "Metadata deployment",
    "write",
  ],
  [
    "retrieve_metadata",
    "Retrieve metadata from an authorized org into the Salesforce DX project.",
    "Metadata retrieval",
    "write",
  ],
  [
    "run_agent_test",
    "Execute Agentforce agent tests in an authorized org.",
    "Agent testing",
    "mixed",
  ],
  ["run_apex_test", "Execute Apex tests in an authorized org.", "Apex testing", "mixed"],
]);
