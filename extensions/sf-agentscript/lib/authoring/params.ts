/* SPDX-License-Identifier: Apache-2.0 */
/** Parameter contract for agentscript_authoring. */

export type AuthoringVerb = "create" | "compile" | "inspect" | "mutate";
export type CompileMode = "check" | "format";
export type InspectMode =
  | "structure"
  | "context_profile"
  | "find_references"
  | "definition"
  | "check_targets"
  | "review";
export type MutateMode = "set_field" | "rename" | "insert" | "delete" | "apply_quick_fix";
export type AuthoringMode = CompileMode | InspectMode | MutateMode;

export interface AuthoringParams {
  verb: AuthoringVerb;
  mode?: AuthoringMode;
  agent_file?: string;
  // create
  bundle_name?: string;
  output_dir?: string;
  template?: "minimal" | "agentforce-default";
  job_spec?: unknown;
  overwrite?: boolean;
  // compile
  fallback?: "none" | "server";
  target_org?: string;
  // inspect
  symbol?: string;
  output_path?: string;
  // mutate
  component?: string;
  field?: string;
  value?: unknown;
  from?: string;
  to?: string;
  parent?: string;
  child?: unknown;
  target?: string;
  diagnostic_code?: string;
  line?: number;
  fix_index?: number;
  dry_run?: boolean;
}

export interface AuthoringActionSpec {
  key: string;
  verb: AuthoringVerb;
  mode?: AuthoringMode;
  required: readonly string[];
  inferable: readonly string[];
  writes: boolean;
}

export const AUTHORING_ACTION_SPECS: Record<string, AuthoringActionSpec> = {
  create: {
    key: "create",
    verb: "create",
    required: ["bundle_name"],
    inferable: [],
    writes: true,
  },
  "compile.check": {
    key: "compile.check",
    verb: "compile",
    mode: "check",
    required: [],
    inferable: ["agent_file"],
    writes: false,
  },
  "compile.format": {
    key: "compile.format",
    verb: "compile",
    mode: "format",
    required: [],
    inferable: ["agent_file"],
    writes: true,
  },
  "inspect.structure": {
    key: "inspect.structure",
    verb: "inspect",
    mode: "structure",
    required: [],
    inferable: ["agent_file"],
    writes: false,
  },
  "inspect.context_profile": {
    key: "inspect.context_profile",
    verb: "inspect",
    mode: "context_profile",
    required: [],
    inferable: ["agent_file"],
    writes: false,
  },
  "inspect.find_references": {
    key: "inspect.find_references",
    verb: "inspect",
    mode: "find_references",
    required: ["symbol"],
    inferable: ["agent_file"],
    writes: false,
  },
  "inspect.definition": {
    key: "inspect.definition",
    verb: "inspect",
    mode: "definition",
    required: ["symbol"],
    inferable: ["agent_file"],
    writes: false,
  },
  "inspect.check_targets": {
    key: "inspect.check_targets",
    verb: "inspect",
    mode: "check_targets",
    required: ["target_org"],
    inferable: ["agent_file"],
    writes: false,
  },
  "inspect.review": {
    key: "inspect.review",
    verb: "inspect",
    mode: "review",
    required: [],
    inferable: ["agent_file"],
    writes: false,
  },
  "mutate.set_field": {
    key: "mutate.set_field",
    verb: "mutate",
    mode: "set_field",
    required: ["component", "field", "value"],
    inferable: ["agent_file"],
    writes: true,
  },
  "mutate.rename": {
    key: "mutate.rename",
    verb: "mutate",
    mode: "rename",
    required: ["from", "to"],
    inferable: ["agent_file"],
    writes: true,
  },
  "mutate.insert": {
    key: "mutate.insert",
    verb: "mutate",
    mode: "insert",
    required: ["parent", "child"],
    inferable: ["agent_file"],
    writes: true,
  },
  "mutate.delete": {
    key: "mutate.delete",
    verb: "mutate",
    mode: "delete",
    required: ["target"],
    inferable: ["agent_file"],
    writes: true,
  },
  "mutate.apply_quick_fix": {
    key: "mutate.apply_quick_fix",
    verb: "mutate",
    mode: "apply_quick_fix",
    required: ["diagnostic_code", "line"],
    inferable: ["agent_file"],
    writes: true,
  },
};

export function normalizeAuthoringMode(params: AuthoringParams): string {
  if (params.verb === "create") return "create";
  if (params.verb === "compile") return `compile.${params.mode ?? "check"}`;
  if (params.verb === "inspect") return `inspect.${params.mode ?? "structure"}`;
  if (params.verb === "mutate") {
    if (!params.mode) return "mutate.";
    return `mutate.${params.mode}`;
  }
  return `${(params as { verb?: string }).verb ?? ""}.${params.mode ?? ""}`;
}

export function validateAuthoringParams(
  params: AuthoringParams,
): { ok: true; key: string; spec: AuthoringActionSpec } | { ok: false; error: string } {
  const key = normalizeAuthoringMode(params);
  if (params.verb === "mutate" && !params.mode) {
    return { ok: false, error: "verb='mutate' requires mode." };
  }
  if (params.verb === "create" && params.mode) {
    return { ok: false, error: "verb='create' does not accept mode." };
  }
  const spec = AUTHORING_ACTION_SPECS[key];
  if (!spec) return { ok: false, error: `Unsupported authoring action: ${key}.` };
  const bag = params as unknown as Record<string, unknown>;
  const missing = spec.required.filter((field) => bag[field] === undefined || bag[field] === "");
  if (missing.length > 0) {
    return { ok: false, error: `${key} requires: ${missing.join(", ")}.` };
  }
  return { ok: true, key, spec };
}
