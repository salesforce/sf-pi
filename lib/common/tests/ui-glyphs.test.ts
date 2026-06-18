/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for shared semantic UI glyph resolution. */
import { afterEach, describe, expect, it } from "vitest";
import { iconForCommandGroup, iconForExtension, resolveUiGlyphs } from "../ui-glyphs.ts";

const originalFlag = process.env.SF_PI_ASCII_ICONS;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SF_PI_ASCII_ICONS;
  else process.env.SF_PI_ASCII_ICONS = originalFlag;
});

describe("ui glyphs", () => {
  it("resolves semantic command-group icons", () => {
    const glyphs = resolveUiGlyphs(process.cwd());

    expect(iconForCommandGroup("Browser", glyphs)).toBe(glyphs.browser);
    expect(iconForCommandGroup("Evidence", glyphs)).toBe(glyphs.evidence);
    expect(iconForCommandGroup("Automation — project", glyphs)).toBe(glyphs.automation);
    expect(iconForCommandGroup("ApexGuru setup", glyphs)).toBe(glyphs.agent);
    expect(iconForCommandGroup("Lifecycle", glyphs)).toBe(glyphs.lifecycle);
  });

  it("resolves stable extension identity icons with ASCII fallbacks", () => {
    process.env.SF_PI_ASCII_ICONS = "0";
    const rich = resolveUiGlyphs(process.cwd());
    expect(iconForExtension("sf-code-analyzer", rich)).toBe("🧪");
    expect(iconForExtension("sf-browser", rich)).toBe("🌐");
    expect(iconForExtension("sf-guardrail", rich)).toBe("🛡");

    process.env.SF_PI_ASCII_ICONS = "1";
    const ascii = resolveUiGlyphs(process.cwd());
    expect(iconForExtension("sf-code-analyzer", ascii)).toBe("ca");
    expect(iconForExtension("sf-browser", ascii)).toBe("br");
    expect(iconForExtension("sf-guardrail", ascii)).toBe("gr");
  });
});
