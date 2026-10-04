/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic navigation policy for local versus Salesforce-verified routes. */
import {
  isResolvedSalesforcePath,
  resolveSalesforcePath,
  type SalesforcePathResolverInput,
  type SalesforceRoute,
} from "./salesforce-path-resolver.ts";

export type NavigationResolution = "local" | "salesforce-verified";

export interface SalesforceNavigationPlan {
  path: string;
  resolution: NavigationResolution;
  route?: SalesforceRoute;
}

const VERIFIED_ROUTE_TYPES = new Set<SalesforceRoute["type"]>([
  "external-client-app",
  "list-view",
  "record-related-list",
]);

export function planSalesforceNavigation(
  input: SalesforcePathResolverInput,
): SalesforceNavigationPlan {
  const result = resolveSalesforcePath(input);
  if (!isResolvedSalesforcePath(result)) throw new Error(result.message);

  const route = routeFromInput(input);
  const requiresVerification = route ? VERIFIED_ROUTE_TYPES.has(route.type) : false;
  return {
    path: result.path,
    resolution: requiresVerification ? "salesforce-verified" : "local",
    ...(requiresVerification && route ? { route } : {}),
  };
}

export function routeFromInput(
  input: Pick<SalesforcePathResolverInput, "target" | "route">,
): SalesforceRoute | undefined {
  if (input.target && input.target.type !== "path") return input.target;
  return input.route;
}
