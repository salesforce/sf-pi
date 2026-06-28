/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { flattenRecords, toCsv } from "../lib/flattener.ts";

describe("sf-soql flattener", () => {
  it("flattens child-to-parent relationship objects", () => {
    const out = flattenRecords([{ Id: "003", Account: { Id: "001", Name: "Acme" } }]);
    expect(out.columns).toEqual(["Id", "Account.Id", "Account.Name"]);
    expect(out.rows[0]).toMatchObject({ Id: "003", "Account.Id": "001", "Account.Name": "Acme" });
  });

  it("stacks subquery rows without cross-product expansion", () => {
    const out = flattenRecords([
      {
        Id: "001",
        Contacts: {
          totalSize: 2,
          done: true,
          records: [
            { Id: "003A", Email: "a@example.com" },
            { Id: "003B", Email: "b@example.com" },
          ],
        },
      },
    ]);
    expect(out.columns).toEqual(["Id", "Contacts.Id", "Contacts.Email"]);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ Id: "001", "Contacts.Id": "003A" });
    expect(out.rows[1]).toMatchObject({ "Contacts.Id": "003B" });
  });

  it("exports flattened CSV", () => {
    const out = flattenRecords([{ Id: "001", Name: "A, B" }]);
    expect(toCsv(out)).toBe('Id,Name\n001,"A, B"');
  });
});
