/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke tests for the shared command-action catalog helpers.
 *
 * Coverage focuses on the contract between manifest -> panel -> completions ->
 * help, since drift across those surfaces is the bug ADR 0005 was opened to
 * prevent. We do not test the visual panel rendering here; that lives in
 * lib/common/tests/command-panel.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  type SfPiCommandAction,
  formatHelpFromActions,
  completeArgumentTail,
  formatHelpFromActions,
  formatReadmeTableFromActions,
  getCompletionsFromActions,
  getFirstTokenCompletions,
  getFirstTokenCompletionsFromActions,
  parseArgumentCompletionPrefix,
  resolveAction,
} from "../command-actions.ts";

type Action = "status" | "doctor" | "help" | "close" | "secret";

const ACTIONS: SfPiCommandAction<Action>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current state.",
    group: "Diagnostics",
    section: "diagnostics",
  },
  {
    value: "doctor",
    label: "Run doctor",
    description: "Diagnose setup problems.",
    group: "Diagnostics",
    section: "diagnostics",
    aliases: ["dr"],
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage.",
    group: "Reference",
    section: "help",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: "Lifecycle",
    section: "lifecycle",
  },
  {
    value: "secret",
    label: "Secret",
    description: "Hidden legacy alias.",
    group: "Diagnostics",
    hidden: true,
    aliases: ["legacy-secret"],
  },
];

describe("getCompletionsFromActions", () => {
  it("returns only actions whose value or alias starts with the prefix", () => {
    const result = getCompletionsFromActions(ACTIONS, "do");
    expect(result?.map((r) => r.value)).toEqual(["doctor"]);
  });

  it("appends a space for expandable action completions", () => {
    const result = getCompletionsFromActions([{ ...ACTIONS[0]!, appendSpace: true }], "st");
    expect(result?.map((r) => r.value)).toEqual(["status "]);
  });

  it("matches aliases as separate completion entries", () => {
    const result = getCompletionsFromActions(ACTIONS, "dr");
    expect(result?.map((r) => r.value)).toEqual(["dr"]);
  });

  it("returns null when no actions match (Pi treats null as 'no autocomplete')", () => {
    expect(getCompletionsFromActions(ACTIONS, "zzz")).toBeNull();
  });

  it("hides actions flagged as hidden", () => {
    const result = getCompletionsFromActions(ACTIONS, "secret");
    expect(result).toBeNull();
  });

  it("respects excludeValues so the panel can drop 'close' from completions", () => {
    const result = getCompletionsFromActions(ACTIONS, "", { excludeValues: ["close"] });
    expect(result?.map((r) => r.value)).not.toContain("close");
    expect(result?.map((r) => r.value)).toContain("status");
  });
});

describe("argument-tail completion helpers", () => {
  it("parses trailing spaces as the next token", () => {
    expect(parseArgumentCompletionPrefix("setup ")).toEqual({
      tokens: ["setup"],
      tokenIndex: 1,
      current: "",
      priorTokens: ["setup"],
    });
  });

  it("returns full argument-tail values with compact labels", () => {
    const context = parseArgumentCompletionPrefix("setup g");
    expect(
      completeArgumentTail(
        [{ value: "global", label: "global", description: "Use global settings." }],
        context,
      ),
    ).toEqual([{ value: "setup global", label: "global", description: "Use global settings." }]);
  });

  it("can append a space after expandable completions", () => {
    const context = parseArgumentCompletionPrefix("set");
    expect(
      completeArgumentTail(
        [{ value: "setup", description: "Configure settings.", appendSpace: true }],
        context,
      ),
    ).toEqual([{ value: "setup ", label: "setup", description: "Configure settings." }]);
  });

  it("supports flat options without requiring action metadata", () => {
    expect(
      getFirstTokenCompletions([{ value: "status", description: "Show status." }], "st"),
    ).toEqual([{ value: "status", label: "status", description: "Show status." }]);
    expect(
      getFirstTokenCompletions([{ value: "status", description: "Show status." }], "status h"),
    ).toBeNull();
  });
});

describe("getFirstTokenCompletionsFromActions", () => {
  it("completes first-token flat commands", () => {
    const result = getFirstTokenCompletionsFromActions(ACTIONS, "do");
    expect(result?.map((r) => r.value)).toEqual(["doctor"]);
  });

  it("offers first-token discovery for an empty prefix", () => {
    const result = getFirstTokenCompletionsFromActions(ACTIONS, "", { excludeValues: ["close"] });
    expect(result?.map((r) => r.value)).toEqual(["status", "doctor", "help"]);
  });

  it("returns null after a completed first token to avoid argument-tail truncation", () => {
    expect(getFirstTokenCompletionsFromActions(ACTIONS, "status ")).toBeNull();
    expect(getFirstTokenCompletionsFromActions(ACTIONS, "status he")).toBeNull();
  });
});

describe("resolveAction", () => {
  it("returns the canonical action for an exact value", () => {
    expect(resolveAction(ACTIONS, "doctor")).toBe("doctor");
  });

  it("resolves aliases to the canonical value", () => {
    expect(resolveAction(ACTIONS, "dr")).toBe("doctor");
  });

  it("is case-insensitive for both values and aliases", () => {
    expect(resolveAction(ACTIONS, "DR")).toBe("doctor");
    expect(resolveAction(ACTIONS, "Status")).toBe("status");
  });

  it("returns null for empty input or unknown subcommands", () => {
    expect(resolveAction(ACTIONS, "")).toBeNull();
    expect(resolveAction(ACTIONS, "explode")).toBeNull();
  });

  it("can resolve hidden actions when invoked explicitly by alias", () => {
    expect(resolveAction(ACTIONS, "legacy-secret")).toBe("secret");
  });
});

describe("formatHelpFromActions", () => {
  it("groups actions, surfaces aliases, and skips hidden actions", () => {
    const help = formatHelpFromActions(ACTIONS, "sf-foo");
    expect(help).toContain("/sf-foo subcommands:");
    expect(help).toContain("Diagnostics:");
    expect(help).toContain("Reference:");
    expect(help).toContain("Lifecycle:");
    expect(help).toContain("/sf-foo doctor (alias: dr) — Diagnose setup problems.");
    expect(help).not.toContain("/sf-foo secret");
  });

  it("falls back to a friendly message when there are no visible actions", () => {
    expect(formatHelpFromActions([{ ...ACTIONS[4]! }], "sf-bar")).toBe("/sf-bar — no subcommands.");
  });
});

describe("formatReadmeTableFromActions", () => {
  it("renders a Markdown table excluding hidden actions", () => {
    const md = formatReadmeTableFromActions(ACTIONS, "sf-foo");
    expect(md.startsWith("| Subcommand | Description |")).toBe(true);
    expect(md).toContain("| `/sf-foo doctor` | Diagnose setup problems. |");
    expect(md).not.toContain("/sf-foo secret");
  });

  it("escapes pipe characters in descriptions", () => {
    const actions: SfPiCommandAction<"weird">[] = [
      {
        value: "weird",
        label: "Weird",
        description: "Pipe | inside.",
        group: "Misc",
      },
    ];
    const md = formatReadmeTableFromActions(actions, "sf-foo");
    expect(md).toContain("Pipe \\| inside.");
  });
});
