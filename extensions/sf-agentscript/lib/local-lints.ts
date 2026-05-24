/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Local Agent Script hardening diagnostics that are not emitted by the
 * vendored SDK yet.
 *
 * Scope is intentionally narrow: deterministic publish/runtime footguns from
 * the Agentforce skill that we can prove from source text alone. No org calls,
 * no semantic rewrites, no speculative design advice.
 */

import type { AgentScriptDiagnostic, AgentScriptRange } from "./types.ts";

interface LineInfo {
  line: number;
  raw: string;
  trimmed: string;
  indent: number;
}

interface ActionBlock {
  name: string;
  line: number;
  indent: number;
  lines: LineInfo[];
  target?: string;
  targetLine?: number;
}

interface ConnectionMessagingBlock {
  header: LineInfo;
  lines: LineInfo[];
}

const ACTION_FIELD_NAMES = new Set([
  "actions",
  "available_when",
  "connection",
  "config",
  "description",
  "inputs",
  "instructions",
  "knowledge",
  "label",
  "language",
  "outputs",
  "reasoning",
  "start_agent",
  "subagent",
  "system",
  "target",
  "topic",
  "variables",
]);

const VARIABLE_FIELD_NAMES = new Set(["default", "description", "source", "visibility"]);

function makeRange(line: number, raw: string, search?: string): AgentScriptRange {
  const character = search ? Math.max(0, raw.indexOf(search)) : 0;
  return {
    start: { line, character },
    end: { line, character: raw.length },
  };
}

function diagnostic(
  line: LineInfo,
  code: string,
  message: string,
  severity: 1 | 2,
  search?: string,
  data?: Record<string, unknown>,
): AgentScriptDiagnostic {
  return {
    range: makeRange(line.line, line.raw, search),
    message,
    severity,
    code,
    source: "sf-agentscript-local",
    ...(data ? { data } : {}),
  };
}

