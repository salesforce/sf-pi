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

  it("parses 'beta' with remaining args", () => {
    const result = parseCommandArgs("beta context-1m on");
    expect(result.subcommand).toBe("beta");
    expect(result.betaArgs).toEqual(["context-1m", "on"]);
  });

  it("parses 'beta' with no extra args", () => {
    const result = parseCommandArgs("beta");
    expect(result.subcommand).toBe("beta");
    expect(result.betaArgs).toEqual([]);
  });

  it("parses 'models'", () => {
    const result = parseCommandArgs("models");
    expect(result.subcommand).toBe("models");
  });

  it("parses 'debug <modelId>' with positional args", () => {
    const result = parseCommandArgs("debug claude-opus-4-7 adaptive reasoning=max");
    expect(result.subcommand).toBe("debug");
    expect(result.positional).toEqual(["claude-opus-4-7", "adaptive", "reasoning=max"]);
  });

  it("parses 'debug' with no model as an empty positional list", () => {
    const result = parseCommandArgs("debug");
    expect(result.subcommand).toBe("debug");
    expect(result.positional).toEqual([]);
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
