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
import { getSfPiArgumentCompletions, parseCommandArgs } from "../index.ts";
import { parseDoctorArgs } from "../lib/doctor-command.ts";

// -------------------------------------------------------------------------------------------------
// parseCommandArgs
// -------------------------------------------------------------------------------------------------

describe("parseCommandArgs", () => {
  it("defaults to overlay with auto-detect scope when no args", () => {
    // scope=undefined signals "resolve at dispatch time" (project > global).
    // See lib/common/sf-pi-package-state.ts > resolveEffectiveScope.
    const result = parseCommandArgs("");
    expect(result.subcommand).toBe("overlay");
    expect(result.scope).toBeUndefined();
  });

  it("leaves scope undefined when no global/project token is given", () => {
    expect(parseCommandArgs("list").scope).toBeUndefined();
    expect(parseCommandArgs("status").scope).toBeUndefined();
    expect(parseCommandArgs("enable sf-ohana-spinner").scope).toBeUndefined();
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
    expect(result.route?.extensionId).toBeUndefined();
  });

  it("parses 'open <extension>' as a detail deep link", () => {
    const result = parseCommandArgs("open sf-guardrail");
    expect(result.subcommand).toBe("overlay");
    expect(result.target).toBe("sf-guardrail");
    expect(result.route).toEqual({ extensionId: "sf-guardrail", view: "detail" });
  });

  it("parses 'open <extension> settings' as a settings deep link", () => {
    const result = parseCommandArgs("open sf-guardrail settings global");
    expect(result.subcommand).toBe("overlay");
    expect(result.scope).toBe("global");
    expect(result.route).toEqual({ extensionId: "sf-guardrail", view: "settings" });
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

  it("routes 'auto-update' to the native auto-update subcommand", () => {
    const result = parseCommandArgs("auto-update run");
    expect(result.subcommand).toBe("auto-update");
    expect(result.rest).toBe("run");
  });
});

describe("getSfPiArgumentCompletions", () => {
  const completions = (prefix: string) => getSfPiArgumentCompletions(prefix) ?? [];
  const values = (prefix: string) => completions(prefix).map((item) => item.value);
  const labels = (prefix: string) => completions(prefix).map((item) => item.label);

  it("completes top-level subcommands directly", () => {
    expect(completions("aut")).toContainEqual(
      expect.objectContaining({
        value: "auto-update ",
        label: "auto-update",
        description: "Manage opt-in Native Auto Update",
      }),
    );
  });

  it("discovers auto-update actions after a trailing space", () => {
    expect(completions("auto-update ")).toContainEqual(
      expect.objectContaining({
        value: "auto-update status",
        label: "status",
        description: "Show Native Auto Update status",
      }),
    );
  });

  it("returns full argument-tail values for auto-update actions", () => {
    expect(values("auto-update st")).toEqual(["auto-update status"]);
    expect(labels("auto-update st")).toEqual(["status"]);
  });

  it("returns full argument-tail values for telemetry actions", () => {
    expect(values("telemetry o")).toEqual(["telemetry on", "telemetry off"]);
    expect(labels("telemetry o")).toEqual(["on", "off"]);
  });

  it("returns full argument-tail values for display profiles and scopes", () => {
    expect(values("display co")).toEqual(["display compact "]);
    expect(values("display compact pr")).toEqual(["display compact project"]);
  });

  it("returns full argument-tail values for extension targets", () => {
    expect(values("enable sf-brow")).toContain("enable sf-browser ");
    expect(labels("enable sf-brow")).toContain("sf-browser");
    expect(values("enable sf-browser gl")).toEqual(["enable sf-browser global"]);
  });

  it("returns full argument-tail values for open views", () => {
    expect(values("open sf-guardrail ")).toEqual([
      "open sf-guardrail detail",
      "open sf-guardrail settings",
    ]);
    expect(values("open sf-guardrail set")).toEqual(["open sf-guardrail settings"]);
  });

  it("returns full argument-tail values for scoped commands", () => {
    expect(values("status pr")).toEqual(["status project"]);
  });
});

describe("parseDoctorArgs", () => {
  it("defaults to status", () => {
    expect(parseDoctorArgs("")).toEqual({ subcommand: "status" });
  });

  it("parses runtime diagnostics", () => {
    expect(parseDoctorArgs("runtime")).toEqual({ subcommand: "runtime" });
    expect(parseDoctorArgs("rt")).toEqual({ subcommand: "runtime" });
  });

  it("parses fix targets", () => {
    expect(parseDoctorArgs("fix")).toEqual({ subcommand: "fix", target: "all" });
    expect(parseDoctorArgs("fix startup")).toEqual({ subcommand: "fix", target: "startup" });
    expect(parseDoctorArgs("repair skills")).toEqual({ subcommand: "fix", target: "skills" });
  });
});
