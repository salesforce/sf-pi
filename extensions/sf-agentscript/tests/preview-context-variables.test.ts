/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin the wire shape the SFAP /messages endpoint expects when the caller
 * passes deterministic state seeds via `context_variables` on a preview
 * send. Mirrors the eval-spec context_variables shape so users can copy
 * between agentscript_eval and agentscript_preview without remembering
 * a second schema.
 */

import { describe, expect, test } from "vitest";
import {
  applyPreviewContextPatch,
  mergeContextVariables,
  normalizeContextVariables,
  type ContextVariable,
} from "../lib/preview/client.ts";

describe("normalizeContextVariables", () => {
  test("undefined / empty → empty array (preserves the body shape for callers without seeds)", () => {
    expect(normalizeContextVariables(undefined)).toEqual([]);
    expect(normalizeContextVariables([])).toEqual([]);
  });

  test("defaults type to 'Text' when omitted (matches eval-spec convention)", () => {
    const vars: ContextVariable[] = [{ name: "verified_check", value: "true" }];
    expect(normalizeContextVariables(vars)).toEqual([
      { name: "verified_check", type: "Text", value: "true" },
    ]);
  });

  test("preserves explicit type", () => {
    const vars: ContextVariable[] = [
      { name: "RoutableId", type: "Text", value: "0Mwbb00000CAGvpCAH" },
    ];
    expect(normalizeContextVariables(vars)).toEqual([
      { name: "RoutableId", type: "Text", value: "0Mwbb00000CAGvpCAH" },
    ]);
  });

  test("stringifies primitive values (SFAP variables are string-typed on the wire)", () => {
    const vars: ContextVariable[] = [
      { name: "n", value: 42 },
      { name: "b", value: true },
      { name: "s", value: "hello" },
    ];
    expect(normalizeContextVariables(vars)).toEqual([
      { name: "n", type: "Text", value: "42" },
      { name: "b", type: "Text", value: "true" },
      { name: "s", type: "Text", value: "hello" },
    ]);
  });

  test("mergeContextVariables lets send-time values override start-time profile values", () => {
    expect(
      mergeContextVariables(
        [
          { name: "CallerPhone", type: "Text", value: "+15550000000" },
          { name: "IsVip", type: "Boolean", value: false },
        ],
        [{ name: "IsVip", type: "Boolean", value: true }],
      ),
    ).toEqual([
      { name: "CallerPhone", type: "Text", value: "+15550000000" },
      { name: "IsVip", type: "Boolean", value: true },
    ]);
  });

  test("applyPreviewContextPatch registers state slots and rewrites linked bound inputs", () => {
    const agentDefinition = {
      agentVersion: {
        stateVariables: [{ developerName: "Existing", dataType: "string" }],
        topics: [
          {
            tools: [
              {
                boundInputs: {
                  phoneNumber: "variables.CallerPhone",
                  keep: "variables.Other",
                },
              },
            ],
          },
        ],
      },
    };

    const result = applyPreviewContextPatch(agentDefinition, [
      { name: "CallerPhone", type: "Text", value: "+15551234567" },
      { name: "IsVip", type: "Boolean", value: true },
    ]);

    expect(result).toMatchObject({
      variables: [
        { name: "CallerPhone", type: "Text", value: "+15551234567" },
        { name: "IsVip", type: "Boolean", value: "true" },
      ],
      registeredStateVariables: 2,
      rewrittenBindings: 1,
    });
    expect(agentDefinition.agentVersion.stateVariables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ developerName: "CallerPhone", dataType: "string" }),
        expect.objectContaining({ developerName: "IsVip", dataType: "boolean" }),
      ]),
    );
    expect(agentDefinition.agentVersion.topics[0].tools[0].boundInputs).toEqual({
      phoneNumber: "state.CallerPhone",
      keep: "variables.Other",
    });
  });
});
