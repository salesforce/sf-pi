/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Runtime SF Pi extension context for sf-brain.
 *
 * The static kernel teaches durable Salesforce operator rules. This formatter
 * adds a small, per-session map of bundled SF Pi extension state so the model
 * can choose extension-owned workflows before falling back to broader skills
 * or raw Salesforce CLI patterns.
 */
import type { CustomMessageEntry, SessionEntry } from "@earendil-works/pi-coding-agent";

import { SF_PI_REGISTRY, type SfPiExtension } from "../../../catalog/registry.ts";
import { isSfPiExtensionEnabled } from "../../../lib/common/sf-pi-extension-state.ts";
import { shouldInjectOnce } from "../../../lib/common/session/inject-once.ts";

export const SF_PI_EXTENSIONS_ENTRY_TYPE = "sf-pi-extensions-context";
export const SF_PI_EXTENSIONS_OPEN_TAG = "<sf_pi_extensions>";
export const SF_PI_EXTENSIONS_CLOSE_TAG = "</sf_pi_extensions>";

type ExtensionIntent = {
  intent: string;
};

type ExtensionContextOptions = {
  activeTools?: readonly string[];
  activeSkills?: readonly string[];
  herdrWorkflowMode?: boolean;
};

type HerdrEnvironment = {
  HERDR_ENV?: string;
  HERDR_PANE_ID?: string;
};

const EXTENSION_INTENTS: Record<string, ExtensionIntent> = {
  "sf-pi-manager": {
    intent: "discover, enable, disable, configure, and inspect bundled extensions with /sf-pi",
  },
  "sf-agentscript": {
    intent:
      "Agentforce Agent Script authoring, .agent / aiAuthoringBundle edits, compile, preview, eval, publish, and lifecycle work",
  },
  "sf-browser": {
    intent:
      "Salesforce Setup or Lightning UI automation, screenshots, browser evidence, and UI-only last-mile checks",
  },
  "sf-data360": {
    intent:
      "Data Cloud / Data 360 discovery, metadata, SQL, DLO/DMO schemas, segments, activations, and Agentforce observability data",
  },
  "sf-docs": {
    intent:
      "official Salesforce documentation and product/reference research; use sf_docs before web_search or code_search when official docs should ground the answer",
  },
  "sf-slack": {
    intent:
      "Slack research, thread/history lookup, user/channel/file/canvas lookup, and confirmed Slack sending",
  },
  "sf-guardrail": {
    intent:
      "Salesforce-aware safety mediation for protected files, dangerous shell commands, and production org mutations",
  },
  "sf-devbar": {
    intent: "Salesforce org/project/model status and the <sf_environment> context block",
  },
  "sf-lsp": {
    intent: "advisory diagnostics after Apex, LWC, and Agent Script file edits",
  },
  "sf-skills": {
    intent: "install, activate, prune, and observe Salesforce skill packs with /sf-skills",
  },
  "sf-data-explorer": {
    intent: "human, read-only TUI exploration of SOQL, SOSL, and Data 360 SQL results",
  },
  "sf-llm-gateway-internal": {
    intent: "Salesforce LLM Gateway provider, model catalog, and usage status",
  },
  "sf-feedback": {
    intent: "sanitized SF Pi issue and feedback reporting",
  },
  "sf-welcome": {
    intent: "startup splash, onboarding, release freshness, and recommended next actions",
  },
  "sf-ohana-spinner": {
    intent: "Salesforce-themed thinking indicator",
  },
  "sf-brain": {
    intent: "Salesforce operator kernel plus this extension-priority context",
  },
};

