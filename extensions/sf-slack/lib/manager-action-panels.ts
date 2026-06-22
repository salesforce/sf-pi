/* SPDX-License-Identifier: Apache-2.0 */
/** Manager action pages for SF Slack detail actions. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, type Component, type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";

type Done = (result: ConfigPanelResult | undefined) => void;

export function createSlackConnectPanel(args: {
  theme: Theme;
  done: Done;
  connect: (token: string) => Promise<string> | string;
}): Component & Focusable & { renderContent(width: number): string[] } {
  return new SlackConnectPanel(args);
}

export function createSlackDisconnectPanel(args: {
  theme: Theme;
  tokenSourceLabel: string;
  done: Done;
  disconnect: () => Promise<string> | string;
}): Component & Focusable & { renderContent(width: number): string[] } {
  return new SlackDisconnectPanel(args);
}

class SlackConnectPanel implements Focusable {
  private input = new Input();
  private result = "";
  private busy = false;
  private error = "";

  get focused(): boolean {
    return this.input.focused;
  }
  set focused(value: boolean) {
    this.input.focused = value;
  }

  constructor(
    private readonly args: {
      theme: Theme;
      done: Done;
      connect: (token: string) => Promise<string> | string;
    },
  ) {
    this.input.onSubmit = (value) => void this.submit(value);
    this.input.onEscape = () => this.args.done(undefined);
  }

  handleInput(data: string): void {
    if (this.busy) return;
    if (matchesKey(data, "escape") || data === "q") {
      this.args.done(undefined);
      return;
    }
    if (this.result) {
      if (matchesKey(data, "enter") || matchesKey(data, "return")) this.args.done(undefined);
      return;
    }
    this.input.handleInput(data);
  }

  renderContent(width: number): string[] {
    const t = this.args.theme;
    if (this.result) {
      return [
        ` ${t.fg("accent", t.bold("Connect to Slack"))}`,
        "",
        ...wrap(this.result, width - 3).map((line) => ` ${t.fg("success", line)}`),
        "",
        ` ${t.fg("dim", "Enter/Esc back")}`,
      ];
    }
    return [
      ` ${t.fg("accent", t.bold("Connect to Slack"))}`,
      ` ${t.fg("dim", "Paste a Slack user token (xoxp- or xapp-). Pi stores it in the central auth store.")}`,
      "",
      ...this.input.render(Math.max(20, width - 4)).map((line) => ` ${line}`),
      this.busy ? ` ${t.fg("dim", "Saving and refreshing identity…")}` : "",
      this.error ? ` ${t.fg("error", this.error)}` : "",
      "",
      ` ${t.fg("dim", "Enter save token · Esc cancel")}`,
    ].filter((line) => line !== "");
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  private async submit(value: string): Promise<void> {
    const token = value.trim();
    if (!token) {
      this.error = "Paste a token before saving.";
      return;
    }
    this.busy = true;
    this.error = "";
    try {
      this.result = await this.args.connect(token);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false;
    }
  }
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
