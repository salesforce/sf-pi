/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { extractStaticSoqlQueries } from "../lib/apex-query-extractor.ts";

describe("sf-soql Apex query extraction", () => {
  it("extracts multiple static bracket queries with source locations", () => {
    const source = `public class Example {
  void run() {
    List<Account> accounts = [SELECT Id, Name FROM Account LIMIT 1];
    List<Contact> contacts = [SELECT Id FROM Contact LIMIT 1];
  }
}`;

    expect(extractStaticSoqlQueries(source)).toEqual([
      expect.objectContaining({
        query: "SELECT Id, Name FROM Account LIMIT 1",
        line: 3,
        column: 31,
      }),
      expect.objectContaining({
        query: "SELECT Id FROM Contact LIMIT 1",
        line: 4,
        column: 31,
      }),
    ]);
  });

  it("does not terminate at brackets inside SOQL string literals", () => {
    const source = `List<Account> rows = [
      SELECT Id FROM Account WHERE Name = 'A]B' LIMIT 1
    ];`;

    expect(extractStaticSoqlQueries(source)[0]?.query).toContain("Name = 'A]B' LIMIT 1");
  });

  it("balances brackets inside Apex bind expressions", () => {
    const source = `List<Account> rows = [
      SELECT Id FROM Account WHERE Id IN :idsByType['Account'] LIMIT 1
    ];`;

    expect(extractStaticSoqlQueries(source)[0]?.query).toContain(
      "Id IN :idsByType['Account'] LIMIT 1",
    );
  });

  it("ignores bracket-like text in Apex comments and strings", () => {
    const source = `
      // [SELECT Id FROM Account]
      String queryText = '[SELECT Id FROM Contact]';
      List<Account> rows = [SELECT Id FROM Account LIMIT 1];
    `;

    expect(extractStaticSoqlQueries(source).map((query) => query.query)).toEqual([
      "SELECT Id FROM Account LIMIT 1",
    ]);
  });

  it("extracts constant Database.query string expressions", () => {
    const source = `
      List<SObject> first = Database.query('SELECT Id, Name ' +
        'FROM Account WHERE Name = \\'A]B\\' LIMIT 1');
      Integer count = Database.countQuery('SELECT COUNT() FROM Contact');
      List<SObject> bound = Database.queryWithBinds(
        'SELECT Id FROM Account WHERE Name = :name LIMIT 1',
        new Map<String, Object>{'name' => 'Acme'}
      );
      Database.QueryLocator locator = Database.getQueryLocator(
        ('SELECT Id FROM Opportunity ') + ('LIMIT 1')
      );
    `;

    expect(extractStaticSoqlQueries(source).map((query) => query.query)).toEqual([
      "SELECT Id, Name FROM Account WHERE Name = 'A]B' LIMIT 1",
      "SELECT COUNT() FROM Contact",
      "SELECT Id FROM Account WHERE Name = :name LIMIT 1",
      "SELECT Id FROM Opportunity LIMIT 1",
    ]);
  });

  it("does not guess Database.query expressions that depend on variables", () => {
    const source = `
      String fields = 'Id, Name';
      Database.query('SELECT ' + fields + ' FROM Account');
    `;

    expect(extractStaticSoqlQueries(source)).toEqual([]);
  });
});
