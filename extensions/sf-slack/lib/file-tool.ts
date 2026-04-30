/* SPDX-License-Identifier: Apache-2.0 */
/**
 * slack_file tool — info, list.
 */
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import {
  SlackFileParams,
  type ApiErr,
  type FilesInfoResponse,
  type FilesListResponse,
  type SlackFile,
  type StructuredFile,
} from "./types.ts";
import { requireAuth } from "./auth.ts";
import { slackApi, clampLimit, errorResult } from "./api.ts";
import { formatFileInfo, extractStructuredFile } from "./format.ts";
import { buildSlackTextResult } from "./truncation.ts";
import { requireConfirmedChannel, requireConfirmedUser } from "./recipient-confirm.ts";

interface FileToolCallArgs {
  action?: string;
  file?: string;
  channel?: string;
  user?: string;
  types?: string;
}

interface FileToolRenderResult {
  content?: unknown[];
  details?: {
    ok?: boolean;
    action?: string;
    total?: number;
    fileData?: StructuredFile;
    files?: StructuredFile[];
  };
}

function callLabel(label: string, summary: string, theme: Theme): Text {
  return new Text(
    theme.fg("toolTitle", theme.bold(label + " ")) + theme.fg("muted", summary),
    0,
    0,
  );
}

export function registerFileTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof SlackFileParams>({
    name: "slack_file",
    label: "Slack File",
    description:
      "Look up Slack files (info, list). " +
      "Actions: info — get file metadata by ID. list — list files in a channel or by a user.",
    promptSnippet: "Get Slack file details by ID, or list files in a channel/by a user",
    parameters: SlackFileParams,

    renderCall(args: FileToolCallArgs, theme: Theme) {
      const action = args.action || "info";
      if (action === "info") return callLabel("Slack File Info", args.file || "?", theme);
      let summary = "files";
      if (args.channel) summary += ` in ${args.channel}`;
      if (args.user) summary += ` by ${args.user}`;
      if (args.types) summary += ` [${args.types}]`;
      return callLabel("Slack Files", summary, theme);
    },

    renderResult(
      result: FileToolRenderResult,
      opts: { expanded: boolean; isPartial: boolean },
      theme: Theme,
    ) {
      if (opts.isPartial) {
        return new Text(theme.fg("warning", "Slack file lookup running…"), 0, 0);
      }

      const details = result.details || {};
      if (!details.ok) {
        return new Text(
          theme.fg("error", "✗ " + (getFirstText(result.content) || "File call failed")),
          0,
          0,
        );
      }
      const action = details.action || "info";

      if (action === "info") {
        const file = details.fileData;
        if (!file) return new Text(theme.fg("warning", "No file data"), 0, 0);

        let text =
          theme.fg("success", "✓ ") +
          theme.fg("text", file.name || "unknown") +
          theme.fg("dim", ` [${file.type || "?"}]`) +
          (file.size ? theme.fg("muted", ` ${file.size}`) : "");
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        text += "\n  " + theme.fg("muted", "ID:        ") + theme.fg("dim", file.id || "?");
        text +=
          "\n  " + theme.fg("muted", "Type:      ") + theme.fg("text", file.type || "unknown");
        text +=
          "\n  " + theme.fg("muted", "Size:      ") + theme.fg("text", file.size || "unknown");
        text +=
          "\n  " + theme.fg("muted", "Created:   ") + theme.fg("dim", file.created || "unknown");
        text +=
          "\n  " +
          theme.fg("muted", "Shared by: ") +
          theme.fg("warning", file.sharedBy || "unknown");
        if (file.permalink)
          text += "\n  " + theme.fg("muted", "Link:      ") + theme.fg("mdLink", file.permalink);
        text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
        return new Text(text, 0, 0);
      }

      const files = details.files || [];
      if (!files.length) return new Text(theme.fg("warning", "No files found"), 0, 0);
      let text = theme.fg("success", `✓ ${files.length} file${files.length !== 1 ? "s" : ""}`);
      if (details.total) text += theme.fg("dim", ` (${details.total} total)`);
      text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
      for (const file of files) {
        text +=
          "\n  " +
          theme.fg("dim", `[${file.type}]`) +
          " " +
          theme.fg("text", file.name) +
          theme.fg("dim", ` — ${file.id}`) +
          (file.size ? theme.fg("muted", ` (${file.size})`) : "") +
          "  " +
          theme.fg("warning", `by ${file.sharedBy || "?"}`);
      }
      text += "\n" + theme.fg("borderMuted", "  ─────────────────────────────────────");
      return new Text(text, 0, 0);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const auth = await requireAuth(ctx);
      if ("result" in auth) return auth.result;
      const action = params.action;

      if (action === "info") {
        if (!params.file) {
          return {
            content: [{ type: "text", text: '"info" requires "file" parameter (e.g. F01ABC...).' }],
            details: { ok: false, action, reason: "missing_file" },
          };
        }

        const result = await slackApi<FilesInfoResponse>(
          "files.info",
          auth.token,
          { file: params.file },
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (error.error === "missing_scope") {
            return {
              content: [
                {
                  type: "text",
                  text: `Cannot access file ${params.file} — token lacks files:read. If this is a canvas, try slack_canvas.`,
                },
              ],
              details: { ok: false, action, reason: "missing_scope" },
            };
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        const file = result.data.file;
        if (!file) {
          return {
            content: [{ type: "text", text: "No file data returned." }],
            details: { ok: false, action },
          };
        }

        return buildSlackTextResult(
          formatFileInfo(file),
          { ok: true, action, file_id: file.id, fileData: extractStructuredFile(file) },
          { prefix: "pi-slack-file-info" },
        );
      }

      if (action === "list") {
        const apiParams: Record<string, string | number | undefined> = {
          count: clampLimit(params.limit, 20, 100),
        };
        if (params.channel) {
          const resolvedChannel = await resolveChannelParam(
            ctx,
            auth.token,
            params.channel,
            signal,
          );
          if ("result" in resolvedChannel) return resolvedChannel.result;
          apiParams.channel = resolvedChannel.id;
        }
        if (params.user) {
          const resolvedUser = await resolveUserParam(ctx, auth.token, params.user, signal);
          if ("result" in resolvedUser) return resolvedUser.result;
          apiParams.user = resolvedUser.id;
        }
        if (params.types) apiParams.types = params.types;
        if (params.cursor) apiParams.page = params.cursor;

        const result = await slackApi<FilesListResponse>(
          "files.list",
          auth.token,
          apiParams,
          signal,
        );
        if (!result.ok) {
          const error = result as ApiErr;
          if (error.error === "missing_scope") {
            return {
              content: [
                {
                  type: "text",
                  text: "Cannot list files — token lacks files:read. Try slack search.",
                },
              ],
              details: { ok: false, action, reason: "missing_scope" },
            };
          }
          return errorResult(error.error, error.needed, error.provided);
        }

        const files = Array.isArray(result.data.files) ? result.data.files : [];
        const paging = result.data.paging;
        if (!files.length) {
          return {
            content: [{ type: "text", text: "No files found." }],
            details: { ok: true, action, count: 0 },
          };
        }

        const structured = files.map((file) => extractStructuredFile(file));
        const text =
          files.map((file, index) => `${index + 1}. ${toFileListLine(file)}`).join("\n") +
          (paging && paging.page && paging.pages && paging.page < paging.pages
            ? `\n\n--- Page ${paging.page}/${paging.pages}. cursor: "${paging.page + 1}" ---`
            : "");

        return buildSlackTextResult(
          text,
          {
            ok: true,
            action,
            count: files.length,
            total: paging?.total,
            page: paging?.page,
            pages: paging?.pages,
            files: structured,
          },
          { prefix: "pi-slack-file-list" },
        );
      }

      return {
        content: [{ type: "text", text: `Unknown action: "${action}". Use: info, list.` }],
        details: { ok: false, action, reason: "unknown_action" },
      };
    },
  });
}

// slack_file list uses the shared HITL helper for both channel and user
// refs. Same contract as everywhere else: raw IDs verify via
// conversations.info / users.info, fuzzy names use the select-or-type
// dialog, headless mode fails loudly.
async function resolveChannelParam(
  ctx: ExtensionContext,
  token: string,
  channel: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; id: string }
  | {
      ok: false;
      result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
    }
> {
  const confirmed = await requireConfirmedChannel(ctx, token, channel, signal);
  if (confirmed.ok && confirmed.recipient.type === "channel") {
    return { ok: true, id: confirmed.recipient.channel.id };
  }
  const failure = confirmed as Extract<typeof confirmed, { ok: false }>;
  return {
    ok: false,
    result: {
      content: [{ type: "text", text: failure.message }],
      details: {
        ok: false,
        reason: failure.reason,
        channel_ref: channel,
        candidates: failure.candidates,
      },
    },
  };
}

async function resolveUserParam(
  ctx: ExtensionContext,
  token: string,
  user: string,
  signal?: AbortSignal,
): Promise<
  | { ok: true; id: string }
  | {
      ok: false;
      result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> };
    }
> {
  const confirmed = await requireConfirmedUser(ctx, token, user, signal);
  if (confirmed.ok && confirmed.recipient.type === "user" && confirmed.recipient.user.id !== "me") {
    return { ok: true, id: confirmed.recipient.user.id };
  }
  const failure = confirmed as Extract<typeof confirmed, { ok: false }>;
  return {
    ok: false,
    result: {
      content: [{ type: "text", text: failure.message || `Could not resolve user "${user}".` }],
      details: {
        ok: false,
        reason: failure.reason || "user_resolution_failed",
        user_ref: user,
        candidates: failure.candidates || [],
      },
    },
  };
}

function toFileListLine(file: SlackFile): string {
  const size = file.size ? ` (${Math.round(file.size / 1024)}KB)` : "";
  return `[${file.filetype || "?"}] ${file.name || file.title || "unknown"} — ${file.id || "?"}${size} — by ${file.user || "?"}`;
}

function getFirstText(content: unknown[] | undefined): string {
  const first = content?.[0];
  if (typeof first !== "object" || first === null || !("text" in first)) {
    return "";
  }

  const text = (first as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}
