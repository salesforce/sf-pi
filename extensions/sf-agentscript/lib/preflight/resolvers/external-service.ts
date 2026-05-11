/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Resolver for `externalService://X` — External Service registration.
 *
 * Resolves against `ExternalServiceRegistration.DeveloperName` via the
 * Tooling API. External Services expose an OpenAPI spec to the agent
 * runtime; missing here means the spec wasn't deployed.
 */

import type { Connection } from "@salesforce/core";
import { safeNamesQuery } from "../soql.ts";
import type { TargetResolver } from "../types.ts";

export const externalServiceResolver: TargetResolver = {
  schemes: ["externalService"],
  metadataLabel: "ExternalServiceRegistration",
  resolve(conn: Connection, names: readonly string[]) {
    return safeNamesQuery(
      conn,
      "/tooling/query",
      "ExternalServiceRegistration",
      "DeveloperName",
      names,
    );
  },
  fixHint(name) {
    return `sf project deploy start -m ExternalServiceRegistration:${name}`;
  },
};
