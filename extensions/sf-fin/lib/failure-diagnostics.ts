/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pattern-based recovery advice for Fin CLI failures that exit codes alone
 * cannot explain (network, TLS, IP allowlist, Fin SDK gating).
 */

interface FailurePattern {
  id: string;
  pattern: RegExp;
  advice: string;
}

const PATTERNS: FailurePattern[] = [
  {
    id: "network",
    pattern: /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|socket hang up/i,
    advice:
      "Network error reaching Fin. Check connectivity and proxy settings (HTTPS_PROXY / NO_PROXY are passed to the CLI).",
  },
  {
    id: "tls",
    pattern:
      /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get local issuer/i,
    advice:
      "TLS certificate error. On a corporate network, set NODE_EXTRA_CA_CERTS to your CA bundle before starting Pi.",
  },
  {
    id: "ip-allowlist",
    pattern: /ip (address )?(is )?not (allowed|permitted|whitelisted|allowlisted)|allowlist/i,
    advice:
      "The workspace restricts API access by IP address. Add this machine to the Fin IP allowlist.",
  },
  {
    id: "fin-sdk-gate",
    pattern: /fin_sdk_not_enabled/i,
    advice:
      "This Fin SDK feature is not enabled for the workspace. The Fin CLI would enable it automatically on a `fin …` command; SF Fin does not do that during doctor.",
  },
  {
    id: "region",
    pattern: /token_not_found/i,
    advice:
      "The token was not recognized. It may be revoked, or it belongs to a workspace in a different region than the one chosen at /login sf-fin.",
  },
];

export function diagnoseFailure(
  text: string | undefined,
): { id: string; advice: string } | undefined {
  if (!text) return undefined;
  const match = PATTERNS.find((entry) => entry.pattern.test(text));
  return match ? { id: match.id, advice: match.advice } : undefined;
}
