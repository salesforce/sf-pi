/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_canvas tool — read, create, edit.
 *
 * The only write surface in sf-slack.
 */
import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackCanvasParams,
  type ApiErr,
  type CanvasCreateResponse,
  type CanvasSectionsLookupResponse,
  type FilesInfoResponse,
  type JsonCompatibleParams,
  type SlackCanvasSection,
  type StructuredCanvasSection,
  type StructuredFile,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import {
  slackApi,
  slackApiJson,
  errorResult,
  hasScope,
  hasScopeKnown,
  detectTokenType,
  type SlackTokenType,
} from "./api.ts";
import { formatFileInfo, extractStructuredFile } from "./format.ts";
import { buildSlackTextResult, SLACK_OUTPUT_DESCRIPTION_SUFFIX } from "./truncation.ts";

interface CanvasToolCallArgs {
  action?: string;
  canvas_id?: string;
  title?: string;
  channel_id?: string;
  operation?: string;
  criteria?: {
    contains?: string;
  };
}

interface CanvasToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    mode?: "metadata" | "sections";
    canvas_id?: string;
    operation?: string;
    fileData?: StructuredFile;
    sections?: StructuredCanvasSection[];
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerCanvasTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackCanvasParams>({
    name: "slack_canvas",
    label: "Slack Canvas",
    description:
      "Read, create, and edit Slack canvases. " +
      "Actions: read — get canvas content or look up section IDs. " +
      "create — create a new canvas with markdown. edit — modify an existing canvas." +
      SLACK_OUTPUT_DESCRIPTION_SUFFIX,
    promptSnippet: "Read Slack canvas content, create new canvases, or edit existing ones",
    parameters: SlackCanvasParams,

    renderCall(args: CanvasToolCallArgs, theme: Theme) {
      const action = args.action || "read";
      switch (action) {
        case "read": {
          let summary = args.canvas_id || "?";
          if (args.criteria?.contains) summary += ` contains:"${args.criteria.contains}"`;
          return callLabel("Slack Canvas", summary, theme);
        }
        case "create": {
          let summary = `"${args.title || "?"}"`;
          if (args.channel_id) summary += ` → ${args.channel_id}`;
          return callLabel("Slack Canvas Create", summary, theme);
        }
        case "edit":
          return callLabel(
            "Slack Canvas Edit",
            `${args.canvas_id || "?"} ${args.operation || "?"}`,
            theme,
          );
        default:
          return callLabel("Slack Canvas", action, theme);
      }
    },

    renderResult(
      result: CanvasToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack canvas operation running…"), 0, 0);
      }

      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "Canvas call failed")),
          0,
          0,
        );
      }
      const action = details.action || "read";

      if (action === "create") {
        return new Text(
          theme.fg("success", "✓ Canvas created ") + theme.fg("accent", details.canvas_id || ""),
          0,
          0,
        );
      }
      if (action === "edit") {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg("text", "Canvas updated") +
            theme.fg("dim", ` (${details.operation || "?"})`),
          0,
          0,
        );
      }

      if (details.mode === "metadata") {
        const file = details.fileData;
        if (!file) return new Text(theme.fg("warning", "No canvas metadata"), 0, 0);

        let text = theme.fg("success", "✓ Canvas ") + theme.fg("accent", file.name || "unknown");
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        text += "\n  " + theme.fg("muted", "ID:     ") + theme.fg("dim", file.id || "?");
        text += "\n  " + theme.fg("muted", "Type:   ") + theme.fg("text", file.type || "canvas");
        text += "\n  " + theme.fg("muted", "Size:   ") + theme.fg("text", file.size || "?");
        text += "\n  " + theme.fg("muted", "Author: ") + theme.fg("warning", file.sharedBy || "?");
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        return new Text(text, 0, 0);
      }

      const sections = details.sections || [];
      let text = theme.fg(
        "success",
        `✓ ${sections.length} section${sections.length !== 1 ? "s" : ""}`,
      );
      for (const section of sections) {
        text +=
          "\n\n  " +
          theme.fg("accent", `Section ID: ${section.id || "?"}`) +
          theme.fg("dim", ` [${section.type || "?"}]`);
        text += "\n  " + theme.fg("text", section.content || "(empty)");
      }
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;
      const action = params.action;
      const tokenType = detectTokenType(auth.token);

      // Per-action scope preflight (P3). The outer scope probe already gates
      // slack_canvas when neither files:read nor canvases:read is granted,
      // but canvas *writes* specifically need canvases:write and a user
      // token — gate those here so we fail with a precise message instead
      // of relaying Slack's raw bot_scopes_not_found / missing_scope.
      if (action === "create" || action === "edit") {
        const gate = preflightCanvasWrite(tokenType);
        if (gate) return canvasGateResult(action, gate);
      }

      if (action === "read") {
        if (!params.canvas_id) {
          return {
            content: [{ type: "text", text: '"read" requires "canvas_id".' }],
            details: { ok: false, action, reason: "missing_canvas_id" },
          };
        }

        if (!params.criteria) {
          const result = await slackApi<FilesInfoResponse>(
            "files.info",
            auth.token,
            { file: params.canvas_id },
            signal,
          );
          if (!result.ok) {
            const error = result as ApiErr;
            if (error.error === "missing_scope") {
              const fallback = await lookupCanvasSections(
                auth.token,
                params.canvas_id,
                {
                  section_types: ["any_header"],
                },
                signal,
              );
              if (fallback.ok) {
                const sections = Array.isArray(fallback.data.sections)
                  ? fallback.data.sections
                  : [];
                // Tell the user *why* metadata is missing so they're not left
                // guessing (this is the "metadata unavailable" case John hit).
                const reason = hasScopeKnown("files:read")
                  ? "files.info call was denied by Slack"
                  : "token lacks files:read";
                return buildSlackTextResult(
                  `Canvas ${params.canvas_id} — metadata unavailable (${reason}). ` +
                    `Returning ${sections.length} header sections via canvases.sections.lookup instead. ` +
                    `To get full metadata, re-run /login sf-slack with files:read granted.`,
                  {
                    ok: true,
                    action,
                    canvas_id: params.canvas_id,
                    mode: "metadata",
                    fileData: {
                      id: params.canvas_id,
                      name: `Canvas ${params.canvas_id}`,
                      type: "canvas",
                      size: "unknown",
                      created: "",
                      sharedBy: "unknown",
                      permalink: "",
                      channels: "",
                    },
                    fallback: true,
                    fallback_reason: reason,
                  },
                  { prefix: "pi-slack-canvas-read" },
                );
              }
              // Fallback call failed too. Distinguish "resource missing"
              // from "second scope missing" — they lead to different
              // user actions. Previously we defaulted to the scope-
              // missing copy regardless, which confused users whose
              // token DID have canvases:read but had supplied an
              // invalid canvas_id.
              const fallbackErr = (fallback as ApiErr).error || "";
              if (fallbackErr === "file_not_found" || fallbackErr === "channel_not_found") {
                return {
                  content: [
                    {
                      type: "text",
                      text:
                        `Canvas ${params.canvas_id} not found. Verify the canvas ID is correct and that your token has access. ` +
                        `(files.info also failed with missing_scope, so we tried canvases.sections.lookup as a fallback; that returned ${fallbackErr}.)`,
                    },
                  ],
                  details: { ok: false, action, reason: "canvas_not_found" },
                };
              }
              if (fallbackErr === "missing_scope") {
                return {
                  content: [
                    {
                      type: "text",
                      text:
                        "Cannot read canvas — token lacks both files:read and canvases:read, " +
                        "so neither files.info nor canvases.sections.lookup will succeed. " +
                        "Re-run /login sf-slack with files:read or canvases:read granted, " +
                        "or pass `criteria` to scope the read to specific sections.",
                    },
                  ],
                  details: { ok: false, action, reason: "missing_scope" },
                };
              }
              // Any other failure on the fallback: surface it directly
              // through the normalized error helper instead of guessing.
              return errorResult(
                fallbackErr,
                (fallback as ApiErr).needed,
                (fallback as ApiErr).provided,
              );
            }
            return errorResult(error.error, error.needed, error.provided);
          }

          const file = result.data.file;
          if (!file) {
            return {
              content: [{ type: "text", text: "No canvas data returned." }],
              details: { ok: false, action },
            };
          }

          return buildSlackTextResult(
            formatFileInfo(file),
            {
              ok: true,
              action,
              canvas_id: file.id,
              mode: "metadata",
              fileData: extractStructuredFile(file),
            },
            { prefix: "pi-slack-canvas-read" },
          );
        }

        const result = await lookupCanvasSections(
          auth.token,
          params.canvas_id,
          {
            contains: params.criteria.contains,
            section_types: params.criteria.section_types,
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const sections = Array.isArray(result.data.sections) ? result.data.sections : [];
        if (!sections.length) {
          return {
            content: [{ type: "text", text: "No matching sections found." }],
            details: { ok: true, action, count: 0 },
          };
        }

        const structured = sections.map(toStructuredCanvasSection);
        const text = sections
          .map((section, index) => toCanvasSectionText(section, index))
          .join("\n\n");
        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: sections.length,
            canvas_id: params.canvas_id,
            mode: "sections",
            sections: structured,
          },
          { prefix: "pi-slack-canvas-sections" },
        );
      }

      if (action === "create") {
        if (!params.title) {
          return {
            content: [{ type: "text", text: '"create" requires "title".' }],
            details: { ok: false, action, reason: "missing_title" },
          };
        }
        if (!params.markdown) {
          return {
            content: [{ type: "text", text: '"create" requires "markdown".' }],
            details: { ok: false, action, reason: "missing_markdown" },
          };
        }

        const body: JsonCompatibleParams = {
          title: params.title,
          document_content: { type: "markdown", markdown: params.markdown },
        };
        if (params.channel_id) body.channel_id = params.channel_id;

        const result = await slackApiJson<CanvasCreateResponse>(
          "canvases.create",
          auth.token,
          body,
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        const canvasId = result.data.canvas_id;
        const lines = [
          `Canvas created successfully!`,
          `Canvas ID: ${canvasId || "unknown"}`,
          `Title: ${params.title}`,
        ];
        if (params.channel_id) lines.push(`Pinned to channel: ${params.channel_id}`);
        return buildSlackTextResult(
          lines.join("\n"),
          { ok: true, action, canvas_id: canvasId },
          {
            prefix: "pi-slack-canvas-create",
          },
        );
      }

      if (action === "edit") {
        if (!params.canvas_id) {
          return {
            content: [{ type: "text", text: '"edit" requires "canvas_id".' }],
            details: { ok: false, action, reason: "missing_canvas_id" },
          };
        }
        if (!params.operation) {
          return {
            content: [{ type: "text", text: '"edit" requires "operation".' }],
            details: { ok: false, action, reason: "missing_operation" },
          };
        }

        const operationsRequiringMarkdown = [
          "insert_at_start",
          "insert_at_end",
          "replace",
          "insert_before",
          "insert_after",
        ];
        if (operationsRequiringMarkdown.includes(params.operation) && !params.markdown) {
          return {
            content: [{ type: "text", text: `"${params.operation}" requires "markdown".` }],
            details: { ok: false, action, reason: "missing_markdown" },
          };
        }

        const operationsRequiringSectionId = ["replace", "delete", "insert_before", "insert_after"];
        if (operationsRequiringSectionId.includes(params.operation) && !params.section_id) {
          return {
            content: [
              {
                type: "text",
                text: `"${params.operation}" requires "section_id". Use read with criteria to find IDs.`,
              },
            ],
            details: { ok: false, action, reason: "missing_section_id" },
          };
        }

        const change = buildCanvasEditChange(params.operation, params.markdown, params.section_id);
        const result = await slackApiJson<Record<string, unknown>>(
          "canvases.edit",
          auth.token,
          {
            canvas_id: params.canvas_id,
            changes: [change],
          },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          return errorResult(error.error, error.needed, error.provided);
        }

        return buildSlackTextResult(
          `Canvas ${params.canvas_id} updated (operation: ${params.operation}).`,
          { ok: true, action, canvas_id: params.canvas_id, operation: params.operation },
          { prefix: "pi-slack-canvas-edit" },
        );
      }

      return {
        content: [{ type: "text", text: `Unknown action: "${action}". Use: read, create, edit.` }],
        details: { ok: false, action, reason: "unknown_action" },
      };
    },
  });
}

