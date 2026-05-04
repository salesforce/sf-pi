/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public-issue sanitization helpers.
 *
 * SF Feedback drafts GitHub issues for a public repository. Diagnostics are
 * useful only if they are safe to share, so this module redacts common local,
 * Salesforce, Git, and auth identifiers before any preview/submission step.
 */
import { homedir } from "node:os";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const SALESFORCE_INSTANCE_RE =
  /https?:\/\/[^\s)]+\.(?:my\.salesforce|lightning\.force|salesforce)\.com\b[^\s)]*/gi;
const TOKEN_QUERY_RE = /([?&](?:access_token|token|key|signature|sig|client_secret)=)[^\s&]+/gi;
const BASIC_AUTH_URL_RE = /(https?:\/\/)[^\s/@:]+(?::[^\s/@]+)?@/gi;
const WINDOWS_HOME_RE = /\b[A-Z]:\\Users\\[^\\\s]+/gi;
const ORG_ID_RE = /\b00D[A-Za-z0-9]{12,15}\b/g;
const LONG_SECRET_RE = /\b(?:ghp|github_pat|sf|00D|ya29)_[A-Za-z0-9_\-.]{20,}\b/g;

export function sanitizeText(value: string | undefined | null): string {
  if (!value) return "";

  let sanitized = value;
  const home = homedir();
  if (home) {
    sanitized = sanitized.split(home).join("~");
  }

  sanitized = sanitized
    .replace(WINDOWS_HOME_RE, "~")
    .replace(BASIC_AUTH_URL_RE, "$1<credentials-redacted>@")
    .replace(TOKEN_QUERY_RE, "$1<redacted>")
    .replace(SALESFORCE_INSTANCE_RE, "<salesforce-instance-url-redacted>")
    .replace(EMAIL_RE, "<email-redacted>")
    .replace(ORG_ID_RE, "<org-id-redacted>")
    .replace(LONG_SECRET_RE, "<token-redacted>");

  return sanitized;
}

export function sanitizeRemoteUrl(value: string | undefined | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "unknown";

  // Handle GitHub SSH before general text sanitization; git@github.com looks
  // like an email address to the generic public-issue redactor.
  const rawGithubSsh = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (rawGithubSsh) {
    return `github.com/${rawGithubSsh[1]}/${rawGithubSsh[2]}`;
  }

  const sanitized = sanitizeText(raw);
  const withoutCredentials = sanitized.replace(BASIC_AUTH_URL_RE, "$1<credentials-redacted>@");

  const githubHttps = withoutCredentials.match(
    /^https?:\/\/(?:<credentials-redacted>@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i,
  );
  if (githubHttps) {
    return `github.com/${githubHttps[1]}/${githubHttps[2]}`;
  }

  if (/github\.com/i.test(withoutCredentials)) {
    return withoutCredentials;
  }

  return "<non-github-remote-redacted>";
}

export function sanitizeLines(lines: string[], maxLines: number): string {
  const cleaned = lines.map((line) => sanitizeText(line).trim()).filter(Boolean);
  if (cleaned.length <= maxLines) return cleaned.join("\n");
  return [...cleaned.slice(0, maxLines), `... truncated ${cleaned.length - maxLines} line(s)`].join(
    "\n",
  );
}
