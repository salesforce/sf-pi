/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { validateObjectSpecificRules } from "../lib/object-validator.ts";
import { parseSoql } from "../lib/parser.ts";

const findings = (query: string) =>
  validateObjectSpecificRules(parseSoql(query, { apiVersion: 68, context: "api" }));

describe("sf-soql object-specific validation", () => {
  it.each([
    ["ContentDocumentLink", "SELECT Id FROM ContentDocumentLink LIMIT 1"],
    ["ContentHubItem", "SELECT Id FROM ContentHubItem LIMIT 1"],
    ["Vote", "SELECT Id FROM Vote LIMIT 1"],
  ])("blocks missing required filters on %s", (_objectName, query) => {
    expect(findings(query)).toEqual([expect.objectContaining({ severity: "error" })]);
  });

  it.each([
    "SELECT Id FROM ContentDocumentLink WHERE ContentDocumentId = '069000000000001AAA' LIMIT 1",
    "SELECT Id FROM ContentHubItem WHERE ContentHubRepositoryId = '0XC000000000001AAA' LIMIT 1",
    "SELECT Id FROM Vote WHERE Parent.Type = 'Question' LIMIT 1",
  ])("accepts a documented implementation filter: %s", (query) => {
    expect(findings(query)).toEqual([]);
  });

  it("warns for permission-dependent TopicAssignment and feed limits", () => {
    expect(findings("SELECT Id FROM TopicAssignment")).toEqual([
      expect.objectContaining({ severity: "warning", label: "TopicAssignment Scope" }),
    ]);
    expect(findings("SELECT Id FROM NewsFeed LIMIT 1001")).toEqual([
      expect.objectContaining({ severity: "warning", label: "Feed Limit" }),
    ]);
  });

  it("accepts documented safe limits for bounded objects", () => {
    expect(findings("SELECT Id FROM TopicAssignment LIMIT 1100")).toEqual([]);
    expect(findings("SELECT Id FROM UserRecordAccess LIMIT 200")).toEqual([]);
    expect(findings("SELECT Id FROM NewsFeed LIMIT 1000")).toEqual([]);
  });

  it("enforces UserRecordAccess ordering for selected access fields", () => {
    expect(findings("SELECT Id, MaxAccessLevel FROM UserRecordAccess LIMIT 200")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", label: "UserRecordAccess Order" }),
      ]),
    );
    expect(
      findings("SELECT Id, MaxAccessLevel FROM UserRecordAccess ORDER BY MaxAccessLevel LIMIT 200"),
    ).toEqual([]);
  });

  it("enforces feed-specific user and relationship-order constraints", () => {
    expect(findings("SELECT Id FROM UserProfileFeed LIMIT 1000")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", label: "UserProfileFeed User" }),
      ]),
    );
    expect(
      findings("SELECT Id FROM UserProfileFeed WITH UserId = '005000000000001AAA' LIMIT 1000"),
    ).toEqual([]);
    expect(findings("SELECT Id FROM NewsFeed ORDER BY Parent.Name LIMIT 1000")).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: "error", label: "Feed Order" })]),
    );
  });

  it("blocks unsupported custom-metadata shapes and warns for external-object shapes", () => {
    expect(findings("SELECT COUNT() FROM Example__mdt GROUP BY DeveloperName")).toEqual([
      expect.objectContaining({ severity: "error", label: "Custom Metadata Query" }),
    ]);
    expect(findings("SELECT Id, DeveloperName FROM Example__mdt LIMIT 10")).toEqual([]);
    expect(findings("SELECT COUNT() FROM Remote__x GROUP BY Status__c")).toEqual([
      expect.objectContaining({ severity: "warning", label: "External Object" }),
    ]);
  });
});
