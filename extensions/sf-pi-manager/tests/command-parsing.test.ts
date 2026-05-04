/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for sf-pi-manager command argument parsing.
 *
 * Covers: parseCommandArgs
 *
 * Command parsing routes user input to the correct handler.
 * Edge cases (empty input, extra whitespace, scope detection)
 * must be handled gracefully.
 */
import { describe, it, expect } from "vitest";
import { parseCommandArgs } from "../index.ts";
import { parseDoctorArgs } from "../lib/doctor-command.ts";

// -------------------------------------------------------------------------------------------------
// parseCommandArgs
// -------------------------------------------------------------------------------------------------

describe("parseCommandArgs", () => {
  it("defaults to overlay with global scope when no args", () => {
    const result = parseCommandArgs("");
    expect(result.subcommand).toBe("overlay");
    expect(result.scope).toBe("global");
  });

  it("parses 'list'", () => {
    const result = parseCommandArgs("list");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'ls' as list alias", () => {
    const result = parseCommandArgs("ls");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'status'", () => {
    const result = parseCommandArgs("status");
    expect(result.subcommand).toBe("status");
  });

  it("parses 'display' without a target", () => {
    const result = parseCommandArgs("display");
    expect(result.subcommand).toBe("display");
    expect(result.target).toBeUndefined();
  });

  it("parses 'display' with a profile target and scope", () => {
    const result = parseCommandArgs("display compact project");
    expect(result.subcommand).toBe("display");
    expect(result.target).toBe("compact");
    expect(result.scope).toBe("project");
  });

  it("parses 'help'", () => {
    const result = parseCommandArgs("help");
    expect(result.subcommand).toBe("help");
  });

  it("parses 'enable-all'", () => {
    const result = parseCommandArgs("enable-all");
    expect(result.subcommand).toBe("enable-all");
  });

  it("parses 'disable-all'", () => {
    const result = parseCommandArgs("disable-all");
    expect(result.subcommand).toBe("disable-all");
  });

  it("parses 'enable' with a target", () => {
    const result = parseCommandArgs("enable sf-ohana-spinner");
    expect(result.subcommand).toBe("enable");
    expect(result.target).toBe("sf-ohana-spinner");
  });

  it("parses 'disable' with a target", () => {
    const result = parseCommandArgs("disable sf-llm-gateway-internal");
    expect(result.subcommand).toBe("disable");
    expect(result.target).toBe("sf-llm-gateway-internal");
  });

  it("parses 'enable' without target (target is undefined)", () => {
    const result = parseCommandArgs("enable");
    expect(result.subcommand).toBe("enable");
    expect(result.target).toBeUndefined();
  });

  it("detects project scope from last token", () => {
    const result = parseCommandArgs("list project");
    expect(result.subcommand).toBe("list");
    expect(result.scope).toBe("project");
  });

  it("detects global scope explicitly", () => {
    const result = parseCommandArgs("status global");
    expect(result.subcommand).toBe("status");
    expect(result.scope).toBe("global");
  });

  it("parses 'manage' as overlay alias", () => {
    const result = parseCommandArgs("manage");
    expect(result.subcommand).toBe("overlay");
  });

  it("parses 'open' as overlay alias", () => {
    const result = parseCommandArgs("open");
    expect(result.subcommand).toBe("overlay");
  });

  it("defaults unknown subcommands to help", () => {
    const result = parseCommandArgs("unknown-thing");
    expect(result.subcommand).toBe("help");
  });

  it("does not treat 'global' or 'project' as enable target", () => {
    const result = parseCommandArgs("enable global");
    expect(result.subcommand).toBe("enable");
    expect(result.target).toBeUndefined();
  });

  it("routes 'recommended' to the recommended subcommand and forwards tail", () => {
    const result = parseCommandArgs("recommended install my-item project");
    expect(result.subcommand).toBe("recommended");
    expect(result.scope).toBe("project");
    expect(result.rest).toBe("install my-item project");
  });

  it("accepts 'rec' as recommended alias", () => {
    const result = parseCommandArgs("rec");
    expect(result.subcommand).toBe("recommended");
    expect(result.rest).toBe("");
  });

  it("routes 'doctor' to the doctor subcommand and forwards tail", () => {
    const result = parseCommandArgs("doctor fix skills");
    expect(result.subcommand).toBe("doctor");
    expect(result.rest).toBe("fix skills");
  });
});

describe("parseDoctorArgs", () => {
  it("defaults to status", () => {
    expect(parseDoctorArgs("")).toEqual({ subcommand: "status" });
  });

  it("parses fix targets", () => {
    expect(parseDoctorArgs("fix")).toEqual({ subcommand: "fix", target: "all" });
    expect(parseDoctorArgs("fix startup")).toEqual({ subcommand: "fix", target: "startup" });
    expect(parseDoctorArgs("repair skills")).toEqual({ subcommand: "fix", target: "skills" });
  });
});
