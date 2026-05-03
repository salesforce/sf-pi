/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Policy matcher tests: glob + regex patterns, exception short-circuits,
 * strongest-protection-wins conflict resolution, tool-blocking levels.
 */
import { describe, expect, it } from "vitest";
import { blockedTools, globToRegExp, matchPath } from "../lib/policies.ts";
import type { PolicyRule } from "../lib/types.ts";

const secretFiles: PolicyRule = {
  id: "secret-files",
  patterns: [{ pattern: ".env" }, { pattern: ".env.local" }],
  allowedPatterns: [{ pattern: ".env.example" }],
  protection: "noAccess",
  onlyIfExists: false,
};

const destructive: PolicyRule = {
  id: "sf-destructive-changes-xml",
  patterns: [{ pattern: "**/destructiveChanges*.xml" }],
  protection: "noAccess",
  onlyIfExists: false,
};

const forceignore: PolicyRule = {
  id: "sf-forceignore",
  patterns: [{ pattern: "**/.forceignore" }],
  protection: "readOnly",
  onlyIfExists: false,
};

const logsReadOnly: PolicyRule = {
  id: "logs-readonly",
  patterns: [{ pattern: "*.log" }],
  protection: "readOnly",
  onlyIfExists: false,
};

const logsRegexNoAccess: PolicyRule = {
  id: "logs-regex-noaccess",
  patterns: [{ pattern: "^.*\\.log$", regex: true }],
  protection: "noAccess",
  onlyIfExists: false,
};

describe("globToRegExp", () => {
  it("** matches across path separators", () => {
    expect(
      globToRegExp("**/destructiveChanges.xml").test(
        "force-app/main/default/destructiveChanges.xml",
      ),
    ).toBe(true);
  });

  it("* does not cross slash boundaries", () => {
    expect(globToRegExp("*.log").test("app.log")).toBe(true);
    expect(globToRegExp("*.log").test("logs/app.log")).toBe(false);
  });

  it("escapes literal dots", () => {
    expect(globToRegExp(".env").test(".env")).toBe(true);
    expect(globToRegExp(".env").test("xenv")).toBe(false);
  });
});

describe("matchPath — glob basename vs full path", () => {
  const cwd = "/project";

  it("basename pattern matches files anywhere under cwd", () => {
    expect(matchPath("/project/src/app.log", cwd, [logsReadOnly])?.rule.id).toBe("logs-readonly");
    expect(matchPath("app.log", cwd, [logsReadOnly])?.rule.id).toBe("logs-readonly");
  });

  it("slash-containing pattern matches the relative path", () => {
    expect(
      matchPath("/project/force-app/main/default/destructiveChanges.xml", cwd, [destructive])?.rule
        .id,
    ).toBe("sf-destructive-changes-xml");
  });

  it("allowedPatterns short-circuit to allow", () => {
    expect(matchPath("/project/.env.example", cwd, [secretFiles])).toBeUndefined();
    expect(matchPath("/project/.env", cwd, [secretFiles])?.rule.id).toBe("secret-files");
  });

  it("regex patterns work when `regex: true`", () => {
    expect(matchPath("/project/debug.log", cwd, [logsRegexNoAccess])?.rule.protection).toBe(
      "noAccess",
    );
  });
});

describe("matchPath — strongest protection wins", () => {
  const cwd = "/project";

  it("noAccess beats readOnly for the same file", () => {
    const match = matchPath("/project/app.log", cwd, [logsReadOnly, logsRegexNoAccess]);
    expect(match?.rule.protection).toBe("noAccess");
  });

  it("respects enabled=false", () => {
    const match = matchPath("/project/app.log", cwd, [
      { ...logsRegexNoAccess, enabled: false },
      logsReadOnly,
    ]);
    expect(match?.rule.protection).toBe("readOnly");
  });
});

describe("blockedTools", () => {
  it("noAccess blocks reads plus mutations plus bash", () => {
    expect(blockedTools("noAccess")).toContain("read");
    expect(blockedTools("noAccess")).toContain("write");
    expect(blockedTools("noAccess")).toContain("edit");
    expect(blockedTools("noAccess")).toContain("bash");
  });

  it("readOnly blocks only write/edit", () => {
    expect(blockedTools("readOnly")).toEqual(["write", "edit"]);
  });

  it("none blocks nothing", () => {
    expect(blockedTools("none")).toEqual([]);
  });
});

// Integration: forceignore is read-only, not no-access.
describe("matchPath — read should be allowed for forceignore (readOnly)", () => {
  it("readOnly does not block read, does block write", () => {
    const match = matchPath("/project/.forceignore", "/project", [forceignore]);
    expect(match?.rule.protection).toBe("readOnly");
    expect(blockedTools(match!.rule.protection)).not.toContain("read");
    expect(blockedTools(match!.rule.protection)).toContain("write");
  });
});
