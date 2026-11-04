/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guidance and data connector authoring: validate against the workspace
 * schema, then upload through `intercom fin procedures upload`, which posts
 * any Fin SDK resource file to `/fin-sdk/upload` (the server routes on
 * `type`).
 *
 * - Guidance has no draft state: `live` changes how Fin answers every
 *   customer at once. SF Fin uploads guidance as `paused` only; making it
 *   live is the separate Guardrail-mediated `guidance_state` step.
 * - Data connectors upload as drafts only. Fin publishes connectors in the
 *   web UI; SF Fin never sets `state: live`.
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import * as JsonSchema from "typebox/schema";
import { parse, parseDocument, stringify } from "yaml";
import type { FinCredential } from "./auth.ts";
import { classifyCliResult, readCliErrorMessage } from "./cli-runner.ts";
import type { ProcedureValidation, ValidationIssue } from "./sdk-procedures.ts";
import { ensureFinSdkEnabled, type SdkReadDeps } from "./sdk-reads.ts";

export type ResourceKind = "procedure" | "guidance" | "data_connector";

export function resourceSchemaPath(sdkDir: string, kind: ResourceKind): string {
  const file = kind === "data_connector" ? "data-connector.json" : `${kind}.json`;
  return path.join(sdkDir, "resources", ".fin", "schema", file);
}

/** Resource kind from the file's `type` (procedure files have none). */
export function detectResourceKind(file: string): ResourceKind | undefined {
  const doc = readStructured(file);
  if (!doc.ok) return undefined;
  const type = (doc.value as Record<string, unknown> | undefined)?.type;
  if (type === "guidance") return "guidance";
  if (type === "data_connector") return "data_connector";
  return "procedure";
}

export function guidanceRuleIssues(record: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.state !== undefined && record.state !== "paused") {
    issues.push({
      path: "/state",
      message:
        "Upload guidance as `state: paused` (or omit state). Live guidance changes every answer at once; set it live with sdk operation='guidance_state'.",
    });
  }
  const isNew = record.id === undefined || record.id === "new";
  if (isNew && record.id === undefined) {
    issues.push({ path: "/id", message: "Use `id: new` for new guidance, or the existing id." });
  }
  return issues;
}

export function dataConnectorRuleIssues(record: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (record.state !== undefined && record.state !== "draft") {
    issues.push({
      path: "/state",
      message:
        "Remove `state`. Data connectors upload as drafts; publish them in the Intercom web UI.",
    });
  }
  if (typeof record.id !== "number") {
    issues.push({
      path: "/id",
      message:
        "Set `id` to an existing numeric data connector id. Create the connector first with sdk operation='create_data_connector'.",
    });
  }
  const request = (record.request ?? {}) as Record<string, unknown>;
  const url = typeof request.url === "string" ? request.url : "";
  if (url && !/^https:\/\//i.test(url)) {
    issues.push({ path: "/request/url", message: "Use an https:// URL." });
  }
  const used = new Set(
    [...JSON.stringify(request).matchAll(/<read attr=\\?['"]([^'"\\]+)\\?['"]/g)].map((m) => m[1]),
  );
  for (const name of Object.keys((record.inputs ?? {}) as Record<string, unknown>)) {
    if (!used.has(name)) {
      issues.push({
        path: `/inputs/${name}`,
        message: `Input "${name}" is not used in the request; reference it with <read attr='${name}' /> or remove it.`,
      });
    }
  }
  if (record.mock_response === undefined) {
    issues.push({
      path: "/mock_response",
      message: "Add a mock_response so Fin can infer outputs and test without calling the API.",
    });
  }
  return issues;
}

