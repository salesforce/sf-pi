/* SPDX-License-Identifier: Apache-2.0 */
/** GitHub issue creation helpers with browser/URL fallback. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ExecFn } from "./diagnostics.ts";
import { sanitizeText } from "./sanitize.ts";

const REPO = "salesforce/sf-pi";
const ISSUE_NEW_URL = `https://github.com/${REPO}/issues/new`;

export interface CreateIssueResult {
  ok: boolean;
  url?: string;
  fallbackUrl: string;
  detail: string;
}

export async function createIssueWithGh(
  exec: ExecFn,
  title: string,
  body: string,
  labels: string[],
): Promise<CreateIssueResult> {
  const fallbackUrl = buildIssueUrl(title, body, labels);
  const tempDir = mkdtempSync(path.join(tmpdir(), "sf-feedback-"));
  const bodyFile = path.join(tempDir, "issue.md");
  writeFileSync(bodyFile, body, "utf8");

  const baseArgs = ["issue", "create", "--repo", REPO, "--title", title, "--body-file", bodyFile];
  const withLabels = [...baseArgs];
  for (const label of labels) {
    withLabels.push("--label", label);
  }

  const first = await run(exec, "gh", withLabels);
  if (first.ok) {
    return {
      ok: true,
      url: extractIssueUrl(first.stdout) || firstLine(first.stdout),
      fallbackUrl,
      detail: "Created GitHub issue with gh CLI.",
    };
  }

  // Some repositories reject unknown labels for contributors. Retry without
  // labels rather than failing a useful feedback report.
  if (labels.length > 0) {
    const retry = await run(exec, "gh", baseArgs);
    if (retry.ok) {
      return {
        ok: true,
        url: extractIssueUrl(retry.stdout) || firstLine(retry.stdout),
        fallbackUrl,
        detail: "Created GitHub issue with gh CLI without labels.",
      };
    }
    return {
      ok: false,
      fallbackUrl,
      detail: sanitizeText(retry.stderr || first.stderr || "GitHub issue creation failed."),
    };
  }

  return {
    ok: false,
    fallbackUrl,
    detail: sanitizeText(first.stderr || "GitHub issue creation failed."),
  };
}

export function buildIssueUrl(title: string, body: string, labels: string[]): string {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  if (labels.length > 0) params.set("labels", labels.join(","));
  return `${ISSUE_NEW_URL}?${params.toString()}`;
}

export async function openUrl(exec: ExecFn, url: string): Promise<boolean> {
  const opener =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const result = await run(exec, opener, args);
  return result.ok;
}

async function run(exec: ExecFn, command: string, args: string[]) {
  try {
    const result = await exec(command, args, { timeout: 12000 });
    return {
      ok: result.code === 0,
      stdout: sanitizeText(result.stdout || ""),
      stderr: sanitizeText(result.stderr || ""),
    };
  } catch (error) {
    return {
      ok: false,
      stdout: "",
      stderr: sanitizeText(error instanceof Error ? error.message : String(error)),
    };
  }
}

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function extractIssueUrl(value: string): string | undefined {
  return value.match(/https:\/\/github\.com\/salesforce\/sf-pi\/issues\/\d+/)?.[0];
}
