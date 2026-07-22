# ADR 0084: Agent-Settled Update Coordinator

Status: accepted

SF Pi will retain opt-in Auto Update but replace the one-shot startup timer with an **Agent-Settled Update Coordinator**. When the daily cadence is due, the coordinator records pending work, waits until Pi is settled, shows the planned first-party update steps, runs eligible targets independently, persists bounded results, and renders a Human-Only Transcript Row with success, failure, skip, and restart evidence.

Automatic Pi runtime updates must stay inside the audited **Pi Runtime Support Window**; a next-minor release is skipped with an audit-needed notice. Pi runtime, Pi package, and Salesforce CLI updates use supported first-party commands and do not become a custom installer. The coordinator never runs during an agent turn or another update. This supersedes ADR 0079's initial decision to retire scheduled updates while preserving ADR 0079's audited compatibility ceiling.
