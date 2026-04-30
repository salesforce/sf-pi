/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for file classification and path resolution in sf-agentscript-assist.
 */
import { describe, expect, it } from "vitest";
import { isAgentScriptFile, resolveToolPath } from "../lib/file-classify.ts";

describe("isAgentScriptFile", () => {
  it("matches .agent files", () => {
    expect(isAgentScriptFile("/project/agents/MyAgent.agent")).toBe(true);
  });

  it("is case-insensitive on the extension", () => {
    expect(isAgentScriptFile("/project/agents/MyAgent.AGENT")).toBe(true);
  });

  it("handles Windows backslash paths", () => {
    expect(isAgentScriptFile("C:\\project\\agents\\MyAgent.agent")).toBe(true);
  });

  it("rejects non-agent files", () => {
    expect(isAgentScriptFile("/project/classes/MyClass.cls")).toBe(false);
    expect(isAgentScriptFile("/project/lwc/my/my.js")).toBe(false);
    expect(isAgentScriptFile("/project/README.md")).toBe(false);
  });

  it("rejects files that merely contain 'agent' in the path", () => {
    expect(isAgentScriptFile("/project/my-agent/readme.md")).toBe(false);
  });
});

describe("resolveToolPath", () => {
  it("resolves relative paths against cwd", () => {
    expect(resolveToolPath("agents/Billing.agent", "/home/user/project")).toBe(
      "/home/user/project/agents/Billing.agent",
    );
  });

  it("strips the @ prefix before resolving", () => {
    expect(resolveToolPath("@agents/Billing.agent", "/home/user/project")).toBe(
      "/home/user/project/agents/Billing.agent",
    );
  });

  it("preserves absolute paths", () => {
    expect(resolveToolPath("/absolute/path/Billing.agent", "/home/user/project")).toBe(
      "/absolute/path/Billing.agent",
    );
  });

  it("strips @ from absolute paths", () => {
    expect(resolveToolPath("@/absolute/path/Billing.agent", "/home/user/project")).toBe(
      "/absolute/path/Billing.agent",
    );
  });
});
