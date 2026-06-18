/* SPDX-License-Identifier: Apache-2.0 */
/** Manager action pages for SF Slack detail actions. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";

type Done = (result: ConfigPanelResult | undefined) => void;

export function createSlackDisconnectPanel(args: {
  theme: Theme;
  tokenSourceLabel: string;
  done: Done;
  disconnect: () => Promise<string> | string;
}): Component & Focusable & { renderContent(width: number): string[] } {
  return new SlackDisconnectPanel(args);
}

class SlackDisconnectPanel implements Focusable {
  focused = false;
  private selected = 0;
  private result = "";

  constructor(
    private readonly args: {
      theme: Theme;
      tokenSourceLabel: string;
      done: Done;
      disconnect: () => Promise<string> | string;
    },
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      this.args.done(undefined);
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.selected = this.selected === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (this.result) {
        this.args.done(undefined);
        return;
      }
      if (this.selected === 1) {
        this.args.done(undefined);
        return;
      }
      void this.confirm();
    }
  }

  renderContent(width: number): string[] {
    const t = this.args.theme;
    if (this.result) {
      return [
        ` ${t.fg("accent", t.bold("Disconnect Slack"))}`,
        "",
        ...wrap(this.result, width - 3).map((line) => ` ${t.fg("success", line)}`),
        "",
        ` ${t.fg("dim", "Enter/Esc back")}`,
      ];
    }
    const confirm = this.selected === 0;
    return [
      ` ${t.fg("accent", t.bold("Disconnect Slack"))}`,
      ` ${t.fg("dim", "Clear the saved Slack credential from Pi's central auth store.")}`,
      ` ${t.fg("dim", "Environment variable SLACK_USER_TOKEN is left untouched.")}`,
      ` ${t.fg("muted", `Current source: ${this.args.tokenSourceLabel}`)}`,
      "",
      ` ${confirm ? t.fg("accent", "→") : " "} ${confirm ? t.fg("accent", "Disconnect Slack") : t.fg("text", "Disconnect Slack")}`,
      ` ${!confirm ? t.fg("accent", "→") : " "} ${!confirm ? t.fg("accent", "Cancel") : t.fg("text", "Cancel")}`,
      "",
      ` ${t.fg("dim", "↑/↓ choose · Enter confirm · Esc cancel")}`,
    ];
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private async confirm(): Promise<void> {
    this.result = await this.args.disconnect();
  }
}

function wrap(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
