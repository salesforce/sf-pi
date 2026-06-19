/* SPDX-License-Identifier: Apache-2.0 */
/** In-Manager form overview + native field editor for SF Feedback issue drafts. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  Input,
  type Component,
  type EditorTheme,
  type Focusable,
  type TUI,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import { sanitizeText } from "./sanitize.ts";
import type { FeedbackDraft, IssueKind } from "./types.ts";

export interface PreparedFeedbackPreview {
  title: string;
  labels: string[];
  body: string;
}

export interface FeedbackSubmitResult {
  title: string;
  body: string;
  severity: "info" | "warning" | "error";
}

interface FormField {
  key: "title" | "summary" | "expected" | "steps";
  label: string;
  help: string;
  placeholder: string;
  multiline: boolean;
}

const FORM_FIELDS: FormField[] = [
  {
    key: "title",
    label: "Title",
    help: "Short GitHub issue title",
    placeholder: "Briefly name the issue",
    multiline: false,
  },
  {
    key: "summary",
    label: "What happened",
    help: "Important details for maintainers",
    placeholder: "Describe the behavior or request",
    multiline: true,
  },
  {
    key: "expected",
    label: "Expected",
    help: "What should have happened instead",
    placeholder: "Describe the desired behavior",
    multiline: true,
  },
  {
    key: "steps",
    label: "Steps / context",
    help: "Reproduction steps or useful context",
    placeholder: "1. Start here",
    multiline: true,
  },
];

type Mode = "form" | "edit" | "preparing" | "preview" | "submitting" | "result";
type FieldEditor = Component &
  Focusable & { getValue?: () => string; getExpandedText?: () => string };

export class FeedbackWizardPanel implements Focusable {
  private _focused = false;
  private mode: Mode = "form";
  private cursor = 0;
  private editingField: FormField | undefined;
  private editor: FieldEditor | undefined;
  private fields: Record<FormField["key"], string> = {
    title: "",
    summary: "",
    expected: "",
    steps: "1. ",
  };
  private preview: PreparedFeedbackPreview | undefined;
  private result: FeedbackSubmitResult | undefined;
  private error: string | undefined;

  get focused(): boolean {
    return this._focused;
  }
  set focused(value: boolean) {
    this._focused = value;
    if (this.editor) this.editor.focused = value;
  }

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly kind: IssueKind,
    private readonly prepare: (draft: FeedbackDraft) => Promise<PreparedFeedbackPreview>,
    private readonly submit: (preview: PreparedFeedbackPreview) => Promise<FeedbackSubmitResult>,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {}

  handleInput(data: string): void {
    if (this.mode === "preparing" || this.mode === "submitting") return;

    if (this.mode === "edit") {
      this.handleEditInput(data);
      return;
    }

    if (matchesKey(data, "escape") || data === "q") {
      this.done(undefined);
      return;
    }

    if (this.mode === "preview") {
      if (data === "y" || data === "Y" || matchesKey(data, "enter") || matchesKey(data, "return")) {
        void this.submitPreview();
        return;
      }
      if (data === "e" || data === "E") this.mode = "form";
      return;
    }

    if (this.mode === "result") {
      if (matchesKey(data, "enter") || matchesKey(data, "return")) this.done(undefined);
      return;
    }

    if (matchesKey(data, "up")) {
      this.moveCursor(-1);
      return;
    }
    if (matchesKey(data, "down") || matchesKey(data, "tab")) {
      this.moveCursor(1);
      return;
    }
    if (matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.openFieldEditor();
      return;
    }
    if (data === "p" || data === "P" || data === "s" || data === "S") {
      void this.preparePreview();
    }
  }

  renderContent(width: number): string[] {
    if (this.mode === "edit") return this.renderEdit(width);
    if (this.mode === "preview") return this.renderPreview(width);
    if (this.mode === "result") return this.renderResult(width);
    if (this.mode === "preparing" || this.mode === "submitting") return this.renderBusy();
    return this.renderForm(width);
  }

  render(width: number): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {
    this.editor?.invalidate?.();
  }

  private renderForm(width: number): string[] {
    const t = this.theme;
    const fieldWidth = Math.max(24, Math.floor(width * 0.22));
    const valueWidth = Math.max(20, width - fieldWidth - 12);
    const lines = [
      ` ${t.fg("accent", t.bold(`${labelForKind(this.kind)} feedback`))}  ${t.fg("muted", "Form")}`,
      ` ${t.fg("dim", "Review all fields here. Press Enter to edit a field with a native editor.")}`,
      "",
    ];

    for (let i = 0; i < FORM_FIELDS.length; i++) {
      const field = FORM_FIELDS[i];
      if (!field) continue;
      const selected = i === this.cursor;
      const value = this.fields[field.key].trim();
      const displayValue = summarizeFieldValue(value);
      const complete =
        field.key === "title" ? value.length > 0 : value.length > 0 && value !== "1.";
      const status = complete ? t.fg("success", "✓") : t.fg("muted", "○");
      const cursor = selected ? t.fg("accent", "›") : " ";
      const label = selected ? t.fg("accent", field.label) : t.fg("text", field.label);
      const renderedValue = displayValue
        ? truncateToWidth(displayValue, valueWidth, "…")
        : t.fg("muted", field.placeholder);
      lines.push(` ${cursor} ${status} ${pad(label, fieldWidth)} ${renderedValue}`);
      if (selected) lines.push(`     ${t.fg("dim", field.help)}`);
    }

    if (this.error) {
      lines.push("");
      lines.push(` ${t.fg("error", this.error)}`);
    }
    lines.push("");
    lines.push(` ${t.fg("dim", "↑/↓ fields · Enter edit field · P preview · Esc back")}`);
    return lines;
  }

  private renderEdit(width: number): string[] {
    const t = this.theme;
    const field = this.editingField;
    if (!field || !this.editor) return this.renderForm(width);
    this.editor.focused = this.focused;
    const editorRows = this.editor.render(Math.max(20, width - 4));
    return [
      ` ${t.fg("accent", t.bold(`${labelForKind(this.kind)} feedback`))}  ${t.fg("muted", field.label)}`,
      ` ${t.fg("dim", field.help)}`,
      "",
      ...editorRows.map((line) => ` ${line}`),
      "",
      ` ${t.fg("dim", field.multiline ? "Ctrl+S save field · Enter newline · Esc cancel" : "Enter save field · Esc cancel")}`,
    ];
  }

  private renderPreview(width: number): string[] {
    const t = this.theme;
    const preview = this.preview;
    if (!preview) return this.renderForm(width);
    const previewLines = [
      `Title: ${preview.title}`,
      `Labels: ${preview.labels.join(", ") || "none"}`,
      "",
      ...preview.body.split("\n"),
    ];
    return [
      ` ${t.fg("accent", t.bold(`${labelForKind(this.kind)} feedback`))}  ${t.fg("muted", "Preview")}`,
      ` ${t.fg("dim", "Review the issue draft before submitting.")}`,
      "",
      ...previewLines
        .slice(0, 18)
        .map((line) => ` ${truncateToWidth(line, Math.max(20, width - 4), "…")}`),
      previewLines.length > 18
        ? ` ${t.fg("muted", `… ${previewLines.length - 18} more line(s)`)}`
        : "",
      "",
      ` ${t.fg("dim", "Y/Enter submit · E edit · Esc back")}`,
    ].filter((line) => line !== "");
  }

  private renderBusy(): string[] {
    const message = this.mode === "preparing" ? "Preparing preview…" : "Submitting…";
    return [
      ` ${this.theme.fg("accent", this.theme.bold(`${labelForKind(this.kind)} feedback`))}`,
      "",
      ` ${this.theme.fg("dim", message)}`,
    ];
  }

  private renderResult(width: number): string[] {
    const t = this.theme;
    const result = this.result;
    if (!result) return this.renderForm(width);
    return [
      ` ${t.fg("accent", t.bold(`${labelForKind(this.kind)} feedback`))}  ${t.fg(result.severity === "warning" ? "warning" : "success", "Done")}`,
      "",
      ` ${t.fg(result.severity === "warning" ? "warning" : "text", result.title)}`,
      "",
      ...result.body
        .split("\n")
        .slice(0, 10)
        .map((line) => ` ${truncateToWidth(line, Math.max(20, width - 4), "…")}`),
      "",
      ` ${t.fg("dim", "Enter/Esc back to SF Feedback")}`,
    ];
  }

  private handleEditInput(data: string): void {
    if (matchesKey(data, "escape")) {
      this.closeEditor(false);
      return;
    }
    const field = this.editingField;
    if (matchesKey(data, "ctrl+s")) {
      this.closeEditor(true);
      return;
    }
    if (field && !field.multiline && (matchesKey(data, "enter") || matchesKey(data, "return"))) {
      this.closeEditor(true);
      return;
    }
    this.editor?.handleInput?.(data);
  }

  private openFieldEditor(): void {
    const field = FORM_FIELDS[this.cursor] ?? FORM_FIELDS[0];
    if (!field) return;
    this.editingField = field;
    this.error = undefined;
    if (field.multiline) {
      const editor = new Editor(this.tui, editorTheme(this.theme));
      editor.disableSubmit = true;
      editor.setText(this.fields[field.key]);
      this.editor = editor;
    } else {
      const input = new Input();
      input.setValue(this.fields[field.key]);
      input.onSubmit = (value) => {
        this.fields[field.key] = sanitizeText(value);
        this.closeEditor(false);
      };
      input.onEscape = () => this.closeEditor(false);
      this.editor = input;
    }
    this.mode = "edit";
    this.editor.focused = this.focused;
  }

  private closeEditor(save: boolean): void {
    if (save && this.editingField && this.editor) {
      const value = this.editor.getExpandedText?.() ?? this.editor.getValue?.() ?? "";
      this.fields[this.editingField.key] = sanitizeText(value);
    }
    this.editor = undefined;
    this.editingField = undefined;
    this.mode = "form";
  }

  private moveCursor(delta: -1 | 1): void {
    this.error = undefined;
    this.cursor = (this.cursor + delta + FORM_FIELDS.length) % FORM_FIELDS.length;
  }

  private async preparePreview(): Promise<void> {
    const draft = this.buildDraft();
    if (!draft.title.trim()) {
      this.error = "Title is required before preview.";
      this.cursor = 0;
      return;
    }

    this.mode = "preparing";
    try {
      this.preview = await this.prepare(draft);
      this.mode = "preview";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.mode = "form";
    }
  }

  private async submitPreview(): Promise<void> {
    if (!this.preview) return;
    this.mode = "submitting";
    try {
      this.result = await this.submit(this.preview);
      this.mode = "result";
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.mode = "preview";
    }
  }

  private buildDraft(): FeedbackDraft {
    return {
      kind: this.kind,
      title: sanitizeText(this.fields.title),
      summary: sanitizeText(this.fields.summary),
      expected: sanitizeText(this.fields.expected),
      steps: sanitizeText(this.fields.steps),
    };
  }
}

export function createFeedbackWizardPanel(
  theme: Theme,
  tui: TUI,
  kind: IssueKind,
  prepare: (draft: FeedbackDraft) => Promise<PreparedFeedbackPreview>,
  submit: (preview: PreparedFeedbackPreview) => Promise<FeedbackSubmitResult>,
  done: (result: ConfigPanelResult | undefined) => void,
): FeedbackWizardPanel {
  return new FeedbackWizardPanel(theme, tui, kind, prepare, submit, done);
}

function editorTheme(theme: Theme): EditorTheme {
  return {
    borderColor: (text) => theme.fg("accent", text),
    selectList: {
      selectedPrefix: (text) => theme.fg("accent", text),
      selectedText: (text) => theme.fg("accent", text),
      description: (text) => theme.fg("muted", text),
      scrollInfo: (text) => theme.fg("dim", text),
      noMatch: (text) => theme.fg("warning", text),
    },
  };
}

function labelForKind(kind: IssueKind): string {
  if (kind === "bug") return "Bug report";
  if (kind === "feature") return "Feature request";
  if (kind === "setup") return "Setup issue";
  return "General";
}

function summarizeFieldValue(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ↵ ");
}

function pad(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`;
}
