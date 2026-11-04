/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Manager confirm page for SF Fin install.
 *
 * Follows SF Code Analyzer's confirm panel, with one addition: the detail is
 * loaded asynchronously (install plan) before the user can confirm.
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";

type Done = (result: ConfigPanelResult | undefined) => void;

export interface ConfirmPanelDetail {
  detail: string;
  canConfirm: boolean;
  confirm?: () => Promise<string>;
}

export interface FinConfirmPanelArgs {
  theme: Theme;
  title: string;
  confirmLabel: string;
  loadDetail: () => Promise<ConfirmPanelDetail>;
  done: Done;
}

export function createFinConfirmPanel(
  args: FinConfirmPanelArgs,
): Component & Focusable & { renderContent(width: number): string[] } {
  return new FinConfirmPanel(args);
}

class FinConfirmPanel implements Focusable {
  focused = false;
  private selected = 0;
  private busy = true;
  private loaded?: ConfirmPanelDetail;
  private result = "";

  constructor(private readonly args: FinConfirmPanelArgs) {
    void this.load();
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (matchesKey(data, "escape") || data === "q") {
      this.args.done(undefined);
      return;
    }
    if (this.loaded?.canConfirm && !this.result) {
      if (matchesKey(data, "up") || matchesKey(data, "down")) {
        this.selected = this.selected === 0 ? 1 : 0;
        return;
      }
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (this.result || !this.loaded?.canConfirm || this.selected === 1) {
        this.args.done(undefined);
        return;
      }
      void this.confirm();
    }
  }

  renderContent(width: number): string[] {
    const t = this.args.theme;
    const title = ` ${t.fg("accent", t.bold(this.args.title))}`;
    if (this.busy) return [title, "", ` ${t.fg("dim", this.loaded ? "Running…" : "Checking…")}`];
    if (this.result) {
      return [
        title,
        "",
        ...wrap(this.result, width - 3).map((line) => ` ${t.fg("text", line)}`),
        "",
        ` ${t.fg("dim", "Enter/Esc back")}`,
      ];
    }
    const body = wrap(this.loaded?.detail ?? "", width - 3).map((line) => ` ${t.fg("dim", line)}`);
    if (!this.loaded?.canConfirm)
      return [title, "", ...body, "", ` ${t.fg("dim", "Enter/Esc back")}`];
    const confirm = this.selected === 0;
    return [
      title,
      "",
      ...body,
      "",
      ` ${confirm ? t.fg("accent", "→") : " "} ${confirm ? t.fg("accent", this.args.confirmLabel) : t.fg("text", this.args.confirmLabel)}`,
      ` ${!confirm ? t.fg("accent", "→") : " "} ${!confirm ? t.fg("accent", "Cancel") : t.fg("text", "Cancel")}`,
      "",
      ` ${t.fg("dim", "↑/↓ choose · Enter confirm · Esc cancel")}`,
    ];
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private async load(): Promise<void> {
    try {
      this.loaded = await this.args.loadDetail();
    } catch (error) {
      this.loaded = {
        detail: error instanceof Error ? error.message : String(error),
        canConfirm: false,
      };
    } finally {
      this.busy = false;
    }
  }

  private async confirm(): Promise<void> {
    if (!this.loaded?.confirm) return;
    this.busy = true;
    try {
      this.result = await this.loaded.confirm();
    } catch (error) {
      this.result = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }
}

/** Preserve explicit line breaks (commands, steps) while wrapping long lines. */
function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (next.length <= width) {
        current = next;
        continue;
      }
      if (current) out.push(current);
      current = word;
    }
    if (current) out.push(current);
  }
  return out.length ? out : [""];
}
