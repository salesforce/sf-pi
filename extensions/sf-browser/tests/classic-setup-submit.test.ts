/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for Classic Setup submit dialog handling. */
import { describe, expect, it } from "vitest";
import { parseDialogStatus, shouldAutoAcceptDialog } from "../lib/classic-setup-submit.ts";

describe("classic setup submit dialog handling", () => {
  it("parses agent-browser dialog status JSON without a dialog", () => {
    expect(parseDialogStatus('{"success":true,"data":{"hasDialog":false},"error":null}')).toEqual({
      hasDialog: false,
      type: undefined,
      message: undefined,
      defaultValue: undefined,
    });
  });

  it("parses pending confirm dialog status", () => {
    expect(
      parseDialogStatus(
        '{"success":true,"data":{"hasDialog":true,"type":"confirm","message":"Are you sure?"},"error":null}',
      ),
    ).toEqual({
      hasDialog: true,
      type: "confirm",
      message: "Are you sure?",
      defaultValue: undefined,
    });
  });

  it("auto-accepts confirm-like dialogs only", () => {
    expect(shouldAutoAcceptDialog({ hasDialog: true, type: "confirm" })).toBe(true);
    expect(shouldAutoAcceptDialog({ hasDialog: true, type: "beforeunload" })).toBe(true);
    expect(shouldAutoAcceptDialog({ hasDialog: true })).toBe(true);
    expect(shouldAutoAcceptDialog({ hasDialog: true, type: "prompt" })).toBe(false);
    expect(shouldAutoAcceptDialog({ hasDialog: false, type: "confirm" })).toBe(false);
  });

  it("ignores malformed dialog status output", () => {
    expect(parseDialogStatus("not-json")).toBeUndefined();
    expect(parseDialogStatus("")).toBeUndefined();
  });
});
