/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Single source of truth for the gateway command surface.
 *
 * The same metadata feeds:
 *   - slash-command completions
 *   - the no-args status/actions panel
 *   - help output
 *
 * Keeping labels and descriptions here prevents drift as the command surface
 * grows (notably diagnostic commands such as doctor, debug, usage-probe, and
 * token counting).
 */
import type { AutocompleteItem } from "@earendil-works/pi-tui";

export type GatewayCommandId =
  | "status"
  | "setup"
  | "on"
  | "off"
  | "refresh"
  | "set-default"
  | "models"
  | "doctor"
  | "usage-probe"
  | "latency-probe"
  | "tokens"
  | "onboard"
  | "open-token"
  | "import-claude"
  | "fix-ca-bundle"
  | "debug"
  | "help";

export type GatewayPanelAction = GatewayCommandId | "switch-scope" | "close" | "lifecycle.toggle";

export type GatewayCommandSection =
  "Connect" | "Setup" | "Discovery & diagnostics" | "Utilities" | "Reference";

export interface GatewayCommandSurfaceItem {
  id: GatewayCommandId;
  label: string;
  usage: string;
  description: string;
  section: GatewayCommandSection;
  aliases?: string[];
  acceptsScope?: boolean;
}

// Order matters: the panel renders in this sequence and groups by section
// label. Connect must come first so the primary entry point is at the
// top of every panel render. Items inside the same section stay
// contiguous so we don't get duplicate group headings.
export const GATEWAY_COMMAND_SURFACE: readonly GatewayCommandSurfaceItem[] = [
  // ─── Connect (always first) ──────────────────────────────────────────────────────────────────────────
  {
    id: "setup",
    label: "Connect / configure credentials",
    usage: "setup [global|project]",
    description:
      "Single place to enter the gateway base URL and API key. Edits the saved config and refreshes the provider — no separate /login required.",
    section: "Connect",
    aliases: ["configure", "connect"],
    acceptsScope: true,
  },
  {
    id: "import-claude",
    label: "Import from Claude Code",
    usage: "import-claude [global|project]",
    description:
      "Import a cleansed gateway base URL and API token from local Claude Code settings, save detected CA bundle candidates, run doctor, and set the gateway default only when preflight passes.",
    section: "Connect",
    aliases: ["import-claude-code"],
    acceptsScope: true,
  },
  {
    id: "open-token",
    label: "Open token page in browser",
    usage: "open-token",
    description:
      "Open the configured gateway root in a browser so you can sign in and copy a token.",
    section: "Connect",
    aliases: ["open", "browser"],
  },
  {
    id: "fix-ca-bundle",
    label: "Fix corporate CA (macOS)",
    usage: "fix-ca-bundle",
    description:
      "Wire NODE_EXTRA_CA_CERTS into both the LaunchAgent (Dock/Spotlight launches) and ~/.zshenv (Terminal launches). Adopts an existing PEM from saved candidates, shell exports, or bounded Claude Code / DevBar / AI Suite locations; otherwise downloads from saved caBundleSource (or the matching env var) when set. Each disk-mutating step requires explicit confirmation.",
    section: "Connect",
    aliases: ["fix-ca", "ca-bundle"],
  },
  {
    id: "onboard",
    label: "One-shot onboard",
    usage: "onboard [global|project]",
    description:
      "Chain Claude Code import + CA candidate discovery \u2192 register provider \u2192 doctor preflight \u2192 set default in one keystroke. Falls back to clear next-step hints when any step needs attention (TLS \u2192 fix-ca-bundle, auth \u2192 rotate key, redirect \u2192 fix base URL).",
    section: "Connect",
    acceptsScope: true,
  },
  // ─── Setup (post-connect tweaks) ─────────────────────────────────────────────────────────────────
  {
    id: "on",
    label: "Enable gateway defaults",
    usage: "on [global|project]",
    description:
      "Enable the provider, set the gateway default model, and apply scoped model routing.",
    section: "Setup",
    aliases: ["enable"],
    acceptsScope: true,
  },
  {
    id: "off",
    label: "Disable gateway defaults",
    usage: "off [global|project]",
    description: "Disable gateway model routing and restore the configured non-gateway default.",
    section: "Setup",
    aliases: ["disable"],
    acceptsScope: true,
  },
  {
    id: "set-default",
    label: "Set current default",
    usage: "set-default [global|project]",
    description:
      "Set the gateway provider/model/thinking defaults without changing saved credentials.",
    section: "Setup",
    acceptsScope: true,
  },
  // ─── Discovery & diagnostics ─────────────────────────────────────────────────────────────────────
  {
    id: "refresh",
    label: "Refresh models + usage",
    usage: "refresh",
    description: "Re-run model discovery and force-refresh monthly usage and health telemetry.",
    section: "Discovery & diagnostics",
  },
  {
    id: "models",
    label: "List discovered models",
    usage: "models",
    description:
      "Show discovered model IDs, context windows, max output, and routing classification.",
    section: "Discovery & diagnostics",
  },
  {
    id: "doctor",
    label: "Run doctor",
    usage: "doctor",
    description: "Diagnose URL, auth, model discovery, and gateway health with repair guidance.",
    section: "Discovery & diagnostics",
    aliases: ["dr"],
  },
  {
    id: "usage-probe",
    label: "Probe usage scope",
    usage: "usage-probe [--trace]",
    description:
      "Classify whether live usage is user-level, key-level, budget-windowed, or unavailable. Pass --trace to render the per-endpoint timings + status of the last refresh.",
    section: "Discovery & diagnostics",
    aliases: ["usage"],
  },
  {
    id: "debug",
    label: "Transform debug probe",
    usage: "debug <modelId> [reasoning=<level>] [tool] [adaptive]",
    description:
      "Inspect the upstream payload the gateway would send for a model without a completion.",
    section: "Discovery & diagnostics",
  },
  {
    id: "latency-probe",
    label: "Latency probe",
    usage: "latency-probe [modelId] [--large]",
    description:
      "Run read-only gateway timing probes for discovery and a tiny streamed generation.",
    section: "Discovery & diagnostics",
    aliases: ["latency"],
  },
  // ─── Utilities ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "tokens",
    label: "Count tokens",
    usage: "tokens <modelId> [prompt]",
    description:
      "Ask the gateway tokenizer and pricing endpoints for a prompt token/cost estimate.",
    section: "Utilities",
    aliases: ["count"],
  },
  // ─── Reference ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    id: "status",
    label: "Show text status",
    usage: "status",
    description: "Print the complete provider, config, usage, and health status report.",
    section: "Reference",
  },
  {
    id: "help",
    label: "Show help",
    usage: "help",
    description: "Print all commands, aliases, scopes, and recognized environment variables.",
    section: "Reference",
  },
];

