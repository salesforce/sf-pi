/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior tests for the Gateway's masked provider-login credential prompt. */
import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionContext,
  ExtensionUIContext,
  KeybindingsManager,
  Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import {
  MaskedCredentialInput,
  createSecureCredentialPromptBridge,
  loginWithSecureCredentialPrompt,
} from "../lib/secure-credential-prompt.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const keybindings = {} as KeybindingsManager;

function makeTui(onRender: () => void = () => undefined): TUI {
  return { requestRender: onRender } as unknown as TUI;
}

describe("MaskedCredentialInput", () => {
  it("returns the submitted credential without rendering any part of it", () => {
    const sentinel = "sk-proof-7Zq9-private";
    const frames: string[] = [];
    let submitted: string | undefined;
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });
    component.focused = true;

    component.handleInput(sentinel);
    frames.push(component.render(40).join("\n"));
    component.handleInput("\r");
    frames.push(component.render(40).join("\n"));

    expect(submitted).toBe(sentinel);
    expect(frames.join("\n")).not.toContain(sentinel);
    expect(frames.join("\n")).not.toContain("sk-proof");
    expect(frames.some((frame) => frame.includes("•"))).toBe(true);
  });

  it("renders the same fixed mask for short and long credentials", () => {
    const short = new MaskedCredentialInput(makeTui(), theme, () => undefined);
    short.handleInput("x");
    const long = new MaskedCredentialInput(makeTui(), theme, () => undefined);
    long.handleInput("a-much-longer-private-credential");

    const countBullets = (value: string) => value.match(/•/gu)?.length ?? 0;
    expect(countBullets(short.render(80)[2] ?? "")).toBe(8);
    expect(countBullets(long.render(80)[2] ?? "")).toBe(8);
  });

  it("supports bracketed paste and backspace while keeping narrow and wide frames masked", () => {
    let submitted: string | undefined;
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });
    component.focused = true;

    component.handleInput("\x1b[200~paste-secret-X\x1b[201~");
    component.handleInput("\x7f");
    const narrow = component.render(12).join("\n");
    const wide = component.render(100).join("\n");
    component.handleInput("\r");

    expect(submitted).toBe("paste-secret-");
    expect(`${narrow}\n${wide}`).not.toContain("paste-secret");
    expect(component.render(40)[2]).not.toContain("•");
  });

  it("decodes plain, shifted, and non-ASCII Kitty printable input", () => {
    let submitted: string | undefined;
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });

    component.handleInput("\x1b[97u");
    component.handleInput("\x1b[65;2u");
    component.handleInput("\x1b[233u");
    component.handleInput("\r");

    expect(submitted).toBe("aAé");
  });

  it("removes one grapheme per backspace for combining and ZWJ input", () => {
    let submitted: string | undefined;
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });

    component.handleInput("e\u0301👩‍💻X");
    component.handleInput("\x7f");
    component.handleInput("\x7f");
    component.handleInput("\r");

    expect(submitted).toBe("e\u0301");
  });

  it("rejects C1 control characters", () => {
    let submitted: string | undefined;
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });

    component.handleInput("ab\u0085cd\u009f");
    component.handleInput("\r");

    expect(submitted).toBe("abcd");
  });

  it("clears the buffer and returns no value on escape", () => {
    let submitted: string | undefined = "not-set";
    const component = new MaskedCredentialInput(makeTui(), theme, (value) => {
      submitted = value;
    });
    component.handleInput("cancelled-secret");
    component.handleInput("\x1b");

    expect(submitted).toBeUndefined();
    expect(component.render(40)[2]).not.toContain("•");
  });
});

type CustomFactory = Parameters<ExtensionUIContext["custom"]>[0];
type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

function makeUi() {
  let active:
    | {
        component: MaskedCredentialInput;
        done: (value: string | undefined) => void;
      }
    | undefined;
  const custom = vi.fn(
    <T>(factory: CustomFactory, _options?: CustomOptions): Promise<T> =>
      new Promise<T>((resolve) => {
        const done = (value: string | undefined) => resolve(value as T);
        active = {
          component: factory(makeTui(), theme, keybindings, done) as MaskedCredentialInput,
          done,
        };
      }),
  );
  return {
    ui: { custom } as unknown as ExtensionUIContext,
    custom,
    get active() {
      return active;
    },
  };
}

async function expectModeRejected(mode: ExtensionContext["mode"]): Promise<void> {
  const bridge = createSecureCredentialPromptBridge();
  const fake = makeUi();
  bridge.bind(fake.ui, mode);
  await expect(bridge.prompt()).rejects.toThrow("only available in interactive TUI mode");
  expect(fake.custom).not.toHaveBeenCalled();
}

describe("secure credential prompt bridge", () => {
  it("opens the component without overlay mode and returns its submitted value", async () => {
    const bridge = createSecureCredentialPromptBridge();
    const fake = makeUi();
    bridge.bind(fake.ui, "tui");

    const result = bridge.prompt();
    expect(fake.custom).toHaveBeenCalledWith(expect.any(Function));
    fake.active?.component.handleInput("credential-from-provider-login");
    fake.active?.component.handleInput("\r");

    await expect(result).resolves.toBe("credential-from-provider-login");
  });

  it("returns an API-key credential without invoking Pi's prompt callback", async () => {
    const bridge = createSecureCredentialPromptBridge();
    const fake = makeUi();
    const prompt = vi.fn();
    bridge.bind(fake.ui, "tui");

    const credential = loginWithSecureCredentialPrompt(bridge, {
      signal: new AbortController().signal,
      prompt,
      notify: vi.fn(),
    });
    fake.active?.component.handleInput("provider-login-secret");
    fake.active?.component.handleInput("\r");

    await expect(credential).resolves.toEqual({
      type: "api_key",
      key: "provider-login-secret",
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it.each(["rpc", "json", "print"] as const)(
    "rejects credential entry in %s mode",
    async (mode) => {
      await expectModeRejected(mode);
    },
  );

  it("settles and cancels an active prompt when the session binding is cleared", async () => {
    const bridge = createSecureCredentialPromptBridge();
    const fake = makeUi();
    bridge.bind(fake.ui, "tui");

    const result = bridge.prompt();
    fake.active?.component.handleInput("must-not-survive-shutdown");
    bridge.clear();

    await expect(result).rejects.toThrow("Login cancelled");
    expect(fake.active?.component.render(40)[2]).not.toContain("•");
  });

  it("cancels on abort and rejects stale prompt results after rebinding", async () => {
    const bridge = createSecureCredentialPromptBridge();
    const first = makeUi();
    bridge.bind(first.ui, "tui");
    const controller = new AbortController();
    const aborted = bridge.prompt(controller.signal);
    first.active?.component.handleInput("abort-secret");
    controller.abort();
    await expect(aborted).rejects.toThrow("Login cancelled");

    const stale = makeUi();
    bridge.bind(stale.ui, "tui");
    const staleResult = bridge.prompt();
    const current = makeUi();
    bridge.bind(current.ui, "tui");
    stale.active?.done("stale-secret");
    await expect(staleResult).rejects.toThrow("Login cancelled");

    const currentResult = bridge.prompt();
    current.active?.component.handleInput("current-secret");
    current.active?.component.handleInput("\r");
    await expect(currentResult).resolves.toBe("current-secret");
  });
});
