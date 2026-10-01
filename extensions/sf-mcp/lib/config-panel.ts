/* SPDX-License-Identifier: Apache-2.0 */
/** Colorful, whitespace-first Salesforce MCP catalog for the SF Pi Manager. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import type { ConflictPlan } from "./conflict-planner.ts";
import { mcpConfigPath, type McpServerConfig } from "./mcp-config.ts";
import {
  padAnsi,
  renderCatalogPage,
  renderConflictPage,
  renderPresetOverviewPage,
  renderReconcilePage,
  renderResultPage,
  renderReviewPage,
  renderSetupPage,
  renderTogglePage,
  renderToolDetailPage,
  renderToolListPage,
  type ConflictOption,
  type PresetOverviewOption,
  type ReconcileOption,
} from "./panel-pages.ts";
import {
  SALESFORCE_MCP_PRESETS,
  buildServerConfig,
  getPreset,
  isPresetConfigCompatible,
  type McpPresetId,
  type McpResolution,
  type PresetSetup,
} from "./presets.ts";
import {
  adoptPreset,
  inspectPresetRuntime,
  installPreset,
  reconcileCanonicalServerNames,
  setManagedPresetEnabled,
  summarizeConfigDiff,
  updateManagedPresetToolPolicy,
  type PresetRuntimeState,
} from "./service.ts";
import { PresetSetupForm } from "./setup-form.ts";
import { getPresetToolCatalog, inspectPresetTools } from "./tool-catalog.ts";
import {
  renderToolPolicyPage,
  renderToolPolicyReviewPage,
  renderToolProfilesPage,
} from "./tool-policy-pages.ts";
import {
  TOOL_POLICY_PROFILES,
  applyToolExposurePolicy,
  buildToolExposurePolicy,
  cycleToolExposure,
  hasReviewedToolPolicy,
  type ToolExposurePolicy,
} from "./tool-policy.ts";

type ReconcileAction =
  | { kind: "adopt" }
  | { kind: "reset" }
  | { kind: "keep-name"; keepName: string }
  | { kind: "cancel" };

type ReconcileChoice = ReconcileOption & { action: ReconcileAction };
type OverviewAction = "tools" | "policy" | "configure" | "back";
type OverviewChoice = PresetOverviewOption & { action: OverviewAction };

type PanelView =
  | { kind: "catalog" }
  | { kind: "overview"; presetId: McpPresetId; selected: number }
  | { kind: "tools"; presetId: McpPresetId; cursor: number }
  | { kind: "tool-detail"; presetId: McpPresetId; toolName: string }
  | { kind: "tool-profiles"; presetId: McpPresetId; selected: number }
  | { kind: "tool-policy"; presetId: McpPresetId; policy: ToolExposurePolicy; cursor: number }
  | {
      kind: "tool-policy-review";
      presetId: McpPresetId;
      policy: ToolExposurePolicy;
      proposedConfig: McpServerConfig;
      selected: number;
    }
  | {
      kind: "conflicts";
      sourcePresetId: McpPresetId;
      plan: ConflictPlan;
      selected: number;
      toolPolicy?: ToolExposurePolicy;
    }
  | {
      kind: "reconcile";
      presetId: McpPresetId;
      state: PresetRuntimeState;
      options: ReconcileChoice[];
      selected: number;
    }
  | {
      kind: "setup";
      sourcePresetId: McpPresetId;
      targetPresetId: McpPresetId;
      resolution: McpResolution;
      replaceExisting: boolean;
      form: PresetSetupForm;
      toolPolicy?: ToolExposurePolicy;
    }
  | {
      kind: "review";
      sourcePresetId: McpPresetId;
      targetPresetId: McpPresetId;
      resolution: McpResolution;
      setup: PresetSetup;
      config: McpServerConfig;
      replaceExisting: boolean;
      form?: PresetSetupForm;
      selected: number;
      toolPolicy?: ToolExposurePolicy;
    }
  | { kind: "toggle"; presetId: McpPresetId; enable: boolean; selected: number }
  | {
      kind: "result";
      title: string;
      message: string;
      tone: "success" | "warning" | "error";
      needsReload: boolean;
    };

class SfMcpConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private states: PresetRuntimeState[] = [];
  private message = "";
  private messageTone: "success" | "warning" | "error" = "success";
  private view: PanelView = { kind: "catalog" };

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: "global" | "project",
    private readonly done: (result: ConfigPanelResult | undefined) => void,
    private readonly projectTrusted: boolean,
  ) {
    this.refresh();
  }

  handleInput(data: string): void {
    switch (this.view.kind) {
      case "catalog":
        this.handleCatalogInput(data);
        return;
      case "overview":
        this.handleOverviewInput(data);
        return;
      case "tools":
        this.handleToolsInput(data);
        return;
      case "tool-detail":
        this.handleToolDetailInput(data);
        return;
      case "tool-profiles":
        this.handleToolProfilesInput(data);
        return;
      case "tool-policy":
        this.handleToolPolicyInput(data);
        return;
      case "tool-policy-review":
        this.handleToolPolicyReviewInput(data);
        return;
      case "conflicts":
        this.handleConflictInput(data);
        return;
      case "reconcile":
        this.handleReconcileInput(data);
        return;
      case "setup":
        this.handleSetupInput(data);
        return;
      case "review":
        this.handleReviewInput(data);
        return;
      case "toggle":
        this.handleToggleInput(data);
        return;
      case "result":
        this.handleResultInput(data);
    }
  }

  renderContent(width: number): string[] {
    const view = this.view;
    const lines = (() => {
      switch (view.kind) {
        case "catalog":
          return renderCatalogPage({
            theme: this.theme,
            width,
            scope: this.scope,
            states: this.states,
            cursor: this.cursor,
            message: this.message,
            messageTone: this.messageTone,
          });
        case "overview": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          const catalog = getPresetToolCatalog(state.preset);
          return renderPresetOverviewPage({
            theme: this.theme,
            width,
            state,
            capabilities: catalog.capabilities,
            catalogNote: catalog.note,
            tools: inspectPresetTools(state.preset),
            options: overviewOptions(state),
            selected: view.selected,
          });
        }
        case "tools": {
          const preset = getPreset(view.presetId);
          const catalog = getPresetToolCatalog(preset);
          return renderToolListPage({
            theme: this.theme,
            width,
            preset,
            runtime: inspectPresetRuntime(this.cwd, this.scope, preset),
            tools: inspectPresetTools(preset),
            cursor: view.cursor,
            catalogNote: catalog.note,
          });
        }
        case "tool-detail": {
          const preset = getPreset(view.presetId);
          const tool = inspectPresetTools(preset).find(
            (candidate) => candidate.name === view.toolName,
          );
          if (!tool) {
            return renderResultPage({
              theme: this.theme,
              width,
              title: "Tool is no longer available",
              message: `${view.toolName} disappeared from the current session tool contract.`,
              tone: "warning",
              needsReload: false,
            });
          }
          return renderToolDetailPage({
            theme: this.theme,
            width,
            preset,
            runtime: inspectPresetRuntime(this.cwd, this.scope, preset),
            tool,
          });
        }
        case "tool-profiles":
          return renderToolProfilesPage({
            theme: this.theme,
            width,
            preset: getPreset(view.presetId),
            options: TOOL_POLICY_PROFILES,
            selected: view.selected,
          });
        case "tool-policy":
          return renderToolPolicyPage({
            theme: this.theme,
            width,
            preset: getPreset(view.presetId),
            policy: view.policy,
            tools: inspectPresetTools(getPreset(view.presetId)),
            cursor: view.cursor,
          });
        case "tool-policy-review": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          return renderToolPolicyReviewPage({
            theme: this.theme,
            width,
            preset: state.preset,
            policy: view.policy,
            configDiff: summarizeConfigDiff(state.managed.config, view.proposedConfig),
            selected: view.selected,
          });
        }
        case "conflicts":
          return renderConflictPage({
            theme: this.theme,
            width,
            source: getPreset(view.sourcePresetId),
            plan: view.plan,
            options: conflictOptions(view.plan),
            selected: view.selected,
          });
        case "reconcile":
          return renderReconcilePage({
            theme: this.theme,
            width,
            preset: getPreset(view.presetId),
            status: view.state.managed.status,
            message: view.state.managed.message,
            options: view.options,
            selected: view.selected,
          });
        case "setup":
          return renderSetupPage({
            theme: this.theme,
            width,
            preset: getPreset(view.targetPresetId),
            form: view.form,
            focused: this.focused,
          });
        case "review": {
          const preset = getPreset(view.targetPresetId);
          return renderReviewPage({
            theme: this.theme,
            width,
            preset,
            scope: this.scope,
            configPath: mcpConfigPath(this.cwd, this.scope),
            runtime: inspectPresetRuntime(this.cwd, this.scope, preset),
            config: view.config,
            resolution: view.resolution,
            configDiff: view.replaceExisting
              ? summarizeConfigDiff(
                  inspectPresetRuntime(this.cwd, this.scope, preset).managed.config,
                  view.config,
                )
              : undefined,
            selected: view.selected,
            ...(view.toolPolicy ? { toolPolicy: view.toolPolicy } : {}),
          });
        }
        case "toggle":
          return renderTogglePage({
            theme: this.theme,
            width,
            preset: getPreset(view.presetId),
            enable: view.enable,
            selected: view.selected,
          });
        case "result":
          return renderResultPage({ theme: this.theme, width, ...view });
      }
    })();
    return lines.map((line) => padAnsi(line, width));
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {
    if (this.view.kind === "setup") this.view.form.invalidate();
    if (this.view.kind === "review") this.view.form?.invalidate();
  }

  private handleCatalogInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) return this.move(-1);
    if (matchesKey(data, "down")) return this.move(1);
    if (data === "d" || data === "D") {
      this.openToggle(false);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return") || matchesKey(data, "space")) {
      this.openSelectedPreset();
    }
  }

  private handleOverviewInput(data: string): void {
    const view = this.viewAs("overview");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "catalog" };
      return;
    }
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    const options = overviewOptions(state);
    if (matchesKey(data, "up")) {
      view.selected = cycle(view.selected, options.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.selected = cycle(view.selected, options.length, 1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const choice = options[view.selected];
    if (!choice || choice.action === "back") {
      this.view = { kind: "catalog" };
      return;
    }
    if (choice.action === "tools") {
      this.view = { kind: "tools", presetId: view.presetId, cursor: 0 };
      return;
    }
    if (choice.action === "policy") {
      this.view = { kind: "tool-profiles", presetId: view.presetId, selected: 0 };
      return;
    }
    this.beginPresetConfiguration(state);
  }

  private handleToolsInput(data: string): void {
    const view = this.viewAs("tools");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "overview", presetId: view.presetId, selected: 0 };
      return;
    }
    const tools = inspectPresetTools(getPreset(view.presetId));
    if (tools.length === 0) return;
    if (matchesKey(data, "up")) {
      view.cursor = cycle(view.cursor, tools.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.cursor = cycle(view.cursor, tools.length, 1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const tool = tools[view.cursor];
    if (tool) {
      this.view = { kind: "tool-detail", presetId: view.presetId, toolName: tool.name };
    }
  }

  private handleToolDetailInput(data: string): void {
    const view = this.viewAs("tool-detail");
    if (
      !matchesKey(data, "escape") &&
      !matchesKey(data, "enter") &&
      !matchesKey(data, "return") &&
      data !== "q"
    ) {
      return;
    }
    const tools = inspectPresetTools(getPreset(view.presetId));
    const cursor = Math.max(
      0,
      tools.findIndex((tool) => tool.name === view.toolName),
    );
    this.view = { kind: "tools", presetId: view.presetId, cursor };
  }

  private handleToolProfilesInput(data: string): void {
    const view = this.viewAs("tool-profiles");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "overview", presetId: view.presetId, selected: 1 };
      return;
    }
    if (matchesKey(data, "up")) {
      view.selected = cycle(view.selected, TOOL_POLICY_PROFILES.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.selected = cycle(view.selected, TOOL_POLICY_PROFILES.length, 1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const option = TOOL_POLICY_PROFILES[view.selected];
    if (!option) return;
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    try {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: buildToolExposurePolicy(state.preset, option.id, state.managed.config),
        cursor: 0,
      };
    } catch (error) {
      this.view = {
        kind: "result",
        title: "Tool policy unavailable",
        message: error instanceof Error ? error.message : String(error),
        tone: "warning",
        needsReload: false,
      };
    }
  }

  private handleToolPolicyInput(data: string): void {
    const view = this.viewAs("tool-policy");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "overview", presetId: view.presetId, selected: 1 };
      return;
    }
    if (data === "p" || data === "P") {
      this.view = { kind: "tool-profiles", presetId: view.presetId, selected: 0 };
      return;
    }
    const preset = getPreset(view.presetId);
    const tools = inspectPresetTools(preset).filter((tool) => tool.documented);
    if (matchesKey(data, "up")) {
      view.cursor = cycle(view.cursor, tools.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.cursor = cycle(view.cursor, tools.length, 1);
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      const tool = tools[view.cursor];
      if (!tool || view.policy.unavailable.includes(tool.name)) return;
      view.policy = cycleToolExposure(
        preset,
        view.policy,
        tool.name,
        matchesKey(data, "left") ? -1 : 1,
      );
      return;
    }
    if (data === "a" || data === "A") this.continueToolPolicy(view.presetId, view.policy);
  }

  private handleToolPolicyReviewInput(data: string): void {
    const view = this.viewAs("tool-policy-review");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: view.policy,
        cursor: 0,
      };
      return;
    }
    if (
      matchesKey(data, "up") ||
      matchesKey(data, "down") ||
      matchesKey(data, "left") ||
      matchesKey(data, "right")
    ) {
      view.selected = view.selected === 0 ? 1 : 0;
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    if (view.selected === 1) {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: view.policy,
        cursor: 0,
      };
      return;
    }
    this.finishMutation(
      updateManagedPresetToolPolicy({
        cwd: this.cwd,
        scope: this.scope,
        presetId: view.presetId,
        policy: view.policy,
      }),
    );
  }

  private handleConflictInput(data: string): void {
    const view = this.viewAs("conflicts");
    if (matchesKey(data, "escape") || data === "q") {
      this.backFromConflict(view);
      return;
    }
    const options = conflictOptions(view.plan);
    if (matchesKey(data, "up")) {
      view.selected = cycle(view.selected, options.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.selected = cycle(view.selected, options.length, 1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const option = options[view.selected];
    if (!option?.resolution) {
      this.backFromConflict(view);
      return;
    }
    if (option.resolution === "native-only") {
      this.view = {
        kind: "result",
        title: "Native owner preserved",
        message: view.plan.recommendation.summary,
        tone: "success",
        needsReload: false,
      };
      return;
    }
    this.openSetup(view.sourcePresetId, option.resolution, false, view.toolPolicy);
  }

  private handleReconcileInput(data: string): void {
    const view = this.viewAs("reconcile");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "overview", presetId: view.presetId, selected: 1 };
      return;
    }
    if (matchesKey(data, "up")) {
      view.selected = cycle(view.selected, view.options.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.selected = cycle(view.selected, view.options.length, 1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const choice = view.options[view.selected];
    if (!choice || choice.action.kind === "cancel") {
      this.view = { kind: "catalog" };
      return;
    }
    if (choice.action.kind === "adopt") {
      this.finishMutation(
        adoptPreset({ cwd: this.cwd, scope: this.scope, presetId: view.presetId }),
      );
      return;
    }
    if (choice.action.kind === "keep-name") {
      this.finishMutation(
        reconcileCanonicalServerNames({
          cwd: this.cwd,
          scope: this.scope,
          presetId: view.presetId,
          keepName: choice.action.keepName,
        }),
      );
      return;
    }
    const resolution = view.state.managed.record?.resolution ?? "enable";
    this.openSetup(view.presetId, resolution, true);
  }

  private handleSetupInput(data: string): void {
    const view = this.viewAs("setup");
    const event = view.form.handleInput(data);
    if (!event) return;
    if (event.kind === "back") {
      this.backFromSetup(view.sourcePresetId, view.replaceExisting, view.toolPolicy);
      return;
    }
    this.openReview({
      sourcePresetId: view.sourcePresetId,
      targetPresetId: view.targetPresetId,
      resolution: view.resolution,
      setup: event.setup,
      form: view.form,
      replaceExisting: view.replaceExisting,
      ...(view.toolPolicy ? { toolPolicy: view.toolPolicy } : {}),
    });
  }

  private handleReviewInput(data: string): void {
    const view = this.viewAs("review");
    if (matchesKey(data, "escape") || data === "q") {
      this.backFromReview();
      return;
    }
    if (
      matchesKey(data, "up") ||
      matchesKey(data, "down") ||
      matchesKey(data, "left") ||
      matchesKey(data, "right")
    ) {
      view.selected = view.selected === 0 ? 1 : 0;
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    if (view.selected === 1) {
      this.backFromReview();
      return;
    }
    const result = installPreset({
      cwd: this.cwd,
      scope: this.scope,
      presetId: view.sourcePresetId,
      resolution: view.resolution,
      setup: view.setup,
      replaceExisting: view.replaceExisting,
      ...(view.toolPolicy ? { toolPolicy: view.toolPolicy } : {}),
    });
    this.finishMutation(result);
  }

  private handleToggleInput(data: string): void {
    const view = this.viewAs("toggle");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "catalog" };
      return;
    }
    if (
      matchesKey(data, "up") ||
      matchesKey(data, "down") ||
      matchesKey(data, "left") ||
      matchesKey(data, "right")
    ) {
      view.selected = view.selected === 0 ? 1 : 0;
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    if (view.selected === 1) {
      this.view = { kind: "catalog" };
      return;
    }
    const result = setManagedPresetEnabled({
      cwd: this.cwd,
      scope: this.scope,
      presetId: view.presetId,
      enabled: view.enable,
    });
    this.finishMutation(result);
  }

  private handleResultInput(data: string): void {
    const view = this.viewAs("result");
    if (
      !matchesKey(data, "escape") &&
      !matchesKey(data, "enter") &&
      !matchesKey(data, "return") &&
      data !== "q"
    ) {
      return;
    }
    if (view.needsReload) {
      this.done({ needsReload: true });
      return;
    }
    this.view = { kind: "catalog" };
  }

  private refresh(): void {
    this.states = SALESFORCE_MCP_PRESETS.map((preset) =>
      inspectPresetRuntime(this.cwd, this.scope, preset),
    );
    this.cursor = Math.max(0, Math.min(this.cursor, this.states.length - 1));
  }

  private move(delta: -1 | 1): void {
    this.cursor = cycle(this.cursor, this.states.length, delta);
    this.message = "";
  }

  private openSelectedPreset(): void {
    const state = this.states[this.cursor];
    if (!state) return;
    this.view = { kind: "overview", presetId: state.preset.id, selected: 0 };
  }

  private continueToolPolicy(presetId: McpPresetId, policy: ToolExposurePolicy): void {
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(presetId));
    if (this.scope === "project" && !this.projectTrusted) {
      this.view = {
        kind: "result",
        title: "Project setup unavailable",
        message:
          "Project MCP configuration is unavailable until Pi trusts this project. Switch to global scope or use /trust.",
        tone: "warning",
        needsReload: false,
      };
      return;
    }
    if (state.managed.status === "missing") {
      this.beginPresetConfiguration(state, policy);
      return;
    }
    if (
      (state.managed.status === "managed-enabled" || state.managed.status === "managed-disabled") &&
      state.managed.config
    ) {
      try {
        this.view = {
          kind: "tool-policy-review",
          presetId,
          policy,
          proposedConfig: applyToolExposurePolicy(state.preset, state.managed.config, policy),
          selected: 0,
        };
      } catch (error) {
        this.view = {
          kind: "result",
          title: "Tool policy validation failed",
          message: error instanceof Error ? error.message : String(error),
          tone: "error",
          needsReload: false,
        };
      }
      return;
    }
    this.view = {
      kind: "result",
      title: "Review existing configuration first",
      message:
        "Adopt or reset the existing native MCP entry before changing its governed tool exposure.",
      tone: "warning",
      needsReload: false,
    };
  }

  private backFromConflict(view: Extract<PanelView, { kind: "conflicts" }>): void {
    if (view.toolPolicy) {
      this.view = {
        kind: "tool-policy",
        presetId: view.sourcePresetId,
        policy: view.toolPolicy,
        cursor: 0,
      };
      return;
    }
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.sourcePresetId));
    this.view = {
      kind: "overview",
      presetId: view.sourcePresetId,
      selected: overviewActionIndex(state, "configure"),
    };
  }

  private beginPresetConfiguration(
    state: PresetRuntimeState,
    toolPolicy?: ToolExposurePolicy,
  ): void {
    if (this.scope === "project" && !this.projectTrusted) {
      this.view = {
        kind: "result",
        title: "Project setup unavailable",
        message:
          "Project MCP setup is unavailable until Pi trusts this project. Switch to global scope or use /trust.",
        tone: "warning",
        needsReload: false,
      };
      return;
    }
    if (state.managed.status === "managed-enabled") {
      this.view = {
        kind: "result",
        title: `${state.preset.label} is already enabled`,
        message:
          state.drift.status === "review"
            ? "Observed tool drift requires review. Added tools remain hidden until a reviewed preset revision approves them; removed tools are unreachable."
            : "Use D from the Salesforce MCP catalog to disable this managed preset.",
        tone: "warning",
        needsReload: false,
      };
      return;
    }
    if (state.managed.status === "managed-disabled") {
      this.view = { kind: "toggle", presetId: state.preset.id, enable: true, selected: 0 };
      return;
    }
    if (
      ["manual", "modified", "managed-outdated", "name-conflict"].includes(state.managed.status)
    ) {
      this.openReconcile(state);
      return;
    }
    if (state.managed.status === "invalid-config") {
      this.view = {
        kind: "result",
        title: "Native MCP configuration is invalid",
        message: state.managed.message ?? "Open Pi's native /mcp manager for repair guidance.",
        tone: "error",
        needsReload: false,
      };
      return;
    }
    if (state.plan.conflicts.length > 0) {
      this.view = {
        kind: "conflicts",
        sourcePresetId: state.preset.id,
        plan: state.plan,
        selected: 0,
        ...(toolPolicy ? { toolPolicy } : {}),
      };
      return;
    }
    this.openSetup(state.preset.id, "enable", false, toolPolicy);
  }

  private openReconcile(state: PresetRuntimeState): void {
    this.view = {
      kind: "reconcile",
      presetId: state.preset.id,
      state,
      options: reconcileOptions(state),
      selected: 0,
    };
  }

  private openSetup(
    sourcePresetId: McpPresetId,
    resolution: McpResolution,
    replaceExisting = false,
    toolPolicy?: ToolExposurePolicy,
  ): void {
    const targetPreset = getPreset(sourcePresetId);
    if (targetPreset.setup === "ready") {
      this.openReview({
        sourcePresetId,
        targetPresetId: targetPreset.id,
        resolution,
        setup: {},
        replaceExisting,
        ...(toolPolicy ? { toolPolicy } : {}),
      });
      return;
    }
    this.view = {
      kind: "setup",
      sourcePresetId,
      targetPresetId: targetPreset.id,
      resolution,
      replaceExisting,
      form: new PresetSetupForm(this.theme, targetPreset),
      ...(toolPolicy ? { toolPolicy } : {}),
    };
  }

  private openReview(input: {
    sourcePresetId: McpPresetId;
    targetPresetId: McpPresetId;
    resolution: McpResolution;
    setup: PresetSetup;
    form?: PresetSetupForm;
    replaceExisting?: boolean;
    toolPolicy?: ToolExposurePolicy;
  }): void {
    const targetPreset = getPreset(input.targetPresetId);
    try {
      const config = buildServerConfig(
        targetPreset,
        input.resolution,
        input.setup,
        input.toolPolicy?.exposures,
      );
      this.view = {
        kind: "review",
        ...input,
        replaceExisting: input.replaceExisting === true,
        config,
        selected: 0,
      };
    } catch (error) {
      this.view = {
        kind: "result",
        title: "Preset validation failed",
        message: error instanceof Error ? error.message : String(error),
        tone: "error",
        needsReload: false,
      };
    }
  }

  private backFromSetup(
    sourcePresetId: McpPresetId,
    replaceExisting = false,
    toolPolicy?: ToolExposurePolicy,
  ): void {
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(sourcePresetId));
    if (replaceExisting) {
      this.openReconcile(state);
      return;
    }
    if (state.plan.conflicts.length) {
      this.view = {
        kind: "conflicts",
        sourcePresetId,
        plan: state.plan,
        selected: 0,
        ...(toolPolicy ? { toolPolicy } : {}),
      };
      return;
    }
    this.view = toolPolicy
      ? { kind: "tool-policy", presetId: sourcePresetId, policy: toolPolicy, cursor: 0 }
      : {
          kind: "overview",
          presetId: sourcePresetId,
          selected: overviewActionIndex(state, "configure"),
        };
  }

  private backFromReview(): void {
    if (this.view.kind !== "review") return;
    if (this.view.form) {
      this.view = {
        kind: "setup",
        sourcePresetId: this.view.sourcePresetId,
        targetPresetId: this.view.targetPresetId,
        resolution: this.view.resolution,
        replaceExisting: this.view.replaceExisting,
        form: this.view.form,
        ...(this.view.toolPolicy ? { toolPolicy: this.view.toolPolicy } : {}),
      };
      return;
    }
    this.backFromSetup(this.view.sourcePresetId, this.view.replaceExisting, this.view.toolPolicy);
  }

  private openToggle(enable: boolean): void {
    const state = this.states[this.cursor];
    if (!state) return;
    if (this.scope === "project" && !this.projectTrusted) {
      this.setMessage(
        "Project MCP setup is unavailable until Pi trusts this project. Switch to global scope or use /trust.",
        "warning",
      );
      return;
    }
    if (
      enable
        ? state.managed.status !== "managed-disabled"
        : state.managed.status !== "managed-enabled"
    ) {
      this.setMessage(
        `${state.preset.label} is not an ${enable ? "disabled" : "enabled"} SF MCP-managed preset.`,
        "warning",
      );
      return;
    }
    this.view = { kind: "toggle", presetId: state.preset.id, enable, selected: 0 };
  }

  private finishMutation(result: ReturnType<typeof installPreset>): void {
    if (!result.ok) {
      this.view = {
        kind: "result",
        title: "No configuration changed",
        message: result.message,
        tone: "error",
        needsReload: false,
      };
      return;
    }
    this.refresh();
    this.view = {
      kind: "result",
      title: result.changed ? `${result.preset.label} saved` : "No configuration change needed",
      message: result.message,
      tone: "success",
      needsReload: result.reloadRequired,
    };
  }

  private viewAs<K extends PanelView["kind"]>(kind: K): Extract<PanelView, { kind: K }> {
    const view = this.view;
    if (view.kind !== kind) {
      throw new Error(`SF MCP panel expected ${kind} view, found ${view.kind}.`);
    }
    return view as Extract<PanelView, { kind: K }>;
  }

  private setMessage(message: string, tone: "success" | "warning" | "error"): void {
    this.message = message;
    this.messageTone = tone;
  }
}

function overviewOptions(state: PresetRuntimeState): OverviewChoice[] {
  const configureLabel =
    state.managed.status === "managed-enabled"
      ? "Review current configuration"
      : state.managed.status === "managed-disabled"
        ? "Enable managed preset"
        : ["manual", "modified", "managed-outdated", "name-conflict"].includes(state.managed.status)
          ? "Review configuration"
          : "Configure connection";
  const options: OverviewChoice[] = [
    {
      label: "Review tools",
      description:
        "Inspect documented and session-observed tools, capabilities, risk, exposure, and runtime metadata without changing configuration.",
      action: "tools",
    },
  ];
  if (
    hasReviewedToolPolicy(state.preset) &&
    ["missing", "managed-enabled", "managed-disabled"].includes(state.managed.status)
  ) {
    options.push({
      label: "Configure tool exposure",
      description:
        "Choose a reviewed profile, then set approved tools to Hidden, Code Mode, Deferred, or Direct.",
      action: "policy",
    });
  }
  options.push(
    {
      label: configureLabel,
      description:
        "Continue to conflict review, connection setup, and an explicit native configuration diff.",
      action: "configure",
    },
    {
      label: "Back to catalog",
      description: "Return without changing native MCP configuration.",
      action: "back",
    },
  );
  return options;
}

function overviewActionIndex(state: PresetRuntimeState, action: OverviewAction): number {
  const index = overviewOptions(state).findIndex((option) => option.action === action);
  return Math.max(0, index);
}

function reconcileOptions(state: PresetRuntimeState): ReconcileChoice[] {
  if (state.managed.status === "name-conflict") {
    return [
      ...(state.managed.conflictingNames ?? []).map((name) => ({
        label: `Keep ${name}`,
        description:
          "Remove the other canonically equivalent names. The kept entry remains user-owned until adopted.",
        action: { kind: "keep-name" as const, keepName: name },
      })),
      {
        label: "Cancel",
        description: "Leave every native MCP entry unchanged.",
        action: { kind: "cancel" as const },
      },
    ];
  }

  const options: ReconcileChoice[] = [];
  if (
    state.managed.config &&
    isPresetConfigCompatible(state.preset, state.managed.config).compatible
  ) {
    options.push({
      label: "Adopt existing entry  · Recommended",
      description:
        "Record the current compatible configuration as SF MCP-managed without changing mcp.json.",
      action: { kind: "adopt" },
    });
  }
  options.push(
    {
      label: "Reset to current preset",
      description:
        "Review a redacted field-level diff, then explicitly replace this one entry with the current preset revision.",
      action: { kind: "reset" },
    },
    {
      label: "Cancel",
      description: "Keep the existing entry user-owned and unchanged.",
      action: { kind: "cancel" },
    },
  );
  return options;
}

function conflictOptions(plan: ConflictPlan): ConflictOption[] {
  if (plan.recommendation.resolution === "native-only") {
    return [
      {
        label: "Keep the native SF Pi owner  · Recommended",
        description: plan.recommendation.summary,
        resolution: "native-only",
      },
      {
        label: "Enable MCP side-by-side  · Advanced",
        description:
          "Keep both providers with explicit routing guidance and the preset's approved MCP tools.",
        resolution: "side-by-side",
      },
      { label: "Cancel", description: "Return to the Salesforce MCP catalog." },
    ];
  }
  return [
    {
      label: "Expose only complementary MCP tools  · Recommended",
      description: plan.recommendation.summary,
      resolution: "complement-native",
    },
    {
      label: "Enable full MCP side-by-side  · Advanced",
      description:
        "Expose the current approved MCP tool contract and keep newly discovered tools hidden.",
      resolution: "side-by-side",
    },
    { label: "Cancel", description: "Return to the Salesforce MCP catalog." },
  ];
}

function cycle(index: number, length: number, delta: -1 | 1): number {
  return (index + delta + length) % length;
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done, _tui, ctx) =>
  new SfMcpConfigPanel(
    theme,
    cwd,
    scope,
    done,
    scope === "global" || ctx?.isProjectTrusted() === true,
  );
