/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Adapter that contributes a small Slack readiness summary to the
 * aggregated `/sf-pi doctor` view.
 *
 * Reuses the auth + scope state that is already populated by session_start
 * and `/sf-slack refresh`, so this provider does not hit the network.
 * Network round-trips happen during normal Slack tool usage; the doctor
 * just reports what's already known.
 */
import type { ExtensionDoctorReport } from "../../../lib/common/doctor/registry.ts";
import { detectTokenSource, oauthScopes } from "./auth.ts";
import { getGrantedScopes } from "./api.ts";
import { DEFAULT_SCOPES } from "./types.ts";
import type { SlackIdentity } from "./types.ts";

export interface SlackDoctorContext {
  /** Latest identity from auth.test, or undefined when no token. */
  getIdentity: () => SlackIdentity | undefined;
}

export function buildSlackDoctor(context: SlackDoctorContext) {
  return async function runExtensionDoctor(_cwd: string): Promise<ExtensionDoctorReport> {
    const checks: ExtensionDoctorReport["checks"] = [];
    const tokenSource = detectTokenSource();
    const identity = context.getIdentity();

    if (tokenSource === "none") {
      checks.push({
        id: "slack.auth",
        severity: "warn",
        title: "No Slack token configured",
        detail: "Slack tools are not registered until a token resolves.",
        fix: "Run /login sf-slack, set SLACK_USER_TOKEN, or store the token in macOS Keychain.",
      });
      return {
        extensionId: "sf-slack",
        title: "SF Slack",
        checks,
        summary: "! not authenticated",
      };
    }

    if (identity) {
      checks.push({
        id: "slack.identity",
        severity: "ok",
        title: `Authenticated as @${identity.userName}`,
        detail: `team ${identity.teamId} — user ${identity.userId} (${tokenSource})`,
      });
    } else {
      checks.push({
        id: "slack.identity",
        severity: "info",
        title: "Token present but identity not yet resolved",
        detail: `token source: ${tokenSource}. /sf-slack refresh forces a re-detect.`,
      });
    }

    const granted = getGrantedScopes();
    if (granted) {
      const expected = oauthScopes()
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const missing = expected.filter((scope) => !granted.has(scope));
      if (missing.length === 0) {
        checks.push({
          id: "slack.scopes",
          severity: "ok",
          title: `${granted.size} scopes granted, all expected scopes present`,
          detail: `Expected: ${expected.join(", ") || DEFAULT_SCOPES}`,
        });
      } else {
        checks.push({
          id: "slack.scopes",
          severity: "warn",
          title: `Missing ${missing.length} expected Slack scope${missing.length === 1 ? "" : "s"}`,
          detail: `missing: ${missing.join(", ")}`,
          fix: "Re-run /login sf-slack with the full scope list to upgrade the token.",
        });
      }
    } else {
      checks.push({
        id: "slack.scopes",
        severity: "info",
        title: "Scope probe has not run yet",
        detail: "Run /sf-slack refresh, or wait for session_start to finish probing scopes.",
      });
    }

    const summary = checks.every((c) => c.severity === "ok") ? "✓ ready" : "! issues detected";
    return {
      extensionId: "sf-slack",
      title: "SF Slack",
      checks,
      summary,
    };
  };
}
