# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents workflow-oriented tools, command surfaces, safety mediation, and compact evidence artifacts for Salesforce development and operations.

## Language

**Data 360 Run**:
One invocation of a `data360_*` tool action, including local catalog actions, dry runs, readiness probes, runbooks, journeys, raw REST calls, and OTel exports.
_Avoid_: Data 360 trace, Data 360 action

**Data 360 Run Digest**:
A compact typed record of a **Data 360 Run**, optimized for LLM context and human traceability while pointing to full artifacts for deep inspection.
_Avoid_: execution trace, action report, raw response summary

**Data 360 Result Card**:
The human-facing render target derived from a **Data 360 Run Digest**.
_Avoid_: generic JSON summary

**Data 360 Artifact**:
Persisted raw or expanded evidence produced by a **Data 360 Run**, such as raw JSON, SQL, Markdown, CSV, or trace export files.
_Avoid_: dump, temp output

## Example dialogue

Dev: "Run `data360_observe stdm.find_sessions` and show me what happened."
Agent: "That created a **Data 360 Run**. I will return a **Data 360 Run Digest** in context, render a **Data 360 Result Card** for the human, and save the raw SQL/JSON as **Data 360 Artifacts**."
