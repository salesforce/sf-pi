/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  normalizeCoreQueryResult,
  normalizeCoreSearchResult,
  normalizeData360SqlResult,
} from "../lib/result-normalize.ts";

describe("result normalization", () => {
  it("normalizes SOQL records and strips attributes from table rows", () => {
    const result = normalizeCoreQueryResult(
      {
        totalSize: 1,
        done: true,
        records: [{ attributes: { type: "Account" }, Id: "001", Name: "Acme" }],
      },
      { query: "SELECT Id, Name FROM Account LIMIT 1", targetOrg: "my-org", apiVersion: "66.0" },
    );

    expect(result.columns).toEqual(["Id", "Name"]);
    expect(result.rows).toEqual([{ Id: "001", Name: "Acme" }]);
    expect(result.totalReturned).toBe(1);
  });

  it("normalizes SOSL records with _object", () => {
    const result = normalizeCoreSearchResult(
      [{ attributes: { type: "Contact" }, Id: "003", Name: "Ada" }],
      { query: "FIND {Ada}", targetOrg: "my-org" },
    );

    expect(result.columns[0]).toBe("_object");
    expect(result.rows[0]).toMatchObject({ _object: "Contact", Id: "003", Name: "Ada" });
  });

  it("normalizes REST /search envelope shape", () => {
    const result = normalizeCoreSearchResult(
      {
        searchRecords: [{ attributes: { type: "Account" }, Id: "001", Name: "Acme" }],
      },
      { query: "FIND {Acme}", targetOrg: "my-org" },
    );

    expect(result.rows).toEqual([{ _object: "Account", Id: "001", Name: "Acme" }]);
    expect(result.totalReturned).toBe(1);
  });

  it("normalizes Data 360 array rows", () => {
    const result = normalizeData360SqlResult(
      {
        metadata: [{ name: "id" }, { name: "name" }],
        data: [["1", "Ada"]],
        returnedRows: 1,
      },
      { query: "SELECT id, name FROM x LIMIT 1", targetOrg: "my-org" },
    );

    expect(result.columns).toEqual(["id", "name"]);
    expect(result.rows).toEqual([{ id: "1", name: "Ada" }]);
  });
});
