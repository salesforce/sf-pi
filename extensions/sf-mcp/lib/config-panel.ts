/* SPDX-License-Identifier: Apache-2.0 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { formatInstances, inspectInstanceSummary } from "./connection-instances.ts";
import type { ConflictPlan } from "./conflict-planner.ts";
import { mcpConfigPath, type McpServerConfig } from "./mcp-config.ts";
import {
  padAnsi,
  renderCatalogPage,
  renderConflictPage,
  renderConnectionPage,
  renderPresetOverviewPage,
  renderReconcilePage,
  renderResultPage,
  renderReviewPage,
  renderSetupPage,
  renderTogglePage,
  renderToolAccessUnavailablePage,
  renderToolDetailPage,
  renderToolListPage,
} from "./panel-pages.ts";
import {
  conflictOptions,
  connectionOptions,
  connectionResolution,
  connectionToolPolicy,
  overviewActionIndex,
  overviewOptions,
  reconcileOptions,
  type ReconcileChoice,
} from "./panel-navigation.ts";
import {
  SALESFORCE_MCP_PRESETS,
  approvedToolsForResolution,
  buildServerConfig,
  getPreset,
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
  renderToolConflictDetailPage,
  renderToolConflictReviewPage,
  renderToolDriftPage,
} from "./tool-governance-pages.ts";
import { buildConflictAwareToolPolicy, inspectActiveToolConflicts } from "./tool-conflicts.ts";
import {
  renderToolModeHelpPage,
  renderToolPolicyPage,
  renderToolPolicyReviewPage,
  renderToolProfilesPage,
} from "./tool-policy-pages.ts";
import {
  TOOL_POLICY_PROFILES,
  applyToolExposurePolicy,
  buildToolExposurePolicy,
  cycleToolExposure,
  exposureLabel,
  hasReviewedToolPolicy,
  type ToolExposurePolicy,
} from "./tool-policy.ts";

type PanelView =
  | { kind: "catalog" }
  | { kind: "overview"; presetId: McpPresetId; selected: number }
  | { kind: "connection"; presetId: McpPresetId; selected: number }
  | { kind: "tool-unavailable"; presetId: McpPresetId; reason: "connection" | "contract" }
  | { kind: "tools"; presetId: McpPresetId; cursor: number }
  | {
      kind: "tool-detail";
      presetId: McpPresetId;
      toolName: string;
      returnPolicy?: ToolExposurePolicy;
      returnCursor?: number;
    }
  | {
      kind: "tool-profiles";
      presetId: McpPresetId;
      selected: number;
      returnPolicy?: ToolExposurePolicy;
      returnCursor?: number;
    }
  | { kind: "tool-conflicts"; presetId: McpPresetId; cursor: number }
  | { kind: "tool-conflict-detail"; presetId: McpPresetId; toolName: string }
  | { kind: "tool-drift"; presetId: McpPresetId }
  | { kind: "tool-policy"; presetId: McpPresetId; policy: ToolExposurePolicy; cursor: number }
  | { kind: "tool-help"; presetId: McpPresetId; policy: ToolExposurePolicy; cursor: number }
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
  | {
      kind: "toggle";
      presetId: McpPresetId;
      connectionName: string;
      enable: boolean;
      selected: number;
    }
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
  private activeRow = 0;

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
      case "connection":
        this.handleConnectionInput(data);
        return;
      case "tool-unavailable":
        this.handleToolUnavailableInput(data);
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
      case "tool-conflicts":
        this.handleToolConflictsInput(data);
        return;
      case "tool-conflict-detail":
        this.handleToolConflictDetailInput(data);
        return;
      case "tool-drift":
        this.handleToolDriftInput(data);
        return;
      case "tool-policy":
        this.handleToolPolicyInput(data);
        return;
      case "tool-help":
        this.handleToolHelpInput(data);
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
          const preset = getPreset(view.presetId);
          const {
            instances,
            configured,
            primary: state,
          } = inspectInstanceSummary(this.cwd, this.scope, preset);
          const catalog = getPresetToolCatalog(state.preset);
          return renderPresetOverviewPage({
            theme: this.theme,
            width,
            state,
            instances,
            capabilities: catalog.capabilities,
            catalogNote: catalog.note,
            tools: inspectPresetTools(state.preset),
            options: overviewOptions(state, configured.length),
            selected: view.selected,
          });
        }
        case "connection": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          return renderConnectionPage({
            theme: this.theme,
            width,
            state,
            options: connectionOptions(state),
            selected: view.selected,
          });
        }
        case "tool-unavailable": {
          const preset = getPreset(view.presetId);
          const tools = inspectPresetTools(preset);
          return renderToolAccessUnavailablePage({
            theme: this.theme,
            width,
            preset,
            title:
              view.reason === "connection"
                ? `Connect ${preset.label} before changing tool access`
                : "Reviewed tool contract pending",
            message:
              view.reason === "connection"
                ? "Connection and authentication are configured separately. Return to the overview and complete Connection & authentication first."
                : "This product publishes capabilities without a stable exact tool-name contract. The connection can be configured, but every observed tool remains Hidden until SF Pi reviews a versioned contract.",
            observedTools: tools.filter((tool) => tool.observed).length,
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
            ...(view.returnPolicy
              ? { exposureOverride: exposureLabelForPolicy(view.returnPolicy, tool.name) }
              : {}),
          });
        }
        case "tool-conflicts": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          return renderToolConflictReviewPage({
            theme: this.theme,
            width,
            preset: state.preset,
            conflicts: inspectActiveToolConflicts(state.preset, state.plan),
            cursor: view.cursor,
          });
        }
        case "tool-conflict-detail": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          const conflict = inspectActiveToolConflicts(state.preset, state.plan).find(
            (candidate) => candidate.toolName === view.toolName,
          );
          if (!conflict) {
            return renderResultPage({
              theme: this.theme,
              width,
              title: "Tool conflict is no longer active",
              message: `${view.toolName} no longer overlaps an enabled SF Pi capability owner.`,
              tone: "warning",
              needsReload: false,
            });
          }
          return renderToolConflictDetailPage({
            theme: this.theme,
            width,
            preset: state.preset,
            conflict,
            tool: inspectPresetTools(state.preset).find((tool) => tool.name === view.toolName),
          });
        }
        case "tool-drift": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          return renderToolDriftPage({
            theme: this.theme,
            width,
            preset: state.preset,
            drift: state.drift,
            tools: inspectPresetTools(state.preset),
            canRepair:
              state.drift.removed.length > 0 &&
              (state.managed.status === "managed-enabled" ||
                state.managed.status === "managed-disabled"),
            canReviewPresetUpdate: state.managed.status === "managed-outdated",
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
        case "tool-policy": {
          const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
          return renderToolPolicyPage({
            theme: this.theme,
            width,
            preset: state.preset,
            policy: view.policy,
            tools: inspectPresetTools(state.preset),
            cursor: view.cursor,
            conflicts: inspectActiveToolConflicts(state.preset, state.plan),
          });
        }
        case "tool-help":
          return renderToolModeHelpPage({
            theme: this.theme,
            width,
            preset: getPreset(view.presetId),
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
    this.activeRow = Math.max(
      0,
      lines.findIndex((line) => line.includes("❯")),
    );
    return lines.map((line) => padAnsi(line, width));
  }

  getActiveRow(): number {
    return this.activeRow;
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
    const preset = getPreset(view.presetId);
    const { configured, primary: state } = inspectInstanceSummary(this.cwd, this.scope, preset);
    const options = overviewOptions(state, configured.length);
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
    if (choice.action === "connection") {
      this.view = { kind: "connection", presetId: view.presetId, selected: 0 };
      return;
    }
    if (choice.action === "connections") {
      this.view = {
        kind: "result",
        title: `${preset.label} connections`,
        message: formatInstances(configured),
        tone: "success",
        needsReload: false,
      };
      return;
    }
    if (choice.action === "policy") {
      this.openToolAccess(state);
      return;
    }
    if (choice.action === "tools") {
      this.view = { kind: "tools", presetId: view.presetId, cursor: 0 };
      return;
    }
    if (choice.action === "tool-conflicts") {
      this.view = { kind: "tool-conflicts", presetId: view.presetId, cursor: 0 };
      return;
    }
    if (choice.action === "drift") {
      this.view = { kind: "tool-drift", presetId: view.presetId };
    }
  }

  private handleConnectionInput(data: string): void {
    const view = this.viewAs("connection");
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    const options = connectionOptions(state);
    if (matchesKey(data, "escape") || data === "q") {
      this.view = {
        kind: "overview",
        presetId: view.presetId,
        selected: overviewActionIndex(state, "connection"),
      };
      return;
    }
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
      this.view = {
        kind: "overview",
        presetId: view.presetId,
        selected: overviewActionIndex(state, "connection"),
      };
      return;
    }
    if (choice.action === "reconcile") {
      this.openReconcile(state);
      return;
    }
    this.beginConnectionConfiguration(state);
  }

  private handleToolUnavailableInput(data: string): void {
    const view = this.viewAs("tool-unavailable");
    if (
      !matchesKey(data, "escape") &&
      !matchesKey(data, "enter") &&
      !matchesKey(data, "return") &&
      data !== "q"
    ) {
      return;
    }
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    this.view = {
      kind: "overview",
      presetId: view.presetId,
      selected: overviewActionIndex(state, "policy"),
    };
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
    if (view.returnPolicy) {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: view.returnPolicy,
        cursor: view.returnCursor ?? cursor,
      };
      return;
    }
    this.view = { kind: "tools", presetId: view.presetId, cursor };
  }

  private handleToolConflictsInput(data: string): void {
    const view = this.viewAs("tool-conflicts");
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    const conflicts = inspectActiveToolConflicts(state.preset, state.plan);
    if (matchesKey(data, "escape") || data === "q") {
      this.view = {
        kind: "overview",
        presetId: view.presetId,
        selected: overviewActionIndex(state, "tool-conflicts"),
      };
      return;
    }
    if (matchesKey(data, "up")) {
      view.cursor = cycle(view.cursor, conflicts.length, -1);
      return;
    }
    if (matchesKey(data, "down")) {
      view.cursor = cycle(view.cursor, conflicts.length, 1);
      return;
    }
    if (data === "n" || data === "N") {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: buildConflictAwareToolPolicy(state.preset, state.plan),
        cursor: 0,
      };
      return;
    }
    if (data === "b" || data === "B") {
      this.view = {
        kind: "tool-policy",
        presetId: view.presetId,
        policy: buildToolExposurePolicy(state.preset, "all-approved", state.managed.config),
        cursor: 0,
      };
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    const conflict = conflicts[view.cursor];
    if (conflict) {
      this.view = {
        kind: "tool-conflict-detail",
        presetId: view.presetId,
        toolName: conflict.toolName,
      };
    }
  }

  private handleToolConflictDetailInput(data: string): void {
    const view = this.viewAs("tool-conflict-detail");
    if (
      !matchesKey(data, "escape") &&
      !matchesKey(data, "enter") &&
      !matchesKey(data, "return") &&
      data !== "q"
    ) {
      return;
    }
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    const conflicts = inspectActiveToolConflicts(state.preset, state.plan);
    const cursor = Math.max(
      0,
      conflicts.findIndex((conflict) => conflict.toolName === view.toolName),
    );
    this.view = { kind: "tool-conflicts", presetId: view.presetId, cursor };
  }

  private handleToolDriftInput(data: string): void {
    const view = this.viewAs("tool-drift");
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(view.presetId));
    if (matchesKey(data, "escape") || data === "q") {
      this.view = {
        kind: "overview",
        presetId: view.presetId,
        selected: overviewActionIndex(state, "drift"),
      };
      return;
    }
    if ((data === "u" || data === "U") && state.managed.status === "managed-outdated") {
      this.openReconcile(state);
      return;
    }
    if (
      (data === "r" || data === "R") &&
      state.drift.removed.length > 0 &&
      state.managed.config &&
      (state.managed.status === "managed-enabled" || state.managed.status === "managed-disabled")
    ) {
      const policy = buildToolExposurePolicy(state.preset, "custom", state.managed.config);
      this.continueToolPolicy(view.presetId, policy);
    }
  }

  private handleToolProfilesInput(data: string): void {
    const view = this.viewAs("tool-profiles");
    if (matchesKey(data, "escape") || data === "q") {
      if (view.returnPolicy) {
        this.view = {
          kind: "tool-policy",
          presetId: view.presetId,
          policy: view.returnPolicy,
          cursor: view.returnCursor ?? 0,
        };
      } else {
        this.view = { kind: "overview", presetId: view.presetId, selected: 0 };
      }
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
        policy:
          option.id === "recommended"
            ? buildConflictAwareToolPolicy(state.preset, state.plan)
            : buildToolExposurePolicy(state.preset, option.id, state.managed.config),
        cursor: view.returnCursor ?? 0,
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
      this.view = { kind: "overview", presetId: view.presetId, selected: 0 };
      return;
    }
    if (data === "?" || data === "h" || data === "H") {
      this.view = {
        kind: "tool-help",
        presetId: view.presetId,
        policy: view.policy,
        cursor: view.cursor,
      };
      return;
    }
    if (data === "p" || data === "P") {
      this.view = {
        kind: "tool-profiles",
        presetId: view.presetId,
        selected: 0,
        returnPolicy: view.policy,
        returnCursor: view.cursor,
      };
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
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      const tool = tools[view.cursor];
      if (tool) {
        this.view = {
          kind: "tool-detail",
          presetId: view.presetId,
          toolName: tool.name,
          returnPolicy: view.policy,
          returnCursor: view.cursor,
        };
      }
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
    if (data === "s" || data === "S" || data === "a" || data === "A") {
      this.continueToolPolicy(view.presetId, view.policy);
    }
  }

  private handleToolHelpInput(data: string): void {
    const view = this.viewAs("tool-help");
    if (
      !matchesKey(data, "escape") &&
      !matchesKey(data, "enter") &&
      !matchesKey(data, "return") &&
      data !== "q"
    ) {
      return;
    }
    this.view = {
      kind: "tool-policy",
      presetId: view.presetId,
      policy: view.policy,
      cursor: view.cursor,
    };
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
    const resolution = view.state.managed.record?.resolution ?? connectionResolution(view.state);
    this.openSetup(view.presetId, resolution, true, connectionToolPolicy(view.state));
  }

  private handleSetupInput(data: string): void {
    const view = this.viewAs("setup");
    const event = view.form.handleInput(data);
    if (!event) return;
    if (event.kind === "back") {
      this.backFromSetup(view.sourcePresetId, view.replaceExisting);
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
      connectionName: view.connectionName,
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
    this.states = SALESFORCE_MCP_PRESETS.map(
      (preset) => inspectInstanceSummary(this.cwd, this.scope, preset).primary,
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

  private openToolAccess(state: PresetRuntimeState): void {
    if (!hasReviewedToolPolicy(state.preset)) {
      this.view = { kind: "tool-unavailable", presetId: state.preset.id, reason: "contract" };
      return;
    }
    if (state.managed.status !== "managed-enabled" && state.managed.status !== "managed-disabled") {
      this.view = { kind: "tool-unavailable", presetId: state.preset.id, reason: "connection" };
      return;
    }
    try {
      this.view = {
        kind: "tool-policy",
        presetId: state.preset.id,
        policy: buildToolExposurePolicy(state.preset, "custom", state.managed.config),
        cursor: 0,
      };
    } catch (error) {
      this.view = {
        kind: "result",
        title: "Tool access unavailable",
        message: error instanceof Error ? error.message : String(error),
        tone: "warning",
        needsReload: false,
      };
    }
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
      this.view = { kind: "tool-unavailable", presetId, reason: "connection" };
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
          proposedConfig: applyToolExposurePolicy(
            state.preset,
            state.managed.config,
            policy,
            approvedToolsForResolution(state.preset, state.managed.record?.resolution ?? "enable"),
          ),
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
      selected: overviewActionIndex(state, "tool-conflicts"),
    };
  }

  private beginConnectionConfiguration(state: PresetRuntimeState): void {
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
    if (state.managed.status === "project-override") {
      this.view = {
        kind: "result",
        title: "Project override is Pi-managed",
        message:
          state.managed.message ??
          "Use Pi's native /mcp surface to change this project override, or explicitly reset it to a full project preset.",
        tone: "warning",
        needsReload: false,
      };
      return;
    }
    if (state.managed.status === "managed-enabled" || state.managed.status === "managed-disabled") {
      this.openSetup(
        state.preset.id,
        connectionResolution(state),
        true,
        connectionToolPolicy(state),
      );
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
    this.openSetup(
      state.preset.id,
      connectionResolution(state),
      false,
      connectionToolPolicy(state),
    );
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

  private backFromSetup(sourcePresetId: McpPresetId, replaceExisting = false): void {
    const state = inspectPresetRuntime(this.cwd, this.scope, getPreset(sourcePresetId));
    if (
      replaceExisting &&
      ["manual", "modified", "managed-outdated", "name-conflict"].includes(state.managed.status)
    ) {
      this.openReconcile(state);
      return;
    }
    this.view = {
      kind: "connection",
      presetId: sourcePresetId,
      selected: 0,
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
    this.backFromSetup(this.view.sourcePresetId, this.view.replaceExisting);
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
    this.view = {
      kind: "toggle",
      presetId: state.preset.id,
      connectionName: state.managed.configuredName ?? state.connectionName,
      enable,
      selected: 0,
    };
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

function exposureLabelForPolicy(policy: ToolExposurePolicy, toolName: string): string {
  return exposureLabel(policy.exposures[toolName] ?? "hidden");
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
