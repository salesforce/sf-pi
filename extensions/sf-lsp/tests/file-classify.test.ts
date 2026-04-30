/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for file classification and path resolution.
 */
import { describe, it, expect } from "vitest";
import {
  getSfLspLanguageForFile,
  resolveToolPath,
  getLspLanguageId,
} from "../lib/file-classify.ts";

// -------------------------------------------------------------------------------------------------
// getSfLspLanguageForFile
// -------------------------------------------------------------------------------------------------

describe("getSfLspLanguageForFile", () => {
  // Apex
  it("classifies .cls files as apex", () => {
    expect(getSfLspLanguageForFile("/project/force-app/main/default/classes/MyClass.cls")).toBe(
      "apex",
    );
  });

  it("classifies .trigger files as apex", () => {
    expect(
      getSfLspLanguageForFile("/project/force-app/main/default/triggers/MyTrigger.trigger"),
    ).toBe("apex");
  });

  // Agent Script
  it("classifies .agent files as agentscript", () => {
    expect(getSfLspLanguageForFile("/project/agents/MyAgent.agent")).toBe("agentscript");
  });

  // LWC
  it("classifies LWC .js files as lwc", () => {
    expect(
      getSfLspLanguageForFile("/project/force-app/main/default/lwc/myComponent/myComponent.js"),
    ).toBe("lwc");
  });

  it("classifies LWC .html files as lwc", () => {
    expect(
      getSfLspLanguageForFile("/project/force-app/main/default/lwc/myComponent/myComponent.html"),
    ).toBe("lwc");
  });

  it("is case-insensitive for LWC extension matching", () => {
    expect(getSfLspLanguageForFile("/project/force-app/main/default/lwc/myComp/myComp.JS")).toBe(
      "lwc",
    );
    expect(getSfLspLanguageForFile("/project/force-app/main/default/lwc/myComp/myComp.HTML")).toBe(
      "lwc",
    );
  });

  // Unsupported files
  it("returns null for unsupported extensions", () => {
    expect(getSfLspLanguageForFile("/project/README.md")).toBeNull();
    expect(getSfLspLanguageForFile("/project/package.json")).toBeNull();
    expect(getSfLspLanguageForFile("/project/src/index.ts")).toBeNull();
  });

  it("returns null for .js files outside lwc bundles", () => {
    expect(getSfLspLanguageForFile("/project/scripts/deploy.js")).toBeNull();
    expect(getSfLspLanguageForFile("/project/src/utils.js")).toBeNull();
  });

  it("returns null for LWC .css files (not supported by this extension)", () => {
    expect(
      getSfLspLanguageForFile("/project/force-app/main/default/lwc/myComponent/myComponent.css"),
    ).toBeNull();
  });

  // Backslash normalization (Windows paths)
  it("handles backslash paths", () => {
    expect(getSfLspLanguageForFile("C:\\project\\classes\\MyClass.cls")).toBe("apex");
    expect(getSfLspLanguageForFile("C:\\project\\lwc\\myComp\\myComp.js")).toBe("lwc");
  });
});

// -------------------------------------------------------------------------------------------------
// resolveToolPath
// -------------------------------------------------------------------------------------------------

describe("resolveToolPath", () => {
  it("resolves relative paths against cwd", () => {
    const result = resolveToolPath("classes/MyClass.cls", "/home/user/project");
    expect(result).toBe("/home/user/project/classes/MyClass.cls");
  });

  it("strips @ prefix before resolving", () => {
    const result = resolveToolPath("@force-app/main/MyClass.cls", "/home/user/project");
    expect(result).toBe("/home/user/project/force-app/main/MyClass.cls");
  });

  it("preserves absolute paths", () => {
    const result = resolveToolPath("/absolute/path/MyClass.cls", "/home/user/project");
    expect(result).toBe("/absolute/path/MyClass.cls");
  });

  it("strips @ from absolute paths", () => {
    const result = resolveToolPath("@/absolute/path/MyClass.cls", "/home/user/project");
    expect(result).toBe("/absolute/path/MyClass.cls");
  });
});

// -------------------------------------------------------------------------------------------------
// getLspLanguageId
// -------------------------------------------------------------------------------------------------

describe("getLspLanguageId", () => {
  it("returns 'apex' for apex files", () => {
    expect(getLspLanguageId("apex", "MyClass.cls")).toBe("apex");
  });

  it("returns 'agentscript' for agent files", () => {
    expect(getLspLanguageId("agentscript", "MyAgent.agent")).toBe("agentscript");
  });

  it("returns 'html' for LWC .html files", () => {
    expect(getLspLanguageId("lwc", "myComponent.html")).toBe("html");
  });

  it("returns 'javascript' for LWC .js files", () => {
    expect(getLspLanguageId("lwc", "myComponent.js")).toBe("javascript");
  });
});
