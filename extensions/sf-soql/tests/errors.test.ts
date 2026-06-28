/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { errorResult } from "../lib/errors.ts";
import { renderSoqlResultMarkdown } from "../lib/render.ts";

describe("sf-soql error cards", () => {
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