function lineInfos(source: string): LineInfo[] {
  return source.split("\n").map((raw, line) => {
    const trimmed = raw.trim();
    const indent = raw.length - raw.trimStart().length;
    return { line, raw, trimmed, indent };
  });
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function scalarAfterColon(trimmed: string): string | undefined {
  const idx = trimmed.indexOf(":");
  if (idx === -1) return undefined;
  const value = trimmed.slice(idx + 1).trim();
  return value.length > 0 ? unquote(value) : undefined;
}

function targetFromLine(trimmed: string): string | undefined {
  if (!trimmed.startsWith("target:")) return undefined;
  return scalarAfterColon(trimmed);
}

function schemeOf(target: string | undefined): string | undefined {
  const idx = target?.indexOf("://") ?? -1;
  return idx > 0 ? target?.slice(0, idx) : undefined;
}

function refNameOf(target: string | undefined): string | undefined {
  const idx = target?.indexOf("://") ?? -1;
  return idx > 0 ? target?.slice(idx + 3) : undefined;
}

function targetRefLooksLikeSalesforceId(target: string | undefined): boolean {
  const ref = refNameOf(target);
  // Match common Salesforce key prefixes instead of every 15-char token.
  // Names such as standardInvocableAction://SendEmailAction are valid and
  // happen to be 15 characters; broad length-only detection is too noisy.
  return (
    !!ref &&
    /^(?:00D|005|001|003|500|301|300|01p|0X9|0Xx|0Mw|0Af)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(
      ref,
    )
  );
}

function parseConfig(lines: LineInfo[]): { agentType?: string; defaultAgentUserLine?: LineInfo } {
  const configLine = lines.find((l) => l.indent === 0 && l.trimmed === "config:");
  if (!configLine) return {};

  const out: { agentType?: string; defaultAgentUserLine?: LineInfo } = {};
  for (const line of lines.slice(configLine.line + 1)) {
    if (line.trimmed.length === 0) continue;
    if (line.indent <= configLine.indent) break;
    if (line.trimmed.startsWith("agent_type:")) out.agentType = scalarAfterColon(line.trimmed);
    if (line.trimmed.startsWith("default_agent_user:")) out.defaultAgentUserLine = line;
  }
  return out;
}

function findConnectionMessagingBlock(lines: LineInfo[]): ConnectionMessagingBlock | undefined {
  const header = lines.find(
    (l) => l.indent === 0 && /^connection(?:\s+messaging)?\s*:/.test(l.trimmed),
  );
  if (!header) return undefined;

  const blockLines: LineInfo[] = [];
  for (const line of lines.slice(header.line + 1)) {
    if (line.trimmed.length > 0 && line.indent <= header.indent) break;
    blockLines.push(line);
  }
  return { header, lines: blockLines };
}

function findConnectionMessaging(lines: LineInfo[]): LineInfo | undefined {
  return findConnectionMessagingBlock(lines)?.header;
}

function findEscalateRefs(lines: LineInfo[]): LineInfo[] {
  return lines.filter((l) => l.trimmed.includes("@utils.escalate"));
}

function entryName(line: LineInfo): string | undefined {
  const m = /^(?<name>[A-Za-z_][\w-]*)\s*:\s*(?:#.*)?$/.exec(line.trimmed);
  const name = m?.groups?.name;
  if (!name || ACTION_FIELD_NAMES.has(name)) return undefined;
  return name;
}

function findActionStart(lines: LineInfo[], targetIndex: number): LineInfo | undefined {
  const target = lines[targetIndex];
  for (let i = targetIndex - 1; i >= 0; i--) {
    const candidate = lines[i];
    if (candidate.trimmed.length === 0 || candidate.trimmed.startsWith("#")) continue;
    if (candidate.indent >= target.indent) continue;
    const name = entryName(candidate);
    if (name) return candidate;
  }
  return undefined;
}

function actionBlockForTarget(lines: LineInfo[], targetIndex: number): ActionBlock | undefined {
  const start = findActionStart(lines, targetIndex);
  if (!start) return undefined;
  const name = entryName(start);
  if (!name) return undefined;

  const blockLines: LineInfo[] = [];
  for (const line of lines.slice(start.line + 1)) {
    if (line.trimmed.length > 0 && line.indent <= start.indent) break;
    blockLines.push(line);
  }

  const targetLine = lines[targetIndex];
  return {
    name,
    line: start.line,
    indent: start.indent,
    lines: blockLines,
    target: targetFromLine(targetLine.trimmed),
    targetLine: targetLine.line,
  };
}

function findTargetBackedActions(lines: LineInfo[]): ActionBlock[] {
  const actions: ActionBlock[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimmed.startsWith("target:")) continue;
    const action = actionBlockForTarget(lines, i);
    if (!action || seen.has(action.line)) continue;
    seen.add(action.line);
    actions.push(action);
  }
  return actions;
}

function hasOutputsBlock(action: ActionBlock): boolean {
  return action.lines.some((l) => l.indent > action.indent && /^outputs\s*:/.test(l.trimmed));
}

function isIoBlock(line: LineInfo): "inputs" | "outputs" | undefined {
  if (/^inputs\s*:/.test(line.trimmed)) return "inputs";
  if (/^outputs\s*:/.test(line.trimmed)) return "outputs";
  return undefined;
}

function numericTypeOnLine(line: LineInfo): boolean {
  // Common Agent Script shapes:
  //   amount: number
  //   amount: integer
  //   type: number
  const direct = /^"?[A-Za-z_][\w:.-]*"?\s*:\s*(number|integer|long)\b/.exec(line.trimmed);
  if (direct) return true;
  return /^type\s*:\s*(number|integer|long)\b/.test(line.trimmed);
}

function collectNumericActionIo(
  action: ActionBlock,
): Array<{ section: "inputs" | "outputs"; line: LineInfo }> {
  const out: Array<{ section: "inputs" | "outputs"; line: LineInfo }> = [];
  for (let i = 0; i < action.lines.length; i++) {
    const section = isIoBlock(action.lines[i]);
    if (!section) continue;
    const sectionIndent = action.lines[i].indent;
    for (const line of action.lines.slice(i + 1)) {
      if (line.trimmed.length > 0 && line.indent <= sectionIndent) break;
      if (numericTypeOnLine(line)) out.push({ section, line });
    }
  }
  return out;
}

function complexTypeOnLine(line: LineInfo): boolean {
  return /^"?[A-Za-z_][\w:.-]*"?\s*:\s*(object|list\[object\])\b/.test(line.trimmed);
}

function hasComplexDataTypeChild(lines: readonly LineInfo[], index: number): boolean {
  const parent = lines[index];
  for (const line of lines.slice(index + 1)) {
    if (line.trimmed.length > 0 && line.indent <= parent.indent) break;
    if (/^complex_data_type_name\s*:/.test(line.trimmed) || /^schema\s*:/.test(line.trimmed)) {
      return true;
    }
  }
  return false;
}

function collectComplexActionIo(
  action: ActionBlock,
): Array<{ section: "inputs" | "outputs"; line: LineInfo }> {
  const out: Array<{ section: "inputs" | "outputs"; line: LineInfo }> = [];
  for (let i = 0; i < action.lines.length; i++) {
    const section = isIoBlock(action.lines[i]);
    if (!section) continue;
    const sectionIndent = action.lines[i].indent;
    for (let j = i + 1; j < action.lines.length; j++) {
      const line = action.lines[j];
      if (line.trimmed.length > 0 && line.indent <= sectionIndent) break;
      if (complexTypeOnLine(line) && !hasComplexDataTypeChild(action.lines, j)) {
        out.push({ section, line });
      }
    }
  }
  return out;
}

function numericMessage(scheme: string | undefined): string {
  if (scheme === "flow") {
    return 'Bare numeric action I/O can fail at publish for flow targets. Use object + complex_data_type_name: "lightning__numberType" for numeric Flow parameters.';
  }
  if (scheme === "apex") {
    return 'Bare numeric action I/O can fail at publish for Apex targets. Use object + complex_data_type_name such as "lightning__integerType" or "lightning__doubleType" to match the @InvocableVariable type.';
  }
  return "Bare numeric action I/O can fail at publish. Use object + the correct complex_data_type_name for target-backed action parameters.";
}

const ROUTE_FIELDS = ["outbound_route_type", "outbound_route_name", "escalation_message"] as const;

type RouteField = (typeof ROUTE_FIELDS)[number];

function connectionFieldLine(
  block: ConnectionMessagingBlock,
  field: RouteField,
): { line: LineInfo; value?: string } | undefined {
  const line = block.lines.find((l) => l.trimmed.startsWith(`${field}:`));
  return line ? { line, value: scalarAfterColon(line.trimmed) } : undefined;
}

function addConnectionMessagingDiagnostics(
  block: ConnectionMessagingBlock | undefined,
  diagnostics: AgentScriptDiagnostic[],
): void {
  if (!block) return;

  const fields = new Map<RouteField, { line: LineInfo; value?: string }>();
  for (const field of ROUTE_FIELDS) {
    const found = connectionFieldLine(block, field);
    if (found) fields.set(field, found);
  }

  if (fields.size > 0 && fields.size < ROUTE_FIELDS.length) {
    const missing = ROUTE_FIELDS.filter((field) => !fields.has(field));
    diagnostics.push(
      diagnostic(
        block.header,
        "connection-messaging-incomplete-route",
        `connection messaging route config is incomplete. When any route field is present, also include: ${missing.join(", ")}.`,
        1,
        "connection",
        { missing_fields: missing },
      ),
    );
  }

  const routeName = fields.get("outbound_route_name");
  if (routeName?.value && !routeName.value.startsWith("flow://")) {
    diagnostics.push(
      diagnostic(
        routeName.line,
        "connection-messaging-route-name-prefix",
        'connection messaging outbound_route_name must use a flow:// target, for example: outbound_route_name: "flow://Route_To_Agent".',
        1,
        "outbound_route_name",
      ),
    );
  }
}

function isWithBindingLine(line: LineInfo): boolean {
  return /^with\b/.test(line.trimmed);
}

function addInputsScopeDiagnostics(
  lines: readonly LineInfo[],
  diagnostics: AgentScriptDiagnostic[],
): void {
  for (const line of lines) {
    if (!line.trimmed.includes("@inputs.")) continue;
    if (line.trimmed.startsWith("#") || line.trimmed.startsWith("|")) continue;
    if (isWithBindingLine(line)) continue;

    diagnostics.push(
      diagnostic(
        line,
        "inputs-out-of-scope",
        "@inputs is only available in action with-bindings. Capture the value in a variable before the action or use @outputs immediately after the action.",
        1,
        "@inputs.",
      ),
    );
  }
}

function addOutputsScopeDiagnostics(
  lines: readonly LineInfo[],
  diagnostics: AgentScriptDiagnostic[],
): void {
  for (const line of lines) {
    if (!line.trimmed.includes("@outputs.")) continue;
    if (line.trimmed.startsWith("#")) continue;
    if (/^(set|if)\b/.test(line.trimmed)) continue;

    const isLiteralText = line.trimmed.startsWith("|");
    diagnostics.push(
      diagnostic(
        line,
        "outputs-out-of-scope",
        "@outputs is only available in set/if statements immediately after an action invocation. Copy it into a variable before using it elsewhere.",
        isLiteralText ? 2 : 1,
        "@outputs.",
      ),
    );
  }
}

const PROCEDURAL_TEXT_RE = /^(?:\|\s*)?(?:if\s+@|set\s+@|transition\s+to\s+@|run\s+@)/;

function addLiteralModeProceduralDiagnostics(
  lines: readonly LineInfo[],
  diagnostics: AgentScriptDiagnostic[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!/^instructions\s*:\s*\|/.test(header.trimmed)) continue;

    const inlineText = header.trimmed.replace(/^instructions\s*:\s*\|\s*/, "");
    if (PROCEDURAL_TEXT_RE.test(inlineText)) {
      diagnostics.push(
        diagnostic(
          header,
          "literal-mode-procedural-text",
          "instructions: | is literal text. Use instructions: -> when you need if/set/run/transition statements to execute.",
          2,
          "instructions",
        ),
      );
    }

    for (const line of lines.slice(i + 1)) {
      if (line.trimmed.length > 0 && line.indent <= header.indent) break;
      if (line.trimmed.startsWith("#") || line.trimmed.length === 0) continue;
      if (!PROCEDURAL_TEXT_RE.test(line.trimmed)) continue;
      diagnostics.push(
        diagnostic(
          line,
          "literal-mode-procedural-text",
          "This looks like executable Agent Script inside literal instructions. Use instructions: -> so it runs instead of being sent to the LLM as text.",
          2,
        ),
      );
    }
  }
}

