/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Lifecycle ops against an Agentforce org — publish, activate, deactivate, list versions.
 *
 * Endpoints:
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts            (server compile)
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents              (publish — first version)
 *   POST  https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents/{botId}/versions  (publish — new version)
 *   POST  /connect/bot-versions/{botVersionId}/activation                                 (activate / deactivate; instance URL)
 *   SOQL  BotDefinition / BotVersion / GenAiPlannerDefinition                             (resolve, list)
 *
 * Auth: every call goes through `@salesforce/core` `Connection`. SFAP routes
 * use sfapRequest with the api → test.api → dev.api fallback. Instance-URL
 * routes use `Connection.request` directly.
 *
 * Local-first: publish always server-compiles first; if local SDK loads, we
 * pre-validate before burning a server call (matches preview's pattern).
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Connection } from "@salesforce/core";
import type { ComponentSet as ComponentSetType } from "@salesforce/source-deploy-retrieve";
import { sfap404Message } from "./errors/sfap-404.ts";
import { isSfapRoutingFailure, sfapRequest } from "./eval/sfap.ts";
import { inspectFile } from "./inspect.ts";
import { checkActionTargets, checkBundleType } from "./preflight.ts";
import { loadAgentforceSDK } from "./sdk.ts";

// -------------------------------------------------------------------------------------------------
// Endpoints
// -------------------------------------------------------------------------------------------------

const COMPILE_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/scripts";
const AGENTS_URL = "https://api.salesforce.com/einstein/ai-agent/v1.1/authoring/agents";

let sdrPromise: Promise<{ ComponentSet: typeof ComponentSetType }> | undefined;
async function loadSdr() {
  sdrPromise ??= import("@salesforce/source-deploy-retrieve").then(({ ComponentSet }) => ({
    ComponentSet,
  }));
  return sdrPromise;
}

// -------------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------------

interface CompileResponseBody {
  status?: string;
  compiledArtifact?: AgentJsonShape;
  errorMessage?: string;
}

interface AgentJsonShape {
  globalConfiguration?: {
    label?: string;
    developerName?: string;
    agentType?: string;
    defaultAgentUser?: string;
  };
  agentVersion?: { developerName?: string };
}

interface PublishResponseBody {
  botId?: string;
  botVersionId?: string;
  errorMessage?: string;
}

export interface PublishResult {
  ok: true;
  bot_id: string;
  bot_version_id: string;
  developer_name: string;
  /** Whether this created the first version of a new agent or a new version of an existing one. */
  was_new_agent: boolean;
  /** When `activate=true` was passed and activation succeeded. */
  activated?: boolean;
  /** Bot version DeveloperName (e.g. v3) — useful for the bundle-meta.xml `target` attribute. */
  version_developer_name?: string;
  /**
   * Outcome of deploying the AiAuthoringBundle metadata record. The bundle
   * record is what tells Agent Script Studio "this agent has authoring
   * source available"; without it the org's UI falls back to the legacy
   * builder. Best-effort: a publish that creates the bot but fails to
   * deploy the bundle still returns ok=true overall, and `authoring_bundle.
   * error` carries the reason so the LLM (or human) can recover.
   */
  authoring_bundle?: {
    full_name: string;
    target: string;
    created: boolean;
    error?: string;
  };
  /**
   * Pre-flight findings collected before the publish call. Bundle XML
   * issues block the publish (publishAgent throws); action-target gaps
   * surface here as warnings so the user sees them on a successful
   * publish too. Empty/undefined when nothing was flagged.
   */
  preflight?: {
    /** action_name -> { target, scheme, ref_name, status, detail? } */
    missing_action_targets?: Array<{
      name: string;
      target: string;
      scheme: string;
      ref_name: string;
      detail: string;
      /** Human-readable metadata type label (e.g. "Flow", "ApexClass"). */
      metadata_label?: string;
    }>;
    /** Total declared actions inspected. */
    actions_inspected?: number;
    /** When pre-flight was skipped (no Connection, etc.) the reason lives here. */
    skipped?: string;
  };
}

