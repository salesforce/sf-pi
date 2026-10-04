/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  expansionStateFromSnapshotLine,
  findExpansionControlInSnapshot,
} from "../lib/expanded-control.ts";

describe("expanded controls", () => {
  it("reads explicit expanded state", () => {
    expect(expansionStateFromSnapshotLine('- treeitem "Security" [expanded=false, ref=e1]')).toBe(
      false,
    );
    expect(expansionStateFromSnapshotLine('- button "Setup" [expanded=true, ref=e2]')).toBe(true);
    expect(expansionStateFromSnapshotLine('- button "Expand" [ref=e3]')).toBeUndefined();
  });

  it("maps a Setup tree item to its nested expansion button", () => {
    const snapshot = [
      '- treeitem "Security" [level=1, expanded=false, ref=e1]',
      '  - button "Expand" [ref=e2]',
      '  - link "Security" [ref=e3]',
      '- treeitem "Identity" [level=1, expanded=false, ref=e4]',
      '  - button "Expand" [ref=e5]',
      '  - link "Identity" [ref=e6]',
    ].join("\n");

    expect(findExpansionControlInSnapshot(snapshot, "e1")).toMatchObject({
      targetRef: "e1",
      controlRef: "e2",
      label: "Security",
      expanded: false,
      role: "treeitem",
    });
  });

  it("uses the target itself when it is an expandable button", () => {
    const snapshot = '- button "Setup" [expanded=true, ref=e10]';

    expect(findExpansionControlInSnapshot(snapshot, "e10")).toMatchObject({
      targetRef: "e10",
      controlRef: "e10",
      label: "Setup",
      expanded: true,
      role: "button",
    });
  });

  it("does not borrow an expansion button from the next tree item", () => {
    const snapshot = [
      '- treeitem "Settings" [level=1, ref=e1]',
      '  - heading "SETTINGS" [level=4, ref=e2]',
      '- treeitem "Security" [level=1, expanded=false, ref=e3]',
      '  - button "Expand" [ref=e4]',
    ].join("\n");

    expect(findExpansionControlInSnapshot(snapshot, "e1")).toBeUndefined();
  });
});
