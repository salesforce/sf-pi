/* SPDX-License-Identifier: Apache-2.0 */
/** Inline preset setup form hosted inside the SF Pi Manager panel. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import { SF_MCP_HEADLESS_360_REQUIREMENT } from "../../../lib/common/sf-mcp-oauth-requirements.ts";
import type { McpPreset, PresetSetup } from "./presets.ts";

type ChoiceKey = "environment" | "region";
type TextKey = "oauthClientId" | "tenantId" | "marketingClientId" | "customUrl";
type Control =
  | { kind: "choice"; key: ChoiceKey; label: string; help: string; options: ChoiceOption[] }
  | { kind: "text"; key: TextKey; label: string; help: string; input: Input }
  | { kind: "action"; action: "review" | "cancel" };

type ChoiceOption = { label: string; value: NonNullable<PresetSetup[ChoiceKey]> };

export type SetupFormEvent = { kind: "review"; setup: PresetSetup } | { kind: "back" };

export class PresetSetupForm {
  private readonly controls: Control[];
  private readonly choices: Partial<Record<ChoiceKey, string>> = {};
  private focusIndex = 0;
  private error = "";

  constructor(
    private readonly theme: Theme,
    private readonly preset: McpPreset,
  ) {
    this.controls = setupControls(theme, preset);
    for (const control of this.controls) {
      if (control.kind === "choice") this.choices[control.key] = control.options[0]?.value;
    }
  }

  handleInput(data: string): SetupFormEvent | undefined {
    if (matchesKey(data, "escape")) return { kind: "back" };
    const control = this.currentControl();

    if (matchesKey(data, "tab") || matchesKey(data, "down")) {
      this.move(1);
      return;
    }
    if (matchesKey(data, "shift+tab") || matchesKey(data, "up")) {
      this.move(-1);
      return;
    }

    if (control.kind === "text") {
      if (matchesKey(data, "enter") || matchesKey(data, "return")) {
        this.move(1);
        return;
      }
      control.input.handleInput(data);
      this.error = "";
      return;
    }

    if (control.kind === "choice") {
      if (matchesKey(data, "left")) {
        this.cycleChoice(control, -1);
        return;
      }
      if (matchesKey(data, "right") || matchesKey(data, "space")) {
        this.cycleChoice(control, 1);
        return;
      }
      if (matchesKey(data, "enter") || matchesKey(data, "return")) {
        this.move(1);
      }
      return;
    }

    if (matchesKey(data, "left")) {
      this.move(-1);
      return;
    }
    if (matchesKey(data, "right")) {
      this.move(1);
      return;
    }
    if (!matchesKey(data, "enter") && !matchesKey(data, "return") && !matchesKey(data, "space")) {
      return;
    }
    if (control.action === "cancel") return { kind: "back" };
    const setup = this.validate();
    return setup ? { kind: "review", setup } : undefined;
  }

  renderContent(width: number, focused: boolean): string[] {
    const lines: string[] = [];
    const fields = this.controls.filter((control) => control.kind !== "action");
    for (const control of fields) {
      const index = this.controls.indexOf(control);
      const selected = index === this.focusIndex;
      const cursor = selected ? this.theme.fg("accent", "❯") : " ";
      const label = selected
        ? this.theme.fg("accent", this.theme.bold(control.label))
        : this.theme.fg("text", control.label);
      lines.push(` ${cursor} ${label}`);
      if (control.kind === "choice") {
        const current = this.choices[control.key];
        const values = control.options
          .map((option) => {
            const text = option.value === current ? this.theme.bold(option.label) : option.label;
            return this.theme.fg(option.value === current ? "accent" : "muted", text);
          })
          .join(this.theme.fg("dim", "  /  "));
        lines.push(`     ${values}`);
      } else {
        control.input.focused = focused && selected;
        for (const inputLine of control.input.render(Math.max(20, width - 6))) {
          lines.push(`     ${inputLine}`);
        }
      }
      lines.push(
        ...wrapText(control.help, Math.max(20, width - 6)).map(
          (line) => `     ${this.theme.fg("dim", line)}`,
        ),
      );
      lines.push("");
    }

    const reviewIndex = this.controls.findIndex(
      (control) => control.kind === "action" && control.action === "review",
    );
    const cancelIndex = this.controls.findIndex(
      (control) => control.kind === "action" && control.action === "cancel",
    );
    lines.push(` ${this.theme.fg("muted", "Actions")}`);
    lines.push(
      `   ${renderButton(this.theme, "Review", this.focusIndex === reviewIndex)}  ${renderButton(
        this.theme,
        "Cancel",
        this.focusIndex === cancelIndex,
      )}`,
    );
    if (this.error) lines.push("", ` ${this.theme.fg("error", `⚠ ${this.error}`)}`);
    lines.push(
      "",
      ...wrapText(
        "Tab/↑↓ move · ←/→ change option · type/paste to edit · Enter action · Esc back",
        Math.max(20, width - 2),
      ).map((line) => ` ${this.theme.fg("dim", line)}`),
    );
    return lines;
  }

  invalidate(): void {
    for (const control of this.controls) {
      if (control.kind === "text") control.input.invalidate();
    }
  }

  private currentControl(): Control {
    const control = this.controls[this.focusIndex];
    if (!control) throw new Error(`SF MCP setup focus ${this.focusIndex} is out of range.`);
    return control;
  }

  private move(delta: -1 | 1): void {
    this.focusIndex = (this.focusIndex + delta + this.controls.length) % this.controls.length;
    this.error = "";
  }

  private cycleChoice(control: Extract<Control, { kind: "choice" }>, delta: -1 | 1): void {
    const current = this.choices[control.key];
    const index = Math.max(
      0,
      control.options.findIndex((option) => option.value === current),
    );
    const next = control.options[(index + delta + control.options.length) % control.options.length];
    if (next) this.choices[control.key] = next.value;
    this.error = "";
  }

  private validate(): PresetSetup | undefined {
    const setup: PresetSetup = {};
    for (let index = 0; index < this.controls.length; index++) {
      const control = this.controls[index];
      if (!control || control.kind === "action") continue;
      if (control.kind === "choice") {
        const value = this.choices[control.key];
        if (control.key === "environment") {
          setup.environment = value as PresetSetup["environment"];
        } else {
          setup.region = value as PresetSetup["region"];
        }
        continue;
      }

      const value = control.input.getValue().trim();
      if (!value) {
        this.focusIndex = index;
        this.error = `${control.label} is required.`;
        return undefined;
      }
      setup[control.key] = value;
    }

    if (setup.customUrl) {
      try {
        const url = new URL(setup.customUrl);
        const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
        if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
          throw new Error("Custom remote MCP URLs must use HTTPS.");
        }
      } catch (error) {
        const index = this.controls.findIndex(
          (control) => control.kind === "text" && control.key === "customUrl",
        );
        this.focusIndex = Math.max(0, index);
        this.error = error instanceof Error ? error.message : "Enter a valid MCP URL.";
        return undefined;
      }
    }
    return setup;
  }
}

function setupControls(theme: Theme, preset: McpPreset): Control[] {
  const controls: Control[] = [];
  if (preset.setup === "hosted-oauth") {
    controls.push({
      kind: "choice",
      key: "environment",
      label: "Org environment",
      help: "Select the endpoint family. Guardrail classifies production, sandbox, or unknown; exact OAuth-org correlation is not yet available.",
      options: [
        { label: "Sandbox / Scratch", value: "sandbox" },
        { label: "Production", value: "production" },
      ],
    });
    const callbackUrl =
      preset.id === SF_MCP_HEADLESS_360_REQUIREMENT.presetId
        ? SF_MCP_HEADLESS_360_REQUIREMENT.callbackUrl
        : "http://127.0.0.1:8765/callback";
    controls.push(
      textControl(
        theme,
        "oauthClientId",
        "External Client App consumer key",
        `Public client identifier. Callback: ${callbackUrl} · scopes: mcp_api, refresh_token`,
        "Paste consumer key",
      ),
    );
  } else if (preset.setup === "agentforce-sales-oauth") {
    controls.push(
      textControl(
        theme,
        "oauthClientId",
        "External Client App consumer key",
        "Set AGENTFORCE_SALES_CLIENT_SECRET in the environment. SF Pi uses a loopback callback; Salesforce currently documents this Beta endpoint for ChatGPT, so generic-client interoperability is experimental.",
        "Paste consumer key",
      ),
    );
  } else if (preset.setup === "marketing-cloud") {
    controls.push({
      kind: "choice",
      key: "region",
      label: "Region",
      help: "The selected region determines the generated hosted MCP endpoint.",
      options: [
        { label: "United States", value: "US" },
        { label: "European Union", value: "EU" },
      ],
    });
    controls.push(
      textControl(
        theme,
        "tenantId",
        "Tenant ID",
        "Marketing Cloud tenant identifier.",
        "Tenant ID",
      ),
      textControl(
        theme,
        "marketingClientId",
        "Public app client ID",
        "Marketing Cloud public-app client identifier.",
        "Client ID",
      ),
    );
  } else if (preset.setup === "mulesoft-env") {
    controls.push({
      kind: "choice",
      key: "region",
      label: "Anypoint region",
      help: "Credentials remain environment references: ANYPOINT_CLIENT_ID and ANYPOINT_CLIENT_SECRET.",
      options: [
        { label: "PROD_US", value: "PROD_US" },
        { label: "PROD_EU", value: "PROD_EU" },
        { label: "PROD_CA", value: "PROD_CA" },
        { label: "PROD_JP", value: "PROD_JP" },
      ],
    });
  } else if (preset.setup === "custom-url") {
    const control = textControl(
      theme,
      "customUrl",
      "Streamable HTTP MCP URL",
      "Custom servers start quarantined with hidden exposure and no callable tools.",
      "https://",
    );
    control.input.setValue("https://");
    controls.push(control);
  }
  controls.push({ kind: "action", action: "review" }, { kind: "action", action: "cancel" });
  return controls;
}

function textControl(
  theme: Theme,
  key: TextKey,
  label: string,
  help: string,
  placeholder: string,
): Extract<Control, { kind: "text" }> {
  return {
    kind: "text",
    key,
    label,
    help,
    input: new Input({
      placeholder,
      placeholderStyle: (value) => theme.fg("dim", value),
    }),
  };
}

function renderButton(theme: Theme, label: string, selected: boolean): string {
  const text = `[ ${label} ]`;
  return selected ? theme.fg("accent", theme.bold(`❯ ${text}`)) : theme.fg("muted", `  ${text}`);
}

function wrapText(text: string, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (visibleWidth(next) <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (visibleWidth(word) <= width) {
      current = word;
      continue;
    }
    const chunks = splitToken(word, width);
    lines.push(...chunks.slice(0, -1));
    current = chunks.at(-1) ?? "";
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

function splitToken(value: string, width: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const character of value) {
    if (current && visibleWidth(`${current}${character}`) > width) {
      chunks.push(current);
      current = character;
    } else {
      current += character;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
