/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  checkExternalLink,
  classifyLinkAttempts,
  extractExternalLinks,
  renderExternalLinkReport,
} from "../lib/external-link-report.mjs";

describe("external link reporting", () => {
  it("extracts unique authored links while ignoring images, code, and placeholders", () => {
    const links = extractExternalLinks([
      {
        file: "docs/one.md",
        source: [
          "[Salesforce](https://developer.salesforce.com/docs)",
          "[same](https://developer.salesforce.com/docs)",
          "<https://pi.dev/docs>",
          "[guide]: https://docs.github.com/actions",
          "![badge](https://img.shields.io/example.svg)",
          "```text",
          "https://example.invalid/not-a-link",
          "```",
          "[fixture](https://example.com/fixture)",
          "[same repository](https://github.com/salesforce/sf-pi/issues)",
        ].join("\n"),
      },
      {
        file: "docs/two.md",
        source: "[Salesforce again](https://developer.salesforce.com/docs)",
      },
    ]);

    expect(links).toEqual([
      {
        url: "https://developer.salesforce.com/docs",
        sources: ["docs/one.md", "docs/two.md"],
      },
      { url: "https://docs.github.com/actions", sources: ["docs/one.md"] },
      { url: "https://pi.dev/docs", sources: ["docs/one.md"] },
    ]);
  });

  it("classifies only repeated 404/410 responses as stable dead links", () => {
    expect(classifyLinkAttempts([{ status: 404 }, { status: 404 }])).toBe("stable_dead");
    expect(classifyLinkAttempts([{ status: 410 }, { status: 404 }])).toBe("stable_dead");
    expect(classifyLinkAttempts([{ status: 404 }, { status: 200 }])).toBe("ok");
    expect(classifyLinkAttempts([{ status: 500 }, { status: 500 }])).toBe("advisory");
    expect(classifyLinkAttempts([{ error: "timeout" }, { error: "timeout" }])).toBe("advisory");
  });

  it("retries a dead response and records redirect-safe attempt facts", async () => {
    const statuses = [404, 200];
    const result = await checkExternalLink("https://docs.example.org/page", {
      fetchImpl: async () => ({
        status: statuses.shift() ?? 200,
        url: "https://docs.example.org/page",
        body: { cancel: async () => undefined },
      }),
      retryDelayMs: 0,
      timeoutMs: 100,
    });

    expect(result.classification).toBe("ok");
    expect(result.attempts.map((attempt: { status?: number }) => attempt.status)).toEqual([
      404, 200,
    ]);
  });

  it("renders dead links separately from advisory transport results", () => {
    const markdown = renderExternalLinkReport({
      generatedAt: "2026-08-11T00:00:00.000Z",
      summary: { total: 2, ok: 0, stableDead: 1, advisory: 1 },
      results: [
        {
          url: "https://docs.example.org/gone",
          sources: ["docs/a.md"],
          classification: "stable_dead",
          attempts: [{ status: 404 }, { status: 404 }],
        },
        {
          url: "https://docs.example.org/blocked",
          sources: ["docs/b.md"],
          classification: "advisory",
          attempts: [{ status: 403 }],
        },
      ],
    });

    expect(markdown).toContain("## Stable 404/410 results");
    expect(markdown).toContain("## Advisory results");
    expect(markdown).toContain("This report does not fail the workflow");
  });
});