export interface BotVersionRow {
  Id: string;
  VersionNumber: number;
  Status: string;
  DeveloperName?: string;
}

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

function soqlEscape(s: string): string {
  return s.replace(/'/g, "''");
}

async function findBotId(conn: Connection, agentApiName: string): Promise<string | undefined> {
  const r = await conn.query<{ Id: string }>(
    `SELECT Id FROM BotDefinition WHERE DeveloperName='${soqlEscape(agentApiName)}'`,
  );
  return r.records[0]?.Id;
}

async function getVersionDetails(
  conn: Connection,
  botVersionId: string,
): Promise<{ DeveloperName?: string; VersionNumber?: number } | undefined> {
  const r = await conn.query<{ DeveloperName?: string; VersionNumber?: number }>(
    `SELECT DeveloperName, VersionNumber FROM BotVersion WHERE Id='${soqlEscape(botVersionId)}' LIMIT 1`,
  );
  return r.records[0];
}

// -------------------------------------------------------------------------------------------------
// Server compile (also used by compile fallback="server")
// -------------------------------------------------------------------------------------------------

export async function serverCompile(
  conn: Connection,
  agentSource: string,
): Promise<{ ok: true; agentJson: AgentJsonShape } | { ok: false; status: number; body: unknown }> {
  const resp = await sfapRequest<CompileResponseBody>(conn, {
    url: COMPILE_URL,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      assets: [{ type: "AFScript", name: "AFScript", content: agentSource }],
      afScriptVersion: "2.0.0",
    },
  });
  if (resp.status < 200 || resp.status >= 300 || resp.body.status !== "success") {
    return { ok: false, status: resp.status, body: resp.body };
  }
  if (!resp.body.compiledArtifact) {
    return { ok: false, status: resp.status, body: { error: "no compiledArtifact" } };
  }
  return { ok: true, agentJson: resp.body.compiledArtifact };
}

// -------------------------------------------------------------------------------------------------
// publish
// -------------------------------------------------------------------------------------------------

export interface PublishOptions {
  /** Normal org connection for SOQL / Connect API operations. */
  conn: Connection;
  /** Named-user JWT connection for `/einstein/ai-agent/*` SFAP routes. Defaults to conn for tests/back-compat. */
  agentApiConn?: Connection;
  agentSource: string;
  /**
   * Path to the on-disk bundle directory that contains both the
   * `<agentApiName>.agent` file and the `<agentApiName>.bundle-meta.xml`
   * file. Required for the AiAuthoringBundle metadata deploy step. When
   * omitted, the publish still creates the BotDefinition + BotVersion via
   * SFAP but the resulting agent will fall back to the legacy builder in
   * Agent Script Studio because no bundle metadata gets deployed.
   */
  bundleDir?: string;
  /** AAB / agent DeveloperName. Used for the SOQL existence check + return value. */
  agentApiName: string;
  /** When true, immediately activate the new version. Default false. */
  activate?: boolean;
  /** Optional progress callback. */
  log?: (msg: string) => void;
  /**
   * When true, skip the action-target Tooling-API pre-flight (network).
   * The local bundleType pre-flight always runs; it's a file read.
   * Default false.
   */
  skipPreflight?: boolean;
}

/** Thrown when a local pre-flight blocks the publish. Recoverable. */
export class PreflightFailureError extends Error {
  public readonly reason: string;
  public readonly path?: string;
  constructor(reason: string, path?: string) {
    super(reason);
    this.name = "PreflightFailureError";
    this.reason = reason;
    this.path = path;
  }
}

// Match the CLI's bundle-meta.xml shape — needs both <bundleType>AGENT</bundleType>
// and <target>{developerName}.{versionDeveloperName}</target>.
const BUNDLE_META_TARGET_REGEX = /<target>[^<]*<\/target>\s*/;
const BUNDLE_META_BUNDLE_TYPE_REGEX = /<bundleType>[^<]*<\/bundleType>/;

