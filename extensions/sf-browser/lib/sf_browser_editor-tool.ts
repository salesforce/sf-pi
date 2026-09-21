/* SPDX-License-Identifier: Apache-2.0 */
/** Narrow editor-surface tool for Salesforce code-like UI fields. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { runEditorOperation } from "./editor-surfaces.ts";

export const SF_BROWSER_EDITOR_TOOL_NAME = "sf_browser_editor";

const EditorAction = StringEnum(["detect", "read", "write"] as const, {
  description:
    "Editor operation. detect lists visible editor surfaces; read returns bounded content; write replaces full content but never clicks Save/Apply.",
});

export function registerSfBrowserEditorTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_BROWSER_EDITOR_TOOL_NAME,
    label: "SF Browser Editor",
    description:
      "Detect, read, or write visible Salesforce editor-like surfaces such as Monaco, textareas, and contenteditable fields. This is a narrow editor adapter, not a generic DOM/eval tool; writes do not click Save or Apply and do not echo full content.",
    promptSnippet:
      "Detect, read, and write Salesforce editor surfaces without generic DOM eval or automatic Save/Apply",
    promptGuidelines: [
      "Detect before editor read/write; editor indexes are render-scoped and writes never imply Save/Apply persistence.",
      "After writing, use the explicit commit control and verify the result; use the installed Browser guide path declared in <sf_engineering_constitution> for the full loop.",
    ],
    parameters: Type.Object({
      action: Type.Optional(EditorAction),
      editorIndex: Type.Optional(
        Type.Number({
          description:
            "Editor index returned by action='detect'. Required when multiple editor surfaces are visible.",
        }),
      ),
      value: Type.Optional(
        Type.String({
          description:
            "Replacement content for action='write'. Writes replace the full editor content and are not echoed back in the result.",
        }),
      ),
      maxChars: Type.Optional(
        Type.Number({
          description:
            "Maximum characters returned by action='read'. Defaults to 4000 and is capped at 20000.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runEditorOperation(
        pi,
        ctx,
        {
          action: params.action ?? "detect",
          editorIndex: params.editorIndex,
          value: params.value,
          maxChars: params.maxChars,
        },
        signal,
      );
      return {
        content: [{ type: "text" as const, text: result.text }],
        details: result.details,
      };
    },
  });
}