function buildCanvasEditChange(
  operation: string,
  markdown?: string,
  sectionId?: string,
): JsonCompatibleParams {
  const change: JsonCompatibleParams = { operation };
  if (markdown) {
    change.document_content = { type: "markdown", markdown };
  }
  if (sectionId) {
    change.section_id = sectionId;
  }
  return change;
}

function lookupCanvasSections(
  token: string,
  canvasId: string,
  criteria: { contains?: string; section_types?: string[] },
  signal?: AbortSignal,
) {
  const body: JsonCompatibleParams = { canvas_id: canvasId, criteria: {} };
  const bodyCriteria = body.criteria as JsonCompatibleParams;
  if (criteria.contains) bodyCriteria.contains = criteria.contains;
  if (criteria.section_types) bodyCriteria.section_types = criteria.section_types;
  return slackApiJson<CanvasSectionsLookupResponse>(
    "canvases.sections.lookup",
    token,
    body,
    signal,
  );
}

function toStructuredCanvasSection(section: SlackCanvasSection): StructuredCanvasSection {
  return {
    id: section.id || "?",
    type: section.type || "?",
    content: section.content || "(empty)",
  };
}

function toCanvasSectionText(section: SlackCanvasSection, index: number): string {
  return [
    `Section ${index + 1}:`,
    `  ID: ${section.id || "?"}`,
    `  Type: ${section.type || "?"}`,
    `  Content: ${section.content || "(empty)"}`,
  ].join("\n");
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) {
    return "";
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

// ─── Per-action write preflight (P3) ──────────────────────────────────────────────────
//
// Canvas create/edit requires:
//   - canvases:write scope on the token, AND
//   - a user (xoxp-) token — bot tokens reject canvases.* with
//     `bot_scopes_not_found` / `not_allowed_token_type` even when the scope
//     looks like it's present.
// We return a structured "gate" so the caller can emit a consistent error.

export interface CanvasWriteGate {
  reason: string;
  message: string;
}

/** Exported for tests. Production callers should stick to the in-module usage. */
export function preflightCanvasWrite(tokenType: SlackTokenType): CanvasWriteGate | null {
  if (tokenType === "bot" || tokenType === "app") {
    return {
      reason: "wrong_token_type",
      message:
        "Canvas create/edit requires a user token (xoxp-). The configured token is a " +
        `${tokenType} token, which Slack will reject with bot_scopes_not_found. ` +
        "Re-run /login sf-slack with a user token (xoxp-).",
    };
  }
  if (!hasScope("canvases:write")) {
    return {
      reason: "missing_scope",
      message:
        "Canvas create/edit needs the canvases:write scope, which this token does not have. " +
        "Re-run /login sf-slack to re-consent with canvases:write granted.",
    };
  }
  return null;
}

function canvasGateResult(action: string, gate: CanvasWriteGate) {
  return {
    content: [{ type: "text" as const, text: gate.message }],
    details: { ok: false, action, reason: gate.reason },
  };
}
