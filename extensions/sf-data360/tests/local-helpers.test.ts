/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { isLocalD360Helper, runLocalD360Helper } from "../lib/local-helpers.ts";

describe("d360 local facade helpers", () => {
  it("previews bundled standard mappings and returns a create payload", () => {
    const result = runLocalD360Helper("d360_standard_mapping_preview", {
      sourceObjectName: "Account",
      targetDmoName: "AccountDmo",
    });

    expect(result).toMatchObject({
      ok: true,
      helper: "d360_standard_mapping_preview",
      found: true,
      targetDmoCount: 1,
      next: expect.objectContaining({ operation: "d360_standard_mapping_create" }),
    });
    expect(result.dmoMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetDmoName: "AccountDmo",
          createPayload: expect.objectContaining({ targetEntityDeveloperName: "AccountDmo" }),
        }),
      ]),
    );
  });

  it("suggests mapping payloads from similar fields", () => {
    const fields = [
      { name: "Id__c", label: "Id", dataType: "Text" },
      { name: "Name__c", label: "Name", dataType: "Text" },
    ];
    const result = runLocalD360Helper("d360_smart_mapping_suggest", {
      sourceFields: fields,
      targetFields: fields,
      sourceDloName: "Example__dll",
      targetDmoName: "Example__dlm",
    });

    expect(result).toMatchObject({
      ok: true,
      helper: "d360_smart_mapping_suggest",
      matchCount: 2,
      mappingPayload: {
        sourceEntityDeveloperName: "Example__dll",
        targetEntityDeveloperName: "Example__dlm",
        fieldMapping: expect.arrayContaining([
          { sourceFieldDeveloperName: "Id__c", targetFieldDeveloperName: "Id__c" },
        ]),
      },
      next: expect.objectContaining({ operation: "d360_dmo_mapping_create" }),
    });
  });

  it("recommends immutable event date fields and enhances data stream bodies", () => {
    const result = runLocalD360Helper("d360_smart_datastream_create", {
      body: {
        name: "Example_Engagement",
        dataLakeObjectInfo: { name: "Example_Engagement__dll", category: "Engagement" },
        sourceFields: [
          { name: "LastModifiedDate__c", label: "Last Modified", dataType: "DateTime" },
          { name: "CreatedDate__c", label: "Created Date", dataType: "DateTime" },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      helper: "d360_smart_datastream_create",
      changed: true,
      enhancedBody: {
        dataLakeObjectInfo: expect.objectContaining({ eventDateTimeFieldName: "CreatedDate__c" }),
      },
      next: expect.objectContaining({ operation: "d360_datastream_create" }),
    });
  });

  it("identifies local helper names", () => {
    expect(isLocalD360Helper("d360_event_date_recommend")).toBe(true);
    expect(isLocalD360Helper("d360_dmo_get")).toBe(false);
  });
});
