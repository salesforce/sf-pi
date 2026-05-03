/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for sf-welcome.
 *
 * Verifies the extension module can be imported and exports a default function,
 * and that splash data collection and component rendering work correctly.
 */
import { describe, it, expect } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";

/**
 * Strip ANSI escapes from a rendered splash so assertions can match plain
 * text without worrying about the color-code payload and without matching
 * across column boundaries (which wrap escape sequences mid-segment).
 */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("sf-welcome", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("splash-data exports collectSplashData", async () => {
    const mod = await import("../lib/splash-data.ts");
    expect(typeof mod.collectSplashData).toBe("function");
    expect(typeof mod.discoverLoadedCounts).toBe("function");
    expect(typeof mod.getRecentSessions).toBe("function");
    expect(typeof mod.discoverExtensionHealth).toBe("function");
    expect(typeof mod.checkSlackConnection).toBe("function");
    expect(typeof mod.estimateMonthlyCost).toBe("function");
  });

  it("extension health stays aligned with the generated registry", async () => {
    const { discoverExtensionHealth } = await import("../lib/splash-data.ts");
    const { SF_PI_REGISTRY } = await import("../../../catalog/registry.ts");

    const health = discoverExtensionHealth(process.cwd());
    expect(health.length).toBe(SF_PI_REGISTRY.length);
    expect(health.some((item) => item.name === "Pi Manager")).toBe(true);
  });

  it("splash-component exports overlay and header classes", async () => {
    const mod = await import("../lib/splash-component.ts");
    expect(mod.SfWelcomeOverlay).toBeDefined();
    expect(mod.SfWelcomeHeader).toBeDefined();
  });

  it("SfWelcomeOverlay renders without crashing", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Sonnet 4",
      providerName: "anthropic",
      loadedCounts: { extensions: 5, skills: 2, promptTemplates: 1 },
      recentSessions: [{ name: "test-project", timeAgo: "2h ago" }],
      extensionHealth: [
        { name: "LLM Gateway", status: "active" as const, icon: "●" },
        { name: "Pi Manager", status: "locked" as const, icon: "◆" },
        { name: "Ohana Spinner", status: "disabled" as const, icon: "○" },
      ],
      slackConnected: true,
      monthlyCost: 450.5,
      monthlyBudget: 3000,

      lifetimeCost: 0,
    };

    const overlay = new SfWelcomeOverlay(data);
    const lines = overlay.render(100);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
  });

  it("uses the wider splash layout on roomy terminals", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Sonnet 4",
      providerName: "anthropic",
      loadedCounts: { extensions: 5, skills: 2, promptTemplates: 1 },
      recentSessions: [{ name: "test-project", timeAgo: "2h ago" }],
      extensionHealth: [
        { name: "LLM Gateway", status: "active" as const, icon: "●" },
        { name: "Pi Manager", status: "locked" as const, icon: "◆" },
      ],
      slackConnected: true,
      monthlyCost: 450.5,
      monthlyBudget: 3000,

      lifetimeCost: 0,
    };

    const overlay = new SfWelcomeOverlay(data);
    const lines = overlay.render(220);
    const widestLine = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);

    expect(widestLine).toBeGreaterThan(150);
  });

  it("SfWelcomeHeader renders without crashing", async () => {
    const { SfWelcomeHeader } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Sonnet 4",
      providerName: "anthropic",
      loadedCounts: { extensions: 3, skills: 1, promptTemplates: 0 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: false,
      monthlyCost: 0,
      monthlyBudget: 3000,

      lifetimeCost: 0,
    };

    const header = new SfWelcomeHeader(data);
    const lines = header.render(100);
    expect(Array.isArray(lines)).toBe(true);
    expect(lines.length).toBeGreaterThan(5);
  });

  it("renders freshness hints for cached Salesforce environment data", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Sonnet 4",
      providerName: "anthropic",
      loadedCounts: { extensions: 3, skills: 1, promptTemplates: 0 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: false,
      monthlyCost: 0,
      monthlyBudget: 3000,

      lifetimeCost: 0,
      sfEnvironment: {
        cliInstalled: true,
        cliVersion: "2.130.9",
        defaultOrg: "CachedOrg",
        orgType: "sandbox",
        connected: true,
        apiVersion: "66.0",
        configScope: "Global",
        detectedAt: Date.now() - 12 * 60 * 1000 - 5 * 1000,
        source: "cached" as const,
        refreshing: true,
        loading: false,
      },
    };

    const overlay = new SfWelcomeOverlay(data);
    const raw = overlay.render(100).join("\n");
    const plain = stripAnsi(raw);
    expect(plain).toContain("updated 12m ago");
    expect(plain).toContain("cached");
    expect(plain).toContain("refreshing");
    // The environment block collapses org + connection status onto one line
    // and no longer prints the instance URL. Those expectations are locked
    // in here so a future render tweak doesn't silently bring them back.
    expect(plain).toMatch(/Org:.*CachedOrg.*sandbox.*Connected/);
    // "salesforce.com/ai-ethics" on the right is fine — it's the instance
    // URL in the left env block that should be gone.
    expect(plain).not.toContain("https://");
    // Trademark must appear in the left column (under the provider
    // name), not below the Salesforce AI / feedback block on the right.
    // On narrow left columns the trademark wraps across multiple lines,
    // so assert on the constituent words instead of the full phrase.
    expect(plain).toContain("trademarks of");
    expect(plain).toContain("Salesforce, Inc.");
    expect(plain).not.toContain("Independent community project");
    expect(plain).not.toContain("Not affiliated with Salesforce");
    // Legacy "coming soon" tease should no longer appear.
    expect(plain).not.toContain("coming soon");
  });

  it("renders an infinite monthly budget when the gateway reports no ceiling", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Opus 4.7",
      providerName: "sf-llm-gateway-internal",
      loadedCounts: { extensions: 8, skills: 38, promptTemplates: 1 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: true,
      monthlyCost: 850.25,
      monthlyBudget: null,

      lifetimeCost: 0,
      monthlyUsageSource: "gateway" as const,
    };

    const overlay = new SfWelcomeOverlay(data);
    const plain = stripAnsi(overlay.render(140).join("\n"));
    // Gateway status shows `$850/∞` — the splash should match.
    expect(plain).toMatch(/\$850\s*\/\s*∞/);
    // A gateway-sourced value should not carry the "local estimate" hint.
    expect(plain).not.toContain("local estimate");
  });

  it("labels session-derived monthly usage as a local estimate", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Sonnet 4",
      providerName: "anthropic",
      loadedCounts: { extensions: 3, skills: 1, promptTemplates: 0 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: false,
      monthlyCost: 186,
      monthlyBudget: 3000,

      lifetimeCost: 0,
      monthlyUsageSource: "sessions" as const,
    };

    const overlay = new SfWelcomeOverlay(data);
    const plain = stripAnsi(overlay.render(140).join("\n"));
    expect(plain).toContain("local estimate");
  });

  it("does not render the legacy Tips panel or generic pi key hints", async () => {
    // The Tips panel was removed in favor of a fuller Recommended block.
    // Lock in the removal here so a future revert doesn't silently bring
    // the panel back. Generic pi hints (`/`, `!`, Shift+Tab) were never
    // part of the splash either — assert they stay out.
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Opus 4.7",
      providerName: "sf-llm-gateway-internal",
      loadedCounts: { extensions: 8, skills: 38, promptTemplates: 1 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: true,
      monthlyCost: 0,
      monthlyBudget: null,
      lifetimeCost: 0,
      monthlyUsageSource: "gateway" as const,
    };

    const overlay = new SfWelcomeOverlay(data);
    const plain = stripAnsi(overlay.render(140).join("\n"));

    expect(plain).not.toMatch(/\bTips\b/);
    expect(plain).not.toMatch(/^\s*\/\s+for commands/m);
    expect(plain).not.toMatch(/^\s*!\s+to run bash/m);
    expect(plain).not.toContain("Shift+Tab");
  });

  it("returns empty lines for narrow terminals", async () => {
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Test",
      providerName: "test",
      loadedCounts: { extensions: 0, skills: 0, promptTemplates: 0 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: false,
      monthlyCost: 0,
      monthlyBudget: 3000,

      lifetimeCost: 0,
    };

    const overlay = new SfWelcomeOverlay(data);
    const lines = overlay.render(20); // Too narrow
    expect(lines).toEqual([]);
  });

  it("falls back to a single-column stacked layout on narrow terminals (issue #17)", async () => {
    // At ~90 cols (typical Terminal.app default), the two-column layout
    // used to truncate the right column with an ellipsis. The fix swaps
    // to a single-column stack so every content block renders in full.
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Opus 4.6",
      providerName: "sf-llm-gateway-internal",
      loadedCounts: { extensions: 8, skills: 38, promptTemplates: 1 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: true,
      monthlyCost: 0,
      monthlyBudget: null,

      lifetimeCost: 0,
      monthlyUsageSource: "gateway" as const,
    };

    const overlay = new SfWelcomeOverlay(data);
    const plain = stripAnsi(overlay.render(92).join("\n"));

    // Left-column content must be present…
    expect(plain).toContain("Welcome back!");
    expect(plain).toContain("sf-pi Extensions");
    // …and the right-column 'Recent Sessions' heading confirms the stacked
    // layout is actually rendering the right-column content below the
    // left column instead of truncating it.
    expect(plain).toContain("Recent Sessions");
    // Single-column stacks should have exactly one vertical border per
    // row, not two (two-column mode has `│ left │ right │`).
    const midLine = plain.split("\n").find((l) => l.includes("Welcome back!")) ?? "";
    const barCount = (midLine.match(/│/g) ?? []).length;
    expect(barCount).toBe(2);
  });

  it("fills wide terminals instead of capping at 176 cols", async () => {
    // The old MAX_WIDTH=176 left a visibly unused gutter on ~200-col
    // windows. MAX_BOX_WIDTH=220 lets the splash grow to fill.
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const data = {
      modelName: "Claude Opus 4.6",
      providerName: "sf-llm-gateway-internal",
      loadedCounts: { extensions: 9, skills: 38, promptTemplates: 1 },
      recentSessions: [],
      extensionHealth: [],
      slackConnected: true,
      monthlyCost: 0,
      monthlyBudget: null,

      lifetimeCost: 0,
    };

    const overlay = new SfWelcomeOverlay(data);
    const lines = overlay.render(210);
    const widestLine = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
    // On a 210-col terminal we expect the box to consume at least ~200
    // cols (was capped near 176 before the fix).
    expect(widestLine).toBeGreaterThanOrEqual(200);
  });

  it("swaps emoji glyphs for ASCII fallbacks when glyph policy forces ascii", async () => {
    // Simulates Terminal.app (or an explicit SF_PI_ASCII_ICONS=1 opt-in)
    // by setting the env var for the duration of the test. The splash
    // should render ASCII variants (`$ Monthly Usage`, `[] Loaded`, etc.)
    // instead of the emoji ones.
    const { SfWelcomeOverlay } = await import("../lib/splash-component.ts");
    const prev = process.env.SF_PI_ASCII_ICONS;
    process.env.SF_PI_ASCII_ICONS = "1";
    try {
      const data = {
        modelName: "Claude Opus 4.6",
        providerName: "sf-llm-gateway-internal",
        loadedCounts: { extensions: 9, skills: 38, promptTemplates: 1 },
        recentSessions: [],
        extensionHealth: [],
        slackConnected: true,
        monthlyCost: 123,
        monthlyBudget: null,
        lifetimeCost: 0,
        monthlyUsageSource: "gateway" as const,
      };
      const overlay = new SfWelcomeOverlay(data);
      const plain = stripAnsi(overlay.render(140).join("\n"));

      // ASCII variants present…
      expect(plain).toMatch(/\$ Monthly Usage/);
      expect(plain).toMatch(/\[\] Loaded/);
      expect(plain).toContain("+ sf-pi Extensions");
      // …and the emoji variants are gone.
      expect(plain).not.toContain("💰 Monthly Usage");
      expect(plain).not.toContain("📦 Loaded");
    } finally {
      if (prev === undefined) delete process.env.SF_PI_ASCII_ICONS;
      else process.env.SF_PI_ASCII_ICONS = prev;
    }
  });
});
