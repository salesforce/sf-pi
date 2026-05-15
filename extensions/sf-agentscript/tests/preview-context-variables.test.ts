/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin the wire shape the SFAP /messages endpoint expects when the caller
 * passes deterministic state seeds via `context_variables` on a preview
 * send. Mirrors the eval-spec context_variables shape so users can copy
 * between agentscript_eval and agentscript_preview without remembering
 * a second schema.
 */

import { describe, expect, test } from "vitest";
import { normalizeContextVariables, type ContextVariable } from "../lib/preview/client.ts";

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
});
