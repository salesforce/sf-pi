/* SPDX-License-Identifier: Apache-2.0 */
/** Shared conservative redaction for text that is about to be displayed. */

const TOKEN_QUERY_RE =
  /([?&](?:access_token|refresh_token|token|sid|sessionid|code|client_secret|api[_-]?key|key|signature|sig)=)[^&\s]+/gi;
const SECRET_ASSIGNMENT_RE =
  /\b(api[_-]?key|apiKey|apiKeySource|apiKeyDescription|access[_-]?token|refresh[_-]?token|client[_-]?secret|session[_-]?id|sid|password|secret)\b\s*[:=]\s*("[^"]*"|'[^']*'|`[^`]*`|[^\s,}\]]+)/gi;
const GITHUB_TOKEN_RE = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g;
const NPM_TOKEN_RE = /\bnpm_[A-Za-z0-9]{20,}\b/g;
const SALESFORCE_SESSION_RE = /\b00D[A-Za-z0-9]{12,15}![A-Za-z0-9._!-]{20,}\b/g;
const BEARER_TOKEN_RE = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{20,}/gi;

export function redactDisplayText(input: string): string {
  return input
    .replace(TOKEN_QUERY_RE, "$1<redacted>")
    .replace(SECRET_ASSIGNMENT_RE, (_match, key: string) => `${key}: <redacted>`)
    .replace(GITHUB_TOKEN_RE, "<github-token-redacted>")
    .replace(NPM_TOKEN_RE, "<npm-token-redacted>")
    .replace(SALESFORCE_SESSION_RE, "<salesforce-session-redacted>")
    .replace(BEARER_TOKEN_RE, "$1<redacted>");
}
