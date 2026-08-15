# Roadmap

This file contains only unresolved, evidence-backed outcomes. Completed work is
removed and remains available in the changelog and Git history. New entries need
a current owner, an observable completion condition, and no conflict with an
accepted ADR.

## Now

- Raise branch coverage enough to sustain a 55% threshold. Current blocking
  floors are 62% lines, 60% statements, 66% functions, and 49% branches; future
  ratchets require another observed full-suite baseline.

## Non-goals

- SF Pi is not an IDE; Pi remains the agent runtime.
- SF Pi does not define a second extension/plugin API on top of Pi's extension
  interface.
- SF Pi does not present community-built extensions as official Salesforce
  product features.
- Installed copies do not send active SF Pi runtime telemetry. Repository
  automation may archive aggregate public GitHub metrics.
- Public source, docs, tests, and examples must not contain confidential
  endpoints, credentials, customer data, private org identifiers, or internal
  discussion artifacts.
