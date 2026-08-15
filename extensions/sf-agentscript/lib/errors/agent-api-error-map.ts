/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Map cryptic SFAP `/einstein/ai-agent/*` server errors to actionable
 * messages with chain-able recovery hints.
 *
 * Used by both the preview surface (`startPreview`, `sendMessage`, ...) and
 * the lifecycle surface (`publishAgent`, `setVersionStatus`, ...). Same
 * server, same error envelope, same diagnoses — one map.
 *
 * Pure function — no I/O, no Connection. Safe to call from anywhere.
 *
 * Preview and lifecycle intentionally share this canonical implementation.
 */

import { sfap404Message } from "./sfap-404.ts";

export interface AgentApiErrorContext {
  /**
   * Which call surfaced the error.
   * Preview: "start" | "send" | "end" | "trace".
   * Lifecycle: "publish" | "activate" | "deactivate".
   */
  phase: "start" | "send" | "end" | "trace" | "publish" | "activate" | "deactivate";
  /**
   * "agent_file" — local-compile preview against a `.agent` file.
   * "api_name"   — production-agent v1, addressed by DeveloperName.
   * "lifecycle"  — publish/activate/deactivate calls; same SFAP envelope,
   *                different inner messages.
   */
  surface: "agent_file" | "api_name" | "lifecycle";
  /** The .agent file's bundle name when surface=agent_file. */
  agentName?: string;
  /** The published agent's DeveloperName when surface=api_name or lifecycle. */
  agentApiName?: string;
  /** When known, the path to the .agent file — used in recover_via params. */
  agentFile?: string;
  /** Local source-detected publish risks (voice, connection surfaces, response formats). */
  publishFeatureRisks?: Array<{ code?: string; message?: string; evidence?: string[] }>;
}

export interface MappedAgentApiError {
  /** Rewritten user-facing message. */
  message: string;
  /** When non-null, the LLM should try this tool call as a recovery step. */
  recover_via?: { tool: string; params: Record<string, unknown> };
  /** The matched pattern key, for diagnostics + tests. */
  matched: string | null;
}

/**
 * Map an HTTP error from an SFAP call to a clean diagnostic.
 * When no pattern matches, returns the original message verbatim with
 * `matched: null` — the caller surfaces it unchanged.
 *
 * Patterns are ordered most-specific to least-specific. The catch-all
 * `activation-rejected` runs only after the typed cases miss.
 */
