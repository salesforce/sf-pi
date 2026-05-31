/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Browser-side editor surface helpers for SF Browser.
 *
 * This module intentionally supports only narrow editor operations. It detects
 * and edits visible editor-like surfaces without exposing a generic DOM eval
 * interface or clicking Save/Apply on behalf of the agent.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";
import { throwWithFailureDiagnostics } from "./failure-diagnostics.ts";
import { redactText } from "./redaction.ts";
import { startTimer } from "./timing.ts";
import { formatPossiblyLargeOutput, okText } from "./tool-support.ts";

export type EditorAction = "detect" | "read" | "write";
export type EditorKind = "monaco" | "textarea" | "contenteditable" | "unknown";

export interface EditorSurfaceCandidate {
  editorIndex: number;
  kind: EditorKind;
  readOnly: boolean | null;
  context?: string;
  framePath: number[];
  sameOrigin: boolean;
  length?: number;
}

export interface EditorDetectResult {
  action: "detect";
  candidates: EditorSurfaceCandidate[];
  inaccessibleFrameCount: number;
}

export interface EditorReadResult {
  action: "read";
  candidate: EditorSurfaceCandidate;
  value: string;
  length: number;
  truncated: boolean;
  maxChars: number;
  inaccessibleFrameCount: number;
}

export interface EditorWriteResult {
  action: "write";
  candidate: EditorSurfaceCandidate;
  previousLength: number | null;
  newLength: number;
  verification: "matched" | "mismatch" | "unreadable";
  inaccessibleFrameCount: number;
}

export type EditorOperationResult = EditorDetectResult | EditorReadResult | EditorWriteResult;

