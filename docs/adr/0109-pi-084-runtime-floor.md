---
id: "0109"
status: accepted
date: "2026-08-25"
supersedes: ["0088"]
---

# ADR 0109: Pi 0.84.0 Runtime Floor

SF Pi raises its **Pi Runtime Floor** from `0.82.0` to `0.84.0` so production
source can use Pi 0.83/0.84 extension Interfaces without compatibility shims or
an untested “loadable but unsupported” tier. Stable runtimes below `0.84.0`,
prereleases, and Pi 1.x or later remain blocked with exact `pi update --self`
repair guidance. SF Pi does not retain a pre-floor bootstrap Module or
automatically mutate the runtime that is currently hosting it.

The requested `0.83+` window is implemented as exact `0.84.0` because that is
the first release whose `ModelRegistry.refresh(options)` result contract is the
one Gateway already depends on. A `0.83.0` floor would keep the 0.82/0.83
void-refresh dual path, which is the opposite of a simpler architecture.

Required compatibility CI starts at exact Pi `0.84.0`. The **Pi Runtime Audit
Edge** advances to exact `0.85.1`. ADR 0079's forward-compatibility behavior for
newer stable Pi 0.x releases remains in force.

The floor contract changes atomically across package metadata, runtime gates,
Doctor/update guidance, documentation, lockfile, and version-policy tests.
Unrelated product behavior remains separate except for one deletion that the
floor existed to postpone:

- Delete the unused `SF_LLM_GATEWAY_TRACE` process-global `fetch` wrapper
  instead of adopting Pi 0.83 per-request `fetch` injection. Diagnostics stay
  on `/sf-llm-gateway doctor`, usage-probe, and Pi-owned logs.
- Call `ctx.modelRegistry.refresh(options)` as a typed 0.84 API and consume
  `aborted` / `errors` directly. Do not keep a void-result adapter.
- Do not adopt `ctx.scopedModels` in this slice. Gateway exclusive/additive
  `enabledModels` remains SF Pi product logic; native scoped-model picking is
  not a deletion of that contract.

Raising the floor does not authorize new SF Pi Modules for `defaultTools`,
`expandPromptTemplates`, fullscreen search, Cloudflare gateway bindings, the
PowerShell tool, installer-managed updates, or `session_compact_failed` HUD.
This supersedes ADR 0088 for the hard floor and required compatibility edge.
