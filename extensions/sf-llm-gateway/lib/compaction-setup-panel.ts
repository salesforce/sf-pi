/* SPDX-License-Identifier: Apache-2.0 */
/** Focused dedicated-compaction setup shared by slash command and Manager action. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, visibleWidth, type Focusable } from "@earendil-works/pi-tui";
import { GatewayCompactionModelPicker } from "./compaction-model-picker.ts";
import type {
  CompactionSettingsScope,
  GatewayCompactionModel,
  GatewayCompactionModelOption,
} from "./compaction-settings.ts";

const MIN_CONTEXT_TOKENS = 1_000_000;
const MIN_OUTPUT_TOKENS = 8_192;

type PanelFocus = "model" | "save" | "cancel";

export interface GatewayCompactionSetupResult {
  configuredModel: Exclude<GatewayCompactionModel, "active">;
  needsReload?: boolean;
}

export function recommendGatewayCompactionModel(
  models: readonly GatewayCompactionModelOption[],
): GatewayCompactionModel | undefined {
  const eligible = models.filter(
    (model) =>
      (model.contextWindow ?? 0) >= MIN_CONTEXT_TOKENS &&
      (model.maxTokens ?? 0) >= MIN_OUTPUT_TOKENS,
  );
  return eligible.length === 1 ? eligible[0]?.value : undefined;
}

export class GatewayCompactionSetupComponent implements Focusable {
  focused = false;
  private readonly picker: GatewayCompactionModelPicker;
  private readonly focusOrder: readonly PanelFocus[] = ["model", "save", "cancel"];
  private focusIndex = 0;
  private errorMessage: string | null = null;

  constructor(
    private readonly theme: Theme,
    scope: CompactionSettingsScope,
    cwd: string,
    private readonly done: (result: GatewayCompactionSetupResult | undefined) => void,
    models: readonly GatewayCompactionModelOption[],
    private readonly onSaved?: (model: GatewayCompactionSetupResult["configuredModel"]) => void,
    private readonly projectTrusted: boolean = true,
  ) {
    this.picker = new GatewayCompactionModelPicker(
      cwd,
      scope,
      models,
      recommendGatewayCompactionModel(models),
    );
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }

    const focus = this.currentFocus();
    if (focus === "model" && (isLeft(data) || isRight(data))) {
      this.errorMessage = null;
      this.picker.cycle(isLeft(data) ? -1 : 1);
      return;
    }
    if (matchesKey(data, "tab") || isDown(data)) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex + 1) % this.focusOrder.length;
      return;
    }
    if (matchesKey(data, "shift+tab") || isUp(data)) {
      this.errorMessage = null;
      this.focusIndex = (this.focusIndex - 1 + this.focusOrder.length) % this.focusOrder.length;
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return")) return;

    if (focus === "cancel") {
      this.done(undefined);
      return;
    }
    if (focus === "model") {
      this.picker.cycle(1);
      return;
    }

    if (!this.projectTrusted) {
      this.errorMessage = "Project compaction settings require a trusted project.";
      return;
    }

    const configuredModel = this.picker.persistSetup();
    if (!configuredModel) {
      this.errorMessage =
        "Choose a cached Gateway model. Authenticate and refresh first when no model is listed.";
      return;
    }
    this.onSaved?.(configuredModel);
    this.done({ configuredModel });
  }

  renderContent(width: number): string[] {
    const lines = [
      this.theme.fg("muted", "Enable automatic compaction and use a dedicated Gateway model."),
      this.theme.fg(
        "dim",
        "This never changes the active chat model. Cached model metadata only; no network request.",
      ),
      "",
      ...this.picker.renderRows(this.theme, this.currentFocus() === "model"),
      "",
      `${this.renderButton("save", "Save")}  ${this.renderButton("cancel", "Cancel")}`,
    ];
    if (this.errorMessage) lines.push("", this.theme.fg("error", `⚠ ${this.errorMessage}`));
    lines.push("", this.theme.fg("dim", "←/→ choose · ↑/↓ move · Enter action · Esc cancel"));
    return lines.map((line) => truncateVisible(line, width));
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private currentFocus(): PanelFocus {
    return this.focusOrder[this.focusIndex] ?? "model";
  }

  private renderButton(field: "save" | "cancel", label: string): string {
    const active = this.currentFocus() === field;
    return this.theme.fg(active ? "accent" : "muted", active ? `[ ${label} ]` : `  ${label}  `);
  }
}

function isUp(data: string): boolean {
  return matchesKey(data, "up") || data === "\x1b[A";
}

function isDown(data: string): boolean {
  return matchesKey(data, "down") || data === "\x1b[B";
}

function isLeft(data: string): boolean {
  return matchesKey(data, "left") || data === "\x1b[D";
}

function isRight(data: string): boolean {
  return matchesKey(data, "right") || data === "\x1b[C";
}

function truncateVisible(text: string, width: number): string {
  if (visibleWidth(text) <= width) return text;
  let output = text;
  while (output.length > 0 && visibleWidth(`${output}…`) > width) {
    output = output.slice(0, -1);
  }
  return `${output}…`;
}