export function validateResourceFile(
  file: string,
  kind: Exclude<ResourceKind, "procedure">,
  schemaPath: string,
): ProcedureValidation {
  if (!existsSync(file))
    return { ok: false, file, issues: [{ path: "/", message: "File not found." }] };
  if (!existsSync(schemaPath)) {
    return {
      ok: false,
      file,
      issues: [
        {
          path: "/",
          message:
            "Workspace schema not found. Run sf_fin action='sdk' operation='download' first.",
        },
      ],
    };
  }
  const doc = readStructured(file);
  if (doc.ok === false) return { ok: false, file, schemaPath, issues: doc.issues };
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as Parameters<
    typeof JsonSchema.Check
  >[0];
  const issues: ValidationIssue[] = [];
  if (!JsonSchema.Check(schema, doc.value)) {
    const [, errors] = JsonSchema.Errors(schema, doc.value) as unknown as [
      boolean,
      Array<{ instancePath: string; message?: string; keyword: string }>,
    ];
    const seen = new Set<string>();
    for (const e of errors ?? []) {
      if (e.keyword === "boolean") continue;
      const key = `${e.instancePath}|${e.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({ path: e.instancePath || "/", message: e.message ?? e.keyword });
      if (issues.length >= 15) break;
    }
  }
  const record = (doc.value && typeof doc.value === "object" ? doc.value : {}) as Record<
    string,
    unknown
  >;
  issues.push(
    ...(kind === "guidance" ? guidanceRuleIssues(record) : dataConnectorRuleIssues(record)),
  );
  const name =
    typeof record.title === "string"
      ? record.title
      : typeof record.name === "string"
        ? record.name
        : undefined;
  return {
    ok: issues.length === 0,
    file,
    schemaPath,
    name,
    id: typeof record.id === "string" || typeof record.id === "number" ? record.id : undefined,
    issues,
  };
}

export interface ResourceUploadResult {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
}

export async function uploadResource(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: {
    file: string;
    kind: Exclude<ResourceKind, "procedure">;
    schemaPath: string;
    note?: string;
  },
  signal?: AbortSignal,
): Promise<ResourceUploadResult> {
  const validation = validateResourceFile(input.file, input.kind, input.schemaPath);
  if (!validation.ok) {
    return {
      ok: false,
      text: [
        `❌ ${validation.issues.length} issue${validation.issues.length === 1 ? "" : "s"} in ${input.file}`,
        ...validation.issues.map((i) => `  ${i.path} — ${i.message}`),
      ].join("\n"),
      details: { phase: "validate", kind: input.kind, issues: validation.issues },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };

  // Guidance without a state would default server-side; send paused explicitly.
  const upload =
    input.kind === "guidance"
      ? withPausedState(input.file)
      : { path: realpathSync(input.file), cleanup: () => undefined };
  const args = ["fin", "procedures", "upload", upload.path, "--json"];
  if (input.note?.trim()) args.push("--note", input.note.trim());
  try {
    const result = await deps.run(args, { credential, signal, timeoutMs: 120_000 });
    if (classifyCliResult(result) !== "ok") {
      return {
        ok: false,
        text: `❌ Upload failed: ${readCliErrorMessage(result) ?? "upload failed."}`,
        details: { phase: "upload", kind: input.kind },
      };
    }
    const response = safeJson(result.stdout) as Record<string, unknown> | undefined;
    const saved = parseLoose(
      typeof response?.new_file_content === "string" ? response.new_file_content : "",
    );
    const id = String(response?.id ?? saved?.id ?? "?");
    const state = typeof saved?.state === "string" ? saved.state : undefined;
    const expected = input.kind === "guidance" ? "paused" : "draft";
    if (state && state !== expected) {
      return {
        ok: false,
        text: `⚠ Uploaded ${input.kind} ${id}, but Fin reports state ${state} instead of ${expected}. Check it in Fin.`,
        details: { phase: "verify", kind: input.kind, id, state },
      };
    }
    const label = validation.name ?? path.basename(input.file);
    // Verify the server-processed copy in the upload response. Fin rewrites it
    // on save (input syntax, inferred outputs), so it is evidence of the save.
    // `data-connectors get` returns only the published version and does not
    // show draft edits, so it cannot be used to read a draft back.
    if (input.kind === "data_connector") {
      const sent = readStructured(input.file);
      const mismatch = connectorMismatch(
        (sent.ok ? sent.value : {}) as Record<string, unknown>,
        saved,
      );
      if (mismatch.length > 0) {
        return {
          ok: false,
          text: `⚠ Fin accepted the upload for data connector ${id}, but its saved draft does not match the file: ${mismatch.join(", ")}. Check it in the Intercom web UI (Settings → Data connectors).`,
          details: { phase: "verify", kind: input.kind, id, mismatch },
        };
      }
    }
    return {
      ok: true,
      text: [
        input.kind === "guidance"
          ? `✅ Uploaded guidance "${label}" as ${id} (paused — Fin does not use it yet).`
          : `✅ Uploaded data connector "${label}" (${id}) as a draft.`,
        input.kind === "guidance"
          ? `To make it live: sf_fin action='sdk' operation='guidance_state' guidance_id='${id}' state='live' (plan first; SF Guardrail mediates execution). Set \`id: ${id}\` in the file before editing again.`
          : "Fin saved it as an unpublished draft. `data-connectors get` keeps showing the published version until you publish the draft in the Intercom web UI (Settings → Data connectors); drafts are not available to Fin.",
        ensured.enabledNow ? `🔓 ${ensured.message}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      details: { phase: "upload", kind: input.kind, id, state: state ?? expected },
    };
  } finally {
    upload.cleanup();
  }
}

export async function createDataConnector(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { name: string },
  signal?: AbortSignal,
): Promise<ResourceUploadResult> {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    return {
      ok: false,
      text: "create_data_connector requires a name (1–120 characters).",
      details: { phase: "input" },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const result = await deps.run(["fin", "data-connectors", "create", "--name", name, "--json"], {
    credential,
    signal,
    timeoutMs: 60_000,
  });
  if (classifyCliResult(result) !== "ok") {
    return {
      ok: false,
      text: `❌ Create failed: ${readCliErrorMessage(result) ?? "create failed."}`,
      details: { phase: "create" },
    };
  }
  const response = safeJson(result.stdout) as Record<string, unknown> | undefined;
  const id = response?.id !== undefined ? String(response.id) : undefined;
  return {
    ok: Boolean(id),
    text: id
      ? `✅ Created draft data connector "${name}" (${id}). Write its JSON with \`"type": "data_connector", "id": ${id}\`, then sdk operation='upload'.`
      : "⚠ Fin did not return a data connector id.",
    details: { phase: "create", id, name },
  };
}

/**
 * Plan or set guidance live/paused. Fin has no guidance state command, so the
 * change is an upload of the current guidance with only `state` changed.
 */
export async function setGuidanceState(
  credential: FinCredential,
  deps: SdkReadDeps,
  input: { guidanceId: string; target: "live" | "paused"; execute: boolean },
  signal?: AbortSignal,
): Promise<ResourceUploadResult> {
  if (!/^\d+$/.test(input.guidanceId)) {
    return {
      ok: false,
      text: "guidance_state requires guidance_id: an exact numeric Fin guidance id.",
      details: { phase: "input" },
    };
  }
  const ensured = await ensureFinSdkEnabled(credential, deps, signal);
  if (!ensured.ok) return { ok: false, text: ensured.message, details: { phase: "enable" } };
  const got = await deps.run(["fin", "guidance", "get", input.guidanceId, "--json"], {
    credential,
    signal,
    timeoutMs: 60_000,
  });
  if (classifyCliResult(got) !== "ok") {
    return {
      ok: false,
      text: `❌ Could not read guidance ${input.guidanceId}: ${readCliErrorMessage(got) ?? "get failed."}`,
      details: { phase: "read" },
    };
  }
  const wrapped = safeJson(got.stdout) as { content?: unknown } | undefined;
  const current = parseLoose(typeof wrapped?.content === "string" ? wrapped.content : got.stdout);
  if (!current || current.type !== "guidance") {
    return {
      ok: false,
      text: `❌ Guidance ${input.guidanceId} returned no readable YAML.`,
      details: { phase: "read" },
    };
  }
  const from = typeof current.state === "string" ? current.state : "unknown";
  const title = typeof current.title === "string" ? current.title : input.guidanceId;
  const base = { guidanceId: input.guidanceId, from, to: input.target };
  if (from === input.target) {
    return {
      ok: true,
      text: `Guidance "${title}" is already ${from}; nothing to change.`,
      details: { phase: "noop", ...base },
    };
  }
  const effect =
    input.target === "live"
      ? "Fin applies it to every matching conversation immediately."
      : "Fin stops applying it; it stays saved and can be set live again.";
  if (!input.execute) {
    return {
      ok: true,
      text: [
        `Plan: set guidance "${title}" (${input.guidanceId}) ${from} → ${input.target}.`,
        effect,
        `To proceed, call sf_fin action='sdk' operation='guidance_state' guidance_id='${input.guidanceId}' state='${input.target}' allow_mutation=true (SF Guardrail mediates it).`,
      ].join("\n"),
      details: { phase: "plan", ...base },
    };
  }
  const temp = writeTemp({ ...current, state: input.target });
  try {
    const result = await deps.run(["fin", "procedures", "upload", temp.path, "--json"], {
      credential,
      signal,
      timeoutMs: 120_000,
    });
    if (classifyCliResult(result) !== "ok") {
      return {
        ok: false,
        text: `❌ Guidance state change failed: ${readCliErrorMessage(result) ?? "upload failed."}`,
        details: { phase: "execute", ...base },
      };
    }
    const response = safeJson(result.stdout) as Record<string, unknown> | undefined;
    const saved = parseLoose(
      typeof response?.new_file_content === "string" ? response.new_file_content : "",
    );
    const after = typeof saved?.state === "string" ? saved.state : undefined;
    if (after !== input.target) {
      return {
        ok: false,
        text: `⚠ Fin accepted the change for guidance "${title}", but reports state ${after ?? "unknown"} instead of ${input.target}.`,
        details: { phase: "verify", ...base, observed: after },
      };
    }
    return {
      ok: true,
      text: `✅ Guidance "${title}" is now ${after} (was ${from}). ${effect}`,
      details: { phase: "execute", ...base, observed: after },
    };
  } finally {
    temp.cleanup();
  }
}

/** Fields that must survive a data connector upload, compared with the read-back. */
function connectorMismatch(
  sent: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): string[] {
  if (!stored) return ["no saved content in the upload response"];
  const out: string[] = [];
  if (sent.name !== undefined && stored.name !== sent.name) out.push("name");
  const sentRequest = (sent.request ?? {}) as Record<string, unknown>;
  const storedRequest = (stored.request ?? {}) as Record<string, unknown>;
  if (sentRequest.method !== undefined && storedRequest.method !== sentRequest.method)
    out.push("request.method");
  // Fin rewrites <read attr='x' /> to <read attr="input.x" />; compare the host and path.
  const base = (url: unknown) => (typeof url === "string" ? url.split("?")[0] : "");
  if (sentRequest.url !== undefined && base(storedRequest.url) !== base(sentRequest.url))
    out.push("request.url");
  const sentInputs = Object.keys((sent.inputs ?? {}) as Record<string, unknown>).sort();
  const storedInputs = Object.keys((stored.inputs ?? {}) as Record<string, unknown>).sort();
  if (sentInputs.join(",") !== storedInputs.join(",")) out.push("inputs");
  return out;
}

function readStructured(
  file: string,
): { ok: true; value: unknown } | { ok: false; issues: ValidationIssue[] } {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (error) {
      return {
        ok: false,
        issues: [{ path: "/", message: `JSON: ${error instanceof Error ? error.message : error}` }],
      };
    }
  }
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((e) => ({ path: "/", message: `YAML: ${e.message}` })),
    };
  }
  return { ok: true, value: doc.toJS() };
}

function withPausedState(file: string): { path: string; cleanup: () => void } {
  const doc = readStructured(file);
  const record = (doc.ok ? doc.value : {}) as Record<string, unknown>;
  return writeTemp({ ...record, state: "paused" });
}

/** Owner-only temp copy for an upload; the caller always cleans it up. */
function writeTemp(record: Record<string, unknown>): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-fin-upload-"));
  const file = path.join(dir, "resource.yaml");
  writeFileSync(file, stringify(record), { mode: 0o600 });
  return { path: file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function parseLoose(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) return undefined;
  try {
    const value = parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
