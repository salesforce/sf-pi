/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `quickAction://X` — Salesforce QuickAction.
 *
 * Resolves against `QuickActionDefinition.DeveloperName` via the Tooling
 * API. QuickActions are usually scoped to an sObject (Account, Case)
 * but the DeveloperName is unique within the org so we can verify
 * presence without knowing the parent type.
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const quickActionResolver: TargetResolver = {
  schemes: ["quickAction"],
  metadataLabel: "QuickAction",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(conn, "/tooling/query", "QuickActionDefinition", "DeveloperName", names);
  },
  fixHint(name) {
    return `sf project deploy start -m QuickAction:${name}`;
  },
};
