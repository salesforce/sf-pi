/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildHelpText, parseCommandArgs } from "../lib/command.ts";

describe("parseCommandArgs", () => {
  it("parses mode, org, and refresh", () => {
    expect(parseCommandArgs("soql wh refresh", "default")).toEqual({
      mode: "soql",
      object: undefined,
      org: "wh",
      forceRefresh: true,
      help: false,
    });
  });

  it("supports requested command examples", () => {
    expect(parseCommandArgs("sosl wh", "default")).toMatchObject({ mode: "sosl", org: "wh" });
    expect(parseCommandArgs("sql wh", "default")).toMatchObject({ mode: "sql", org: "wh" });
  });

  it("defaults org when not supplied", () => {
    expect(parseCommandArgs("soql", "dev")).toMatchObject({ mode: "soql", org: "dev" });
  });

  it("parses object deep links", () => {
    expect(parseCommandArgs("soql Account wh", "default")).toMatchObject({
      mode: "soql",
      object: "Account",
      org: "wh",
    });
    expect(parseCommandArgs("sql ssot__Individual__dlm wh", "default")).toMatchObject({
      mode: "sql",
      object: "ssot__Individual__dlm",
      org: "wh",
    });
  });

  it("detects help flags", () => {
    expect(parseCommandArgs("help", "dev")).toMatchObject({ help: true, org: "dev" });
    expect(parseCommandArgs("soql --help", "dev")).toMatchObject({ mode: "soql", help: true });
  });

  it("documents streamlined lowercase primary keys", () => {
    const help = buildHelpText();
    expect(help).toContain("? help, t switch explorer");
    expect(help).toContain("w WHERE/search term, l LIMIT");
    expect(help).toContain("s save");
  });
});
