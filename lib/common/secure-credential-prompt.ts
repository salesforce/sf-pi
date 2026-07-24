/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Session-bound masked credential entry for SF Pi provider authentication.
 *
 * Pi still owns `/login` orchestration and credential persistence. Providers
 * use this bridge instead of Pi 0.81.1's visible stock secret prompt.
 */
import type { ApiKeyCredential, AuthInteraction } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  CURSOR_MARKER,
  decodeKittyPrintable,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type TUI,
} from "@earendil-works/pi-tui";

const CANCELLED_MESSAGE = "Login cancelled";
const UNAVAILABLE_MESSAGE = "Secure credential entry is only available in interactive TUI mode.";
const MASK = "••••••••";
const DEFAULT_DESCRIPTION = "The submitted value is masked and is not added to the session.";
const ESC = String.fromCharCode(27);
const CSI = `${ESC}[`;
const SS3 = `${ESC}O`;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function normalizePastedTextFieldInput(data: string): string {
  if (/^\[(?:\d+(?:;\d+)*)?[A-Za-z~]$/.test(data)) return "";

  let output = "";
  for (let i = 0; i < data.length; i++) {
    const nextIndex = consumeTerminalControl(data, i);
    if (nextIndex !== i) {
      i = nextIndex - 1;
      continue;
    }
    const code = data.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    output += data[i] ?? "";
  }
  return output;
}

function consumeTerminalControl(data: string, index: number): number {
  if (data.startsWith(CSI, index)) {
    for (let i = index + CSI.length; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code >= 64 && code <= 126) return i + 1;
    }
    return data.length;
  }
  if (data.startsWith(SS3, index) && /[ABCD]/.test(data[index + 2] ?? "")) return index + 3;
  return index;
}

export interface SecureCredentialPromptOptions {
  title: string;
  description?: string;
}

export class MaskedCredentialInput implements Component, Focusable {
  focused = false;
  private value = "";
  private settled = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: Theme,
    private readonly done: (value: string | undefined) => void,
    private readonly options: SecureCredentialPromptOptions = { title: "Secure credential" },
  ) {}

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const maskedValue = this.value ? MASK : "";
    const cursor = this.focused ? CURSOR_MARKER : "";

    return [
      truncateToWidth(this.theme.fg("accent", this.theme.bold(this.options.title)), safeWidth),
      truncateToWidth(
        this.theme.fg("muted", this.options.description ?? DEFAULT_DESCRIPTION),
        safeWidth,
      ),
      truncateToWidth(
        `${this.theme.fg("border", "[")}${this.theme.fg("text", maskedValue)}${cursor}${this.theme.fg("border", "]")}`,
        safeWidth,
      ),
      truncateToWidth(
        this.theme.fg("dim", "Enter saves • Esc cancels • Backspace edits"),
        safeWidth,
      ),
    ];
  }

  handleInput(data: string): void {
    if (this.settled) return;

    if (matchesKey(data, "escape")) {
      this.cancel();
      return;
    }

    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (!this.value) return;
      const submitted = this.value;
      this.value = "";
      this.settled = true;
      this.done(submitted);
      return;
    }

    if (matchesKey(data, "backspace")) {
      const segments = [...graphemeSegmenter.segment(this.value)];
      const last = segments.at(-1);
      this.value = last ? this.value.slice(0, last.index) : "";
      this.tui.requestRender();
      return;
    }

    const decoded = decodeKittyPrintable(data);
    const text = (decoded ?? normalizePastedTextFieldInput(data)).replace(/[\u0080-\u009f]/gu, "");
    if (!text) return;
    this.value += text;
    this.tui.requestRender();
  }

  cancel(): void {
    if (this.settled) return;
    this.value = "";
    this.settled = true;
    this.done(undefined);
  }

  dispose(): void {
    this.value = "";
    this.settled = true;
  }

  invalidate(): void {}
}

type ExtensionMode = ExtensionContext["mode"];

export interface SecureCredentialPromptBridge {
  bind(ui: ExtensionUIContext, mode: ExtensionMode): void;
  clear(): void;
  prompt(signal?: AbortSignal): Promise<string>;
}

type SessionBinding = {
  generation: number;
  mode: ExtensionMode;
  ui?: ExtensionUIContext;
};

type ActivePrompt = {
  generation: number;
  cancel(): void;
};

export async function loginWithSecureCredentialPrompt(
  bridge: SecureCredentialPromptBridge,
  interaction: AuthInteraction,
): Promise<ApiKeyCredential> {
  return {
    type: "api_key",
    key: await bridge.prompt(interaction.signal),
  };
}

export function createSecureCredentialPromptBridge(
  options: SecureCredentialPromptOptions = { title: "Secure credential" },
): SecureCredentialPromptBridge {
  let generation = 0;
  let binding: SessionBinding | undefined;
  let activePrompt: ActivePrompt | undefined;

  const cancelActivePrompt = () => {
    const current = activePrompt;
    activePrompt = undefined;
    current?.cancel();
  };

  return {
    bind(ui, mode) {
      generation += 1;
      cancelActivePrompt();
      binding = {
        generation,
        mode,
        ui: mode === "tui" ? ui : undefined,
      };
    },

    clear() {
      generation += 1;
      binding = undefined;
      cancelActivePrompt();
    },

    async prompt(signal) {
      const current = binding;
      if (!current || current.mode !== "tui" || !current.ui) {
        throw new Error(UNAVAILABLE_MESSAGE);
      }
      if (signal?.aborted) {
        throw new Error(CANCELLED_MESSAGE);
      }
      if (activePrompt) {
        throw new Error("Credential entry is already active.");
      }

      const promptGeneration = current.generation;
      const abortListener = signal
        ? () => {
            if (activePrompt?.generation === promptGeneration) activePrompt.cancel();
          }
        : undefined;
      if (abortListener) signal?.addEventListener("abort", abortListener, { once: true });
      try {
        const result = await current.ui.custom<string | undefined>(
          (tui: TUI, theme: Theme, _keybindings: KeybindingsManager, done) => {
            const component = new MaskedCredentialInput(tui, theme, done, options);
            activePrompt = {
              generation: promptGeneration,
              cancel: () => component.cancel(),
            };
            if (generation !== promptGeneration || signal?.aborted) {
              component.cancel();
            }
            return component;
          },
        );

        if (generation !== promptGeneration || !result) {
          throw new Error(CANCELLED_MESSAGE);
        }
        return result;
      } finally {
        if (abortListener && signal) signal.removeEventListener("abort", abortListener);
        if (activePrompt?.generation === promptGeneration) activePrompt = undefined;
      }
    },
  };
}
