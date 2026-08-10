/* SPDX-License-Identifier: Apache-2.0 */
/** Proof that Agent Script bounded transport delegates registered shared connections. */

import { describe, expect, test, vi } from "vitest";

const sessionForConnectionMock = vi.fn();
const lowLevelRequestMock = vi.fn();
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  salesforceSessionForConnection: (connection: unknown) => sessionForConnectionMock(connection),
  requestWithSalesforceConnection: (...args: unknown[]) => lowLevelRequestMock(...args),
}));

import { boundedRestRequest, boundedSoqlQuery } from "../lib/bounded-salesforce-transport.ts";

describe("Agent Script shared bounded transport", () => {
  test("delegates REST and SOQL through the registered SalesforceSession", async () => {
    const connection = {};
    const request = vi.fn(async () => ({
      status: 200,
      body: { ok: true },
      path: "/services/data/v67.0/limits",
      target: {},
      warnings: [],
    }));
    const query = vi.fn(async () => ({
      records: [{ Id: "001" }],
      totalSize: 1,
      done: true,
      truncated: false,
      target: {},
    }));
    sessionForConnectionMock.mockReturnValue({ request, continueRequest: vi.fn(), query });

    const rest = await boundedRestRequest<{ ok: boolean }>(connection as never, "/limits", "GET");
    const soql = await boundedSoqlQuery<{ Id: string }>(
      connection as never,
      "SELECT Id FROM Account",
    );

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/limits" }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ api: "rest", soql: "SELECT Id FROM Account" }),
    );
    expect(rest).toMatchObject({ ok: true, body: { ok: true } });
    expect(soql).toMatchObject({ ok: true, records: [{ Id: "001" }], totalSize: 1 });
    expect(lowLevelRequestMock).not.toHaveBeenCalled();
  });
});