function addRunInAfterReasoningDiagnostics(
  lines: readonly LineInfo[],
  diagnostics: AgentScriptDiagnostic[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!/^after_reasoning\s*:/.test(header.trimmed)) continue;
    for (const line of lines.slice(i + 1)) {
      if (line.trimmed.length > 0 && line.indent <= header.indent) break;
      if (!/^run\s+@actions\./.test(line.trimmed)) continue;
      diagnostics.push(
        diagnostic(
          line,
          "run-in-after-reasoning",
          "run inside after_reasoning has inconsistent runtime behavior. Prefer deterministic runs in reasoning instructions: -> or post-action blocks.",
          2,
          "run",
        ),
      );
    }
  }
}

interface VariableDeclaration {
  name: string;
  line: LineInfo;
  removalStartLine: number;
}

function findVariablesBlock(lines: readonly LineInfo[]): { header: LineInfo; lines: LineInfo[] }[] {
  const blocks: { header: LineInfo; lines: LineInfo[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (header.indent !== 0 || header.trimmed !== "variables:") continue;
    const blockLines: LineInfo[] = [];
    for (const line of lines.slice(i + 1)) {
      if (line.trimmed.length > 0 && line.indent <= header.indent) break;
      blockLines.push(line);
    }
    blocks.push({ header, lines: blockLines });
  }
  return blocks;
}

function variableChildIndent(blockLines: readonly LineInfo[]): number | undefined {
  const childIndents = blockLines
    .filter((line) => line.trimmed.length > 0 && !line.trimmed.startsWith("#"))
    .map((line) => line.indent);
  return childIndents.length > 0 ? Math.min(...childIndents) : undefined;
}

function variableNameFromDeclaration(line: LineInfo): string | undefined {
  const match =
    /^(?<name>[A-Za-z_][\w-]*)\s*:\s*(?:(?:mutable|linked)\s+)?[A-Za-z_][\w.-]*(?:\s*=.*)?$/.exec(
      line.trimmed,
    );
  const name = match?.groups?.name;
  if (!name || VARIABLE_FIELD_NAMES.has(name)) return undefined;
  return name;
}

function collectVariableDeclarations(lines: readonly LineInfo[]): VariableDeclaration[] {
  const declarations: VariableDeclaration[] = [];
  for (const block of findVariablesBlock(lines)) {
    const childIndent = variableChildIndent(block.lines);
    if (childIndent === undefined) continue;
    for (const line of block.lines) {
      if (line.indent !== childIndent || line.trimmed.startsWith("#")) continue;
      const name = variableNameFromDeclaration(line);
      if (!name) continue;

      let removalStartLine = line.line;
      for (let i = line.line - 1; i > block.header.line; i--) {
        const previous = lines[i];
        if (!previous || previous.trimmed.length === 0) break;
        if (!previous.trimmed.startsWith("#") || previous.indent !== line.indent) break;
        removalStartLine = previous.line;
      }

      declarations.push({ name, line, removalStartLine });
    }
  }
  return declarations;
}

function variableRefRegex(name: string): RegExp {
  return new RegExp(`@variables\\.${escapeRegExp(name)}\\b`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasVariableReference(lines: readonly LineInfo[], name: string): boolean {
  const ref = variableRefRegex(name);
  return lines.some((line) => {
    if (line.trimmed.startsWith("#") || line.trimmed.startsWith("|")) return false;
    return ref.test(line.raw);
  });
}

function addUnusedVariableDiagnostics(
  lines: readonly LineInfo[],
  diagnostics: AgentScriptDiagnostic[],
): void {
  for (const variable of collectVariableDeclarations(lines)) {
    if (hasVariableReference(lines, variable.name)) continue;
    diagnostics.push(
      diagnostic(
        variable.line,
        "unused-variable",
        `Variable '${variable.name}' is declared but never referenced as @variables.${variable.name}.`,
        2,
        variable.name,
        {
          removalRange: {
            start: { line: variable.removalStartLine, character: 0 },
            end: { line: variable.line, character: variable.line.raw.length },
          },
        },
      ),
    );
  }
}

function outputEntryLines(action: ActionBlock, outputName: string): LineInfo[] | undefined {
  const outputsLine = action.lines.find((l) => /^outputs\s*:/.test(l.trimmed));
  if (!outputsLine) return undefined;

  const entry = action.lines.find(
    (l) => l.indent > outputsLine.indent && l.trimmed.startsWith(`${outputName}:`),
  );
  if (!entry) return undefined;

  const out: LineInfo[] = [entry];
  for (const line of action.lines.slice(action.lines.indexOf(entry) + 1)) {
    if (line.trimmed.length > 0 && line.indent <= entry.indent) break;
    out.push(line);
  }
  return out;
}

function hasBooleanField(lines: readonly LineInfo[], field: string, expected: boolean): boolean {
  return lines.some((l) => {
    if (!l.trimmed.startsWith(`${field}:`)) return false;
    const value = scalarAfterColon(l.trimmed)?.toLowerCase();
    return value === String(expected).toLowerCase();
  });
}

function addPromptTemplateOutputDiagnostics(
  action: ActionBlock,
  diagnostics: AgentScriptDiagnostic[],
): void {
  if (schemeOf(action.target) !== "generatePromptResponse") return;
  const promptResponse = outputEntryLines(action, "promptResponse");
  if (!promptResponse) return;

  const missing: string[] = [];
  if (!hasBooleanField(promptResponse, "is_used_by_planner", true)) {
    missing.push("is_used_by_planner: True");
  }
  if (!hasBooleanField(promptResponse, "is_displayable", false)) {
    missing.push("is_displayable: False");
  }
  if (missing.length === 0) return;

  diagnostics.push(
    diagnostic(
      promptResponse[0],
      "prompt-template-output-flags",
      `Prompt template output promptResponse should usually include ${missing.join(" and ")} so the planner can use it without directly displaying intermediate prompt output.`,
      2,
      "promptResponse",
      { action: action.name, missing_fields: missing },
    ),
  );
}

export function buildLocalDiagnostics(source: string): AgentScriptDiagnostic[] {
  const lines = lineInfos(source);
  const diagnostics: AgentScriptDiagnostic[] = [];

  addConnectionMessagingDiagnostics(findConnectionMessagingBlock(lines), diagnostics);
  addUnusedVariableDiagnostics(lines, diagnostics);
  addInputsScopeDiagnostics(lines, diagnostics);
  addOutputsScopeDiagnostics(lines, diagnostics);
  addLiteralModeProceduralDiagnostics(lines, diagnostics);
  addRunInAfterReasoningDiagnostics(lines, diagnostics);

  const config = parseConfig(lines);
  if (config.agentType === "AgentforceEmployeeAgent") {
    if (config.defaultAgentUserLine) {
      diagnostics.push(
        diagnostic(
          config.defaultAgentUserLine,
          "employee-agent-default-user",
          "Employee Agents run as the logged-in user. Remove default_agent_user from config; it can cause publish/preview failures.",
          1,
          "default_agent_user",
          {
            removalRange: {
              start: { line: config.defaultAgentUserLine.line, character: 0 },
              end: {
                line: config.defaultAgentUserLine.line,
                character: config.defaultAgentUserLine.raw.length,
              },
            },
          },
        ),
      );
    }

    const connection = findConnectionMessaging(lines);
    if (connection) {
      diagnostics.push(
        diagnostic(
          connection,
          "employee-agent-connection-messaging",
          "Employee Agents must not include a connection messaging block. Use a transition/help subagent or a target-backed action instead of Messaging escalation.",
          1,
          "connection",
        ),
      );
    }

    for (const line of findEscalateRefs(lines)) {
      diagnostics.push(
        diagnostic(
          line,
          "employee-agent-escalate",
          "@utils.escalate is Service-Agent-only. Employee Agents should route to a help subagent or call a target-backed action instead.",
          1,
          "@utils.escalate",
        ),
      );
    }
  }

  for (const action of findTargetBackedActions(lines)) {
    const actionLine = lines[action.line];
    if (!hasOutputsBlock(action)) {
      diagnostics.push(
        diagnostic(
          actionLine,
          "action-missing-outputs",
          `Action '${action.name}' has a target but no outputs block. Add outputs so server publish can resolve the action contract.`,
          1,
          action.name,
          { action: action.name, target: action.target },
        ),
      );
    }

    addPromptTemplateOutputDiagnostics(action, diagnostics);

    if (targetRefLooksLikeSalesforceId(action.target) && action.targetLine !== undefined) {
      diagnostics.push(
        diagnostic(
          lines[action.targetLine],
          "target-ref-looks-like-id",
          "Action target references should use a stable API name, not a Salesforce record id. Publish/runtime resolution expects names such as flow://MyFlow or apex://MyInvocableClass.",
          2,
          action.target,
          { action: action.name, target: action.target },
        ),
      );
    }

    const scheme = schemeOf(action.target);
    for (const item of collectNumericActionIo(action)) {
      diagnostics.push(
        diagnostic(item.line, "numeric-action-io", numericMessage(scheme), 2, "number", {
          action: action.name,
          target: action.target,
          section: item.section,
          scheme,
        }),
      );
    }
    for (const item of collectComplexActionIo(action)) {
      diagnostics.push(
        diagnostic(
          item.line,
          "complex-action-io",
          `Action ${item.section} has type object/list[object] but no complex_data_type_name or schema. Publish can fail because the platform cannot bind the target contract.`,
          2,
          "object",
          {
            action: action.name,
            target: action.target,
            section: item.section,
            scheme,
          },
        ),
      );
    }
  }

  return diagnostics;
}
