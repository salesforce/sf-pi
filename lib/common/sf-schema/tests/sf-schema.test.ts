/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";
import { SalesforceRequestError, type SalesforceSession } from "../../sf-conn/index.ts";
import {
  activePicklistValues,
  createSchemaCatalog,
  describeSObject,
  findSchemaField,
} from "../index.ts";

const target = { apiVersion: "68.0", alias: "dev", targetOrg: "dev" };

function session(handler: (path: string) => { status: number; body: unknown }) {
  const request = vi.fn(async (input: { path: string }) => ({
    ...handler(input.path),
    path: input.path,
    target,
  }));
  return { session: { target, request } as unknown as SalesforceSession, request };
}

describe("shared sObject schema", () => {
  it("describes through the REST or Tooling sobjects path", async () => {
    const { session: rest, request } = session(() => ({
      status: 200,
      body: { name: "Account", fields: [{ name: "Name" }] },
    }));
    await describeSObject(rest, "Account");
    await describeSObject(rest, "ApexClass", { mode: "tooling" });
    expect(request.mock.calls.map(([input]) => input.path)).toEqual([
      "/sobjects/Account/describe",
      "/tooling/sobjects/ApexClass/describe",
    ]);
  });

  it("throws SalesforceRequestError for HTTP failures", async () => {
    const { session: failing } = session(() => ({ status: 500, body: [] }));
    await expect(describeSObject(failing, "Account")).rejects.toBeInstanceOf(
      SalesforceRequestError,
    );
  });

  it("caches describes and resolves missing objects to undefined", async () => {
    const { session: catalogSession, request } = session((path) =>
      path.includes("Missing")
        ? { status: 404, body: [{ errorCode: "NOT_FOUND" }] }
        : { status: 200, body: { name: "Account", fields: [] } },
    );
    const catalog = createSchemaCatalog(catalogSession);
    await catalog.object("Account");
    await catalog.object("account");
    expect(await catalog.object("Missing__c")).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(catalog.calls).toBe(2);
  });

  it("finds fields case-insensitively and lists active picklist values", () => {
    const object = {
      name: "Product2",
      fields: [
        {
          name: "Family",
          picklistValues: [
            { active: true, value: "Hardware" },
            { active: false, value: "Legacy" },
          ],
        },
      ],
    };
    const field = findSchemaField(object, "family");
    expect(field?.name).toBe("Family");
    expect(activePicklistValues(field!)).toEqual(["Hardware"]);
  });
});
