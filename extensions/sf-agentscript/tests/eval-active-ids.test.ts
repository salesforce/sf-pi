/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pin the placeholder substitution + usage detection contract.
 *
 * The resolver itself is exercised against a live org in integration; the
 * unit tests here focus on:
 *
 *  - `$active_*` and `$latest_*` substitute correctly (and don't cross-
 *    contaminate)
 *  - `detectPlaceholderUsage` returns a per-family signal so the
 *    orchestrator can skip family resolvers it doesn't need
 *  - `specHasActivePlaceholders` (back-compat alias) still returns true
 *    when either family is referenced
 */

import { describe, expect, test } from "vitest";
import {
  detectPlaceholderUsage,
  specHasActivePlaceholders,
  substitutePlaceholders,
  type ResolvedAgentIds,
} from "../lib/eval/active-ids.ts";

const ACTIVE: ResolvedAgentIds = {
  bot_id: "BOT-DEF-1",
  bot_version_id: "BV-ACTIVE",
  planner_id: "PL-ACTIVE",
  version_number: 11,
  status: "Active",
};

const LATEST: ResolvedAgentIds = {
  bot_id: "BOT-DEF-1", // same BotDefinition
  bot_version_id: "BV-LATEST",
  planner_id: "PL-LATEST",
  version_number: 12,
  status: "Inactive",
};

describe("detectPlaceholderUsage", () => {
  test("active and latest are independent signals", () => {
    expect(detectPlaceholderUsage({ x: "$active_planner_id" })).toEqual({
      active: true,
      latest: false,
    });
    expect(detectPlaceholderUsage({ x: "$latest_planner_id" })).toEqual({
      active: false,
      latest: true,
    });
    expect(detectPlaceholderUsage({ a: "$active_bot_id", b: "$latest_bot_version_id" })).toEqual({
      active: true,
      latest: true,
    });
  });

  test("no placeholders → both false (skip both resolvers)", () => {
    expect(detectPlaceholderUsage({ tests: [{ id: "x" }] })).toEqual({
      active: false,
      latest: false,
    });
  });

  test("specHasActivePlaceholders returns true on either family (back-compat)", () => {
    expect(specHasActivePlaceholders({ x: "$active_planner_id" })).toBe(true);
    expect(specHasActivePlaceholders({ x: "$latest_planner_id" })).toBe(true);
    expect(specHasActivePlaceholders({ x: "no placeholder" })).toBe(false);
  });
});

describe("substitutePlaceholders", () => {
  test("$active_* uses active ids", () => {
    const out = substitutePlaceholders(
      {
        planner_id: "$active_planner_id",
        tags: { botId: "$active_bot_id", botVersionId: "$active_bot_version_id" },
      },
      { active: ACTIVE },
    );
    expect(out).toEqual({
      planner_id: "PL-ACTIVE",
      tags: { botId: "BOT-DEF-1", botVersionId: "BV-ACTIVE" },
    });
  });

  test("$latest_* uses latest ids; $active_bot_id falls back to latest's BotDefinition", () => {
    const out = substitutePlaceholders(
      {
        planner_id: "$latest_planner_id",
        tags: { botId: "$active_bot_id", botVersionId: "$latest_bot_version_id" },
      },
      { latest: LATEST }, // no active resolved
    );
    expect(out).toEqual({
      planner_id: "PL-LATEST",
      tags: { botId: "BOT-DEF-1", botVersionId: "BV-LATEST" },
    });
  });

  test("families don't cross-contaminate when both are resolved", () => {
    const spec = {
      // Mixed within the same spec — supported but unusual.
      activeTest: {
        planner_id: "$active_planner_id",
        botVersionId: "$active_bot_version_id",
      },
      latestTest: {
        planner_id: "$latest_planner_id",
        botVersionId: "$latest_bot_version_id",
      },
    };
    const out = substitutePlaceholders(spec, { active: ACTIVE, latest: LATEST });
    expect(out.activeTest).toEqual({
      planner_id: "PL-ACTIVE",
      botVersionId: "BV-ACTIVE",
    });
    expect(out.latestTest).toEqual({
      planner_id: "PL-LATEST",
      botVersionId: "BV-LATEST",
    });
  });

  test("unknown placeholders are left intact (so the API surfaces a clear error)", () => {
    const out = substitutePlaceholders(
      { planner_id: "$version_99_planner_id" },
      { active: ACTIVE },
    );
    // The string-token form for specific versions is deliberately NOT
    // a placeholder — users use action='resolve_active' version=N and bake
    // the resulting plain id into the spec.
    expect(out).toEqual({ planner_id: "$version_99_planner_id" });
  });

  test("$latest_* with no latest resolved is a no-op (leaves placeholder)", () => {
    const out = substitutePlaceholders({ x: "$latest_bot_version_id" }, { active: ACTIVE });
    // No `latest` key in PlaceholderSet → don't substitute, surface error
    // upstream when the API rejects the literal placeholder string.
    expect(out).toEqual({ x: "$latest_bot_version_id" });
  });

  test("walks arrays + nested objects", () => {
    const out = substitutePlaceholders(
      {
        tests: [
          {
            steps: [{ planner_id: "$active_planner_id" }, { planner_id: "$latest_planner_id" }],
          },
        ],
      },
      { active: ACTIVE, latest: LATEST },
    );
    expect(out).toEqual({
      tests: [
        {
          steps: [{ planner_id: "PL-ACTIVE" }, { planner_id: "PL-LATEST" }],
        },
      ],
    });
  });
});
