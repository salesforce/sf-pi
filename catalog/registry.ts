// AUTO-GENERATED — do not edit manually.
// Source of truth: extensions/<id>/manifest.json
// Regenerate: npm run generate-catalog

// Re-export shared types so existing imports from catalog/registry.ts keep working.
export type { ConfigPanelResult, ConfigPanelFactory, SfPiExtension, ExtensionManifest } from "./types.ts";
import type { SfPiExtension } from "./types.ts";

export const SF_PI_REGISTRY: readonly SfPiExtension[] = [
  {
    id: "sf-agentscript-assist",
    name: "SF Agent Script Assist",
    description: "In-process Agent Script authoring companion — parse, compile, and code-action feedback on every .agent write",
    file: "extensions/sf-agentscript-assist/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-agentscript-assist"],
    events: ["session_start","session_shutdown","tool_result"],
  },
  {
    id: "sf-brain",
    name: "SF Brain",
    description: "High-density Salesforce operator kernel injected once per session — describe-before-query rules, API picker, anonymous Apex verification loop, and CLI power moves",
    file: "extensions/sf-brain/index.ts",
    category: "core",
    defaultEnabled: true,
    events: ["before_agent_start"],
  },
  {
    id: "sf-devbar",
    name: "SF DevBar",
    description: "Bespoke Salesforce developer status bar with org context, model info, git, and context window progress",
    file: "extensions/sf-devbar/index.ts",
    category: "ui",
    defaultEnabled: true,
    commands: ["/sf-devbar","/sf-org"],
    events: ["session_start","session_shutdown","model_select","thinking_level_select","turn_start","turn_end","agent_end","before_agent_start"],
  },
  {
    id: "sf-feedback",
    name: "SF Feedback",
    description: "Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue",
    file: "extensions/sf-feedback/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-feedback"],
  },
  {
    id: "sf-guardrail",
    name: "SF Guardrail",
    description: "Salesforce-aware safety hooks — file protection policies, dangerous-command gating, and org-aware confirmation for production deploys, apex runs, and data mutations",
    file: "extensions/sf-guardrail/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-guardrail"],
    events: ["session_start","session_shutdown","before_agent_start","tool_call"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-guardrail/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-llm-gateway-internal",
    name: "SF LLM Gateway Internal",
    description: "Salesforce LLM Gateway provider with model discovery",
    file: "extensions/sf-llm-gateway-internal/index.ts",
    category: "provider",
    defaultEnabled: true,
    commands: ["/sf-llm-gateway-internal"],
    providers: ["sf-llm-gateway-internal"],
    events: ["session_start","turn_end","model_select","after_provider_response","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-llm-gateway-internal/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-lsp",
    name: "SF LSP",
    description: "Real-time Salesforce LSP diagnostics on write/edit with a working-indicator spinner, transcript rows, and a permanent top-bar health segment in sf-devbar",
    file: "extensions/sf-lsp/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-lsp"],
    events: ["session_start","session_shutdown","tool_result"],
  },
  {
    id: "sf-ohana-spinner",
    name: "SF Ohana Spinner",
    description: "Salesforce-themed rainbow spinner during LLM thinking",
    file: "extensions/sf-ohana-spinner/index.ts",
    category: "ui",
    defaultEnabled: true,
    events: ["session_start","session_shutdown"],
  },
  {
    id: "sf-pi-manager",
    name: "SF Pi Manager",
    description: "Core manager — provides /sf-pi commands",
    file: "extensions/sf-pi-manager/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-pi","/sf-pi recommended","/sf-pi announcements","/sf-pi skills"],
    events: ["session_start","session_shutdown"],
    alwaysActive: true,
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-pi-manager/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-skills-hud",
    name: "SF Skills HUD",
    description: "Pinned top-right overlay that shows which skills are live in context versus earlier in the session",
    file: "extensions/sf-skills-hud/index.ts",
    category: "ui",
    defaultEnabled: true,
    commands: ["/sf-skills"],
    events: ["session_start","message_end","session_tree","session_compact","session_shutdown"],
  },
  {
    id: "sf-slack",
    name: "SF Slack",
    description: "Slack integration — search messages, read threads, browse channel history",
    file: "extensions/sf-slack/index.ts",
    category: "core",
    defaultEnabled: true,
    commands: ["/sf-slack"],
    providers: ["sf-slack"],
    tools: ["slack","slack_time_range","slack_resolve","slack_research","slack_channel","slack_user","slack_file","slack_canvas","slack_send"],
    events: ["session_start","session_shutdown","before_agent_start"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-slack/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-welcome",
    name: "SF Welcome",
    description: "Salesforce-branded splash screen with environment status, extension health, and community info",
    file: "extensions/sf-welcome/index.ts",
    category: "ui",
    defaultEnabled: true,
    commands: ["/sf-welcome","/sf-setup-fonts"],
    events: ["session_start","agent_start","tool_call"],
  },
];
