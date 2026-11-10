/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildIssueUrl,
  createIssueWithGh,
  isIssueCreationPermissionError,
  openUrl,
} from "../lib/github.ts";
import type { ExecFn } from "../lib/diagnostics.ts";

describe("sf-feedback GitHub helpers", () => {
  it("builds a prefilled GitHub issue URL", () => {
    const url = buildIssueUrl("[Bug] Broken", "Body text", ["feedback", "bug"]);

    expect(url).toContain("https://github.com/salesforce/sf-pi/issues/new?");
    expect(url).toContain("title=%5BBug%5D+Broken");
    expect(url).toContain("body=Body+text");
    expect(url).toContain("labels=feedback%2Cbug");
  });

  it("classifies Enterprise Managed User createIssue failures as manual fallback", () => {
    expect(
      isIssueCreationPermissionError(
        "GraphQL: Unauthorized: As an Enterprise Managed User, you cannot access this content (createIssue)",
      ),
    ).toBe(true);
  });

  it("does not auto-open fallback URLs for createIssue permission failures", async () => {
    const exec: ExecFn = async () => ({
      code: 1,
      stdout: "",
      stderr:
        "GraphQL: Unauthorized: As an Enterprise Managed User, you cannot access this content (createIssue)",
    });

    const result = await createIssueWithGh(exec, "[Bug] Broken", "Body text", ["feedback"]);

    expect(result.ok).toBe(false);
    expect(result.shouldOpenFallback).toBe(false);
    expect(result.fallbackUrl).toContain("https://github.com/salesforce/sf-pi/issues/new?");
  });
});

describe("openUrl", () => {
  it("opens the prefilled issue URL with & intact on Windows, without cmd.exe", async () => {
    const calls: Array<[string, string[]]> = [];
    const exec = async (command: string, args: string[]) => {
      calls.push([command, args]);
      return { stdout: "", stderr: "", code: 0 };
    };
    const url = "https://github.com/example/repo/issues/new?title=Bug&body=Steps&labels=bug";
    await expect(openUrl(exec, url, "win32")).resolves.toBe(true);
    expect(calls).toEqual([["rundll32", ["url.dll,FileProtocolHandler", url]]]);
  });
});
