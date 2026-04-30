/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Config panel for sf-slack.
 *
 * Read-only status display showing:
 *   - Token source and masked preview
 *   - Connected workspace and user
 *   - Available scopes
 *   - Quick action hints
 *
 * Matches the ConfigPanelFactory signature required by the catalog.
 */
import { type Focusable, matchesKey, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  PROVIDER_NAME,
  KEYCHAIN_SERVICE,
  KEYCHAIN_ACCOUNT,
  ENV_TOKEN,
  ENV_TEAM_ID,
} from "./types.ts";
import {
  type TokenSource,
  detectTokenSource,
  resolveTokenFromConfiguredSources,
  maskToken,
  oauthScopes,
} from "./auth.ts";
import { getGrantedScopes } from "./api.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function padAnsi(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}

// ─── Panel component ────────────────────────────────────────────────────────────

class SlackConfigPanelComponent implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly _scope: "global" | "project",
    private readonly _cwd: string,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
    }
  }

  renderContent(width: number): string[] {
    const lines: string[] = [];
    const t = this.theme;
    const pad = (content: string) => padAnsi(content, width);

    const configuredToken = resolveTokenFromConfiguredSources();
    const source = detectTokenSource();
    const teamId = process.env[ENV_TEAM_ID]?.trim() || "";

    lines.push(pad(` ${t.fg("muted", "SF Slack Connection Status")}`));
    lines.push(pad(""));

    if (configuredToken) {
      // Connected state
      const sourceLabels: Record<TokenSource, string> = {
        keychain: `macOS Keychain (${KEYCHAIN_SERVICE})`,
        env: `Environment (${ENV_TOKEN})`,
        "pi-auth": "Pi auth store (/login) ★ recommended",
        none: "Unknown",
      };

      lines.push(pad(` ${t.fg("success", "●")} ${t.fg("text", "Connected")}`));
      lines.push(pad(""));
      lines.push(
        pad(`   ${t.fg("muted", "Token source:")}  ${t.fg("text", sourceLabels[source])}`),
      );
      lines.push(
        pad(`   ${t.fg("muted", "Token:")}         ${t.fg("dim", maskToken(configuredToken))}`),
      );
      if (teamId) {
        lines.push(pad(`   ${t.fg("muted", "Team ID:")}       ${t.fg("dim", teamId)}`));
      }
      // Prefer the scopes Slack actually granted (P4); fall back to the
      // requested list only if we haven't captured X-OAuth-Scopes yet.
      const granted = getGrantedScopes();
      const scopeLabel = granted ? "Granted:" : "Requested:";
      const scopeSource = granted
        ? [...granted]
        : oauthScopes()
            .split(",")
            .map((scope) => scope.trim());
      const scopeSummary = scopeSource.slice(0, 4).join(", ") + (scopeSource.length > 4 ? "…" : "");
      lines.push(pad(`   ${t.fg("muted", scopeLabel)}     ${t.fg("dim", scopeSummary)}`));
    } else {
      // Not connected
      lines.push(pad(` ${t.fg("error", "●")} ${t.fg("text", "Not configured")}`));
      lines.push(pad(""));
      lines.push(pad(`   ${t.fg("muted", "Recommended setup order:")}`));
      lines.push(
        pad(
          `   ${t.fg("dim", "1.")} ${t.fg("text", "Pi auth:")} ${t.fg("dim", `/login ${PROVIDER_NAME}`)}`,
        ),
      );
      lines.push(
        pad(
          `   ${t.fg("dim", "2.")} ${t.fg("text", "macOS Keychain:")} ${t.fg("dim", `security add-generic-password -a "${KEYCHAIN_ACCOUNT}" -s "${KEYCHAIN_SERVICE}" -w "xoxp-..." -U`)}`,
        ),
      );
      lines.push(
        pad(
          `   ${t.fg("dim", "3.")} ${t.fg("text", "Environment:")} ${t.fg("dim", `export ${ENV_TOKEN}=xoxp-...`)}`,
        ),
      );
    }

    lines.push(pad(""));
    lines.push(pad(` ${t.fg("dim", "Esc to go back")}`));

    return lines;
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}
}

// ─── Factory ────────────────────────────────────────────────────────────────────

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SlackConfigPanelComponent(theme, scope, cwd, done);
};
