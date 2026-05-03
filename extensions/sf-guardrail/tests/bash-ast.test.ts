/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tokenizer and AST matcher tests.
 *
 * Focus areas:
 *   - Quoting and escape handling — a string literal must not pollute tokens.
 *   - Flag-vs-positional detection for both `-o MyOrg` and `--target-org=MyOrg`.
 *   - Subcommand walking through an arbitrary number of leading flags.
 *   - Pipeline termination so we only consider the first simple command.
 */
import { describe, expect, it } from "vitest";
import { extractTargetOrg, matches, tokenize } from "../lib/bash-ast.ts";

describe("tokenize", () => {
  it("strips path from head word", () => {
    const tokens = tokenize("/usr/local/bin/sf project deploy start");
    expect(tokens?.head).toBe("sf");
  });

  it("respects single quotes", () => {
    const tokens = tokenize("echo 'sf org delete prod'");
    expect(tokens?.head).toBe("echo");
    expect(tokens?.args).toEqual(["sf org delete prod"]);
  });

  it("respects double quotes and backslash escapes", () => {
    const tokens = tokenize(
      'sf data query --query "SELECT Id FROM Account WHERE Name = \\"ACME\\""',
    );
    expect(tokens?.head).toBe("sf");
    expect(tokens?.args[0]).toBe("data");
    expect(tokens?.args[3]).toBe('SELECT Id FROM Account WHERE Name = "ACME"');
  });

  it("stops at pipeline and && terminators", () => {
    expect(tokenize("sf project deploy start && echo done")?.args).toEqual([
      "project",
      "deploy",
      "start",
    ]);
    expect(tokenize("sf org list --all | grep prod")?.args).toEqual(["org", "list", "--all"]);
  });

  it("returns undefined for empty input", () => {
    expect(tokenize("")).toBeUndefined();
    expect(tokenize("   ")).toBeUndefined();
  });
});

describe("matches (AST)", () => {
  it("matches a simple subCmd chain", () => {
    const tokens = tokenize("sf project deploy start -o MyOrg")!;
    expect(matches(tokens, { cmd: "sf", subCmd: ["project", "deploy"] })).toBe(true);
    expect(matches(tokens, { cmd: "sf", subCmd: ["project", "retrieve"] })).toBe(false);
  });

  it("supports alternatives in a subCmd position", () => {
    const tokens = tokenize("sf data upsert --file x.csv -o prod")!;
    expect(matches(tokens, { cmd: "sf", subCmd: ["data", ["delete", "update", "upsert"]] })).toBe(
      true,
    );
    expect(matches(tokens, { cmd: "sf", subCmd: ["data", ["delete"]] })).toBe(false);
  });

  it("skips over leading flags", () => {
    const tokens = tokenize("sf --json apex run -f script.apex -o MyOrg")!;
    expect(matches(tokens, { cmd: "sf", subCmd: ["apex", "run"] })).toBe(true);
  });

  it("enforces flagIn constraints", () => {
    const del = tokenize("sf org api /custom --method DELETE -o prod")!;
    const get = tokenize("sf org api /custom --method GET -o prod")!;
    const spec = {
      cmd: "sf",
      subCmd: ["org", "api"],
      flagIn: { "--method": ["DELETE", "PATCH", "PUT"] },
    };
    expect(matches(del, spec)).toBe(true);
    expect(matches(get, spec)).toBe(false);
  });

  it("flag values work with = shorthand", () => {
    const tokens = tokenize("sf org api /x --method=PUT -o prod")!;
    expect(
      matches(tokens, {
        cmd: "sf",
        subCmd: ["org", "api"],
        flagIn: { "--method": ["PUT"] },
      }),
    ).toBe(true);
  });
});

describe("extractTargetOrg", () => {
  it("prefers -o over --target-org when both are present", () => {
    const tokens = tokenize("sf project deploy start -o Alias1 --target-org Alias2")!;
    expect(extractTargetOrg(tokens)).toBe("Alias1");
  });

  it("accepts --target-org=Alias shorthand", () => {
    const tokens = tokenize("sf project deploy start --target-org=Prod")!;
    expect(extractTargetOrg(tokens)).toBe("Prod");
  });

  it("returns undefined when no target-org flag is present", () => {
    const tokens = tokenize("sf project deploy start")!;
    expect(extractTargetOrg(tokens)).toBeUndefined();
  });
});
