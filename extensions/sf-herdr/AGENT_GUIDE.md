# SF Herdr Agent Guide

Use SF Herdr only when the user explicitly requests Herdr or when the active
workflow is already running inside a ready Herdr pane.

## Workflow

1. Call `sf_herdr_plan` with explicit `intent` and `primaryWorkflow`.
2. Execute the returned `herdr_layout.pane_split` step.
3. Read the opaque pane ID from `details.pane.pane_id`; do not construct or name a pane ID.
4. For ordinary tests, logs, deploy checks, previews, evals, servers, or verification, use the returned `herdr_pane` steps. The owning workflow supplies the command and success marker; use the bounded snapshot returned by `wait_output` instead of adding a pane read.
5. For review work, use the returned `herdr_agent` steps. The caller supplies agent kind, name, and prompt.
6. Close a fresh ephemeral pane only after observed success. Leave failure, timeout, blocked, or ambiguous results open for inspection.

## Boundaries

- Never call or recommend a monolithic Herdr control tool.
- Never generate a shell command; the owning Salesforce workflow retains command ownership.
- Never retry the exact normalized empty-body pane-run result; the command was already submitted.
- Preserve UI focus unless the user asks to switch.
- Do not close panes that the current workflow did not create.
- Sticky and manual lifecycles require explicit cleanup.
- The official Herdr skill is separate and out of scope for SF Herdr.

## Related domain skills

Prefer `sf_herdr_plan` plus the vendor `herdr_layout` / `herdr_pane` / `herdr_agent` tools. If they cannot cover the work, read the vendor Herdr skill `herdr`.
