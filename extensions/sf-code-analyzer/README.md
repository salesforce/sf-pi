# SF Code Analyzer

## What It Does

SF Code Analyzer provides a focused wrapper around the supported
`sf code-analyzer` CLI plugin:

- explicit scans, rule discovery, config generation, recipes, and prior-report
  summaries through one `code_analyzer` family tool;
- readiness diagnostics through `/sf-code-analyzer` and `/sf-pi doctor`;
- narrow deferred scans after successful Pi `write` or `edit` results;
- explicit org-backed ApexGuru analysis when the target supports it;
- session-scoped report artifacts and bounded result cards.

Automatic scans are quality feedback for files the agent just touched, not a
replacement for full-project, AppExchange, or CI scans.

## Automatic and explicit scans

| Changed file                        | Deferred selector    |
| ----------------------------------- | -------------------- |
| Apex classes, triggers, and `.apex` | `pmd:Recommended`    |
| JavaScript and TypeScript           | `eslint:Recommended` |
| Flow metadata                       | `flow:Recommended`   |

The default explicit run uses `Recommended`, not `all`. Use broader selectors
only when intentionally requested. `code_analyzer action="recipes"` describes
security, AppExchange, duplication, dependency, exhaustive, and SFGE profiles;
recipes never execute by themselves.

Long-running recipes can recommend a visible `sf_herdr_plan` handoff. SF Code
Analyzer does not create Herdr panes internally. ApexGuru is a separate org
service rather than a local engine; setup guidance opens Salesforce UI only
after user approval.

## Commands

| Command                    | Purpose                                       |
| -------------------------- | --------------------------------------------- |
| `/sf-code-analyzer`        | Open SF Code Analyzer in the SF Pi Manager    |
| `/sf-code-analyzer status` | Print extension and tool status               |
| `/sf-code-analyzer doctor` | Check CLI, plugin, Java, and Python readiness |
| `/sf-code-analyzer help`   | Print command and tool usage                  |

## Tool actions

`code_analyzer` supports `doctor`, `run`, `rules`, `config`, `recipes`,
`apexguru`, `apexguru_setup_help`, and `last_report`. Report-shaped actions
accept `summary`, `inline`, or `file_only` output while preserving full evidence
in artifacts. The active tool schema is the exact parameter reference.

## Configuration

Project and global settings control:

- deferred local auto-scan (`sfPi.codeAnalyzer.autoScan`);
- automatic ApexGuru suggestions when cached readiness permits
  (`sfPi.codeAnalyzer.apexGuruAuto`).

Project settings override global settings, then extension defaults. These
preferences are available through **SF Pi Manager → SF Code Analyzer →
Settings**; explicit tool arguments and broader scan requests remain deliberate
one-run choices.

## Safety and Data Boundaries

- Startup performs no Code Analyzer subprocess or live org call.
- The extension invokes the supported CLI plugin rather than importing engine
  internals.
- Default reports are written outside the project. Caller-supplied
  `output_files` may intentionally target project paths.
- Deferred scans are readiness-gated and limited to successful Pi edits of
  supported files.
- Findings, fixes, and suggestions are reported but never applied automatically.
- ApexGuru UI setup is never opened or changed without approval.

## Troubleshooting

**The doctor says the plugin is missing:** Install it with
`sf plugins install code-analyzer`, then rerun `/sf-code-analyzer doctor`.

**PMD, CPD, or SFGE rules fail:** Install Java 11 or later. The doctor reports
Java readiness.

**Flow Scanner rules fail:** Install Python 3.10 or later and check the doctor's
`python3`/`python` result.

**A scan wrote unexpected files:** SF Pi's default artifact path is outside the
project. Review caller-supplied `output_files`, which are passed to Code Analyzer
as explicit output destinations.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-code-analyzer/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
