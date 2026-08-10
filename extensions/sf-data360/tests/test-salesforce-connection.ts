/* SPDX-License-Identifier: Apache-2.0 */
/** Shared @salesforce/core Org double for Data 360 connection-module tests. */

import type { Mock } from "vitest";

export function createTestSalesforceOrg(
  requestMock: Mock,
  options: {
    alias?: string;
    apiVersion?: string;
    orgType?: "sandbox" | "scratch" | "developer" | "production";
  } = {},
) {
  const alias = options.alias ?? "AgentforceSTDM";
  let apiVersion = options.apiVersion ?? "50.0";
  const instanceUrl =
    options.orgType === "developer"
      ? "https://example-dev-ed.develop.my.salesforce.com"
      : "https://example.sandbox.my.salesforce.com";
  const connection = {
    instanceUrl,
    getApiVersion: () => apiVersion,
    setApiVersion: (version: string) => {
      apiVersion = version;
    },
    getAuthInfoFields: () => ({
      alias,
      username: `${alias.toLowerCase()}@example.invalid`,
      orgId: "00D000000000001AAA",
      instanceUrl,
      isSandbox: options.orgType !== "developer" && options.orgType !== "production",
      isScratch: options.orgType === "scratch",
      isDevHub: options.orgType === "production",
    }),
    request: async (request: { method?: string; url?: string; body?: unknown }) => {
      if (request.url?.replace(/\/$/, "").endsWith("/services/data")) {
        return [{ version: "65.0" }, { version: "67.0" }];
      }
      return requestMock(request);
    },
  };
  return { getConnection: () => connection };
}

export function testConfigAggregator() {
  return {
    getInfo: (key: string) => ({
      value: key === "target-org" ? "AgentforceSTDM" : undefined,
      location: "Global",
    }),
  };
}
