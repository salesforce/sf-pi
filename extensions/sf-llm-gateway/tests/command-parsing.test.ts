/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for gateway command parsing behavior.
 *
 * Covers: parseCommandArgs
 *
 * Command parsing determines which handler runs.
 * Getting this wrong routes user intent to the wrong action.
 */
import { describe, it, expect } from "vitest";
import { parseCommandArgs } from "../index.ts";

// -------------------------------------------------------------------------------------------------
// parseCommandArgs
// -------------------------------------------------------------------------------------------------

describe("parseCommandArgs", () => {
  it("defaults to status with global scope when no args", () => {
    const result = parseCommandArgs("");
    expect(result.subcommand).toBe("status");
    expect(result.scope).toBe("global");
  });

  it("parses 'status'", () => {
    const result = parseCommandArgs("status");
    expect(result.subcommand).toBe("status");
  });

  it("parses 'refresh'", () => {
    const result = parseCommandArgs("refresh");
    expect(result.subcommand).toBe("refresh");
  });

  it("parses 'set-default'", () => {
    const result = parseCommandArgs("set-default");
    expect(result.subcommand).toBe("set-default");
  });

  it("parses 'set-default project'", () => {
    const result = parseCommandArgs("set-default project");
    expect(result.subcommand).toBe("set-default");
    expect(result.scope).toBe("project");
  });

  it("parses 'setup'", () => {
    const result = parseCommandArgs("setup");
    expect(result.subcommand).toBe("setup");
  });

  it("parses 'configure' as setup alias", () => {
    const result = parseCommandArgs("configure");
    expect(result.subcommand).toBe("setup");
  });

  it("parses 'on'", () => {
    const result = parseCommandArgs("on");
    expect(result.subcommand).toBe("on");
  });

  it("parses 'enable' as on alias", () => {
    const result = parseCommandArgs("enable");
    expect(result.subcommand).toBe("on");
  });

  it("parses 'off'", () => {
    const result = parseCommandArgs("off");
    expect(result.subcommand).toBe("off");
  });

  it("parses 'disable' as off alias", () => {
    const result = parseCommandArgs("disable");
    expect(result.subcommand).toBe("off");
  });

  it("parses 'on project' with project scope", () => {
    const result = parseCommandArgs("on project");
    expect(result.subcommand).toBe("on");
    expect(result.scope).toBe("project");
  });

  it("parses 'models'", () => {
    const result = parseCommandArgs("models");
    expect(result.subcommand).toBe("models");
  });

  it("parses dedicated compaction setup with global and project scope", () => {
    expect(parseCommandArgs("compaction")).toMatchObject({
      subcommand: "compaction",
      scope: "global",
    });
    expect(parseCommandArgs("compaction project")).toMatchObject({
      subcommand: "compaction",
      scope: "project",
    });
  });

  it("parses 'doctor'", () => {
    const result = parseCommandArgs("doctor");
    expect(result.subcommand).toBe("doctor");
    expect(result.positional).toEqual([]);
  });

  it("preserves opt-in doctor stream arguments", () => {
    expect(
      parseCommandArgs("doctor --stream gpt-6-sol --thinking xhigh --count 2 --tool").positional,
    ).toEqual(["--stream", "gpt-6-sol", "--thinking", "xhigh", "--count", "2", "--tool"]);
    expect(parseCommandArgs("dr --stream-canaries --count 3").positional).toEqual([
      "--stream-canaries",
      "--count",
      "3",
    ]);
  });

  it("parses 'usage-probe'", () => {
    const result = parseCommandArgs("usage-probe");
    expect(result.subcommand).toBe("usage-probe");
  });

  it("parses 'usage' as usage-probe alias", () => {
    const result = parseCommandArgs("usage");
    expect(result.subcommand).toBe("usage-probe");
  });

  it("parses 'tokens <modelId>' with positional args", () => {
    const result = parseCommandArgs("tokens example-model hello world");
    expect(result.subcommand).toBe("tokens");
    expect(result.positional).toEqual(["example-model", "hello", "world"]);
  });

  it("parses 'count' as tokens alias", () => {
    const result = parseCommandArgs("count example-model");
    expect(result.subcommand).toBe("tokens");
    expect(result.positional).toEqual(["example-model"]);
  });

  it("parses 'onboard'", () => {
    const result = parseCommandArgs("onboard");
    expect(result.subcommand).toBe("onboard");
  });

  it("parses open-token aliases", () => {
    expect(parseCommandArgs("open-token").subcommand).toBe("open-token");
    expect(parseCommandArgs("open").subcommand).toBe("open-token");
    expect(parseCommandArgs("browser").subcommand).toBe("open-token");
  });

  it("parses import-claude aliases with scope", () => {
    const result = parseCommandArgs("import-claude project");
    expect(result.subcommand).toBe("import-claude");
    expect(result.scope).toBe("project");
    expect(parseCommandArgs("import-claude-code").subcommand).toBe("import-claude");
  });

  it("parses 'dr' as doctor alias", () => {
    const result = parseCommandArgs("dr");
    expect(result.subcommand).toBe("doctor");
  });

  it("does not recognize the removed debug command", () => {
    expect(parseCommandArgs("debug example-model").subcommand).toBe("status");
  });

  it.each(["latency-probe", "latency"])("does not recognize removed %s command", (command) => {
    expect(parseCommandArgs(command).subcommand).toBe("status");
  });

  it("parses 'help'", () => {
    const result = parseCommandArgs("help");
    expect(result.subcommand).toBe("help");
  });

  it("defaults unknown subcommands to status", () => {
    const result = parseCommandArgs("unknown-thing");
    expect(result.subcommand).toBe("status");
  });

  it("handles extra whitespace", () => {
    const result = parseCommandArgs("  refresh   project  ");
    expect(result.subcommand).toBe("refresh");
    expect(result.scope).toBe("project");
  });
});
