/* SPDX-License-Identifier: Apache-2.0 */
/** Salesforce adapter: package install completion against a fake sf-conn session. */
import { describe, expect, it } from "vitest";
import type { SalesforceSession } from "../../../lib/common/sf-conn/index.ts";
import { createFinSalesforceOrg } from "../lib/salesforce/org.ts";

const VERSION = "04t000000000001AAA";
const REQUEST = "0Hf000000000001AAA";

interface FakeOptions {
  /** HTTP result for reading the PackageInstallRequest status. */
  statusRead: { status: number; body: unknown };
  /** Number of install-status polls after which the package shows as installed. */
  installedAfterPolls?: number;
}

function fakeSession(options: FakeOptions) {
  let polls = 0;
  const calls: string[] = [];
  const session = {
    target: { orgId: "00D000000000001AAA", orgType: "developer", apiVersion: "68.0" },
    async request(input: { method: string; path: string }) {
      calls.push(`${input.method} ${input.path}`);
      if (input.method === "POST") return { status: 201, body: { id: REQUEST, success: true } };
      polls += 1;
      return options.statusRead;
    },
    async query(input: { soql: string }) {
      calls.push(`QUERY ${input.soql.slice(0, 40)}`);
      const installed =
        options.installedAfterPolls !== undefined && polls >= options.installedAfterPolls;
      return {
        records: installed
          ? [
              {
                SubscriberPackageVersionId: VERSION,
                SubscriberPackage: { NamespacePrefix: "finai" },
              },
            ]
          : [],
        done: true,
        truncated: false,
      };
    },
  };
  return { session: session as unknown as SalesforceSession, calls, polls: () => polls };
}

const FAST = { installPollMs: 1, installTimeoutMs: 200 };

describe("installPackage completion", () => {
  it("succeeds once the package is installed even when the install request cannot be read", async () => {
    const fake = fakeSession({
      statusRead: { status: 400, body: [{ errorCode: "INVALID_CROSS_REFERENCE_KEY" }] },
      installedAfterPolls: 2,
    });
    const org = createFinSalesforceOrg(fake.session, FAST);
    const result = await org.installPackage({ versionId: VERSION, enableRss: false });
    expect(result).toMatchObject({ ok: true, requestId: REQUEST, status: "Success", errors: [] });
    expect(fake.polls()).toBe(2);
  });

  it("reports a readable install error without waiting for the timeout", async () => {
    const fake = fakeSession({
      statusRead: {
        status: 200,
        body: { Status: "Error", Errors: { errors: [{ message: "Name conflict" }] } },
      },
    });
    const org = createFinSalesforceOrg(fake.session, FAST);
    const result = await org.installPackage({ versionId: VERSION, enableRss: false });
    expect(result).toMatchObject({ ok: false, status: "Error", errors: ["Name conflict"] });
    expect(fake.polls()).toBe(1);
  });

  it("times out with the last unreadable status explained", async () => {
    const fake = fakeSession({
      statusRead: { status: 400, body: [{ errorCode: "INVALID_CROSS_REFERENCE_KEY" }] },
    });
    const org = createFinSalesforceOrg(fake.session, { installPollMs: 1, installTimeoutMs: 20 });
    const result = await org.installPackage({ versionId: VERSION, enableRss: false });
    expect(result.ok).toBe(false);
    expect(result.status).toBe("InProgress");
    expect(result.errors.join(" ")).toContain("INVALID_CROSS_REFERENCE_KEY");
  });
});