export function mapAgentApiError(
  status: number,
  body: unknown,
  context: AgentApiErrorContext,
): MappedAgentApiError {
  const text = errorBlob(body);

  // -- 1. version-mismatch on start (v1.1 preview) -----------------------------
  if (
    /retrieve bot version ID to insert into cache/i.test(text) ||
    /bot version.*not found/i.test(text)
  ) {
    return {
      message:
        `agentVersion.developerName doesn't match a known BotVersion in the ` +
        `org. Most often: the bundle's <target>X.vN</target> in bundle-meta.xml ` +
        `points at a BotVersion that hasn't been published yet. Try one of: ` +
        `(a) remove the <target> tag (defaults to "v0", a fresh-preview sentinel), ` +
        `(b) set it to an existing version like "v1", or ` +
        `(c) publish first: agentscript_lifecycle action='publish'.`,
      matched: "version-cache-miss",
    };
  }

  // -- 2. local/package compiler ahead of the target-org server compiler -----
  const orgCompilerRisks = (context.publishFeatureRisks ?? []).filter((risk) =>
    [
      "runtime_org_compiler_compatibility",
      "file_upload_org_compiler_compatibility",
      "collect_org_compiler_compatibility",
    ].includes(risk.code ?? ""),
  );
  if (
    (context.phase === "start" || context.phase === "publish") &&
    orgCompilerRisks.length > 0 &&
    (status === 400 ||
      status === 422 ||
      /422 Unprocessable Entity|parseandcompile|CompilationError|Syntax error/i.test(text))
  ) {
    return {
      message:
        `The installed local compiler accepts this Agent Script source, but the target org's server compiler rejected one or more newer language or configuration features. ` +
        `Server compiler rollout can lag local package support.\n\n` +
        orgCompilerRisks
          .map(
            (risk) =>
              `• ${risk.code ?? "org-compiler-compatibility"}: ${risk.message ?? "target-org support is not yet proven"}` +
              (risk.evidence?.length ? ` Evidence: ${risk.evidence.join(", ")}` : ""),
          )
          .join("\n") +
        `\n\nRemove or isolate these features for this org, or retry after the org server compiler supports them. A local compile alone cannot prove target-org acceptance.`,
      recover_via: context.agentFile
        ? {
            tool: "agentscript_authoring",
            params: { verb: "inspect", mode: "structure", agent_file: context.agentFile },
          }
        : undefined,
      matched: "org-compiler-feature-skew",
    };
  }

  // -- 3. preview start with unsupported / unlicensed connection surface -----
  if (/Failed to populate planner surface/i.test(text)) {
    return {
      message:
        `Preview failed while populating a connection surface. The org may not ` +
        `have access to the surface type used by this agent, or the connection ` +
        `block may name a surface that is not valid in this org. Original ` +
        `message: ${text.slice(0, 300)}\n\n` +
        `For linked/context variable testing, remove or isolate the connection ` +
        `block and run agentscript_authoring inspect/context_profile to validate response_formats without ` +
        `starting a live preview. If this surface is required, verify the org's ` +
        `channel/surface entitlement and the connection name/source in the .agent file.`,
      recover_via: context.agentFile
        ? {
            tool: "agentscript_authoring",
            params: { verb: "inspect", mode: "structure", agent_file: context.agentFile },
          }
        : undefined,
      matched: "surface-population-failed",
    };
  }

  // -- 3. send/end against a session the server doesn't know about ------------
  if (/V6Session not found|Session not found for sessionId/i.test(text)) {
    return {
      message:
        `The server doesn't know about this session. Common causes: ` +
        `(a) target_org on send/end differs from the one start used (now caught ` +
        `pre-flight, but legacy sessions on disk may still hit this), ` +
        `(b) the session expired (idle TTL), or ` +
        `(c) the agent was deactivated mid-session. Re-run agentscript_preview ` +
        `action='start' to open a fresh session.`,
      recover_via: {
        tool: "agentscript_preview",
        params: { action: "start" },
      },
      matched: "session-not-found",
    };
  }

  // -- 4. start session with empty bot user (Service Agent without BotUser) ---
  if (/Invalid user ID provided on start session/i.test(text)) {
    return {
      message:
        `The agent's running-user couldn't be resolved. ` +
        (context.surface === "api_name"
          ? `For Service Agents, assign an Einstein Agent User via ` +
            `agentscript_lifecycle action='provision_agent_user' (or fix it ` +
            `manually) and re-publish. For Employee Agents this should never ` +
            `happen — the agent_type may be miscategorized.`
          : `For local previews, set agent_type to 'AgentforceEmployeeAgent' ` +
            `(no BotUser needed) or assign a real default_agent_user before ` +
            `starting the preview.`),
      matched: "invalid-user-id",
    };
  }

  // -- 5. published agent inactive (412 PRECONDITION_FAILED) ------------------
  if (/No access to Einstein Copilot/i.test(text) || status === 412) {
    const apiName = context.agentApiName ?? "<agent>";
    return {
      message:
        `The agent has no active BotVersion (or you lack Einstein Copilot ` +
        `access). Activate first: agentscript_lifecycle action='activate' ` +
        `agent_api_name='${apiName}'.`,
      recover_via: {
        tool: "agentscript_lifecycle",
        params: { action: "activate", agent_api_name: apiName },
      },
      matched: "inactive-agent",
    };
  }

  // -- 6. SFAP route unavailable in this org ----------------------------------
  if (status === 404 && /ERROR_HTTP_404|URL No Longer Exists|api\.salesforce\.com/i.test(text)) {
    return {
      message: sfap404Message({
        phase:
          context.phase === "publish" ||
          context.phase === "activate" ||
          context.phase === "deactivate"
            ? context.phase === "deactivate"
              ? "activate"
              : context.phase
            : "preview",
        agentApiName: context.agentApiName,
      }),
      matched: "sfap-404",
    };
  }

  // -- 7. JWT bootstrap failed ------------------------------------------------
  if (/agentforce\/bootstrap\/nameduser/i.test(text) || /sfap_api/i.test(text)) {
    return {
      message:
        `Failed to mint the named-user JWT required by /einstein/ai-agent/*. ` +
        `If using a custom Connected App, add scopes: chatbot_api, sfap_api, ` +
        `web. Otherwise re-auth: sf org login web -a <alias>.`,
      matched: "bootstrap-failed",
    };
  }

  // -- 8. Service Agent activation without default_agent_user -----------------
  // This is the exact text returned by the activation API for
  // `agent_type=AgentforceServiceAgent` + missing/invalid `default_agent_user`.
  // Catch this before the broader "Activation request did not succeed"
  // fallback so the response preserves the actionable missing-user diagnosis.
  if (/should have a user assigned/i.test(text) || /Agent Type should have/i.test(text)) {
    const apiName = context.agentApiName ?? "<agent>";
    const recover: { tool: string; params: Record<string, unknown> } | undefined = context.agentFile
      ? {
          tool: "agentscript_lifecycle",
          params: {
            action: "provision_agent_user",
            agent_file: context.agentFile,
            dry_run: true,
          },
        }
      : undefined;
    return {
      message:
        `Service Agents need an Einstein Agent User assigned and permissioned ` +
        `before activation. The org's BotDefinition for '${apiName}' is missing ` +
        `that wiring. Run agentscript_lifecycle action='diagnose_agent_user' to ` +
        `see exactly what's missing, then 'provision_agent_user' (defaults to ` +
        `dry_run) to fix it idempotently. Editing the .agent file and using ` +
        `'sf project deploy' will NOT propagate agent_type / default_agent_user ` +
        `into the BotDefinition record — you must re-publish via ` +
        `agentscript_lifecycle action='publish'.`,
      recover_via: recover,
      matched: "should-have-user-assigned",
    };
  }

  // -- 9. Cryptic publish failure with source-detected channel-gated features -
  if (
    context.surface === "lifecycle" &&
    context.phase === "publish" &&
    (status >= 500 || status === 0) &&
    /Internal Error/i.test(text) &&
    context.publishFeatureRisks &&
    context.publishFeatureRisks.length > 0
  ) {
    const risks = context.publishFeatureRisks;
    return {
      message:
        `SFAP returned an Internal Error on publish, and the source uses ` +
        `channel/surface-gated Agentforce features that can compile and preview ` +
        `but still require org entitlement at publish time.\n\n` +
        risks
          .map(
            (risk) =>
              `• ${risk.code ?? "feature-risk"}: ${risk.message ?? "publish may require org support"}` +
              (risk.evidence?.length ? ` Evidence: ${risk.evidence.join(", ")}` : ""),
          )
          .join("\n") +
        `\n\nIf this is a generic lifecycle smoke, remove voice modality / VoiceCall-linked ` +
        `variables / connection surfaces and retry. If those features are required, ` +
        `confirm this target org has the relevant voice/channel/surface entitlement before retrying.`,
      recover_via: context.agentFile
        ? {
            tool: "agentscript_authoring",
            params: { verb: "inspect", mode: "context_profile", agent_file: context.agentFile },
          }
        : undefined,
      matched: "feature-gated-publish-internal-error",
    };
  }

  // -- 10. Cryptic 500 on first publish — usually missing system PS ------------
  // The SFAP publish endpoint returns "Internal Error, try again later" when
  // the Einstein Agent User exists but lacks the `AgentforceServiceAgentUser`
  // system permission set. Doc:
  // https://github.com/forcedotcom/afv-library/.../agent-user-setup.md (Pitfall #1)
  if (
    context.surface === "lifecycle" &&
    context.phase === "publish" &&
    status >= 500 &&
    /Internal Error/i.test(text)
  ) {
    return {
      message:
        `SFAP returned an Internal Error on publish. The most common cause is ` +
        `that the Einstein Agent User is missing the system permission set ` +
        `'AgentforceServiceAgentUser' (publish requires it; activation does ` +
        `not). Run agentscript_lifecycle action='diagnose_agent_user' to ` +
        `confirm, then 'provision_agent_user' to assign it. Wait 2-3 minutes ` +
        `after assigning the PS before retrying — Salesforce caches PS ` +
        `assignments aggressively on the publish path.`,
      recover_via: context.agentFile
        ? {
            tool: "agentscript_lifecycle",
            params: { action: "diagnose_agent_user", agent_file: context.agentFile },
          }
        : undefined,
      matched: "internal-error-publish",
    };
  }

  // -- 11. Deactivation blocked by a dependent connected agent ---------------
  if (/trying to deactivate is in use by other agents/i.test(text)) {
    const apiName = context.agentApiName ?? "<agent>";
    return {
      message:
        `Agent '${apiName}' cannot be deactivated while another agent still uses it as a connected dependency. ` +
        `Deactivate dependent parent agents first, confirm their versions are Inactive, then retry. ` +
        `Activation status propagation can lag briefly after the parent deactivates.`,
      recover_via: {
        tool: "agentscript_lifecycle",
        params: { action: "list_versions", agent_api_name: apiName },
      },
      matched: "deactivation-dependent-agent",
    };
  }

  // -- 12. Activation rejected — generic catch-all -----------------------------
  // Anything matching "Activation request did not succeed: <unknown body>"
  // that #7 didn't catch falls through here with the original message plus
  // a hint to inspect the .agent and the BotDefinition.
  if (/Activation request did not succeed/i.test(text)) {
    return {
      message:
        `Activation rejected by the org. Original message: ${text.slice(0, 400)}\n\n` +
        `Run agentscript_authoring inspect/structure on the .agent and confirm 'config.agent_type' ` +
        `and 'access.default_agent_user' match what the BotDefinition expects. ` +
        `If you're not sure what the org expects, run ` +
        `agentscript_lifecycle action='diagnose_agent_user'.`,
      recover_via: context.agentFile
        ? {
            tool: "agentscript_authoring",
            params: { verb: "inspect", mode: "structure", agent_file: context.agentFile },
          }
        : undefined,
      matched: "activation-rejected",
    };
  }

  // -- default: pass through verbatim -----------------------------------------
  const phase = context.phase;
  const verb =
    phase === "publish" || phase === "activate" || phase === "deactivate"
      ? phase
      : `Preview ${phase}`;
  return {
    message: `${verb} failed (HTTP ${status}): ${text.slice(0, 600)}`,
    matched: null,
  };
}

function errorBlob(body: unknown): string {
  if (body == null) return "";
  if (typeof body === "string") return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}
