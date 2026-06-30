# ADR 0071: SF LWC is a local-native LWC Lifecycle Extension

## Status

Accepted

## Context

SF Pi needs a first-party Lightning Web Component workflow that helps agents safely move through local bundle discovery, component inspection, LWC diagnostics, targeted Jest testing, result summarization, and iteration without becoming a mini IDE, UI builder, deployment surface, or wrapper around Salesforce CLI commands. Existing extensions already own adjacent responsibilities: `sf-lsp` provides advisory background diagnostics, `sf-code-analyzer` owns broader static/security scans, `sf-apex` owns Apex/server verification, `sf-soql` owns schema-backed query work, and normal Pi file tools own source edits.

The Salesforce VS Code LWC implementation provides useful precedent for package-directory scanning, LWC diagnostics, component creation/rename complexity, and local Jest execution. However, the monorepo package name `@salesforce/salesforcedx-lwc-language-server` is not a public npm dependency. The stable public package available to SF Pi is `@salesforce/lwc-language-server`, which `sf-lsp` already manages for advisory LWC diagnostics.

## Decision

`sf-lwc` will be a lean **LWC Lifecycle Extension** with one `/sf-lwc` command and one `sf_lwc` family tool. V1 owns the local **LWC Lifecycle Loop** only: `status`, `project.scan`, `component.list`, `component.inspect`, `file.diagnose`, `test.discover`, `test.plan`, `test.run`, `history.last`, and `history.rerun`. V1 explicitly excludes component creation, component rename, org source evidence, deploy/retrieve, TypeScript project setup, visual preview, and watch-mode test loops.

`sf-lwc` is local-native rather than API-native: it works primarily against the checked-out SFDX project. It must not shell out to Salesforce CLI or grow Salesforce CLI fallback machinery. A bounded **Local LWC Test Run** may execute the local project's LWC Jest runner directly because LWC Jest is local component evidence, not an org API or Salesforce CLI fallback. Test execution must be explicit, scoped, timeout-bounded, and artifact-backed; it must not install dependencies, run watch mode, update snapshots by default, or run arbitrary package scripts as the primary path.

`sf-lwc` will use public LWC compiler packages through a small SF Pi-owned diagnostics adapter for LWC template/javascript diagnostics and metadata extraction. The preferred conceptual alignment remains the public `@salesforce/lwc-language-server` surface that `sf-lsp` manages for advisory diagnostics, but the current public language-server package pulls older vulnerable `@lwc/*` transitives when used as a direct runtime dependency. V1 therefore depends directly on current public `@lwc/compiler` and `@lwc/template-compiler` packages while preserving the adapter boundary so the direct dependency can be revisited when the language-server package updates cleanly. VS Code monorepo packages remain research references, not runtime dependencies.

`sf-lwc` diagnostics coexist with `sf-lsp` in V1. `sf-lsp` keeps advisory on-write LWC diagnostics, while `sf_lwc file.diagnose` provides explicit lifecycle-scoped diagnostics with **LWC Artifacts**. A future **Diagnostics Handoff** for LWC can be considered only after the explicit lifecycle loop is proven stable.

`component.inspect` extracts local component shape and cross-extension handoff hints: bundle files, metadata exposure, public API surface, template usage, Salesforce module imports, child component references, test presence, Apex import names, schema import strings, and lightweight style/SLDS signals. It does not deeply validate Apex methods, schema fields, security rules, SLDS rules, or broader static-analysis findings; it points to `sf_apex`, `sf_soql`, `code_analyzer`, and a future `sf-slds2` surface when those lifecycle surfaces are the right authority. LWC authoring/test/fix actions return `recommended_skills` such as `generating-lwc-components`, and style/SLDS signals additionally recommend `uplifting-components-to-slds2`, while `sf_lwc` remains the local lifecycle evidence authority.

Human output follows the existing SF Pi lifecycle-extension contract. Every action returns a normalized **LWC Run Digest** rendered as an **LWC Result Card** with a compact **LWC Local Rail**, clear scope, high-signal diagnostics or test outcomes, root-cause hints when available, and artifact pointers. Full source extracts, dependency graphs, diagnostics JSON/SARIF, Jest JSON, stdout/stderr, and markdown summaries are stored as **LWC Artifacts** rather than dumped into chat.

## Consequences

- V1 can be validated without a live Salesforce org through deterministic local SFDX fixtures, unit tests, a local E2E script, full `validate:ci`, Code Analyzer scans, and public-safety grep.
- `project.scan` only inventories LWC bundles inside package directories registered by `sfdx-project.json`; non-SFDX and workspace-wide scans are intentionally unsupported in V1.
- `test.run` guarantees Jest JSON, stdout/stderr capture, and an SF Pi markdown summary artifact. JUnit/TAP/text reporter parity with Apex is deferred unless a local project already produces those reports without extra installs.
- `org.source.get` for LightningComponentBundle evidence, component creation, component rename, deploy/retrieve, and watch-mode test workflows are deferred roadmap items rather than hidden V1 scope.
