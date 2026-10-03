/* SPDX-License-Identifier: Apache-2.0 */
/** Safe Salesforce Setup navigation targets for completed External Client Apps. */

import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { salesforce15CharId } from "../../../lib/common/salesforce-id.ts";
import type { EcaInspection } from "./types.ts";

const ECA_MANAGER_PATH = "/lightning/setup/ManageExternalClientApplication/home";

export interface EcaSetupNavigation {
  path: string;
  url: string;
  setup: "external-client-apps";
  route: { type: "external-client-app"; appName: string };
}

export function buildEcaSetupNavigation(
  session: SalesforceSession,
  inspection: Pick<EcaInspection, "app_name" | "record_id">,
): EcaSetupNavigation {
  const path = inspection.record_id
    ? `/lightning/setup/ManageExternalClientApplication/${salesforce15CharId(inspection.record_id)}/detail`
    : ECA_MANAGER_PATH;
  return {
    path,
    url: `${session.target.instanceUrl.replace(/\/$/u, "")}${path}`,
    setup: "external-client-apps",
    route: { type: "external-client-app", appName: inspection.app_name },
  };
}