/**
 * Read the on-disk `<name>.bundle-meta.xml` and write back the same content
 * with a `<target>{agentApiName}.{versionDeveloperName}</target>` element.
 * If the element already exists, replace it. Returns the original content
 * so the caller can restore it after deploy.
 */
/**
 * Ensure the bundle directory is laid out so SDR's path-based metadata
 * resolver can identify it as an `AiAuthoringBundle`. The registry maps
 * directoryName=`aiAuthoringBundles` to type=`AiAuthoringBundle`, so the
 * required layout is `<root>/aiAuthoringBundles/<name>/<files>`.
 *
 * If `bundleDir`'s parent is already named `aiAuthoringBundles` we deploy
 * from there directly. Otherwise we synthesize a minimal mirror under
 * `os.tmpdir()/sf-agentscript-bundle-XXXX/aiAuthoringBundles/<name>/` and
 * point the deploy at that. The caller is responsible for cleanup
 * (we return `tmpRoot` when one was created).
 */
// Test-only re-export. The helper is intentionally not part of the public
// API surface; tests import it via this name to verify behavior without
// us shipping the synthesizer as a callable from outside lifecycle.ts.
export const ensureSdrFriendlyLayoutForTests = (
  bundleDir: string,
  agentApiName: string,
): Promise<{ bundleDir: string; tmpRoot?: string }> =>
  ensureSdrFriendlyLayout(bundleDir, agentApiName);

async function ensureSdrFriendlyLayout(
  bundleDir: string,
  agentApiName: string,
): Promise<{ bundleDir: string; tmpRoot?: string }> {
  const parent = path.basename(path.dirname(bundleDir));
  if (parent === "aiAuthoringBundles") {
    return { bundleDir };
  }
  // Synthesize: <tmp>/aiAuthoringBundles/<agentApiName>/<files copied>
  const tmpRoot = await mkdtemp(path.join(tmpdir(), "sf-agentscript-bundle-"));
  const synthDir = path.join(tmpRoot, "aiAuthoringBundles", agentApiName);
  await mkdir(synthDir, { recursive: true });
  // Copy the .agent file and the .bundle-meta.xml to the synth dir. The
  // bundle is intentionally minimal, so we don't need a recursive copy.
  const agentPath = path.join(bundleDir, `${agentApiName}.agent`);
  const metaPath = path.join(bundleDir, `${agentApiName}.bundle-meta.xml`);
  await writeFile(
    path.join(synthDir, `${agentApiName}.agent`),
    await readFile(agentPath, "utf8"),
    "utf8",
  );
  await writeFile(
    path.join(synthDir, `${agentApiName}.bundle-meta.xml`),
    await readFile(metaPath, "utf8"),
    "utf8",
  );
  return { bundleDir: synthDir, tmpRoot };
}

async function injectBundleTarget(
  bundleMetaPath: string,
  target: string,
): Promise<{ original: string; updated: string }> {
  const original = await readFile(bundleMetaPath, "utf8");
  let updated: string;
  if (BUNDLE_META_TARGET_REGEX.test(original)) {
    updated = original.replace(BUNDLE_META_TARGET_REGEX, `<target>${target}</target>\n    `);
  } else if (BUNDLE_META_BUNDLE_TYPE_REGEX.test(original)) {
    updated = original.replace(
      BUNDLE_META_BUNDLE_TYPE_REGEX,
      (m) => `${m}\n    <target>${target}</target>`,
    );
  } else {
    // Fallback: insert before </AiAuthoringBundle>
    updated = original.replace(
      /<\/AiAuthoringBundle>/,
      `    <target>${target}</target>\n</AiAuthoringBundle>`,
    );
  }
  if (updated !== original) {
    await writeFile(bundleMetaPath, updated, "utf8");
  }
  return { original, updated };
}

