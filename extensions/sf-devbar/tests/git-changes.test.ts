/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { parseGitStatus, formatGitChanges } from "../lib/git-changes.ts";

// -------------------------------------------------------------------------------------------------
// parseGitStatus
// -------------------------------------------------------------------------------------------------

describe("parseGitStatus", () => {
  it("parses untracked files as added", () => {
    const result = parseGitStatus("?? newfile.ts\n?? another.ts\n");
    expect(result).toEqual({ added: 2, modified: 0, deleted: 0 });
  });

  it("parses staged adds", () => {
    const result = parseGitStatus("A  staged.ts\n");
    expect(result).toEqual({ added: 1, modified: 0, deleted: 0 });
  });

  it("parses modified files", () => {
    const result = parseGitStatus(" M changed.ts\nM  staged-change.ts\n");
    expect(result).toEqual({ added: 0, modified: 2, deleted: 0 });
  });

  it("parses deleted files", () => {
    const result = parseGitStatus(" D removed.ts\nD  staged-delete.ts\n");
    expect(result).toEqual({ added: 0, modified: 0, deleted: 2 });
  });

  it("parses mixed changes", () => {
    const porcelain = [
      "?? new.ts",
      " M changed.ts",
      "D  deleted.ts",
      "MM both.ts",
      "A  added.ts",
    ].join("\n");

    const result = parseGitStatus(porcelain);
    expect(result).toEqual({ added: 2, modified: 2, deleted: 1 });
  });

  it("handles empty output", () => {
    expect(parseGitStatus("")).toEqual({ added: 0, modified: 0, deleted: 0 });
  });

  it("parses renamed files as modified", () => {
    const result = parseGitStatus("R  old.ts -> new.ts\n");
    expect(result).toEqual({ added: 0, modified: 1, deleted: 0 });
  });
});

// -------------------------------------------------------------------------------------------------
// formatGitChanges
// -------------------------------------------------------------------------------------------------

describe("formatGitChanges", () => {
  it("formats all change types", () => {
    expect(formatGitChanges({ added: 3, modified: 1, deleted: 2 })).toBe("+3 ~1 -2");
  });

  it("omits zero categories", () => {
    expect(formatGitChanges({ added: 5, modified: 0, deleted: 0 })).toBe("+5");
    expect(formatGitChanges({ added: 0, modified: 2, deleted: 0 })).toBe("~2");
    expect(formatGitChanges({ added: 0, modified: 0, deleted: 1 })).toBe("-1");
  });

  it("returns empty string for no changes", () => {
    expect(formatGitChanges({ added: 0, modified: 0, deleted: 0 })).toBe("");
  });
});
