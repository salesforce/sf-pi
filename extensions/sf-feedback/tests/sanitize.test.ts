/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { sanitizeRemoteUrl, sanitizeText } from "../lib/sanitize.ts";

describe("sf-feedback sanitize", () => {
  it("redacts public-issue unsafe identifiers", () => {
    const text = [
      "email jane@example.com",
      "url https://example.my.salesforce.com/lightning/setup",
      "org 00D000000000000AAA",
      "token ghp_abcdefghijklmnopqrstuvwxyz123456",
    ].join("\n");

    const sanitized = sanitizeText(text);

    expect(sanitized).toContain("<email-redacted>");
    expect(sanitized).toContain("<salesforce-instance-url-redacted>");
    expect(sanitized).toContain("<org-id-redacted>");
    expect(sanitized).toContain("<token-redacted>");
    expect(sanitized).not.toContain("jane@example.com");
  });

  it("keeps GitHub remotes but redacts non-GitHub remotes", () => {
    expect(sanitizeRemoteUrl("https://github.com/salesforce/sf-pi.git")).toBe(
      "github.com/salesforce/sf-pi",
    );
    expect(sanitizeRemoteUrl("git@github.com:salesforce/sf-pi.git")).toBe(
      "github.com/salesforce/sf-pi",
    );
    expect(sanitizeRemoteUrl("ssh://git.example.com/private/repo.git")).toBe(
      "<non-github-remote-redacted>",
    );
  });
});
