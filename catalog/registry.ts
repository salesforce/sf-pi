// AUTO-GENERATED — do not edit manually.
// Source of truth: extensions/<id>/manifest.json
// Regenerate: npm run generate-catalog

// Re-export shared types so existing imports from catalog/registry.ts keep working.
export type { ConfigPanelResult, ConfigPanelFactory, SfPiExtension, ExtensionManifest } from "./types.ts";
import type { SfPiExtension } from "./types.ts";

export const SF_PI_REGISTRY: readonly SfPiExtension[] = [
  {
    id: "sf-agentscript",
    name: "SF Agent Script",
    description: "Single-plugin lifecycle for `.agent` files: in-process compile-on-save diagnostics, an LLM-callable compile tool, multi-turn eval/regression testing against the Salesforce Evaluation API, and a placeholder for the future Agent Script LSP.",
    file: "extensions/sf-agentscript/index.ts",
    category: "agent-tool",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-agentscript"],
    tools: ["agentscript_compile","agentscript_create","agentscript_inspect","agentscript_mutate","agentscript_preview","agentscript_eval","agentscript_lifecycle"],
    events: ["session_start","session_shutdown","tool_result"],
  },
  {
    id: "sf-brain",
    name: "SF Brain",
    description: "High-density Salesforce operator kernel injected once per session — describe-before-query rules, API picker, anonymous Apex verification loop, and CLI power moves",
    file: "extensions/sf-brain/index.ts",
    category: "assistive",
    maturity: "stable",
    defaultEnabled: true,
    events: ["before_agent_start"],
  },
  {
    id: "sf-browser",
    name: "SF Browser",
    description: "Salesforce-aware browser automation for last-mile UI work using agent-browser.",
    file: "extensions/sf-browser/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-browser"],
    tools: ["sf_browser_open_org","sf_browser_snapshot","sf_browser_click","sf_browser_fill","sf_browser_select","sf_browser_press","sf_browser_wait","sf_browser_capture_evidence","sf_browser_resolve_path"],
    events: ["session_start","session_shutdown","resources_discover"],
  },
  {
    id: "sf-data360",
    name: "SF Data 360",
    description: "Data Cloud/Data 360 capability facade and direct REST helper — d360 search/examples/execute, d360_api, compact metadata discovery, readiness probe, and progressive-disclosure references",
    file: "extensions/sf-data360/index.ts",
    category: "agent-tool",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-data360"],
    tools: ["d360","d360_api","d360_metadata","d360_probe"],
    events: ["session_start","session_shutdown","resources_discover"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-data360/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-devbar",
    name: "SF DevBar",
    description: "Bespoke Salesforce developer status bar with org context, model info, git, and context window progress",
    file: "extensions/sf-devbar/index.ts",
    category: "ui",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-devbar","/sf-org"],
    events: ["session_start","session_shutdown","model_select","thinking_level_select","turn_start","turn_end","agent_end","before_agent_start"],
  },
  {
    id: "sf-feedback",
    name: "SF Feedback",
    description: "Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue",
    file: "extensions/sf-feedback/index.ts",
    category: "assistive",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-feedback"],
  },
  {
    id: "sf-guardrail",
    name: "SF Guardrail",
    description: "Salesforce-aware safety hooks — file protection policies, dangerous-command gating, and org-aware confirmation for production deploys, apex runs, and data mutations",
    file: "extensions/sf-guardrail/index.ts",
    category: "safety",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-guardrail"],
    events: ["session_start","session_tree","before_agent_start","tool_call"],
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
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-llm-gateway"],
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
    category: "assistive",
    maturity: "stable",
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
    maturity: "stable",
    defaultEnabled: true,
    events: ["session_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-ohana-spinner/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-pi-manager",
    name: "SF Pi Manager",
    description: "Core manager — provides /sf-pi commands",
    file: "extensions/sf-pi-manager/index.ts",
    category: "manager",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-pi"],
    events: ["session_start","session_shutdown"],
    alwaysActive: true,
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-pi-manager/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-skills",
    name: "SF Skills",
    description: "Manage skills end-to-end: pinned HUD, tabbed datatable (Active/Discover/Stats), Claude/Codex/Cursor source detection, forcedotcom/afv-library install + auto-update, per-skill usage counters, and prune.",
    file: "extensions/sf-skills/index.ts",
    category: "ui",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-skills"],
    events: ["session_start","message_end","session_tree","session_compact","before_agent_start","session_shutdown"],
  },
  {
    id: "sf-slack",
    name: "SF Slack",
    description: "Slack integration — search messages, read threads, browse channel history",
    file: "extensions/sf-slack/index.ts",
    category: "agent-tool",
    maturity: "stable",
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
    description: "Salesforce-branded splash screen with environment status, release freshness, and community info",
    file: "extensions/sf-welcome/index.ts",
    category: "ui",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-welcome","/sf-setup-fonts"],
    events: ["session_start","agent_start","tool_call","session_shutdown"],
  },
];
