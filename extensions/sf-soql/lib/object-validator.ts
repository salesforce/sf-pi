/* SPDX-License-Identifier: Apache-2.0 */
/** Documented SOQL restrictions for standard objects with implementation-specific query shapes. */

import { finding } from "./digest.ts";
import type { SoqlFinding, SoqlQueryShape } from "./types.ts";

export function validateObjectSpecificRules(shape: SoqlQueryShape): SoqlFinding[] {
  const objectName = shape.primary_object?.toLowerCase();
  if (!objectName) return [];
  const fields = new Set((shape.where_fields ?? []).map((field) => field.toLowerCase()));

  switch (objectName) {
    case "contentdocumentlink":
      return requireFilter(
        fields,
        ["id", "contentdocumentid", "linkedentityid"],
        "ContentDocumentLink",
        "Id, ContentDocumentId, or LinkedEntityId",
      );
    case "contenthubitem":
      return requireFilter(
        fields,
        ["id", "externalid", "contenthubrepositoryid"],
        "ContentHubItem",
        "Id, ExternalId, or ContentHubRepositoryId",
      );
    case "vote":
      return requireFilter(
        fields,
        ["id", "parentid", "parent.type"],
        "Vote",
        "Id, ParentId, or Parent.Type",
      );
    case "topicassignment":
      if (shape.limit !== undefined && shape.limit <= 1_100) return [];
      if (fields.has("id") || fields.has("entity")) return [];
      return [
        finding(
          "warning",
          "⚠️",
          "TopicAssignment Scope",
          "TopicAssignment can require LIMIT 1100 or less, or an Id/Entity filter, when the user lacks View All Data.",
        ),
      ];
    case "userrecordaccess":
      return validateUserRecordAccess(shape);
    case "newsfeed":
      return validateFeed(shape, false);
    case "userprofilefeed":
      return validateFeed(shape, true);
    default:
      if (objectName.endsWith("__mdt")) return validateCustomMetadata(shape);
      if (objectName.endsWith("__x") && hasComplexShape(shape)) {
        return [
          finding(
            "warning",
            "⚠️",
            "External Object",
            "External-object support for aggregates, grouping, and relationship subqueries depends on the adapter.",
          ),
        ];
      }
      return [];
  }
}

function validateUserRecordAccess(shape: SoqlQueryShape): SoqlFinding[] {
  const findings: SoqlFinding[] = [];
  if (shape.limit === undefined || shape.limit > 200) {
    findings.push(
      finding(
        "warning",
        "⚠️",
        "UserRecordAccess Limit",
        "UserRecordAccess queries return at most 200 records; add LIMIT 200 or less.",
      ),
    );
  }
  const selected = new Set(
    (shape.selected_fields ?? [])
      .filter((field) => field.kind === "field" && field.field)
      .map((field) => field.field?.toLowerCase()),
  );
  const ordered = new Set((shape.order_by_fields ?? []).map((field) => field.toLowerCase()));
  for (const field of ["hasaccess", "maxaccesslevel"]) {
    if (!selected.has(field) || ordered.has(field)) continue;
    findings.push(
      finding(
        "error",
        "❌",
        "UserRecordAccess Order",
        `${field === "hasaccess" ? "HasAccess" : "MaxAccessLevel"} must also appear in ORDER BY when selected.`,
      ),
    );
  }
  return findings;
}

function validateFeed(shape: SoqlQueryShape, requireUser: boolean): SoqlFinding[] {
  const findings: SoqlFinding[] = [];
  if (shape.limit === undefined || shape.limit > 1_000) {
    findings.push(
      finding(
        "warning",
        "⚠️",
        "Feed Limit",
        `${shape.primary_object} can require LIMIT 1000 or less when the user lacks View All Data.`,
      ),
    );
  }
  if (shape.order_by_fields?.some((field) => field.includes("."))) {
    findings.push(
      finding(
        "error",
        "❌",
        "Feed Order",
        `${shape.primary_object} does not support ORDER BY on relationship fields.`,
      ),
    );
  }
  if (
    requireUser &&
    !/\bWITH\s+UserId\s*=\s*(?:'[^']+'|:[a-zA-Z_][\w.]*)/i.test(shape.normalized ?? "")
  ) {
    findings.push(
      finding(
        "error",
        "❌",
        "UserProfileFeed User",
        "UserProfileFeed requires WITH UserId = <userId>.",
      ),
    );
  }
  return findings;
}

function validateCustomMetadata(shape: SoqlQueryShape): SoqlFinding[] {
  if (!hasComplexShape(shape)) return [];
  return [
    finding(
      "error",
      "❌",
      "Custom Metadata Query",
      "Custom metadata SOQL does not support aggregate, GROUP BY, HAVING, or child-subquery query shapes.",
    ),
  ];
}

function hasComplexShape(shape: SoqlQueryShape): boolean {
  return Boolean(
    shape.aggregate_fields?.length ||
    shape.group_by_fields?.length ||
    shape.having_fields?.length ||
    shape.subqueries?.length ||
    shape.function_fields?.some(
      (reference) => reference.context === "group_by" || reference.context === "having",
    ),
  );
}

function requireFilter(
  actual: Set<string>,
  allowed: string[],
  objectName: string,
  description: string,
): SoqlFinding[] {
  if (allowed.some((field) => actual.has(field))) return [];
  return [
    finding(
      "error",
      "❌",
      `${objectName} Filter`,
      `${objectName} requires a WHERE filter on ${description}.`,
    ),
  ];
}
