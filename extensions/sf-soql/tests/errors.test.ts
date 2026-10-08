/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { errorResult } from "../lib/errors.ts";
import { renderSoqlResultMarkdown } from "../lib/render.ts";

describe("sf-soql error cards", () => {
  it("renders typed Salesforce request errors for the model", () => {
    const error = Object.assign(
      new Error("Salesforce request failed (400) using API 67.0: /query/"),
      { status: 400, errorCode: "INVALID_FIELD", path: "/query/" },
    );
    const result = errorResult(
      { action: "query.run", target_org: "TestOrg", query: "SELECT Bad__c FROM Account LIMIT 1" },
      error,
    );

    expect(result.content[0]?.text).toContain("Code: INVALID_FIELD");
    expect(result.content[0]?.text).toContain("Salesforce request failed (400)");
    const digest = result.details.digest as { api_calls: Array<{ path: string }> };
    expect(digest.api_calls[0].path).toBe("INVALID_FIELD");
  });

  it("renders structured Salesforce API failures", () => {
    const result = errorResult(
      { action: "query.run", target_org: "TestOrg", query: "SELECT Bad__c FROM Account LIMIT 1" },
      new Error(
        'Salesforce API GET /services/data/v67.0/query failed (400): [{"message":"No such column Bad__c on entity Account","errorCode":"INVALID_FIELD"}]',
      ),
    );
    const rendered = renderSoqlResultMarkdown(result);
    expect(result.details.ok).toBe(false);
    expect(rendered).toContain("INVALID_FIELD");
    expect(rendered).toContain("Root Cause");
    expect(rendered).toContain("SELECT Bad__c FROM Account LIMIT 1");
  });
});