/**
 * Server-compile then publish. Creates a new agent if BotDefinition is absent;
 * otherwise creates a new version on the existing agent.
 */
export async function publishAgent(opts: PublishOptions): Promise<PublishResult> {
  const log = opts.log ?? (() => {});

  // Local pre-flight when the SDK is loadable — saves a network call when the
  // source is obviously broken.
  const sdk = await loadAgentforceSDK();
  if (sdk) {
    log("Pre-flighting local compile…");
    const compile = sdk.compileSource(opts.agentSource);
    const sev1 = compile.diagnostics
      .filter((d): d is { severity?: number } => typeof d === "object" && d !== null)
      .filter((d) => (d as { severity?: number }).severity === 1);
    if (sev1.length > 0) {
      throw new Error(
        `Local compile rejected the source (${sev1.length} severity-1 errors). ` +
          `Run agentscript_compile to see them, fix, and retry.`,
      );
    }
  }

  // Pre-flight: local bundle XML check (always blocks on failure).
  // Reading the bundle-meta.xml is cheap (file read), and SDR's deploy step
  // surfaces a cryptic 'Required fields are missing: [BundleType]' error
  // when the field is missing. Catch it locally so the LLM gets a clean
  // INVALID_BUNDLE envelope with a clear next step.
  if (opts.bundleDir) {
    const bundleMetaPath = path.join(opts.bundleDir, `${opts.agentApiName}.bundle-meta.xml`);
    const bundleCheck = await checkBundleType(bundleMetaPath);
    if (!bundleCheck.ok) {
      throw new PreflightFailureError(
        `Bundle XML is invalid: ${bundleCheck.detail}`,
        bundleMetaPath,
      );
    }
  }

  // Pre-flight: action targets via Tooling API. Non-blocking — we collect
  // missing references and surface them on PublishResult.preflight so the
  // caller can warn the user without aborting the publish. Server-side
  // validation will catch them too, but pre-flighting lets us route the
  // user to deploy the missing flows / classes BEFORE the publish round-
  // trip succeeds and the agent fails at preview-start runtime.
  let preflightFindings: PublishResult["preflight"];
  if (!opts.skipPreflight) {
    if (opts.bundleDir) {
      try {
        // Reuse inspectFile so we walk both top-level `actions:` and inline
        // declarations under `subagent.<X>.actions:` / `topic.<X>.actions:`.
        // CSA-style recipes declare every action inline, so a top-level-only
        // walk would silently miss them all and the pre-flight would no-op.
        const agentPath = path.join(opts.bundleDir, `${opts.agentApiName}.agent`);
        const inspect = await inspectFile(agentPath);
        const actions = inspect.ok ? (inspect.components?.actions ?? []) : [];
        const targeted = actions.filter((a) => typeof a.target === "string" && a.target.length > 0);
        if (targeted.length > 0) {
          log(`Pre-flighting ${targeted.length} action target(s) against the org…`);
          const tcheck = await checkActionTargets(opts.conn, targeted);
          const missing = tcheck.targets.filter((t) => t.status === "missing");
          preflightFindings = {
            actions_inspected: tcheck.total,
            ...(missing.length > 0
              ? {
                  missing_action_targets: missing.map((m) => ({
                    name: m.name,
                    target: m.target,
                    scheme: m.scheme,
                    ref_name: m.ref_name,
                    detail: m.detail ?? "",
                    metadata_label: m.metadata_label,
                  })),
                }
              : {}),
          };
          // Block the publish when any action target is missing in the org.
          // Server publish would otherwise fail with a cryptic 'Invocation
          // Target: bad value for restricted picklist field' error after the
          // network round-trip. The clean local error includes the full list
          // of missing targets so the user can deploy them, then retry.
          if (missing.length > 0) {
            const lines = [
              `${missing.length} action target(s) missing in org — publish would fail at server validation.`,
              "Missing:",
              ...missing.slice(0, 10).map((m) => `  • ${m.name} → ${m.scheme}://${m.ref_name}`),
            ];
            if (missing.length > 10) lines.push(`  …and ${missing.length - 10} more`);
            lines.push("");
            lines.push(
              "Deploy the missing flows / classes (sf project deploy start -m Flow:<X> -m ApexClass:<Y>), then retry. Pass skipPreflight=true to bypass this check.",
            );
            throw new PreflightFailureError(lines.join("\n"));
          }
        }
      } catch (err) {
        if (err instanceof PreflightFailureError) throw err;
        preflightFindings = {
          skipped: `action-target pre-flight skipped: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  } else {
    preflightFindings = { skipped: "opts.skipPreflight=true" };
  }

  const agentApiConn = opts.agentApiConn ?? opts.conn;

  log("Server-compiling…");
  const compileResult = await serverCompile(agentApiConn, opts.agentSource);
  if (compileResult.ok === false) {
    if (
      isSfapRoutingFailure({ status: compileResult.status, body: compileResult.body, endpoint: "" })
    ) {
      throw new Error(sfap404Message({ phase: "compile" }));
    }
    throw new Error(
      `Server compile failed (HTTP ${compileResult.status}): ${JSON.stringify(compileResult.body).slice(0, 600)}`,
    );
  }
  const agentJson = compileResult.agentJson;

  log("Looking up existing BotDefinition…");
  const existingBotId = await findBotId(opts.conn, opts.agentApiName);
  const url = existingBotId ? `${AGENTS_URL}/${existingBotId}/versions` : AGENTS_URL;
  log(
    existingBotId
      ? `Publishing new version of ${opts.agentApiName}…`
      : `Publishing new agent ${opts.agentApiName}…`,
  );

  const publishResp = await sfapRequest<PublishResponseBody>(agentApiConn, {
    url,
    method: "POST",
    headers: { "x-client-name": "sf-pi", "content-type": "application/json" },
    body: {
      agentDefinition: agentJson,
      instanceConfig: { endpoint: opts.conn.instanceUrl },
    },
  });
  if (publishResp.status < 200 || publishResp.status >= 300) {
    if (isSfapRoutingFailure(publishResp)) {
      throw new Error(sfap404Message({ phase: "publish", agentApiName: opts.agentApiName }));
    }
    throw new Error(
      `Publish failed (HTTP ${publishResp.status}): ${JSON.stringify(publishResp.body).slice(0, 600)}`,
    );
  }
  const { botId, botVersionId, errorMessage } = publishResp.body;
  if (!botId || !botVersionId) {
    throw new Error(`Publish returned no botId/botVersionId: ${errorMessage ?? "unknown"}`);
  }

  const versionDetails = await getVersionDetails(opts.conn, botVersionId);
  const versionDeveloperName = versionDetails?.DeveloperName;
  const versionNumber = versionDetails?.VersionNumber;

  // Critical for Agent Script Studio: deploy the AiAuthoringBundle metadata
  // record. Without this record, the org's UI falls back to the legacy
  // builder for our published agent. We mirror the CLI's flow exactly:
  // ComponentSet.fromSource(bundleDir).deploy() over @salesforce/source-
  // deploy-retrieve. The bundle directory must contain both the
  // <agentApiName>.bundle-meta.xml (with <target> injected) and the
  // <agentApiName>.agent source file. Without bundleDir we skip the deploy
  // and report it on PublishResult.authoring_bundle.error so the LLM (or
  // human) sees why Agent Script Studio will fall back to legacy builder.
  let authoringBundleResult: PublishResult["authoring_bundle"] = undefined;
  if (versionDeveloperName && typeof versionNumber === "number") {
    const bundleFullName = `${opts.agentApiName}_${versionNumber}`;
    const target = `${opts.agentApiName}.${versionDeveloperName}`;
    if (!opts.bundleDir) {
      authoringBundleResult = {
        full_name: bundleFullName,
        target,
        created: false,
        error:
          "bundleDir not provided; skipped AiAuthoringBundle deploy. Agent Script Studio will fall back to the legacy builder.",
      };
    } else {
      log(`Deploying AiAuthoringBundle ${bundleFullName} (target=${target})…`);
      const bundleMetaPath = path.join(opts.bundleDir, `${opts.agentApiName}.bundle-meta.xml`);
      let original: string | null = null;
      // Stage 2 may need to deploy from a temp directory when the caller's
      // bundle path isn't laid out as `<root>/aiAuthoringBundles/<name>/`.
      // SDR's path-based metadata resolver requires that exact directory
      // shape (the registry maps directoryName=aiAuthoringBundles to type=
      // AiAuthoringBundle). When that's missing the deploy fails with
      // "Could not infer a metadata type" before any network call. We
      // detect the layout and synthesize a minimal mirror under os.tmpdir()
      // so the deploy works regardless of where the caller stored the bundle.
      let tmpRoot: string | undefined;
      try {
        // 1. Inject <target> into the local bundle-meta.xml (CLI does this exact step).
        original = (await injectBundleTarget(bundleMetaPath, target)).original;

        // 2. Deploy via SDR ComponentSet.fromSource(bundleDir). This zips the
        //    bundle directory + a generated package.xml manifest and calls
        //    conn.metadata.deploy under the hood — same SOAP endpoint the
        //    CLI uses, just without us hand-rolling the zip format.
        const deploySource = await ensureSdrFriendlyLayout(opts.bundleDir, opts.agentApiName);
        if (deploySource.tmpRoot) tmpRoot = deploySource.tmpRoot;
        const { ComponentSet } = await loadSdr();
        const componentSet = ComponentSet.fromSource(deploySource.bundleDir);
        const deployJob = await componentSet.deploy({ usernameOrConnection: opts.conn });
        const deployResult = await deployJob.pollStatus();
        const success = deployResult.response?.success === true;
        if (success) {
          authoringBundleResult = { full_name: bundleFullName, target, created: true };
        } else {
          const failures = (deployResult.response?.details?.componentFailures ?? []) as
            | unknown
            | unknown[];
          const failArr = Array.isArray(failures) ? failures : [failures];
          const firstProblem =
            (failArr[0] as { problem?: string } | undefined)?.problem ?? "unknown";
          authoringBundleResult = {
            full_name: bundleFullName,
            target,
            created: false,
            error: `Bundle deploy failed: ${firstProblem}`,
          };
        }
      } catch (err) {
        authoringBundleResult = {
          full_name: bundleFullName,
          target,
          created: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        // 3. Always restore the local bundle-meta.xml so the <target> doesn't
        //    leak into source control. CLI does this in a finally block too.
        if (original !== null) {
          try {
            await writeFile(bundleMetaPath, original, "utf8");
          } catch {
            /* best-effort restore; if it fails the user can revert via git */
          }
        }
        // 4. Clean up the synthesized temp layout, if we had one.
        if (tmpRoot) {
          try {
            await rm(tmpRoot, { recursive: true, force: true });
          } catch {
            /* best-effort */
          }
        }
      }
    }
  }

  let activated = false;
  if (opts.activate) {
    log(`Activating ${botVersionId}…`);
    await setVersionStatus(opts.conn, botVersionId, "Active");
    activated = true;
  }

  return {
    ok: true,
    bot_id: botId,
    bot_version_id: botVersionId,
    developer_name: opts.agentApiName,
    was_new_agent: !existingBotId,
    activated,
    version_developer_name: versionDeveloperName,
    authoring_bundle: authoringBundleResult,
    ...(preflightFindings ? { preflight: preflightFindings } : {}),
  };
}

// -------------------------------------------------------------------------------------------------
// activate / deactivate
// -------------------------------------------------------------------------------------------------

interface BotActivationResponseBody {
  success: boolean;
  isActivated?: boolean;
  messages?: string[] | string;
}

export interface ActivateOptions {
  conn: Connection;
  agentApiName: string;
  /** Specific version number; default: latest. */
  version?: number;
}

export async function activateVersion(opts: ActivateOptions): Promise<BotVersionRow> {
  return setActivationByApiName(opts, "Active");
}

export async function deactivateVersion(opts: ActivateOptions): Promise<BotVersionRow> {
  return setActivationByApiName(opts, "Inactive");
}

async function setActivationByApiName(
  opts: ActivateOptions,
  desired: "Active" | "Inactive",
): Promise<BotVersionRow> {
  const botId = await findBotId(opts.conn, opts.agentApiName);
  if (!botId) {
    throw new Error(
      `Agent '${opts.agentApiName}' not found. Verify the DeveloperName via ` +
        `\`SELECT Id, DeveloperName FROM BotDefinition\`.`,
    );
  }

  // Resolve the target BotVersion row.
  const versionFilter = opts.version ? `AND VersionNumber=${opts.version}` : "";
  const versions = await opts.conn.query<BotVersionRow>(
    `SELECT Id, VersionNumber, Status FROM BotVersion ` +
      `WHERE BotDefinitionId='${soqlEscape(botId)}' ${versionFilter} ` +
      `ORDER BY VersionNumber DESC LIMIT 1`,
  );
  if (versions.records.length === 0) {
    throw new Error(
      opts.version
        ? `No BotVersion ${opts.version} for agent '${opts.agentApiName}'.`
        : `No BotVersion records for agent '${opts.agentApiName}'.`,
    );
  }
  const row = versions.records[0];
  if (row.Status === desired) {
    return row; // already in desired state — idempotent
  }
  await setVersionStatus(opts.conn, row.Id, desired);
  return { ...row, Status: desired };
}

async function setVersionStatus(
  conn: Connection,
  botVersionId: string,
  desired: "Active" | "Inactive",
): Promise<void> {
  const url = `/connect/bot-versions/${botVersionId}/activation`;
  const resp = (await conn.request({
    method: "POST",
    url,
    body: JSON.stringify({ status: desired }),
    headers: { "Content-Type": "application/json" },
  } as Parameters<typeof conn.request>[0])) as BotActivationResponseBody;
  if (!resp.success) {
    const msg = Array.isArray(resp.messages)
      ? resp.messages.join("; ")
      : (resp.messages ?? "unknown");
    throw new Error(`Activation request did not succeed: ${msg}`);
  }
}

// -------------------------------------------------------------------------------------------------
// list_versions
// -------------------------------------------------------------------------------------------------

export interface ListVersionsResult {
  ok: true;
  agent_api_name: string;
  bot_id: string;
  versions: Array<{
    bot_version_id: string;
    version_number: number;
    developer_name?: string;
    status: string;
    created_date?: string;
    last_modified_date?: string;
  }>;
}

export async function listVersions(
  conn: Connection,
  agentApiName: string,
): Promise<ListVersionsResult> {
  const botId = await findBotId(conn, agentApiName);
  if (!botId) {
    throw new Error(`Agent '${agentApiName}' not found. Verify the DeveloperName.`);
  }
  const r = await conn.query<{
    Id: string;
    VersionNumber: number;
    DeveloperName: string;
    Status: string;
    CreatedDate: string;
    LastModifiedDate: string;
  }>(
    `SELECT Id, VersionNumber, DeveloperName, Status, CreatedDate, LastModifiedDate ` +
      `FROM BotVersion WHERE BotDefinitionId='${soqlEscape(botId)}' ORDER BY VersionNumber DESC`,
  );
  return {
    ok: true,
    agent_api_name: agentApiName,
    bot_id: botId,
    versions: r.records.map((row) => ({
      bot_version_id: row.Id,
      version_number: row.VersionNumber,
      developer_name: row.DeveloperName,
      status: row.Status,
      created_date: row.CreatedDate,
      last_modified_date: row.LastModifiedDate,
    })),
  };
}
