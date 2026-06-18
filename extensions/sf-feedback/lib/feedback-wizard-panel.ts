/* SPDX-License-Identifier: Apache-2.0 */
/** In-Manager wizard page for SF Feedback issue drafts. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import { sanitizeText } from "./sanitize.ts";
import type { FeedbackDraft, IssueKind } from "./types.ts";

interface WizardStep {
  key: "title" | "summary" | "expected" | "steps";
  label: string;
  prompt: string;
  placeholder: string;
}

const STEPS: WizardStep[] = [
  {
    key: "title",
    label: "Title",
    prompt: "Short GitHub issue title",
    placeholder: "Briefly name the issue",
  },
  {
    key: "summary",
    label: "What happened",
    prompt: "What happened? Include the important details.",
    placeholder: "Describe the behavior or request",
  },
  {
    key: "expected",
    label: "Expected",
    prompt: "What did you expect instead?",
    placeholder: "Describe the desired behavior",
  },
  {
    key: "steps",
    label: "Steps",
    prompt: "Steps to reproduce or context",
    placeholder: "1. Start here",
  },
];

export class FeedbackWizardPanel implements Focusable {
  focused = false;

  private stepIndex = 0;
  private fields: Record<WizardStep["key"], string> = {
    title: "",
    summary: "",
    expected: "",
    steps: "1. ",
  };
  private submitting = false;
  private error: string | undefined;

  constructor(
    private readonly theme: Theme,
    private readonly kind: IssueKind,
    private readonly submit: (draft: FeedbackDraft) => Promise<void>,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (this.submitting) return;

    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) {
      this.moveStep(-1);
      return;
    }
    if (matchesKey(data, "down")) {
      this.moveStep(1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      if (this.stepIndex < STEPS.length - 1) {
        this.moveStep(1);
        return;
      }
      void this.submitDraft();
      return;
    }
    if (matchesKey(data, "backspace") || data === "\u007f") {
      this.editCurrent((value) => value.slice(0, -1));
      return;
    }
    if (data.length === 1 && data >= " " && data !== "\u007f") {
      this.editCurrent((value) => `${value}${data}`);
    }
  }

  renderContent(width: number): string[] {
    const t = this.theme;
    const step = STEPS[this.stepIndex] ?? STEPS[0]!;
    const value = this.fields[step.key];
    const progress = `Step ${this.stepIndex + 1}/${STEPS.length}`;
    const clippedValue = value || t.fg("muted", step.placeholder);
    const promptWidth = Math.max(30, width - 4);
    return [
      ` ${t.fg("accent", t.bold(`${labelForKind(this.kind)} feedback`))}  ${t.fg("muted", progress)}`,
      ` ${t.fg("dim", "Each answer lives on its own page. Enter advances; Esc cancels.")}`,
      "",
      ` ${t.fg("accent", step.label)}`,
      ...wrap(step.prompt, promptWidth).map((line) => ` ${t.fg("dim", line)}`),
      "",
      ` ${t.fg("text", clippedValue)}`,
      this.error ? ` ${t.fg("error", this.error)}` : "",
      "",
      ` ${t.fg("dim", this.submitting ? "Submitting…" : "Type to edit · Enter next/submit · ↑/↓ steps · Esc cancel")}`,
    ];
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}

  private moveStep(delta: -1 | 1): void {
    this.error = undefined;
    this.stepIndex = Math.max(0, Math.min(STEPS.length - 1, this.stepIndex + delta));
  }

  private editCurrent(update: (value: string) => string): void {
    const step = STEPS[this.stepIndex] ?? STEPS[0]!;
    this.fields[step.key] = update(this.fields[step.key]);
    this.error = undefined;
  }

  private async submitDraft(): Promise<void> {
    const draft: FeedbackDraft = {
      kind: this.kind,
      title: sanitizeText(this.fields.title),
      summary: sanitizeText(this.fields.summary),
      expected: sanitizeText(this.fields.expected),
      steps: sanitizeText(this.fields.steps),
    };
    if (!draft.title.trim()) {
      this.error = "Title is required before submitting.";
      this.stepIndex = 0;
      return;
    }

    this.submitting = true;
    try {
      await this.submit(draft);
      this.done(undefined);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.submitting = false;
    }
  }
}

export function createFeedbackWizardPanel(
  theme: Theme,
  kind: IssueKind,
  submit: (draft: FeedbackDraft) => Promise<void>,
  done: (result: ConfigPanelResult | undefined) => void,
): FeedbackWizardPanel {
  return new FeedbackWizardPanel(theme, kind, submit, done);
}

function labelForKind(kind: IssueKind): string {
  if (kind === "bug") return "Bug report";
  if (kind === "feature") return "Feature request";
  if (kind === "setup") return "Setup issue";
  return "General";
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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
  return lines.length ? lines : [""];
}
