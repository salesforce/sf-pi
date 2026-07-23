/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { toDevbarRuntimeFacts } from "../lib/runtime-facts.ts";

describe("toDevbarRuntimeFacts", () => {
  it("uses Pi's public percentage without recomputing it from tokens", () => {
    expect(
      toDevbarRuntimeFacts(
        {
          tokens: 1,
          contextWindow: 200_000,
          percent: 37.25,
        },
        undefined,
      ),
    ).toEqual({
      contextWindow: 200_000,
      contextPercent: 37.25,
      sessionName: undefined,
    });
  });

  it("keeps absent usage distinct from Pi's explicit unknown state", () => {
    expect(toDevbarRuntimeFacts(undefined, undefined)).toEqual({
      contextWindow: undefined,
      contextPercent: undefined,
      sessionName: undefined,
    });
  });

  it("consumes a session name from Pi's public session seam", () => {
    const session = SessionManager.inMemory();
    session.appendSessionInfo("Review gateway changes");

    expect(toDevbarRuntimeFacts(undefined, session.getSessionName()).sessionName).toBe(
      "Review gateway changes",
    );
  });

  it("passes through Pi's public session name without deriving a fallback", () => {
    expect(toDevbarRuntimeFacts(undefined, "Review gateway changes").sessionName).toBe(
      "Review gateway changes",
    );
    expect(toDevbarRuntimeFacts(undefined, undefined).sessionName).toBeUndefined();
  });

  it("preserves Pi's unknown and exact-zero percentage states", () => {
    expect(
      toDevbarRuntimeFacts({ tokens: null, contextWindow: 200_000, percent: null }, undefined)
        .contextPercent,
    ).toBeNull();
    expect(
      toDevbarRuntimeFacts({ tokens: 0, contextWindow: 200_000, percent: 0 }, undefined)
        .contextPercent,
    ).toBe(0);
  });
});
