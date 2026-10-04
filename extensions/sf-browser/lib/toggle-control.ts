/* SPDX-License-Identifier: Apache-2.0 */
/** Idempotent checkbox/switch operations with a narrow Classic Setup iframe fallback. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runAgentBrowser } from "./agent-browser.ts";
import { classifyBrowserFailure } from "./failure-diagnostics.ts";
import { redactText } from "./redaction.ts";

export interface SnapshotToggle {
  ref: string;
  role: "checkbox" | "switch";
  label: string;
  checked: boolean;
  disabled: boolean;
  line: string;
}

export interface SetToggleStateInput {
  cwd: string;
  ref: string;
  role: string;
  label: string;
  desiredState: boolean;
  frameRef?: string;
  frameUrl?: string;
}

export interface SetToggleStateResult {
  ok: boolean;
  before?: boolean;
  after: boolean;
  changed: boolean;
  recoveredClassicSetup: boolean;
}

interface ClassicToggleEvalResult {
  found?: boolean;
  before?: boolean;
  after?: boolean;
  changed?: boolean;
  frame?: boolean;
}

export function toggleStateFromSnapshotLine(line: string): boolean | undefined {
  const match = line.match(/\bchecked=(true|false)\b/iu);
  return match?.[1] === "true" ? true : match?.[1] === "false" ? false : undefined;
}

export function findToggleInSnapshot(snapshot: string, label: string): SnapshotToggle | undefined {
  const expected = normalizeLabel(label);
  for (const rawLine of snapshot.split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = line.match(/^- (checkbox|switch) "([^"]+)" \[([^\]]*\bref=(e\d+)[^\]]*)\]/iu);
    if (!match || normalizeLabel(match[2] ?? "") !== expected) continue;
    const checked = toggleStateFromSnapshotLine(line);
    if (checked === undefined) continue;
    return {
      ref: match[4] ?? "",
      role: match[1]?.toLowerCase() as "checkbox" | "switch",
      label: match[2] ?? label,
      checked,
      disabled: /\bdisabled\b/iu.test(match[3] ?? ""),
      line,
    };
  }
  return undefined;
}

export async function setToggleState(
  pi: ExtensionAPI,
  input: SetToggleStateInput,
  signal: AbortSignal | undefined,
): Promise<SetToggleStateResult> {
  const actionArgs =
    input.role.toLowerCase() === "checkbox"
      ? [input.desiredState ? "check" : "uncheck", input.ref]
      : ["click", input.ref];
  if (!input.frameRef) {
    try {
      await runAgentBrowser(pi, actionArgs, { cwd: input.cwd, signal });
      return {
        ok: true,
        after: input.desiredState,
        changed: true,
        recoveredClassicSetup: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (classifyBrowserFailure(message) !== "covered-element") throw error;
    }
  }

  if (input.frameRef) {
    try {
      await runAgentBrowser(pi, ["focus", input.ref], { cwd: input.cwd, signal });
      await runAgentBrowser(pi, ["press", "Space"], { cwd: input.cwd, signal });
      const verifiedSnapshot = await pollInteractiveSnapshot(pi, input.cwd, signal);
      const verified = findToggleInSnapshot(verifiedSnapshot, input.label);
      if (verified?.checked === input.desiredState) {
        return {
          ok: true,
          after: verified.checked,
          changed: true,
          recoveredClassicSetup: true,
        };
      }
    } catch {
      // Continue to the validated Salesforce-frame page promotion fallback.
    }
    return setToggleOnPromotedClassicPage(pi, input, signal);
  }

  const expression = buildSameOriginToggleExpression(input.label, input.desiredState);
  const evaluated = await runAgentBrowser(pi, ["eval", expression], {
    cwd: input.cwd,
    signal,
    timeoutMs: 15_000,
  });
  const result = parseClassicToggleResult(evaluated.stdout);
  if (!result?.found || result.after !== input.desiredState) {
    throw new Error(
      `Classic Setup toggle fallback could not verify ${JSON.stringify(input.label)} as ${input.desiredState ? "On" : "Off"}.`,
    );
  }
  return {
    ok: true,
    before: result.before,
    after: result.after,
    changed: result.changed === true,
    recoveredClassicSetup: true,
  };
}

async function setToggleOnPromotedClassicPage(
  pi: ExtensionAPI,
  input: SetToggleStateInput,
  signal: AbortSignal | undefined,
): Promise<SetToggleStateResult> {
  let frameUrl = safeSalesforceFrameUrl(input.frameUrl ?? "");
  let observedRaw = input.frameUrl ?? "";
  if (!frameUrl) {
    try {
      const refUrlResult = await runAgentBrowser(pi, ["get", "attr", input.frameRef ?? "", "src"], {
        cwd: input.cwd,
        signal,
        timeoutMs: 15_000,
      });
      frameUrl = safeSalesforceFrameUrl(refUrlResult.stdout.trim());
      observedRaw = refUrlResult.stdout;
    } catch {
      // Expanded frame refs can replace agent-browser's main-frame ref map.
    }
  }
  if (!frameUrl) {
    const frameUrlResult = await runAgentBrowser(
      pi,
      [
        "eval",
        `(() => { const roots = [document]; for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot) roots.push(element.shadowRoot); } } const frames = roots.flatMap((root) => Array.from(root.querySelectorAll('iframe'))); return JSON.stringify(frames.map((frame) => ({ src: frame.src || frame.getAttribute('src') || '', title: frame.title || '' })).filter((frame) => frame.src)); })()`,
      ],
      { cwd: input.cwd, signal, timeoutMs: 15_000 },
    );
    frameUrl = parseClassicFrameUrl(frameUrlResult.stdout);
    observedRaw = frameUrlResult.stdout;
  }
  if (!frameUrl) {
    const observed = redactText(observedRaw).replace(/\s+/gu, " ").trim().slice(0, 500);
    throw new Error(
      `Classic Setup iframe URL could not be resolved safely.${observed ? ` Observed: ${observed}` : ""}`,
    );
  }

  await runAgentBrowser(pi, ["open", frameUrl], { cwd: input.cwd, signal });
  const beforeSnapshot = await pollInteractiveSnapshot(pi, input.cwd, signal);
  const before = findToggleInSnapshot(beforeSnapshot, input.label);
  if (!before || before.disabled) {
    throw new Error(
      `Classic Setup page did not expose editable toggle ${JSON.stringify(input.label)}.`,
    );
  }
  if (before.checked !== input.desiredState) {
    const action =
      before.role === "checkbox" ? (input.desiredState ? "check" : "uncheck") : "click";
    await runAgentBrowser(pi, [action, before.ref], { cwd: input.cwd, signal });
  }
  const afterSnapshot = await pollInteractiveSnapshot(pi, input.cwd, signal);
  const after = findToggleInSnapshot(afterSnapshot, input.label);
  if (!after || after.checked !== input.desiredState) {
    throw new Error(
      `Classic Setup promoted page could not verify ${JSON.stringify(input.label)} as ${input.desiredState ? "On" : "Off"}.`,
    );
  }
  return {
    ok: true,
    before: before.checked,
    after: after.checked,
    changed: before.checked !== after.checked,
    recoveredClassicSetup: true,
  };
}

async function pollInteractiveSnapshot(
  pi: ExtensionAPI,
  cwd: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  let snapshot = "";
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = await runAgentBrowser(pi, ["snapshot", "-i", "-c"], {
      cwd,
      signal,
      timeoutMs: 15_000,
    });
    snapshot = result.stdout.trim();
    if (/\bref=e\d+\b/u.test(snapshot)) return snapshot;
    if (attempt < 3) {
      await runAgentBrowser(pi, ["wait", "250"], { cwd, signal, timeoutMs: 5_000 });
    }
  }
  return snapshot;
}

function safeSalesforceFrameUrl(raw: string): string | undefined {
  try {
    const url = new URL(raw.replace(/^"|"$/gu, ""));
    if (
      url.protocol === "https:" &&
      /(?:^|\.)(?:salesforce\.com|force\.com|salesforce-setup\.com)$/iu.test(url.hostname)
    ) {
      return url.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseClassicFrameUrl(raw: string): string | undefined {
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") value = JSON.parse(value);
    if (!Array.isArray(value)) return undefined;
    for (const candidate of value) {
      const src =
        candidate && typeof candidate === "object"
          ? (candidate as { src?: unknown }).src
          : undefined;
      if (typeof src !== "string") continue;
      const url = safeSalesforceFrameUrl(src);
      if (url) return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function buildSameOriginToggleExpression(label: string, desiredState: boolean): string {
  const target = JSON.stringify(label);
  return `(() => {
    const target = ${target};
    const desired = ${desiredState ? "true" : "false"};
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const accessibleName = (element) => {
      const aria = element.getAttribute('aria-label');
      if (aria) return aria;
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const text = labelledBy.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent || '').join(' ').trim();
        if (text) return text;
      }
      const labels = element.labels ? Array.from(element.labels).map((item) => item.textContent || '').join(' ').trim() : '';
      if (labels) return labels;
      const closest = element.closest('label');
      return closest ? closest.textContent || '' : '';
    };
    const checked = (element) => {
      if ('checked' in element) return Boolean(element.checked);
      return element.getAttribute('aria-checked') === 'true';
    };
    const documents = [{ doc: document, frame: false }];
    for (let index = 0; index < documents.length; index += 1) {
      const current = documents[index];
      for (const frame of current.doc.querySelectorAll('iframe')) {
        try {
          if (frame.contentDocument) documents.push({ doc: frame.contentDocument, frame: true });
        } catch {}
      }
    }
    for (const current of documents) {
      const controls = current.doc.querySelectorAll('input[type="checkbox"], [role="checkbox"], [role="switch"]');
      for (const element of controls) {
        if (normalize(accessibleName(element)) !== normalize(target)) continue;
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
          return JSON.stringify({ found: true, disabled: true, before: checked(element), after: checked(element), changed: false, frame: current.frame });
        }
        const before = checked(element);
        if (before !== desired) element.click();
        const after = checked(element);
        return JSON.stringify({ found: true, before, after, changed: before !== after, frame: current.frame });
      }
    }
    return JSON.stringify({ found: false });
  })()`;
}

function parseClassicToggleResult(raw: string): ClassicToggleEvalResult | undefined {
  try {
    let value: unknown = JSON.parse(raw);
    if (typeof value === "string") value = JSON.parse(value);
    return value && typeof value === "object" ? (value as ClassicToggleEvalResult) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
