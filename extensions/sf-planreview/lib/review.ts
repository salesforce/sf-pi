/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded, branch-aware sources for a human Plannotator TUI review. */
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";

const MAX_SOURCE_BYTES = 1024 * 1024;

export interface AssistantReview {
  entryId: string;
  text: string;
}

export function getAssistantReviews(branch: readonly unknown[], limit = 10): AssistantReview[] {
  const reviews: AssistantReview[] = [];
  const max = Math.min(10, Math.max(0, limit));
  for (let i = branch.length - 1; i >= 0 && reviews.length < max; i--) {
    const entry = branch[i] as
      { id?: unknown; type?: unknown; message?: { role?: unknown; content?: unknown } } | undefined;
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    if (!Array.isArray(entry.message.content)) continue;
    const text = entry.message.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block?.type === "text" && typeof block.text === "string",
      )
      .map((block) => block.text)
      .join("\n");
    if (text.trim() && typeof entry.id === "string") reviews.push({ entryId: entry.id, text });
  }
  return reviews;
}

export function getLastAssistantReview(branch: readonly unknown[]): AssistantReview | null {
  return getAssistantReviews(branch, 1)[0] ?? null;
}

export function prepareFileReview(cwd: string, requested: string): string {
  const value = requested.trim();
  const unquoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
      ? value.slice(1, -1)
      : value;
  const file = path.resolve(cwd, unquoted);
  if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:pem|key))$/i.test(file)) {
    throw new Error("Sensitive files cannot be opened for review.");
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Review source must be a regular file.");
  if (stat.size > MAX_SOURCE_BYTES) throw new Error("Review source is too large (max 1 MB).");
  return realpathSync(file);
}

function newReviewDirectory(): string {
  const dir = globalAgentPath("sf-pi", "sf-planreview", "reviews", randomUUID());
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function createReviewSnapshot(
  content: string,
  label: string,
): {
  file: string;
  dataDir: string;
} {
  if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_BYTES) {
    throw new Error("Review source is too large (max 1 MB).");
  }
  const dir = newReviewDirectory();
  const basename = path
    .basename(label)
    .replace(/[^a-z0-9._-]/gi, "_")
    .replace(/\.mdx?$/i, "")
    .slice(0, 80);
  const file = path.join(dir, `${basename}-review-${path.basename(dir)}.md`);
  const fence = "`".repeat(
    Math.max(3, ...(content.match(/`+/g) ?? []).map((run) => run.length + 1)),
  );
  const body = /\.mdx?$/i.test(label) ? content : `${fence}\n${content}\n${fence}\n`;
  const markdown = `> Saved review snapshot: ${label}. Check the current source before applying feedback.\n\n${body}`;
  writeFileSync(file, markdown, { mode: 0o600 });
  return { file, dataDir: path.join(dir, "data") };
}

export function fileReviewSnapshot(
  cwd: string,
  requested: string,
): {
  file: string;
  dataDir: string;
  label: string;
  sourcePath: string;
  sourceDigest: string;
} {
  const source = prepareFileReview(cwd, requested);
  const bytes = readFileSync(source);
  if (bytes.includes(0))
    throw new Error("Only UTF-8 text files can be reviewed in Plannotator TUI.");
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Only UTF-8 text files can be reviewed in Plannotator TUI.");
  }
  if (!content.trim()) throw new Error("That file has no text to review.");
  const { file, dataDir } = createReviewSnapshot(content, source);
  return { file, dataDir, label: source, sourcePath: source, sourceDigest: sha256(bytes) };
}

export function reviewSourceChanged(source: {
  sourcePath?: string;
  sourceDigest?: string;
}): boolean {
  if (!source.sourcePath || !source.sourceDigest) return false;
  try {
    return sha256(readFileSync(source.sourcePath)) !== source.sourceDigest;
  } catch {
    return true;
  }
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function listReviewDataDirs(): string[] {
  const root = globalAgentPath("sf-pi", "sf-planreview", "reviews");
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((item) => item.isDirectory() && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item.name))
      .map((item) => path.join(root, item.name));
  } catch {
    return [];
  }
}

export function cleanupReviewSnapshot(source: { dataDir: string }): void {
  const root = globalAgentPath("sf-pi", "sf-planreview", "reviews");
  const dir = path.dirname(source.dataDir);
  if (path.dirname(dir) === root && listReviewDataDirs().includes(dir)) {
    rmSync(dir, { force: true, recursive: true });
  }
}
