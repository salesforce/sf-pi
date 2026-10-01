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
  renderReconcilePage,
  renderResultPage,
  renderReviewPage,
  renderSetupPage,
  renderTogglePage,
  type ConflictOption,
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
  type PresetRuntimeState,
} from "./service.ts";
import { PresetSetupForm } from "./setup-form.ts";

type ReconcileAction =
  | { kind: "adopt" }
  | { kind: "reset" }
  | { kind: "keep-name"; keepName: string }
  | { kind: "cancel" };

type ReconcileChoice = ReconcileOption & { action: ReconcileAction };

type PanelView =
  | { kind: "catalog" }
  | { kind: "conflicts"; sourcePresetId: McpPresetId; plan: ConflictPlan; selected: number }
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

  private handleConflictInput(data: string): void {
    const view = this.viewAs("conflicts");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "catalog" };
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
      this.view = { kind: "catalog" };
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
    this.openSetup(view.sourcePresetId, option.resolution);
  }

  private handleReconcileInput(data: string): void {
    const view = this.viewAs("reconcile");
    if (matchesKey(data, "escape") || data === "q") {
      this.view = { kind: "catalog" };
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
    if (this.scope === "project" && !this.projectTrusted) {
      this.setMessage(
        "Project MCP setup is unavailable until Pi trusts this project. Switch to global scope or use /trust.",
        "warning",
      );
      return;
    }
    if (state.managed.status === "managed-enabled") {
      this.setMessage(
        state.drift.status === "review"
          ? `${state.preset.label} observed tool drift. Added tools remain hidden until a reviewed preset revision approves them; removed tools are unreachable.`
          : `${state.preset.label} is already enabled. Press D to disable it.`,
        "warning",
      );
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
      this.setMessage(
        state.managed.message ?? "The native MCP configuration is invalid.",
        "warning",
      );
      return;
    }
    if (state.plan.conflicts.length > 0) {
      this.view = {
        kind: "conflicts",
        sourcePresetId: state.preset.id,
        plan: state.plan,
        selected: 0,
      };
      return;
    }
    this.openSetup(state.preset.id, "enable", false);
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
  ): void {
    const targetPreset = getPreset(sourcePresetId);
    if (targetPreset.setup === "ready") {
      this.openReview({
        sourcePresetId,
        targetPresetId: targetPreset.id,
        resolution,
        setup: {},
        replaceExisting,
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
    };
  }

  private openReview(input: {
    sourcePresetId: McpPresetId;
    targetPresetId: McpPresetId;
    resolution: McpResolution;
    setup: PresetSetup;
    form?: PresetSetupForm;
    replaceExisting?: boolean;
  }): void {
    const targetPreset = getPreset(input.targetPresetId);
    try {
      const config = buildServerConfig(targetPreset, input.resolution, input.setup);
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
    if (replaceExisting) {
      this.openReconcile(state);
      return;
    }
    this.view = state.plan.conflicts.length
      ? { kind: "conflicts", sourcePresetId, plan: state.plan, selected: 0 }
      : { kind: "catalog" };
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
