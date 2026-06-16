# ADR 0053: Agent Script Uses a Language Override Canary

## Status

Accepted

## Context

SF Agent Script depends on public `@sf-agentscript/*` packages for parsing,
compilation, language-service, and LSP behavior. The latest direct
`@sf-agentscript/language` release can provide generic diagnostics and quick
fixes before every upstream package has updated its declared dependency range.

Using the latest language-service package directly without controlling the
transitive graph can leave SF Pi with multiple AgentScript language-service
versions in one process. That creates a confusing seam: SF Pi direct imports
may see newer semantics while `@sf-agentscript/agentforce` or
`@sf-agentscript/lsp` internals may still run older semantics.

## Decision

SF Pi temporarily uses an **Agent Script Language Override Canary**: npm
overrides force the AgentScript toolchain to resolve one
`@sf-agentscript/language` version and the matching foundational
`@sf-agentscript/types` version.

The canary is allowed only when all of these are true:

1. `npm ls @sf-agentscript/language @sf-agentscript/types --all` shows one
   effective language-service and one effective types version for the
   AgentScript toolchain.
2. TypeScript, targeted SF Agent Script tests, targeted SF LSP tests, and the
   full test suite pass locally.
3. SF Pi keeps the **Agent Script Hardening Adapter** thin: generic AgentScript
   diagnostics and quick fixes move to the official packages when proven, while
   Salesforce/pi-specific runtime hardening remains local.

The initial canary forces:

- `@sf-agentscript/language@2.9.0`
- `@sf-agentscript/types@0.2.3`

## Consequences

- SF Pi can adopt latest generic AgentScript language-service behavior without
  waiting for every upstream package declaration to catch up.
- The package graph is intentionally more opinionated than the upstream package
  declarations, so dependency refreshes must validate the full local gate before
  release.
- Local duplicate diagnostics should be removed when upstream owns the same
  behavior. For example, `unused-variable` is emitted by the official language
  service and fixed by the official LSP provider, so SF Pi should not keep a
  parallel scanner for it.
- SF Pi must not treat the canary as a permanent fork. Compatibility code should
  stay localized and reviewable; broad compatibility layers should trigger a
  fresh decision.

## Removal criteria

Remove the overrides and this canary posture when the direct AgentScript
packages SF Pi uses naturally resolve the desired `@sf-agentscript/language`
and `@sf-agentscript/types` versions without transitive duplication.
