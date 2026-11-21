/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_canvas read returns the canvas body.
 *
 * Slack serves a canvas body only as HTML at the file's url_private_download.
 * files.info has metadata only and canvases.sections.lookup returns bare
 * section IDs, so read without criteria must download and convert the body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCanvasTool } from "../lib/canvas-tool.ts";
import { canvasHtmlToMarkdown } from "../lib/canvas-body.ts";
import { _resetGrantedScopes, downloadSlackFileText } from "../lib/api.ts";

const CANVAS_ID = "F0EXAMPLE01";
const DOWNLOAD_URL = `https://files.slack.com/files-pri/T00000000-${CANVAS_ID}/canvas`;
const CANVAS_HTML =
  '<div class="quip-canvas-content">' +
  '<h1 id="temp:C:1">Project plan</h1>' +
  '<p id="temp:C:2" class="line"><b>Goal:</b> ship the <a href="https://example.com/spec">spec</a> &amp; tests.</p>' +
  '<h2 id="temp:C:3">Use case 1: Briefing</h2>' +
  "<ul id='temp:C:4'><li value='1'><span>Read CRM data</span></li><li value='2'><span>Run web searches</span></li></ul>" +
  '<table data-header="row"><tr><th><p class="line">Block</p></th><th><p class="line">Source</p></th></tr>' +
  '<tr><td><p class="line">Client data</p></td><td><p class="line">CRM | Flow</p></td></tr></table>' +
  "</div>";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface CapturedTool {
  name: string;
  execute?: (...args: unknown[]) => Promise<unknown>;
}

function captureCanvasTool(): CapturedTool {
  const captured: CapturedTool[] = [];
  registerCanvasTool({
    registerTool(definition: CapturedTool) {
      captured.push(definition);
    },
  } as never);
  const tool = captured.find((entry) => entry.name === "slack_canvas");
  if (!tool?.execute) throw new Error("slack_canvas did not register an execute handler");
  return tool;
}

const ctx = {
  cwd: process.cwd(),
  hasUI: false,
  modelRegistry: { getApiKeyForProvider: vi.fn(async () => "xoxp-test") },
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function runRead(): Promise<ToolResult> {
  const tool = captureCanvasTool();
  return (await tool.execute!(
    "tool-call" as never,
    { action: "read", canvas_id: CANVAS_ID } as never,
    undefined as never,
    undefined as never,
    ctx as never,
  )) as ToolResult;
}

describe("canvasHtmlToMarkdown", () => {
  it("keeps headings, inline marks, links, lists, and tables", () => {
    const markdown = canvasHtmlToMarkdown(CANVAS_HTML);
    expect(markdown).toContain("# Project plan");
    expect(markdown).toContain("**Goal:** ship the [spec](https://example.com/spec) & tests.");
    expect(markdown).toContain("## Use case 1: Briefing");
    expect(markdown).toContain("- Read CRM data\n- Run web searches");
    expect(markdown).toContain("| Block | Source |\n| --- | --- |\n| Client data | CRM \\| Flow |");
  });

  it("drops scripts and styles and returns an empty string for an empty body", () => {
    expect(canvasHtmlToMarkdown("<script>alert(1)</script><style>p{}</style>")).toBe("");
  });
});

describe("downloadSlackFileText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses to send the token to a host other than files.slack.com", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadSlackFileText("https://evil.example.com/canvas", "xoxp-test");
    expect(result).toEqual({ ok: false, error: "untrusted_download_host" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not follow redirects and reports them as errors", async () => {
    const fetchMock = vi.fn(
      async () => new Response("", { status: 302, headers: { location: "https://x.example" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await downloadSlackFileText(DOWNLOAD_URL, "xoxp-test");
    expect(result).toEqual({ ok: false, error: "http_302" });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe("manual");
  });
});

describe("slack_canvas read", () => {
  beforeEach(() => _resetGrantedScopes());
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetGrantedScopes();
  });

  it("returns the canvas body as markdown after the metadata", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/files.info")) {
          return jsonResponse({
            ok: true,
            file: {
              id: CANVAS_ID,
              name: "Project plan",
              filetype: "quip",
              url_private: DOWNLOAD_URL,
              url_private_download: DOWNLOAD_URL,
            },
          });
        }
        if (url === DOWNLOAD_URL) {
          expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer xoxp-test");
          return new Response(CANVAS_HTML, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const result = await runRead();
    const text = result.content[0].text;
    expect(result.details.ok).toBe(true);
    expect(result.details.bodyIncluded).toBe(true);
    expect(text).toContain("File: Project plan");
    expect(text).toContain("--- Canvas body (markdown) ---");
    expect(text).toContain("## Use case 1: Briefing");
    expect(calls).toEqual(["https://slack.com/api/files.info", DOWNLOAD_URL]);
  });

  it("still returns metadata when the body download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/files.info")) {
          return jsonResponse({
            ok: true,
            file: { id: CANVAS_ID, name: "Project plan", url_private_download: DOWNLOAD_URL },
          });
        }
        return new Response("", { status: 403 });
      }),
    );

    const result = await runRead();
    expect(result.details.ok).toBe(true);
    expect(result.details.bodyIncluded).toBe(false);
    expect(result.content[0].text).toContain("File: Project plan");
    expect(result.content[0].text).toContain(
      "Canvas body not available: download failed (http_403)",
    );
  });

  it("does not present a Slack page that is not the canvas as its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/files.info")) {
          return jsonResponse({
            ok: true,
            file: { id: CANVAS_ID, name: "Project plan", url_private_download: DOWNLOAD_URL },
          });
        }
        return new Response(
          "<html><head><title>Slack</title></head><body><h1>Sign in to Slack</h1><p>Use your work email.</p></body></html>",
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }),
    );

    const result = await runRead();
    expect(result.details.ok).toBe(true);
    expect(result.details.bodyIncluded).toBe(false);
    expect(result.content[0].text).not.toContain("Sign in to Slack");
    expect(result.content[0].text).toContain(
      "Canvas body not available: Slack returned a page that is not the canvas",
    );
  });
});

