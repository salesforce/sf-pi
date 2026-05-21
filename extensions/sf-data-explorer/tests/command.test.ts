/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildHelpText, parseCommandArgs } from "../lib/command.ts";

describe("parseCommandArgs", () => {
  it("parses mode, org, and refresh", () => {
    expect(parseCommandArgs("soql my-org refresh", "default")).toEqual({
      mode: "soql",
      object: undefined,
      org: "my-org",
      forceRefresh: true,
      help: false,
    });
  });

  it("supports requested command examples", () => {
    expect(parseCommandArgs("sosl my-org", "default")).toMatchObject({
      mode: "sosl",
      org: "my-org",
    });
    expect(parseCommandArgs("sql my-org", "default")).toMatchObject({ mode: "sql", org: "my-org" });
  });

  it("defaults org when not supplied", () => {
    expect(parseCommandArgs("soql", "dev")).toMatchObject({ mode: "soql", org: "dev" });
  });

  it("parses object deep links", () => {
    expect(parseCommandArgs("soql Account my-org", "default")).toMatchObject({
      mode: "soql",
      object: "Account",
      org: "my-org",
    });
    expect(parseCommandArgs("sql ssot__Individual__dlm my-org", "default")).toMatchObject({
      mode: "sql",
      object: "ssot__Individual__dlm",
      org: "my-org",
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
