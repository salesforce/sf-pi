/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { responseLooksLikeError, resolveRequest, type D360ApiInput } from "../lib/api-tool.ts";
import type { SfEnvironment } from "../../../lib/common/sf-environment/types.ts";

const env: SfEnvironment = {
  cli: { installed: true, version: "2.132.14" },
  project: { detected: true, sourceApiVersion: "65.0" },
  config: { hasTargetOrg: true, targetOrg: "my-sandbox", location: "Global" },
  org: {
    detected: true,
    alias: "my-sandbox",
    username: "user@example.invalid",
    instanceUrl: "https://example.my.salesforce.com",
    orgType: "sandbox",
    apiVersion: "66.0",
  },
  detectedAt: 1,
};

describe("sf-data360 request resolution", () => {
  it("uses active org api version and default target org", () => {
    const input: D360ApiInput = {
      method: "GET",
      path: "/services/data/v60.0/ssot/data-model-objects",
    };

    expect(resolveRequest(input, env)).toMatchObject({
      method: "GET",
      apiPath: "/services/data/v66.0/ssot/data-model-objects",
      targetOrg: "my-sandbox",
      apiVersion: "66.0",
      orgType: "sandbox",
      safety: { level: "read", requiresConfirmation: false },
    });
  });

  it("treats non-default target org type as unknown", () => {
    const input: D360ApiInput = {
      method: "POST",
      path: "/ssot/data-model-objects",
      target_org: "other-org",
    };

    expect(resolveRequest(input, env)).toMatchObject({
      targetOrg: "other-org",
      orgType: "unknown",
      safety: { level: "create", requiresConfirmation: true },
    });
  });

  it("detects application-level REST errors even when the CLI exits zero", () => {
    expect(responseLooksLikeError('{"content":[],"error":{"message":"Nope"},"size":0}')).toBe(true);
    expect(responseLooksLikeError('[{"errorCode":"NOT_FOUND","message":"Missing"}]')).toBe(true);
    expect(responseLooksLikeError('{"dataModelObject":[]}')).toBe(false);
    expect(responseLooksLikeError("not json")).toBe(false);
  });
});
