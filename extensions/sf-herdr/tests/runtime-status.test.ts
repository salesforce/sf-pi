/* SPDX-License-Identifier: Apache-2.0 */
/** Runtime detection tests for sf-herdr Herdr-pane environment sensing. */
import { describe, expect, it } from "vitest";
import { getHerdrRuntimeStatus } from "../lib/status.ts";

describe("getHerdrRuntimeStatus", () => {
  it("detects an active Herdr pane when HERDR_ENV is the literal \"1\"", () => {
    const status = getHerdrRuntimeStatus({ HERDR_ENV: "1", HERDR_PANE_ID: "pane-1" } as NodeJS.ProcessEnv);
    expect(status.inHerdrPane).toBe(true);
    expect(status.activeControlEnv).toBe(true);
    expect(status.paneId).toBe("pane-1");
  });

  it("detects an active Herdr pane for any truthy HERDR_ENV value (upstream semantics)", () => {
    for (const value of ["true", "on", "yes", "/tmp/herdr.sock"]) {
      const status = getHerdrRuntimeStatus({
        HERDR_ENV: value,
        HERDR_PANE_ID: "pane-2",
      } as NodeJS.ProcessEnv);
      expect(status.inHerdrPane, `HERDR_ENV=${value}`).toBe(true);
      expect(status.activeControlEnv, `HERDR_ENV=${value}`).toBe(true);
    }
  });

  it("reports the passive status bridge only when a socket path is present", () => {
    const withoutSocket = getHerdrRuntimeStatus({
      HERDR_ENV: "1",
      HERDR_PANE_ID: "pane-3",
    } as NodeJS.ProcessEnv);
    expect(withoutSocket.passiveStatusBridge).toBe(false);

    const withSocket = getHerdrRuntimeStatus({
      HERDR_ENV: "1",
      HERDR_PANE_ID: "pane-3",
      HERDR_SOCKET_PATH: "/tmp/herdr.sock",
    } as NodeJS.ProcessEnv);
    expect(withSocket.passiveStatusBridge).toBe(true);
  });

  it("is inactive without a pane id or without HERDR_ENV", () => {
    expect(getHerdrRuntimeStatus({ HERDR_ENV: "1" } as NodeJS.ProcessEnv).inHerdrPane).toBe(false);
    expect(getHerdrRuntimeStatus({ HERDR_PANE_ID: "pane-4" } as NodeJS.ProcessEnv).inHerdrPane).toBe(
      false,
    );
    expect(getHerdrRuntimeStatus({} as NodeJS.ProcessEnv).inHerdrPane).toBe(false);
  });
});
