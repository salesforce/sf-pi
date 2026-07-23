# ADR 0084: Agent-Settled Update Coordinator

Status: accepted

SF Pi retains opt-in Auto Update but replaces the one-shot startup timer with an **Agent-Settled Update Coordinator**. When the daily cadence is due, startup records pending work without mutation. The next `agent_settled` boundary rechecks opt-in and idle state, emits a sanitized Human-Only plan before the first mutation, runs eligible targets independently, persists bounded results, and renders final success, failure, skip, and restart evidence.

Automatic Pi runtime updates stay inside the audited **Pi Runtime Support Window**. Pi 0.81.1 exposes no bounded self-update target, so the runtime target is skipped instead of invoking `pi update --all` or clearing version-check environment policy. This also avoids the `PI_SKIP_VERSION_CHECK` inheritance failure because package updates never enter Pi's self-update path.

Global npm Pi packages receive a bounded read-only metadata preflight. Only an outdated unpinned package whose latest release declares compatibility with the active Pi and Node versions is eligible; SF Pi then delegates the mutation to `pi update --extension <source> --no-approve`. Outdated unpinned Herdr is covered by this generic policy. Pinned, local, git, project-scoped, incompatible, malformed, custom-npm-command, and unverifiable packages remain untouched. Salesforce CLI remains an independent `sf update stable` target, so a package failure does not hide it.

A process-local latch plus an atomic machine lock prevents overlap. `agent_start` aborts an active command and defers remaining automatic work; opt-out is re-read before every later target; reload and shutdown abort stale work; automatic headless execution is disabled. Command output never enters persisted evidence: target summaries use fixed bounded language and both the status store and Human-Only transcript path redact credential-, home-, and URL-shaped values. The coordinator never restarts Pi automatically. This supersedes ADR 0079's initial decision to retire scheduled updates while preserving ADR 0079's audited compatibility ceiling.
