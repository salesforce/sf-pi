/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Fresh synthetic queries that preserve recurring historical failure categories.
 * They intentionally contain no copied org names, ids, literals, or private session text.
 */

export interface HistoricalQueryRegression {
  name: string;
  query: string;
  expected: "pass" | "fail";
  expectedMessage?: string;
}

export const HISTORICAL_QUERY_REGRESSIONS: HistoricalQueryRegression[] = [
  {
    name: "multi-level parent relationship",
    query: "SELECT Id, Root__r.Owner.Name FROM Child__c LIMIT 1",
    expected: "pass",
  },
  {
    name: "guessed top-level field",
    query: "SELECT Id, Guessed_Field__c FROM Root__c LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Field__c does not exist on Root__c",
  },
  {
    name: "missing child-subquery filter field",
    query:
      "SELECT Id, (SELECT Id FROM Children__r WHERE Guessed_Filter__c = true LIMIT 2) FROM Root__c LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Filter__c does not exist on Child__c",
  },
  {
    name: "missing semi-join inner field",
    query:
      "SELECT Id FROM Root__c WHERE Id IN (SELECT Root__c FROM Child__c WHERE Guessed_Filter__c = true) LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Filter__c does not exist on Child__c",
  },
  {
    name: "missing TYPEOF WHEN field",
    query:
      "SELECT Id, TYPEOF What WHEN Root__c THEN Guessed_Field__c ELSE Name END FROM Activity__c LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Field__c does not exist on Root__c",
  },
  {
    name: "function combined with TYPEOF",
    query:
      "SELECT Id, TYPEOF What WHEN Root__c THEN FORMAT(CreatedDate) ELSE Name END FROM Activity__c LIMIT 1",
    expected: "fail",
    expectedMessage: "TYPEOF cannot be combined with functions in the SELECT clause",
  },
  {
    name: "missing TYPEOF ELSE Name field",
    query:
      "SELECT Id, TYPEOF What WHEN Root__c THEN Name ELSE Guessed_Name_Field__c END FROM Activity__c LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Name_Field__c does not exist on Name",
  },
  {
    name: "missing date-function field",
    query: "SELECT Id FROM Root__c WHERE CALENDAR_YEAR(Guessed_Date__c) = 2026 LIMIT 1",
    expected: "fail",
    expectedMessage: "Guessed_Date__c does not exist on Root__c",
  },
  {
    name: "DISTANCE on a non-geolocation field",
    query: "SELECT Id FROM Root__c WHERE DISTANCE(Name, GEOLOCATION(1.0, 2.0), 'mi') < 10 LIMIT 1",
    expected: "fail",
    expectedMessage: "DISTANCE requires a geolocation field",
  },
];
