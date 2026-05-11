/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `generatePromptResponse://X` — Prompt Template invocation.
 *
 * Resolves against `Prompt.DeveloperName` via the Tooling API.
 * (`Prompt` is the Tooling sObject; `GenAiPromptTemplate` is sometimes
 * mentioned in docs but isn't exposed as a queryable Tooling type —
 * verified live against AgentforceSTDM.)
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const promptTemplateResolver: TargetResolver = {
  schemes: ["generatePromptResponse"],
  metadataLabel: "Prompt Template",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(conn, "/tooling/query", "Prompt", "DeveloperName", names);
  },
  fixHint(name) {
    return `sf project deploy start -m GenAiPromptTemplate:${name}`;
  },
};
