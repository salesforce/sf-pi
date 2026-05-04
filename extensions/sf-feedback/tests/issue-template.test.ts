/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildIssueBody, labelForKind, normalizeIssueTitle } from "../lib/issue-template.ts";
import type { Diagnostics, FeedbackDraft } from "../lib/types.ts";

const diagnostics: Diagnostics = {
  sfPiVersion: "0.1.0",
  piVersion: "0.2.0",
  nodeVersion: "v20.0.0",
  npmVersion: "10.0.0",
  platform: "darwin",
  osRelease: "1.0.0",
  arch: "arm64",
  shell: "zsh",
  terminal: "Apple_Terminal",
  term: "xterm-256color",
  colorTerm: "truecolor",
  locale: "en_US.UTF-8",
  terminalSize: "120x40",
  isCI: false,
  isTty: true,
  cwd: "~/work/<project>",
  gitInsideWorkTree: true,
  gitBranch: "main",
  gitStatusSummary: "clean",
  gitRemote: "github.com/salesforce/sf-pi",
  sfCliVersion: "2.0.0",
  sfCliPlugins: "12 core plugin(s)",
  sfOrgConnected: "configured (alias redacted)",
  sfOrgApiVersion: "66.0",
  enabledExtensions: ["sf-feedback"],
  disabledExtensions: [],
  github: { ghAvailable: true, authenticated: true, login: "octocat" },
  tools: [{ name: "gh", available: true }],
};

describe("sf-feedback issue template", () => {
  it("normalizes titles and labels", () => {
    expect(normalizeIssueTitle("bug", "crashes on startup")).toBe("[Bug] crashes on startup");
    expect(labelForKind("feature")).toEqual(["feedback", "enhancement"]);
  });

  it("builds a sanitized public issue body", () => {
    const draft: FeedbackDraft = {
      kind: "bug",
      title: "bad thing",
      summary: "It printed jane@example.com and https://example.my.salesforce.com",
      expected: "No private data",
      steps: "1. Run it",
    };

    const body = buildIssueBody(draft, diagnostics);

    expect(body).toContain("## Diagnostics");
    expect(body).toContain("SF Pi: 0.1.0");
    expect(body).toContain("<email-redacted>");
    expect(body).toContain("<salesforce-instance-url-redacted>");
    expect(body).not.toContain("jane@example.com");
  });
});
