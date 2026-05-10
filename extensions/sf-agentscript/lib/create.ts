/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Scaffold a new `.agent` + `bundle-meta.xml` from a job spec.
 *
 * Idea borrowed from `@salesforce/agents` `ScriptAgent.createAuthoringBundle`;
 * we own the implementation. Local-first: the generated source is compiled
 * via the vendored SDK before it lands on disk so a template bug surfaces
 * as a CreateBundleResult failure rather than an unparseable file.
 *
 * Default location matches Salesforce convention:
 *   <defaultPackageDir>/main/default/aiAuthoringBundles/<bundle_name>/
 *
 * Default-package-dir detection reads `sfdx-project.json`; falls back to
 * `force-app` when the file is missing or malformed.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateAgentforceDefault } from "./templates/agentforce-default.ts";
import { generateMinimal } from "./templates/minimal.ts";
import { loadAgentforceSDK } from "./sdk.ts";

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

export interface AgentJobSpec {
  description?: string;
  agent_user?: string;
  topics?: Array<{ name: string; description?: string }>;
  variables?: Array<{
    name: string;
    type: "string" | "boolean" | "number";
    mutable?: boolean;
    default?: unknown;
    description?: string;
  }>;
}

export interface CreateBundleOptions {
  cwd: string;
  bundle_name: string;
  output_dir?: string;
  template?: "minimal" | "agentforce-default";
  job_spec?: AgentJobSpec;
  overwrite?: boolean;
}

export interface CreateBundleSuccess {
  ok: true;
  bundle_dir: string;
  agent_path: string;
  meta_path: string;
  /** Number of severity-1 / severity-2 diagnostics from the local validate pass. */
  diagnostics_count: number;
  /**
   * Tool call hints the LLM can chain next. Always non-empty on success.
   */
  next_steps: Array<{ tool: string; params: Record<string, unknown> }>;
}

export interface CreateBundleFailure {
  ok: false;
  reason: "exists" | "sdk_unavailable" | "template_compile_failed" | "write_failed";
  reason_detail?: string;
}

export type CreateBundleResult = CreateBundleSuccess | CreateBundleFailure;

// -------------------------------------------------------------------------------------------------
// Implementation
// -------------------------------------------------------------------------------------------------

const BUNDLE_META_XML_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">
  <bundleType>AGENT</bundleType>
</AiAuthoringBundle>`;

export async function createBundle(opts: CreateBundleOptions): Promise<CreateBundleResult> {
  const targetDir =
    opts.output_dir ??
    path.join(
      await detectDefaultPackageDir(opts.cwd),
      "main",
      "default",
      "aiAuthoringBundles",
      opts.bundle_name,
    );

  if (!opts.overwrite && existsSync(targetDir)) {
    return {
      ok: false,
      reason: "exists",
      reason_detail: `Bundle directory already exists at ${targetDir}.`,
    };
  }

  const template = opts.template ?? "agentforce-default";
  const source =
    template === "minimal"
      ? generateMinimal(opts.bundle_name, opts.job_spec)
      : generateAgentforceDefault(opts.bundle_name, opts.job_spec);

  // Local-first validation. If the SDK isn't loadable we still write —
  // the user's local copy may be repaired later via /sf-agentscript doctor.
  let diagnosticsCount = 0;
  const sdk = await loadAgentforceSDK();
  if (sdk) {
    try {
      const compileResult = (
        sdk as unknown as {
          compileSource: (s: string) => { diagnostics: { severity: number }[] };
        }
      ).compileSource(source);
      const sev1 = compileResult.diagnostics.filter((d) => d.severity === 1);
      diagnosticsCount = compileResult.diagnostics.length;
      if (sev1.length > 0) {
        return {
          ok: false,
          reason: "template_compile_failed",
          reason_detail: `Template '${template}' produced ${sev1.length} severity-1 errors. This is a template bug.`,
        };
      }
    } catch (err) {
      return {
        ok: false,
        reason: "template_compile_failed",
        reason_detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
    await mkdir(targetDir, { recursive: true });
    const agentPath = path.join(targetDir, `${opts.bundle_name}.agent`);
    const metaPath = path.join(targetDir, `${opts.bundle_name}.bundle-meta.xml`);
    await writeFile(agentPath, source, "utf8");
    await writeFile(metaPath, BUNDLE_META_XML_BODY, "utf8");

    return {
      ok: true,
      bundle_dir: targetDir,
      agent_path: agentPath,
      meta_path: metaPath,
      diagnostics_count: diagnosticsCount,
      next_steps: [
        { tool: "agentscript_inspect", params: { path: agentPath } },
        {
          tool: "agentscript_preview",
          params: { action: "start", agent_file: agentPath, mock_mode: "Mock" },
        },
      ],
    };
  } catch (err) {
    return {
      ok: false,
      reason: "write_failed",
      reason_detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

async function detectDefaultPackageDir(cwd: string): Promise<string> {
  const sfdxProject = path.join(cwd, "sfdx-project.json");
  try {
    const raw = await readFile(sfdxProject, "utf8");
    const parsed = JSON.parse(raw) as {
      packageDirectories?: Array<{ path: string; default?: boolean }>;
    };
    const dirs = parsed.packageDirectories ?? [];
    const def = dirs.find((d) => d.default) ?? dirs[0];
    if (def?.path) return path.join(cwd, def.path);
  } catch {
    /* fall through to default */
  }
  return path.join(cwd, "force-app");
}
