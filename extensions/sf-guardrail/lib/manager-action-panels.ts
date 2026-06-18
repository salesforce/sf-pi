/* SPDX-License-Identifier: Apache-2.0 */
/** Manager action pages for SF Guardrail detail actions. */
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import { clearProjectApprovals, forgetSessionApprovals } from "./approval-ledger.ts";
import { loadConfig } from "./config.ts";
import { productionAliasesText, updateProductionAliasesFromText } from "./preferences.ts";

type Done = (result: ConfigPanelResult | undefined) => void;

export function createProtectedAliasesActionPanel(
  theme: Theme,
  done: Done,
): Component & Focusable & { renderContent(width: number): string[] } {
  return new ProtectedAliasesActionPanel(theme, done);
}

export function createForgetApprovalsActionPanel(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  theme: Theme,
  done: Done,
): Component & Focusable & { renderContent(width: number): string[] } {
  return new ForgetApprovalsActionPanel(pi, ctx, theme, done);
}

class ProtectedAliasesActionPanel implements Focusable {
  private input = new Input();
  private savedMessage = "";

  get focused(): boolean {
    return this.input.focused;
  }
  set focused(value: boolean) {
    this.input.focused = value;
  }

  constructor(
    private readonly theme: Theme,
    private readonly done: Done,
  ) {
    this.input.setValue(productionAliasesText(loadConfig().config));
    this.input.onSubmit = (value) => this.save(value);
    this.input.onEscape = () => this.done(undefined);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.done(undefined);
      return;
    }
    this.input.handleInput(data);
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    return [
      ` ${t.fg("accent", t.bold("Protected org aliases"))}`,
      ` ${t.fg("dim", "Comma-separated aliases that should receive production-level guardrail prompts.")}`,
      "",
      ...this.input.render(Math.max(20, width - 4)).map((line) => ` ${line}`),
      this.savedMessage ? ` ${t.fg("success", this.savedMessage)}` : "",
      "",
      ` ${t.fg("dim", "Enter save aliases · Esc back")}`,
    ].filter((line) => line !== "");
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private save(value: string): void {
    const aliases = updateProductionAliasesFromText(value);
    this.savedMessage =
      aliases.length > 0
        ? `Protected org aliases saved: ${aliases.join(", ")}`
        : "Protected org aliases cleared.";
    this.input.setValue(productionAliasesText(loadConfig().config));
  }
}

class ForgetApprovalsActionPanel implements Focusable {
  focused = false;
  private selected = 0;
  private result = "";

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly ctx: ExtensionCommandContext,
    private readonly theme: Theme,
    private readonly done: Done,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.selected = this.selected === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (this.result) {
        this.done(undefined);
        return;
      }
      if (this.selected === 1) {
        this.done(undefined);
        return;
      }
      forgetSessionApprovals(this.pi);
      const removed = clearProjectApprovals(this.ctx.cwd);
      this.result = `Session approvals revoked. Cleared ${removed} persisted project approval grant(s).`;
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    if (this.result) {
      return [
        ` ${t.fg("accent", t.bold("Forget approvals"))}`,
        "",
        ` ${t.fg("success", this.result)}`,
        "",
        ` ${t.fg("dim", "Enter/Esc back")}`,
      ];
    }
    const confirm = this.selected === 0;
    return [
      ` ${t.fg("accent", t.bold("Forget approvals"))}`,
      ` ${t.fg("dim", "This clears session approvals for this branch and persisted project grants.")}`,
      "",
      ` ${confirm ? t.fg("accent", "→") : " "} ${confirm ? t.fg("accent", "Clear approvals") : t.fg("text", "Clear approvals")}`,
      ` ${!confirm ? t.fg("accent", "→") : " "} ${!confirm ? t.fg("accent", "Cancel") : t.fg("text", "Cancel")}`,
      "",
      ` ${t.fg("dim", "↑/↓ choose · Enter confirm · Esc cancel")}`,
    ];
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}
}
