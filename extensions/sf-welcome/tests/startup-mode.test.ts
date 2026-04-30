/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { isVerboseStartupRequested, resolveQuietStartup } from "../lib/startup-mode.ts";

describe("resolveQuietStartup", () => {
  it("defaults to overlay mode when quietStartup is unset", () => {
    expect(resolveQuietStartup(undefined, {}, {})).toBe(false);
  });

  it("uses global quietStartup when the project does not override it", () => {
    expect(resolveQuietStartup(undefined, { quietStartup: true }, {})).toBe(true);
    expect(resolveQuietStartup(undefined, { quietStartup: false }, {})).toBe(false);
  });

  it("lets project quietStartup override global settings", () => {
    expect(resolveQuietStartup(undefined, { quietStartup: false }, { quietStartup: true })).toBe(
      true,
    );
    expect(resolveQuietStartup(undefined, { quietStartup: true }, { quietStartup: false })).toBe(
      false,
    );
  });

  it("lets --verbose override quietStartup and force the overlay", () => {
    expect(resolveQuietStartup(true, { quietStartup: true }, { quietStartup: true })).toBe(false);
  });

  it("detects Pi's built-in --verbose flag from argv", () => {
    expect(isVerboseStartupRequested(["node", "pi", "--verbose"])).toBe(true);
    expect(isVerboseStartupRequested(["node", "pi"])).toBe(false);
  });
});
