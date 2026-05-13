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
 * Originally lived under `lib/preview/error-map.ts` (function
 * `mapPreviewError`). Promoted to its own module after Issue 4 surfaced
 * the same root causes on the lifecycle surface; see
 * docs/POSTMORTEM_E2E_DEMO.md.
 */

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

  // -- 2. send/end against a session the server doesn't know about ------------
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

  // -- 3. start session with empty bot user (Service Agent without BotUser) ---
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

  // -- 4. published agent inactive (412 PRECONDITION_FAILED) ------------------
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

  // -- 5. SFAP route unavailable in this org ----------------------------------
  if (status === 404 && /ERROR_HTTP_404|URL No Longer Exists|api\.salesforce\.com/i.test(text)) {
    return {
      message:
        `The Einstein AI Agent SFAP routes returned 404 across api / test.api / ` +
        `dev.api hosts. The org isn't Agentforce-enabled (e.g. a basic dev ` +
        `edition) or the user lacks permission. Use a sandbox or production ` +
        `org with Agentforce enabled, or assign the right permission set.`,
      matched: "sfap-404",
    };
  }

  // -- 6. JWT bootstrap failed ------------------------------------------------
  if (/agentforce\/bootstrap\/nameduser/i.test(text) || /sfap_api/i.test(text)) {
    return {
      message:
        `Failed to mint the named-user JWT required by /einstein/ai-agent/*. ` +
        `If using a custom Connected App, add scopes: chatbot_api, sfap_api, ` +
        `web. Otherwise re-auth: sf org login web -a <alias>.`,
      matched: "bootstrap-failed",
    };
  }

  // -- 7. Service Agent activation without default_agent_user -----------------
  // This is the exact text returned by the activation API for
  // `agent_type=AgentforceServiceAgent` + missing/invalid `default_agent_user`.
  // Catch it first because the broader "Activation request did not succeed"
  // catch-all (#9 below) would otherwise swallow the diagnosis. See
  // docs/POSTMORTEM_E2E_DEMO.md Issue 4.
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

  // -- 8. Cryptic 500 on first publish — usually missing system PS ------------
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

  // -- 9. Activation rejected — generic catch-all -----------------------------
  // Anything matching "Activation request did not succeed: <unknown body>"
  // that #7 didn't catch falls through here with the original message plus
  // a hint to inspect the .agent and the BotDefinition.
  if (/Activation request did not succeed/i.test(text)) {
    return {
      message:
        `Activation rejected by the org. Original message: ${text.slice(0, 400)}\n\n` +
        `Run agentscript_inspect on the .agent and confirm 'config.agent_type' ` +
        `and 'config.default_agent_user' match what the BotDefinition expects. ` +
        `If you're not sure what the org expects, run ` +
        `agentscript_lifecycle action='diagnose_agent_user'.`,
      recover_via: context.agentFile
        ? { tool: "agentscript_inspect", params: { path: context.agentFile } }
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