describe("canvasHtmlToMarkdown keeps structure Slack exports", () => {
  // Shapes below mirror Slack's canvas export: links are <lnk>, code blocks
  // are <p class="prettyprint line"> with <br> line breaks, and a line can
  // hold several <br>-separated lines.
  it("renders Slack <lnk> links as markdown links", () => {
    expect(
      canvasHtmlToMarkdown(
        '<p class="line">See <lnk href="https://example.com/doc">the doc</lnk>.</p>',
      ),
    ).toBe("See [the doc](https://example.com/doc).");
  });

  it("renders prettyprint lines as a fenced code block with their line breaks", () => {
    expect(
      canvasHtmlToMarkdown(
        '<p class="prettyprint line">npm install<br>npm run build &amp;&amp; npm test<br><br>done</p>',
      ),
    ).toBe("```\nnpm install\nnpm run build && npm test\n\ndone\n```");
  });

  it("keeps <br> line breaks inside a paragraph", () => {
    expect(canvasHtmlToMarkdown('<p class="line"><b>Steps:</b> one<br>two<br>three</p>')).toBe(
      "**Steps:** one\ntwo\nthree",
    );
  });

  it("keeps nested list items as indented items", () => {
    const markdown = canvasHtmlToMarkdown(
      "<ul><li>Parent<ul><li>Child A</li><li>Child B</li></ul></li><li>Second</li></ul>",
    );
    expect(markdown).toBe("- Parent\n  - Child A\n  - Child B\n- Second");
  });

  it("keeps text in div lines and loose text outside block elements", () => {
    const markdown = canvasHtmlToMarkdown(
      '<div class="line">First line</div><div>Second <b>line</b></div>Loose <span>text</span>',
    );
    expect(markdown).toBe("First line\n\nSecond **line**\n\nLoose text");
  });

  it("keeps paragraph breaks inside quotes, list items, and table cells", () => {
    expect(canvasHtmlToMarkdown("<blockquote><p>line one</p><p>line two</p></blockquote>")).toBe(
      "> line one\n> line two",
    );
    expect(
      canvasHtmlToMarkdown(
        "<table><tr><th>H</th></tr><tr><td><ul><li>x</li><li>y</li></ul></td></tr></table>",
      ),
    ).toBe("| H |\n| --- |\n| x; y |");
  });

  it("bounds list nesting so hostile input cannot exhaust the stack", () => {
    const markdown = canvasHtmlToMarkdown(
      "<ul>".repeat(2000) + "<li>deep</li>" + "</ul>".repeat(2000),
    );
    expect(markdown).toContain("deep");
  });

  it("stays linear on unclosed block tags", () => {
    const started = performance.now();
    const markdown = canvasHtmlToMarkdown("<p>".repeat(80_000) + "tail");
    expect(markdown).toBe("tail");
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("stays linear on unclosed inline tags", () => {
    const started = performance.now();
    canvasHtmlToMarkdown(
      "<p>" + '<lnk href="https://example.com">x'.repeat(40_000) + "<b>y".repeat(40_000) + "</p>",
    );
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("keeps an image's element text but never its placeholder alt or blob path", () => {
    const markdown = canvasHtmlToMarkdown(
      '<div class="quip-canvas-content"><img src="/collab-slack-blob/x/F0EXAMPLE02" alt="_SLACK_FILE_ALT_PLACEHOLDER_F0EXAMPLE02">Diagram</img><p class="line">after</p></div>',
    );
    expect(markdown).toBe("Diagram\n\nafter");
  });

  it("decodes common named entities", () => {
    expect(canvasHtmlToMarkdown("<p>a &hellip; b &mdash; c &ndash; d &rsquo;s &copy;</p>")).toBe(
      "a … b — c – d ’s ©",
    );
  });

  it("drops link targets that are not http(s) or mailto and keeps the label", () => {
    expect(
      canvasHtmlToMarkdown(
        '<p><a href="javascript:alert(1)">click</a> <a href="mailto:a@example.com">mail</a> <a href="data:text/html,x">data</a></p>',
      ),
    ).toBe("click [mail](mailto:a@example.com) data");
  });
});
