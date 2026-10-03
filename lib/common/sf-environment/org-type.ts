/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce org-type inference from authenticated facts and trusted instance URLs. */

import type { OrgType } from "./types.ts";

export interface OrgTypeSignals {
  isScratch?: boolean;
  isSandbox?: boolean;
  isDevHub?: boolean;
  devHubUsername?: string;
  expirationDate?: string | null;
  instanceUrl?: string;
  trailExpirationDate?: string | null;
  orgEdition?: string;
}

export function inferSalesforceOrgType(info: OrgTypeSignals): OrgType {
  if (info.isScratch || present(info.devHubUsername) || present(info.expirationDate)) {
    return "scratch";
  }
  if (info.isSandbox) return "sandbox";

  const urlType = inferNonProductionOrgTypeFromUrl(info.instanceUrl);
  if (urlType === "sandbox" || urlType === "scratch") return urlType;

  // Dev Hub is an explicit production-risk signal even when enabled in a
  // Developer Edition org whose hostname otherwise looks non-production.
  if (info.isDevHub) return "production";

  const edition = info.orgEdition?.trim().toLowerCase();
  if (present(info.trailExpirationDate) || edition?.includes("trial")) return "trial";
  if (urlType === "developer" || edition?.includes("developer")) return "developer";
  if (edition?.includes("sandbox")) return "sandbox";
  if (edition?.includes("scratch")) return "scratch";

  // Authenticated Organization metadata with an explicit non-sandbox edition
  // is sufficient to distinguish ordinary production orgs from Unknown Org.
  if (info.isSandbox === false && edition) return "production";
  return "unknown";
}

export function inferNonProductionOrgTypeFromUrl(
  urlValue: string | undefined,
): Extract<OrgType, "sandbox" | "scratch" | "developer"> | undefined {
  const hostname = trustedSalesforceHostname(urlValue);
  if (!hostname) return undefined;
  const labels = hostname.split(".");
  if (labels.includes("sandbox")) return "sandbox";
  if (labels.includes("scratch")) return "scratch";
  if (labels.includes("develop")) return "developer";
  return undefined;
}

/** Stable tenant key across my.salesforce.com, lightning.force.com, and Setup hosts. */
export function salesforceOrgHostKey(urlValue: string | undefined): string | undefined {
  const hostname = trustedSalesforceHostname(urlValue);
  if (!hostname) return undefined;
  for (const suffix of [
    ".my.salesforce-setup.com",
    ".my.salesforce.com",
    ".lightning.force.com",
    ".salesforce.com",
  ]) {
    if (hostname.endsWith(suffix)) return hostname.slice(0, -suffix.length);
  }
  return undefined;
}

function trustedSalesforceHostname(urlValue: string | undefined): string | undefined {
  if (!urlValue) return undefined;
  try {
    const url = new URL(urlValue);
    if (url.protocol !== "https:") return undefined;
    const hostname = url.hostname.toLowerCase();
    return salesforceOrgHostKeyFromHostname(hostname) ? hostname : undefined;
  } catch {
    return undefined;
  }
}

function salesforceOrgHostKeyFromHostname(hostname: string): string | undefined {
  for (const suffix of [
    ".my.salesforce-setup.com",
    ".my.salesforce.com",
    ".lightning.force.com",
    ".salesforce.com",
  ]) {
    if (hostname.endsWith(suffix) && hostname.length > suffix.length) {
      return hostname.slice(0, -suffix.length);
    }
  }
  return undefined;
}

function present(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
