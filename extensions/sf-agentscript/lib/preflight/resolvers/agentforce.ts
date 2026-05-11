/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `agentforce://X` — connected agent / sub-agent reference.
 *
 * Resolves against `BotDefinition.DeveloperName` via the data API. A
 * connected-agent reference points at another published agent in the
 * same org; pre-flight catches typos and unpublished agents BEFORE the
 * publish round-trip would 500.
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const agentforceResolver: TargetResolver = {
  schemes: ["agentforce"],
  metadataLabel: "Connected Agent (BotDefinition)",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(conn, "/query", "BotDefinition", "DeveloperName", names);
  },
  fixHint(name) {
    return `Publish the connected agent first: agentscript_lifecycle action='publish' for the agent named '${name}'.`;
  },
};