export interface EditorOperationInput {
  action: EditorAction;
  editorIndex?: number;
  value?: string;
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 4_000;
const MAX_MAX_CHARS = 20_000;

export async function runEditorOperation(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  input: EditorOperationInput,
  signal?: AbortSignal,
): Promise<{ text: string; details: Record<string, unknown> }> {
  const stopTimer = startTimer();
  const payload = normalizeEditorInput(input);
  try {
    const result = await runAgentBrowser(pi, ["eval", buildEditorExpression(payload)], {
      cwd: ctx.cwd,
      signal,
    });
    const parsed = parseEditorResult(result.stdout);
    const duration = stopTimer();
    return {
      text: formatEditorResult(parsed, ctx.sessionManager.getSessionId(), duration.durationText),
      details: { ok: true, ...safeEditorDetails(parsed), ...duration },
    };
  } catch (error) {
    const duration = stopTimer();
    await throwWithFailureDiagnostics(
      pi,
      ctx,
      {
        toolName: "sf_browser_editor",
        action: `editor ${payload.action}`,
        durationMs: duration.durationMs,
      },
      error,
      signal,
    );
  }
}

function normalizeEditorInput(input: EditorOperationInput): Required<EditorOperationInput> {
  const maxChars = Math.min(
    MAX_MAX_CHARS,
    Math.max(
      1,
      Math.floor(Number.isFinite(input.maxChars) ? (input.maxChars as number) : DEFAULT_MAX_CHARS),
    ),
  );
  return {
    action: input.action,
    editorIndex: Number.isInteger(input.editorIndex) ? (input.editorIndex as number) : -1,
    value: input.value ?? "",
    maxChars,
  };
}

function buildEditorExpression(input: Required<EditorOperationInput>): string {
  return `(() => { ${EDITOR_HELPERS} return window.__sfPiEditorOperation(${JSON.stringify(input)}); })()`;
}

function parseEditorResult(stdout: string): EditorOperationResult {
  const first = JSON.parse(stdout.trim()) as unknown;
  const parsed = typeof first === "string" ? (JSON.parse(first) as unknown) : first;
  if (!parsed || typeof parsed !== "object")
    throw new Error("Editor operation returned no result.");
  const result = parsed as { ok?: boolean; error?: string } & EditorOperationResult;
  if (result.ok === false) throw new Error(redactText(result.error || "Editor operation failed."));
  return result;
}

function formatEditorResult(
  result: EditorOperationResult,
  sessionId: string,
  durationText: string,
): string {
  if (result.action === "detect") {
    return okText([
      `Detected ${result.candidates.length} editor surface${result.candidates.length === 1 ? "" : "s"}.`,
      ...result.candidates.map(formatCandidate),
      result.inaccessibleFrameCount
        ? `Inaccessible frames: ${result.inaccessibleFrameCount} (cross-origin frames cannot be inspected).`
        : undefined,
      `Duration: ${durationText}`,
      "Use editorIndex from detect for read/write. Re-run detect after navigation, save, modal changes, or major rerenders.",
    ]);
  }

  if (result.action === "read") {
    const formatted = formatPossiblyLargeOutput(result.value, {
      label: `editor-${result.candidate.editorIndex}-read`,
      extension: "txt",
      maxBytes: result.maxChars,
      maxLines: 2_000,
      sessionId,
    });
    return okText([
      `Read editor ${result.candidate.editorIndex}.`,
      formatCandidate(result.candidate),
      `Length: ${result.length}`,
      result.truncated || formatted.truncated
        ? `Content truncated to ${result.maxChars} chars.`
        : undefined,
      "Content:",
      formatted.text,
      formatted.fullOutputPath ? `Full output: ${formatted.fullOutputPath}` : undefined,
      result.inaccessibleFrameCount
        ? `Inaccessible frames: ${result.inaccessibleFrameCount} (cross-origin frames cannot be inspected).`
        : undefined,
      `Duration: ${durationText}`,
    ]);
  }

  return okText([
    `Wrote editor ${result.candidate.editorIndex}.`,
    formatCandidate(result.candidate),
    result.previousLength !== null ? `Previous length: ${result.previousLength}` : undefined,
    `New length: ${result.newLength}`,
    `Verification: ${result.verification}`,
    result.inaccessibleFrameCount
      ? `Inaccessible frames: ${result.inaccessibleFrameCount} (cross-origin frames cannot be inspected).`
      : undefined,
    `Duration: ${durationText}`,
    "Content is not echoed after writes. Use action='read' with maxChars for a bounded preview if needed.",
    "Next: snapshot, click the explicit Save/Apply control if appropriate, wait for save-result, then verify through API or Browser Evidence.",
  ]);
}

function formatCandidate(candidate: EditorSurfaceCandidate): string {
  const frame = candidate.framePath.length ? ` frame=${candidate.framePath.join(".")}` : " top";
  const readOnly = candidate.readOnly === null ? "unknown" : candidate.readOnly ? "yes" : "no";
  return `- #${candidate.editorIndex} kind=${candidate.kind} readOnly=${readOnly}${frame}${candidate.context ? ` context=${JSON.stringify(candidate.context)}` : ""}${candidate.length !== undefined ? ` length=${candidate.length}` : ""}`;
}

function safeEditorDetails(result: EditorOperationResult): Record<string, unknown> {
  if (result.action === "read") {
    const safe = { ...result };
    delete safe.value;
    return safe as unknown as Record<string, unknown>;
  }
  return result as unknown as Record<string, unknown>;
}

export const EDITOR_HELPERS = String.raw`
function visible(el) {
  if (!el) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
}
function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
}
function contextForElement(el) {
  if (!el) return '';
  const doc = el.ownerDocument;
  const labels = [];
  const id = el.getAttribute && el.getAttribute('id');
  if (id) {
    const label = doc.querySelector('label[for="' + CSS.escape(id) + '"]');
    if (label) labels.push(cleanText(label.textContent));
  }
  let node = el;
  for (let i = 0; node && i < 4; i += 1, node = node.parentElement) {
    const aria = node.getAttribute && (node.getAttribute('aria-label') || node.getAttribute('title'));
    if (aria) labels.push(cleanText(aria));
    const labelledBy = node.getAttribute && node.getAttribute('aria-labelledby');
    if (labelledBy) {
      for (const ref of labelledBy.split(/\s+/)) {
        const target = doc.getElementById(ref);
        if (target) labels.push(cleanText(target.textContent));
      }
    }
    const heading = node.querySelector && node.querySelector('h1,h2,h3,.slds-form-element__label,label');
    if (heading) labels.push(cleanText(heading.textContent));
  }
  return labels.filter(Boolean).find(Boolean) || '';
}
function monacoReadOnly(win, editor) {
  try {
    if (!win.monaco || !editor.getOptions) return null;
    const option = win.monaco.editor.EditorOption.readOnly;
    return Boolean(editor.getOptions().get(option));
  } catch (_) {
    return null;
  }
}
function editorRecord(kind, framePath, index, el, extra) {
  return Object.assign({
    editorIndex: index,
    kind,
    readOnly: null,
    context: contextForElement(el),
    framePath,
    sameOrigin: true
  }, extra || {});
}
function collectEditorsInWindow(win, framePath, state) {
  const doc = win.document;
  if (win.monaco && win.monaco.editor && typeof win.monaco.editor.getEditors === 'function') {
    for (const editor of win.monaco.editor.getEditors()) {
      const el = editor.getDomNode && editor.getDomNode();
      if (!visible(el)) continue;
      const value = editor.getValue ? editor.getValue() : '';
      state.candidates.push(editorRecord('monaco', framePath, state.candidates.length, el, {
        readOnly: monacoReadOnly(win, editor),
        length: String(value || '').length
      }));
    }
  }
  for (const el of Array.from(doc.querySelectorAll('textarea'))) {
    if (!visible(el)) continue;
    state.candidates.push(editorRecord('textarea', framePath, state.candidates.length, el, {
      readOnly: Boolean(el.readOnly || el.disabled),
      length: String(el.value || '').length
    }));
  }
  for (const el of Array.from(doc.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]'))) {
    if (!visible(el)) continue;
    state.candidates.push(editorRecord('contenteditable', framePath, state.candidates.length, el, {
      readOnly: false,
      length: String(el.innerText || el.textContent || '').length
    }));
  }
  Array.from(win.frames || []).forEach(function(frame, i) {
    try {
      collectEditorsInWindow(frame, framePath.concat(i), state);
    } catch (_) {
      state.inaccessibleFrameCount += 1;
    }
  });
}
function collectEditors() {
  const state = { candidates: [], inaccessibleFrameCount: 0 };
  collectEditorsInWindow(window, [], state);
  return state;
}
function resolveWindowForFramePath(framePath) {
  let win = window;
  for (const index of framePath || []) win = win.frames[index];
  return win;
}
function monacoEditorsForCandidate(candidate) {
  const win = resolveWindowForFramePath(candidate.framePath);
  return (win.monaco && win.monaco.editor && win.monaco.editor.getEditors ? win.monaco.editor.getEditors() : [])
    .filter(function(editor) { return visible(editor.getDomNode && editor.getDomNode()); });
}
function findLiveEditor(candidate) {
  const win = resolveWindowForFramePath(candidate.framePath);
  if (candidate.kind === 'monaco') {
    const editors = monacoEditorsForCandidate(candidate);
    const sameKindBefore = collectEditors().candidates.filter(function(item) {
      return item.kind === 'monaco' && item.framePath.join('.') === candidate.framePath.join('.') && item.editorIndex <= candidate.editorIndex;
    }).length;
    return { win, editor: editors[Math.max(0, sameKindBefore - 1)] || null };
  }
  const selector = candidate.kind === 'textarea'
    ? 'textarea'
    : '[contenteditable="true"], [contenteditable="plaintext-only"]';
  const elements = Array.from(win.document.querySelectorAll(selector)).filter(visible);
  const matching = collectEditors().candidates.filter(function(item) {
    return item.kind === candidate.kind && item.framePath.join('.') === candidate.framePath.join('.') && item.editorIndex <= candidate.editorIndex;
  }).length;
  return { win, editor: elements[Math.max(0, matching - 1)] || null };
}
function chooseCandidate(state, requestedIndex, action) {
  if (requestedIndex >= 0) {
    const candidate = state.candidates.find(function(item) { return item.editorIndex === requestedIndex; });
    if (!candidate) return { error: 'Editor index is stale or not found. Re-run detect and choose a current editorIndex.' };
    return { candidate };
  }
  if (state.candidates.length === 1) return { candidate: state.candidates[0] };
  if (state.candidates.length === 0) return { error: 'No visible editor surfaces were detected.' };
  return { error: action + ' requires editorIndex because multiple editor surfaces were detected.' };
}
function readEditor(candidate, maxChars) {
  const live = findLiveEditor(candidate);
  if (!live.editor) return { error: 'Editor index is stale or not readable. Re-run detect.' };
  let value = '';
  if (candidate.kind === 'monaco') value = live.editor.getValue ? live.editor.getValue() : '';
  else if (candidate.kind === 'textarea') value = live.editor.value || '';
  else value = live.editor.innerText || live.editor.textContent || '';
  const stringValue = String(value || '');
  return {
    value: stringValue.slice(0, maxChars),
    length: stringValue.length,
    truncated: stringValue.length > maxChars
  };
}
function writeEditor(candidate, value) {
  if (candidate.readOnly === true) return { error: 'Editor is read-only. Refusing to write.' };
  const before = readEditor(candidate, Number.MAX_SAFE_INTEGER);
  if (before.error) return before;
  const live = findLiveEditor(candidate);
  if (!live.editor) return { error: 'Editor index is stale or not writable. Re-run detect.' };
  if (candidate.kind === 'monaco') {
    const editor = live.editor;
    const model = editor.getModel && editor.getModel();
    if (!model) return { error: 'Monaco editor has no model.' };
    if (editor.executeEdits && model.getFullModelRange) {
      editor.executeEdits('sf-browser', [{ range: model.getFullModelRange(), text: value, forceMoveMarkers: true }]);
    } else if (editor.setValue) {
      editor.setValue(value);
    } else {
      return { error: 'Monaco editor does not expose a supported write method.' };
    }
  } else if (candidate.kind === 'textarea') {
    live.editor.value = value;
    live.editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    live.editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  } else if (candidate.kind === 'contenteditable') {
    live.editor.textContent = value;
    live.editor.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
    live.editor.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  const after = readEditor(candidate, Number.MAX_SAFE_INTEGER);
  if (after.error) {
    return { previousLength: before.length, newLength: value.length, verification: 'unreadable' };
  }
  return {
    previousLength: before.length,
    newLength: after.length,
    verification: after.value === value ? 'matched' : 'mismatch'
  };
}
window.__sfPiEditorOperation = function(input) {
  try {
    const state = collectEditors();
    if (input.action === 'detect') {
      return JSON.stringify({ ok: true, action: 'detect', candidates: state.candidates, inaccessibleFrameCount: state.inaccessibleFrameCount });
    }
    const chosen = chooseCandidate(state, input.editorIndex, input.action);
    if (chosen.error) return JSON.stringify({ ok: false, error: chosen.error });
    if (input.action === 'read') {
      const read = readEditor(chosen.candidate, input.maxChars);
      if (read.error) return JSON.stringify({ ok: false, error: read.error });
      return JSON.stringify(Object.assign({ ok: true, action: 'read', candidate: chosen.candidate, inaccessibleFrameCount: state.inaccessibleFrameCount, maxChars: input.maxChars }, read));
    }
    if (input.action === 'write') {
      const written = writeEditor(chosen.candidate, String(input.value || ''));
      if (written.error) return JSON.stringify({ ok: false, error: written.error });
      return JSON.stringify(Object.assign({ ok: true, action: 'write', candidate: chosen.candidate, inaccessibleFrameCount: state.inaccessibleFrameCount }, written));
    }
    return JSON.stringify({ ok: false, error: 'Unsupported editor action.' });
  } catch (error) {
    return JSON.stringify({ ok: false, error: error && error.message ? error.message : String(error) });
  }
};
`;