export function formatSfPiExtensionContext(
  cwd: string,
  options: ExtensionContextOptions = {},
): string {
  const activeTools = new Set(options.activeTools ?? []);
  const activeSfSkills = (options.activeSkills ?? []).filter((skill) => skill.startsWith("sf-"));
  const enabled = SF_PI_REGISTRY.filter((extension) => isSfPiExtensionEnabled(cwd, extension.id));
  const disabled = SF_PI_REGISTRY.filter((extension) => !isSfPiExtensionEnabled(cwd, extension.id));

  const lines: string[] = [SF_PI_EXTENSIONS_OPEN_TAG];
  lines.push("SF Pi bundled-extension routing priority:");
  lines.push("- If multiple <sf_pi_extensions> blocks are visible, follow the latest one.");
  lines.push(
    "- When an enabled SF Pi extension matches the request, use its LLM tools, slash command, README, or extension-owned skill before generic Salesforce skills or raw sf CLI.",
  );
  lines.push(
    "- If the best-fit extension is disabled, suggest `/sf-pi enable <extension-id>` and only continue with skills or manual CLI as a fallback if the user chooses not to enable it.",
  );
  lines.push(
    "- Active tools below are the actual LLM-callable tools selected for this turn; enabled extensions can also expose commands, UI, hooks, providers, or diagnostics.",
  );
  lines.push(`Status: ${enabled.length}/${SF_PI_REGISTRY.length} bundled extensions enabled.`);
  if (disabled.length > 0) {
    lines.push(`Disabled now: ${disabled.map((extension) => extension.id).join(", ")}`);
  } else {
    lines.push("Disabled now: none");
  }
  if (activeSfSkills.length > 0) {
    lines.push(`Active SF skills remain fallback/workflow guidance: ${activeSfSkills.join(", ")}`);
  }
  if (options.herdrWorkflowMode) {
    lines.push("");
    lines.push("Proactive Herdr Guidance: active.");
    lines.push(
      "- Use the `herdr` tool for long-running, parallel, or command-scoped pane workflows: servers, tests, log tails, previews, evals, and multi-pane monitoring.",
    );
    if (activeTools.has("sf_herdr_plan")) {
      lines.push(
        "- Use `sf_herdr_plan` before creating dynamic Salesforce workflow lanes; it is non-mutating and owns detailed lane lifecycle guidance.",
      );
    }
    lines.push(
      '- Execute pane work through visible upstream `herdr(action="...")` calls such as `herdr(action="list")`, `herdr(action="pane_split")`, `herdr(action="run")`, `herdr(action="watch"|"read")`, and `herdr(action="stop")`.',
    );
    lines.push(
      "- Let the owning SF Pi extension or Salesforce skill choose the actual command; SF Herdr plans lane placement and lifecycle only.",
    );
    lines.push("- Keep quick one-shot commands and normal file edits on the ordinary tool path.");
    lines.push(
      "- If Herdr is unavailable or a Herdr action fails, fall back to normal SF Pi operation without blocking the task.",
    );
  }

  lines.push("");
  lines.push("Extension map:");
  for (const extension of SF_PI_REGISTRY) {
    lines.push(
      formatExtensionLine(extension, {
        enabled: isSfPiExtensionEnabled(cwd, extension.id),
        activeTools,
      }),
    );
  }

  lines.push(SF_PI_EXTENSIONS_CLOSE_TAG);
  return lines.join("\n");
}

export function shouldInjectSfPiExtensionContext(
  entries: readonly SessionEntry[],
  context: string,
): boolean {
  const stillFresh = (entry: CustomMessageEntry) => entry.content === context;
  return shouldInjectOnce(entries, SF_PI_EXTENSIONS_ENTRY_TYPE, stillFresh);
}

export function isHerdrWorkflowModeActive(options: {
  env?: HerdrEnvironment;
  activeTools?: readonly string[];
}): boolean {
  const env = options.env ?? {};
  return (
    env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID && (options.activeTools ?? []).includes("herdr")
  );
}

function formatExtensionLine(
  extension: SfPiExtension,
  options: { enabled: boolean; activeTools: ReadonlySet<string> },
): string {
  const intent = EXTENSION_INTENTS[extension.id]?.intent ?? extension.description;
  const status = extension.alwaysActive ? "always-on" : options.enabled ? "enabled" : "disabled";
  const surfaces = formatSurfaces(extension, options.activeTools);
  const disabledHint = options.enabled ? "" : ` Suggest: /sf-pi enable ${extension.id}.`;
  return `- ${extension.id} (${status}) — ${intent}.${surfaces}${disabledHint}`;
}

function formatSurfaces(extension: SfPiExtension, activeTools: ReadonlySet<string>): string {
  const parts: string[] = [];
  if (extension.tools?.length) {
    const active = extension.tools.filter((tool) => activeTools.has(tool));
    const inactive = extension.tools.filter((tool) => !activeTools.has(tool));
    if (active.length > 0) {
      parts.push(`active tools: ${compactList(active)}`);
    }
    if (inactive.length > 0) {
      parts.push(`tools not active this turn: ${compactList(inactive)}`);
    }
  }
  if (extension.commands?.length) {
    parts.push(`commands: ${extension.commands.join(", ")}`);
  }
  if (extension.providers?.length) {
    parts.push(`providers: ${extension.providers.join(", ")}`);
  }
  return parts.length > 0 ? ` Surfaces: ${parts.join("; ")}.` : "";
}

function compactList(items: readonly string[]): string {
  if (items.length <= 6) return items.join(", ");
  return `${items.slice(0, 6).join(", ")} (+${items.length - 6} more)`;
}
