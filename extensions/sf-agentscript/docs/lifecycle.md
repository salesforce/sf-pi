# Agent Script lifecycle

Use `agentscript_lifecycle`. Return to [`../AGENT_GUIDE.md`](../AGENT_GUIDE.md) for the preferred loop. For Service Agent user wiring details, read [`agent-user-setup.md`](./agent-user-setup.md).

Use `publish` to create an inactive agent/version. Native quality runs before org calls. New enabled High rule IDs or a quality-analysis failure pause publication and return evidence; retry with `acknowledge_quality_risk=true` only after user approval. Approval is session-scoped to the bundle and reviewed risk IDs. If High or Moderate recommendations remain after publication, the result advises resolving them before activation.

After publication, run `agentscript_eval action="run_release"` with the local `agent_file` and `agent_api_name`, or use the Studio Release Contract tab. It generates and runs the baseline against the exact latest inactive BotVersion, then runs `tests/agentforce/<AgentApiName>.eval.json` when present (or `release_spec_path`). `activate` proceeds only when current-schema Suite evidence is Passed and matches the target org, exact BotVersion, current baseline identity, and current designated-spec digest. Release lookup uses an exact-identity index, revalidates terminal status/snapshots/raw evidence, and rebuilds from Run manifests when needed; recent-index eviction cannot expire evidence. Emergency activation requires `acknowledge_untested_activation=true` and a distinct Guardrail approval.

Use `agent_user_status`, `diagnose_agent_user`, and `provision_agent_user` for Service Agent user wiring. Provision defaults to `dry_run=true`; pass `dry_run=false` only after reviewing the plan. Live provisioning deploys a synthesized Permission Set for Apex action access with bounded Metadata API start/poll timeouts so stalled deploys return diagnostics instead of waiting on SDR's long default poll window.

Do not infer activation/deactivation targets from branch state. Pass `agent_api_name` explicitly for `activate`, `deactivate`, and `list_versions`. If a connected helper cannot deactivate because it is in use, deactivate dependent parent agents first, confirm their versions are Inactive, then retry after status propagation.
