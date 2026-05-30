/* SPDX-License-Identifier: Apache-2.0 */
/** User-visible transcript rows for automatic Code Analyzer work. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export const CODE_ANALYZER_TRANSCRIPT_TYPE = "sf-code-analyzer";

export interface CodeAnalyzerTranscriptDetails {
  status: "running" | "clean" | "findings" | "skipped" | "timeout" | "error" | "stopped";
  reportFile?: string;
  targetCount?: number;
  violationCount?: number;
  durationMs?: number;
}

export function registerCodeAnalyzerTranscriptRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer<CodeAnalyzerTranscriptDetails>(
    CODE_ANALYZER_TRANSCRIPT_TYPE,
    (message, _options, theme) =>
      new Text(
        theme.fg(
          "muted",
          typeof message.content === "string" ? message.content : "[sf-code-analyzer]",
        ),
        0,
        0,
      ),
  );
}

export function emitCodeAnalyzerTranscript(
  pi: ExtensionAPI,
  content: string,
  details: CodeAnalyzerTranscriptDetails,
): void {
  pi.sendMessage({
    customType: CODE_ANALYZER_TRANSCRIPT_TYPE,
    content,
    display: true,
    details,
  });
}
