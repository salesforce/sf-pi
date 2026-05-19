/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const upstreamExamples = JSON.parse(
  readFileSync("extensions/sf-data360/registry/upstream-payload-examples.json", "utf8"),
) as Record<string, unknown>;
const localExamples = JSON.parse(
  readFileSync("extensions/sf-data360/registry/examples.json", "utf8"),
) as Record<string, unknown>;

describe("d360 payload example parity", () => {
  it("represents every upstream payload example as a capability example or variant", () => {
    const uncovered = Object.keys(upstreamExamples).filter(
      (upstreamKey) => !localExamples[upstreamKey] && !findVariantBySourceExample(upstreamKey),
    );

    expect(uncovered).toEqual([]);
  });

  it("keeps upstream variant examples under canonical executable capabilities", () => {
    expect(findVariantBySourceExample("d360_dmo_create_profile")).toMatchObject({
      capability: "d360_dmo_create",
      variant: "profile",
    });
    expect(findVariantBySourceExample("d360_datastream_create_sfdc_engagement")).toMatchObject({
      capability: "d360_datastream_create_sfdc",
      variant: "engagement",
    });
    expect(findVariantBySourceExample("d360_smart_datastream")).toMatchObject({
      capability: "d360_smart_datastream_create",
      variant: "engagement_event_date",
    });
  });
});

function findVariantBySourceExample(
  sourceExample: string,
): { capability: string; variant: string; value: unknown } | undefined {
  for (const [capability, example] of Object.entries(localExamples)) {
    if (!example || typeof example !== "object" || Array.isArray(example)) continue;
    const variants = (example as { variants?: unknown }).variants;
    if (!variants || typeof variants !== "object" || Array.isArray(variants)) continue;
    for (const [variant, value] of Object.entries(variants)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (value as { sourceExample?: unknown }).sourceExample === sourceExample
      ) {
        return { capability, variant, value };
      }
    }
  }
  return undefined;
}
