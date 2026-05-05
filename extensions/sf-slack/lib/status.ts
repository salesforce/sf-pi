/* SPDX-License-Identifier: Apache-2.0 */
/** Pure Slack status helpers shared by the runtime footer and tests. */
import type { SlackStatusKind } from "../../../lib/common/slack-status/store.ts";

export function classifySlackStatus(input: {
  state: "loading" | "connected" | "disconnected" | "error";
  grantedScopeCount: number;
  requestedScopeCount: number;
  missingGrantedScopeCount: number;
}): SlackStatusKind {
  switch (input.state) {
    case "loading":
      return "loading";
    case "disconnected":
      return "not-configured";
    case "error":
      return "auth-error";
    case "connected":
      if (input.missingGrantedScopeCount > 0) return "scope-drift";
      if (input.requestedScopeCount > 0 && input.grantedScopeCount >= input.requestedScopeCount) {
        return "ready";
      }
      return "scopes-unknown";
  }
}

export function slackStatusLabel(kind: SlackStatusKind): string {
  switch (kind) {
    case "ready":
      return "✓ Ready";
    case "scope-drift":
      return "⚠ Limited";
    case "scopes-unknown":
      return "? Scopes unknown";
    case "loading":
      return "connecting…";
    case "not-configured":
      return "○ Not configured";
    case "auth-error":
      return "✗ Auth error";
    case "hidden":
      return "";
  }
}
