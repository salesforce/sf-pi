/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { classifyDocsFooterStatus, formatDocsFooterStatus } from "../lib/footer-status.ts";

const plainTheme = {
  fg: (_color: string, text: string) => text,
};

describe("SF Docs footer status", () => {
  it("hides an unconfigured Docs install", () => {
    const kind = classifyDocsFooterStatus({ ok: false, source: "none", error: "missing" });
    expect(kind).toBe("not-configured");
    expect(formatDocsFooterStatus({ icon: "📖", kind }, plainTheme)).toBeNull();
  });

  it("warns when a configured endpoint is invalid", () => {
    const kind = classifyDocsFooterStatus({ ok: false, source: "env", error: "invalid" });
    expect(kind).toBe("setup");
    expect(formatDocsFooterStatus({ icon: "📖", kind }, plainTheme)).toBe("📖 Docs ! setup");
  });

  it("keeps a valid endpoint-only state compact", () => {
    const kind = classifyDocsFooterStatus({
      ok: true,
      source: "pi-auth",
      endpoint: "https://docs.example.test/",
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
