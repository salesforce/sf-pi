/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `apex://X` and `apexRest://X`.
 *
 * Both schemes resolve against the same `ApexClass.Name` row in the
 * Tooling API. `apex://` expects the class to expose an
 * `@InvocableMethod`; `apexRest://` expects an `@RestResource`. We
 * don't inspect the class body to differentiate — the runtime fails
 * with a clear error if the wrong annotation is used, and that's a
 * concern beyond pre-flight scope. Both schemes share one resolver so
 * the registry stays small.
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const apexResolver: TargetResolver = {
  schemes: ["apex", "apexRest"],
  metadataLabel: "ApexClass",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(conn, "/tooling/query", "ApexClass", "Name", names);
  },
  fixHint(name) {
    return `sf project deploy start -m ApexClass:${name}`;
  },
};