const COMMAND_BY_ID = new Map(GATEWAY_COMMAND_SURFACE.map((item) => [item.id, item]));

export function getGatewayCommandSurfaceItem(
  id: GatewayCommandId,
): GatewayCommandSurfaceItem | undefined {
  return COMMAND_BY_ID.get(id);
}

export function getGatewayArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const { tokens, tokenIndex, current } = tokenizeCompletionPrefix(prefix);

  if (tokenIndex === 0) {
    return matches(
      GATEWAY_COMMAND_SURFACE.map((item) => ({
        value: item.id,
        label: item.id,
        description: item.description,
      })),
      current,
    );
  }

  const sub = tokens[0]?.toLowerCase();

  const surface = GATEWAY_COMMAND_SURFACE.find((item) => item.id === sub);
  if (surface?.acceptsScope && tokenIndex === 1) {
    return matches(
      [
        { value: "global", label: "global", description: "Save in the global Pi settings/config" },
        {
          value: "project",
          label: "project",
          description: "Save in this project's .pi settings/config",
        },
      ],
      current,
    );
  }

  return null;
}

export function formatGatewayCommandReference(commandName: string): string[] {
  const lines = ["Commands:"];
  for (const item of GATEWAY_COMMAND_SURFACE) {
    lines.push(`- /${commandName} ${item.usage}`.trimEnd() + `    # ${item.description}`);
  }
  return lines;
}

export function formatGatewayAliasReference(): string[] {
  const aliasLines = GATEWAY_COMMAND_SURFACE.flatMap((item) =>
    (item.aliases ?? []).map((alias) => `- ${alias} → ${item.id}`),
  );
  return aliasLines.length > 0 ? ["Aliases:", ...aliasLines] : [];
}

function matches(items: AutocompleteItem[], current: string): AutocompleteItem[] | null {
  const lower = current.toLowerCase();
  const filtered = items.filter((item) => item.value.toLowerCase().startsWith(lower));
  return filtered.length > 0 ? filtered : null;
}

function tokenizeCompletionPrefix(prefix: string): {
  tokens: string[];
  tokenIndex: number;
  current: string;
} {
  const hasTrailingSpace = /\s$/.test(prefix);
  const trimmed = prefix.trim();
  const tokens = trimmed ? trimmed.split(/\s+/) : [];

  if (hasTrailingSpace) {
    return { tokens, tokenIndex: tokens.length, current: "" };
  }

  if (tokens.length === 0) {
    return { tokens, tokenIndex: 0, current: "" };
  }

  return {
    tokens,
    tokenIndex: tokens.length - 1,
    current: tokens[tokens.length - 1] ?? "",
  };
}
