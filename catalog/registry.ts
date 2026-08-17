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
    description: "Single-plugin lifecycle for `.agent` files: compile diagnostics, native quality, preview, local-first Eval Studio, exact-version release eval, inactive publication, and gated activation.",
    file: "extensions/sf-agentscript/index.ts",
    category: "agent-tool",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-agentscript"],
    tools: ["agentscript_authoring","agentscript_preview","agentscript_eval","agentscript_lifecycle"],
    events: ["session_start","session_shutdown","tool_result","agent_settled"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-agentscript/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-apex",
    name: "SF Apex",
    description: "API-native Apex lifecycle workflows for pi: authoring guidance, diagnostics, trace/log/watch, Anonymous Apex, and targeted tests.",
    file: "extensions/sf-apex/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-apex"],
    tools: ["sf_apex"],
    events: ["session_start","tool_result"],
  },
  {
    id: "sf-brain",
    name: "SF Brain",
    description: "Salesforce Engineering Constitution, compact SF Pi routing summary, and advisory Instruction Surface diagnostics",
    file: "extensions/sf-brain/index.ts",
    category: "assistive",
    maturity: "stable",
    defaultEnabled: true,
    events: ["before_agent_start","context"],
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
    tools: ["sf_browser_open_org","sf_browser_snapshot","sf_browser_click","sf_browser_fill","sf_browser_select","sf_browser_press","sf_browser_editor","sf_browser_wait","sf_browser_capture_evidence","sf_browser_resolve_path"],
    events: ["session_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-browser/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-code-analyzer",
    name: "SF Code Analyzer",
    description: "Salesforce Code Analyzer workflows for pi: setup readiness, explicit scans, rule discovery, config generation, report artifacts, deferred agent quality passes, and ApexGuru analysis.",
    file: "extensions/sf-code-analyzer/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-code-analyzer"],
    tools: ["code_analyzer"],
    events: ["session_start","tool_result","agent_settled","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-code-analyzer/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-data-explorer",
    name: "SF Data Explorer",
    description: "Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing.",
    file: "extensions/sf-data-explorer/index.ts",
    category: "ui",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-data-explorer"],
    events: ["session_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-data-explorer/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-data360",
    name: "SF Data 360",
    description: "Data Cloud/Data 360 v2 family tools — discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and raw API escape hatch",
    file: "extensions/sf-data360/index.ts",
    category: "agent-tool",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-data360"],
    tools: ["data360_discover","data360_connect","data360_prepare","data360_harmonize","data360_segment","data360_activate","data360_query","data360_semantic","data360_observe","data360_orchestrate","data360_api"],
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
    events: ["session_start","session_shutdown","model_select","session_compact","session_info_changed","thinking_level_select","turn_start","turn_end","agent_end","before_agent_start","context"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-devbar/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-docs",
    name: "SF Docs",
    description: "Salesforce documentation lookup for agents and humans, with Pi-owned auth-store credentials, cited results, and a Manager settings surface.",
    file: "extensions/sf-docs/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-docs"],
    providers: ["sf-docs"],
    tools: ["sf_docs"],
    events: ["session_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-docs/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
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
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-feedback/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-guardrail",
    name: "SF Guardrail",
    description: "Salesforce-aware safety hooks — file protection policies, dangerous-command gating, org-aware confirmation, and native high-value mutation mediation",
    file: "extensions/sf-guardrail/index.ts",
    category: "safety",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-guardrail"],
    events: ["session_start","session_tree","before_agent_start","tool_call","context"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-guardrail/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-herdr",
    name: "SF Herdr",
    description: "Non-mutating Salesforce workflow plans for the current split Herdr tools.",
    file: "extensions/sf-herdr/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-herdr"],
    tools: ["sf_herdr_plan"],
    events: ["session_start","tool_result"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-herdr/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-llm-gateway",
    name: "SF LLM Gateway",
    description: "Salesforce LLM Gateway provider with model discovery",
    file: "extensions/sf-llm-gateway/index.ts",
    category: "provider",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-llm-gateway"],
    providers: ["sf-llm-gateway"],
    events: ["session_start","message_end","session_before_compact","turn_end","model_select","after_provider_response","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-llm-gateway/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-lsp",
    name: "SF LSP",
    description: "Real-time Salesforce LSP diagnostics on write/edit with a working indicator, transcript rows, and one-line startup readiness in SF Welcome",
    file: "extensions/sf-lsp/index.ts",
    category: "assistive",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-lsp"],
    events: ["session_start","session_shutdown","tool_result"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-lsp/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-lwc",
    name: "SF LWC",
    description: "Local-native Lightning Web Component lifecycle workflows for pi: project scan, component inspection, focused diagnostics, targeted Jest tests, and artifacts.",
    file: "extensions/sf-lwc/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-lwc"],
    tools: ["sf_lwc"],
    events: ["session_start"],
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
    events: ["session_start","agent_start","agent_settled","session_shutdown"],
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
    description: "Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Plus a passive live-context HUD, forcedotcom/afv-library install, per-skill usage counters, and prune.",
    file: "extensions/sf-skills/index.ts",
    category: "ui",
    maturity: "stable",
    defaultEnabled: true,
    commands: ["/sf-skills"],
    events: ["session_start","message_end","session_tree","session_compact","before_agent_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-skills/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
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
    tools: ["slack","slack_time_range","slack_resolve","slack_research","slack_channel","slack_user","slack_file","slack_canvas","slack_send","slack_schedule"],
    events: ["session_start","session_shutdown","before_agent_start","context"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-slack/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
  {
    id: "sf-soql",
    name: "SF SOQL",
    description: "API-native SOQL lifecycle workflows for pi: schema search/describe, relationship discovery, query drafting, validation, query plans, bounded query/SOSL execution, exports, file diagnostics, and artifacts.",
    file: "extensions/sf-soql/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-soql"],
    tools: ["sf_soql"],
    events: ["session_start"],
  },
  {
    id: "sf-tldraw",
    name: "SF tldraw",
    description: "Deterministic, editable Salesforce diagrams rendered through the local tldraw offline Canvas API.",
    file: "extensions/sf-tldraw/index.ts",
    category: "agent-tool",
    maturity: "experimental",
    defaultEnabled: true,
    commands: ["/sf-tldraw"],
    tools: ["tldraw_canvas"],
    events: ["session_start","session_shutdown"],
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-tldraw/lib/config-panel.ts");
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
    configurable: true,
    getConfigPanel: async () => {
      const mod = await import("../extensions/sf-welcome/lib/config-panel.ts");
      return mod.createConfigPanel;
    },
  },
];
