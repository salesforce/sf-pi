/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `flow://X`.
 *
 * `FlowDefinitionView` is the canonical data-API sObject that exposes
 * the active version of every deployed Flow + ProcessBuilder. We query
 * it (not the Tooling API's `FlowDefinition`, which uses DeveloperName)
 * because invocable references resolve against the active version's
 * runtime ApiName.
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const flowResolver: TargetResolver = {
  schemes: ["flow"],
  metadataLabel: "Flow",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(conn, "/query", "FlowDefinitionView", "ApiName", names);
  },
  fixHint(name) {
    return `sf project deploy start -m Flow:${name}`;
  },
};
