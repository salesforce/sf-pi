/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Semantic comparison of a sent procedure with the procedure Fin saved.
 *
 * Fin canonicalizes procedures on save, so a raw field-by-field diff reports
 * false drift. Both documents are normalized to the same canonical form first:
 *
 * - object steps lose their redundant `type:` key (`type: decide` + `decide:`
 *   ≡ `decide:`; `type: escalate` ≡ `escalate:`);
 * - `{ escalate: "reason" }` ≡ the string `"reason <escalate />"`;
 * - a one-element `then`/`else` list ≡ its single element;
 * - strings compare with trimmed trailing whitespace and collapsed spaces,
 *   which absorbs YAML block-scalar chomping (`|` vs `|-`) and line folding;
 * - documented defaults are dropped (`condition_type: natural_language`);
 * - server-owned fields (`id`, `version`, `state`, `has_unpublished_changes`,
 *   `draft_hidden_by_release`, `agentic_switch`) are ignored.
 *
 * Real changes, such as removed steps, altered conditions, or dropped
 * triggers, still surface as drift.
 */

const SERVER_OWNED_KEYS = new Set([
  "id",
  "version",
  "state",
  "has_unpublished_changes",
  "draft_hidden_by_release",
  "agentic_switch",
  "version_note",
]);

/** Step keys that make `type:` redundant: the type is implied by the key. */
const STEP_TYPE_KEYS = new Set([
  "decide",
  "if",
  "escalate",
  "run",
  "run_workflow",
  "run_procedure",
  "call_procedure",
  "end",
  "end_with_ticket",
  "say",
  "gather",
  "note",
  "heading",
  "instructions",
  "use_action",
  "wait_for_reply",
  "human_in_the_loop",
  "user_task",
  "update_context",
]);

export function normalizeProcedure(doc: unknown): unknown {
  if (!isRecord(doc)) return normalizeValue(doc);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (SERVER_OWNED_KEYS.has(key)) continue;
    out[key] = key === "procedure" ? normalizeSections(value) : normalizeValue(value);
  }
  return out;
}

function normalizeSections(procedure: unknown): unknown {
  if (!isRecord(procedure)) return normalizeValue(procedure);
  return Object.fromEntries(
    Object.entries(procedure).map(([name, steps]) => [name, normalizeSteps(steps)]),
  );
}

function normalizeSteps(steps: unknown): unknown {
  return Array.isArray(steps) ? steps.map(normalizeStep) : normalizeStep(steps);
}

function normalizeStep(step: unknown): unknown {
  if (typeof step === "string") return normalizeText(step);
  if (!isRecord(step)) return normalizeValue(step);

  const rest: Record<string, unknown> = { ...step };
  if (typeof rest.type === "string" && Object.keys(rest).some((k) => STEP_TYPE_KEYS.has(k))) {
    delete rest.type;
  }
  // `natural_language` is the documented default and Fin omits it on save.
  if (rest.condition_type === "natural_language") delete rest.condition_type;
  // `{ escalate: reason }` is saved as the string "reason <escalate />".
  if (Object.keys(rest).length === 1 && typeof rest.escalate === "string") {
    return normalizeText(`${rest.escalate} <escalate />`);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (key === "then" || key === "else") out[key] = normalizeBranch(value);
    else if (key === "decide" && Array.isArray(value)) {
      out[key] = value.map((branch) =>
        isRecord(branch)
          ? Object.fromEntries(
              Object.entries(branch).map(([k, v]) => [
                k,
                k === "then" || k === "else" ? normalizeBranch(v) : normalizeValue(v),
              ]),
            )
          : normalizeValue(branch),
      );
    } else out[key] = normalizeValue(value);
  }
  return out;
}

/** A one-element branch list equals its single element. */
function normalizeBranch(value: unknown): unknown {
  const steps = Array.isArray(value) ? value.map(normalizeStep) : [normalizeStep(value)];
  return steps.length === 1 ? steps[0] : steps;
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeValue(v)]));
  }
  return value;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Paths whose normalized values differ between sent and saved. */
export function procedureDrift(sent: unknown, saved: unknown): string[] {
  return diff(normalizeProcedure(sent), normalizeProcedure(saved), "");
}

function diff(a: unknown, b: unknown, path: string): string[] {
  const here = path || ".";
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return [here];
    return a.flatMap((item, i) => diff(item, b[i], `${path}[${i}]`));
  }
  if (isRecord(a)) {
    if (!isRecord(b)) return [here];
    // Only fields we sent must survive; additive server fields are not drift.
    return Object.entries(a).flatMap(([k, v]) => diff(v, b[k], path ? `${path}.${k}` : k));
  }
  return a === b || (a == null && b == null) ? [] : [here];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
