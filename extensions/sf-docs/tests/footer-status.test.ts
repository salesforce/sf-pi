/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { classifyDocsFooterStatus, formatDocsFooterStatus } from "../lib/footer-status.ts";

const plainTheme = {
  fg: (_color: string, text: string) => text,
};

describe("SF Docs footer status", () => {
  it("hides a fully unconfigured Docs install", () => {
    const kind = classifyDocsFooterStatus({
      tokenSource: "none",
      endpoint: { ok: false, source: "none", error: "missing" },
    });
    expect(kind).toBe("not-configured");
    expect(formatDocsFooterStatus({ icon: "📖", kind }, plainTheme)).toBeNull();
  });

  it("warns when only the token or only the endpoint is present", () => {
    expect(
      classifyDocsFooterStatus({
        tokenSource: "env",
        endpoint: { ok: false, source: "none", error: "missing" },
      }),
    ).toBe("setup");
    expect(
      classifyDocsFooterStatus({
        tokenSource: "none",
        endpoint: { ok: true, source: "env", endpoint: "https://docs.example.test/" },
      }),
    ).toBe("setup");
    expect(formatDocsFooterStatus({ icon: "📖", kind: "setup" }, plainTheme)).toBe(
      "📖 Docs ! setup",
    );
  });

  it("warns when a configured endpoint is invalid", () => {
    expect(
      classifyDocsFooterStatus({
        tokenSource: "pi-auth",
        endpoint: { ok: false, source: "env", error: "invalid" },
      }),
    ).toBe("setup");
  });

  it("keeps a healthy configured state compact", () => {
    const kind = classifyDocsFooterStatus({
      tokenSource: "pi-auth",
      endpoint: { ok: true, source: "pi-auth", endpoint: "https://docs.example.test/" },
    });
    expect(kind).toBe("ready");
    expect(formatDocsFooterStatus({ icon: "📖", kind }, plainTheme)).toBe("📖 Docs ✓");

    const themed = formatDocsFooterStatus(
      { icon: "📖", kind: "ready" },
      { fg: (color, text) => `[${color}:${text}]` },
    );
    expect(themed).toContain("[dim:Docs]");
    expect(themed).toContain("[success:✓]");
  });
});
