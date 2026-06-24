# SF Code Analyzer — Code Walkthrough

## What It Does

SF Code Analyzer gives pi a Salesforce Code Analyzer workflow surface. It wraps
the supported `sf code-analyzer` CLI commands with:

- `/sf-code-analyzer` shortcut into the SF Pi Manager detail page, with status, doctor, setup, automation, ApexGuru, recipes, and help actions
- one `code_analyzer` LLM tool with `doctor`, `run`, `rules`, `config`,
  `apexguru`, and `last_report` actions
- session-scoped report artifacts outside the project tree by default
- `/sf-pi doctor` contribution for setup readiness
- deferred post-agent local quality scans on supported file edits
- explicit ApexGuru analysis for one Apex file when the target org supports it
- ApexGuru automatic insights that are default-on when cached org readiness is enabled
- automatic ApexGuru setup suggestions that offer SF Browser guidance only after user approval
- scoped automation preferences with project > global > default precedence
- `summary`, `inline`, and `file_only` output modes for explicit report actions
- scan recipes that explain default automatic profiles, broader explicit scans, and Herdr handoff guidance

## Runtime Flow

```text
Extension loads
  ├─ register /sf-code-analyzer
  ├─ register /sf-pi doctor provider
  └─ session_start
       ├─ if extension enabled, register code_analyzer tool
       ├─ schedule deferred readiness-cache refresh
       └─ collect changed write/edit targets for post-agent scans

agent_end
  ├─ if changed supported files exist and cached readiness is ready
  ├─ run one bounded local Code Analyzer scan
  ├─ emit human-visible transcript row
  └─ send bounded LLM follow-up only when actionable findings exist

code_analyzer action='run'
  ├─ create JSON report path under <globalAgentDir>/sf-pi/code-analyzer/
  ├─ run sf code-analyzer run --output-file <report>.json
  ├─ parse JSON report when present
  └─ return bounded LLM summary + report path in details
```

## Key Architecture Decisions

- **CLI-first boundary** — SF Pi shells out to `sf code-analyzer` and parses
  output files instead of importing Code Analyzer core or engine packages. See
  ADR 0020.
- **Quality-biased feedback** — LLM feedback includes enough violation detail to
  act, while full reports stay as artifacts. See ADR 0022.
- **No shadow rule config** — `code-analyzer.yml` remains the upstream source of
  truth for rule and engine configuration. See ADR 0025.
- **Default-enabled, readiness-gated** — setup recommendations are cache-first;
  scans run only when prerequisites are ready. See ADR 0024.
- **Deferred quality pass** — automatic local scans wait until the agent finishes
  an edit response. See ADR 0021.
- **ApexGuru boundary** — explicit ApexGuru is available now; automatic ApexGuru
  is cache-first and default-on when cached availability is enabled. When ApexGuru
  is unavailable, SF Pi suggests checking Setup with SF Browser but does not
  open or mutate Setup without user approval. See ADR 0026.

## User Guide

### What runs automatically?

`sf-code-analyzer` watches successful pi `write` and `edit` tool results for
supported files. It does **not** watch arbitrary editor saves or shell-created
files. After the agent finishes its current response, the extension runs a
readiness-gated deferred scan for changed files:

| Changed file type                     | Automatic selector   |
| ------------------------------------- | -------------------- |
| Apex classes, triggers, `.apex` files | `pmd:Recommended`    |
| JavaScript / TypeScript               | `eslint:Recommended` |
| Flow metadata (`*.flow-meta.xml`)     | `flow:Recommended`   |

Automatic scans are intentionally narrow. They are fast quality checks for the
files the agent just touched, not replacements for full-project, AppExchange, or
CI scans.

### `Recommended` is not `all`

The default explicit run uses Code Analyzer's `Recommended` selector:

```json
{ "action": "run", "rule_selector": ["Recommended"], "workspace": ["."] }
```

That is different from an exhaustive scan:

```json
{ "action": "run", "rule_selector": ["all"], "workspace": ["."] }
```

Use `all` only when you explicitly want broad/noisy coverage, usually in a
Herdr lane or CI-style validation.

### Recipes and broader suggestions

`code_analyzer action='recipes'` lists named scan recipes. Recipes are metadata
only: they explain the selector and workflow, but never execute a scan by
themselves.

Common explicit recipes:

| Recipe        | Selector                | When to use                                                                             |
| ------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| `security`    | `Recommended:Security`  | Auth, CRUD/FLS, sharing, dynamic SOQL, callouts, secrets, crypto, guest/Experience work |
| `appexchange` | `AppExchange`           | Managed package, ISV, AppExchange security review preparation                           |
| `all-rules`   | `all`                   | Exhaustive pre-release or CI hardening                                                  |
| `retire-js`   | `retire-js:Recommended` | Dependency manifest or lockfile changes                                                 |
| `cpd`         | `cpd:Recommended`       | Broad refactors or duplicate-code checks                                                |
| `sfge`        | `sfge:Recommended`      | Apex data-flow or security-sensitive SOQL/DML paths                                     |

When changed files look security-sensitive or broad, the automatic scan can emit
a compact suggestion such as:

```text
💡 Broader scan suggestions (not run automatically):
- security: Security-focused scan — rule_selector Recommended:Security (Herdr recommended)
```

These suggestions are educational. The extension does not run broader recipes
automatically.

### Herdr handoff

Long-running recipes include plan-focused Herdr Workflow Handoff metadata and
text guidance. If a recipe says Herdr is recommended and `sf_herdr_plan` is
available, the agent should call `sf_herdr_plan` visibly before running the
broad scan. The handoff carries plan intent and workflow context, not shell
commands. The Code Analyzer extension does not invoke Herdr internally and does
not create panes on its own.

### ApexGuru

ApexGuru is org-backed, not a local Code Analyzer engine. It requires a target
org whose ApexGuru service is enabled for the current org/user. When unavailable,
SF Pi can suggest an SF Browser setup check, but it will not open Setup or click
Enable/Accept/Save without user approval.

Use:

```json
{ "action": "apexguru", "target": ["force-app/main/default/classes/MyClass.cls"] }
```

To see the HIL-gated browser setup runbook:

```json
{ "action": "apexguru_setup_help" }
```

### Output modes and artifacts

For `run`, `rules`, `config`, and `last_report`, use:

| Output mode | Behavior                                            |
| ----------- | --------------------------------------------------- |
| `summary`   | Bounded default detail plus artifact path           |
| `inline`    | Richer truncated detail plus artifact path          |
| `file_only` | Minimal prompt output with counts and artifact path |

Full JSON/YAML/HTML/SARIF outputs are preserved as report artifacts. By default,
SF Pi writes its own artifacts under the global agent directory rather than the
project tree. User-supplied `output_files` are passed directly to Code Analyzer.

### Automation settings

`/sf-code-analyzer` exposes project and global controls for:

- deferred auto-scan;
- ApexGuru auto insights.

Project settings override global settings, which override extension defaults.
Use project overrides when a repository needs stricter or quieter automation
than your global default. These two low-friction settings are editable from
**SF Pi Manager → SF Code Analyzer → Settings**:

- **Deferred auto-scan** (`sfPi.codeAnalyzer.autoScan`) — runs readiness-gated local scans after agent edits.
- **ApexGuru auto insights** (`sfPi.codeAnalyzer.apexGuruAuto`) — suggests ApexGuru insights automatically when cached org readiness allows it.

The same preferences remain available as quick Manager detail actions. In the
SF Pi Manager detail page, press `S` to switch the active Manager scope; scoped
automation actions render once and apply to the selected global or project
scope.

## Behavior Matrix

| Event/Trigger                 | Condition         | Result                                                                   |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------ |
| extension load                | always            | Register `/sf-code-analyzer` and `/sf-pi doctor` provider.               |
| session_start                 | extension enabled | Register the `code_analyzer` tool.                                       |
| session_shutdown              | always            | Clear the tool-registration latch.                                       |
| `/sf-code-analyzer`           | interactive       | Open SF Code Analyzer in the SF Pi Manager.                              |
| `/sf-code-analyzer status`    | any mode          | Print extension and tool status.                                         |
| `/sf-code-analyzer doctor`    | any mode          | Probe Salesforce CLI, Code Analyzer plugin, Java, and Python.            |
| `code_analyzer` `doctor`      | agent tool        | Return setup readiness to the LLM.                                       |
| `code_analyzer` `run`         | agent tool        | Run the CLI scan, parse JSON output, and return a bounded summary.       |
| `code_analyzer` `rules`       | agent tool        | Run rule discovery and save JSON output.                                 |
| `code_analyzer` `config`      | agent tool        | Write effective Code Analyzer config output.                             |
| `code_analyzer` `apexguru`    | agent tool        | Run explicit ApexGuru analysis for one Apex file.                        |
| `code_analyzer` `last_report` | agent tool        | Recover the latest branch-local report summary from tool-result details. |

## Commands

| Command                    | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `/sf-code-analyzer`        | Open SF Code Analyzer in the SF Pi Manager.                                 |
| `/sf-code-analyzer status` | Print extension and tool status.                                            |
| `/sf-code-analyzer doctor` | Check Salesforce CLI, Code Analyzer plugin, Java, and Python prerequisites. |
| `/sf-code-analyzer help`   | Print command and tool usage.                                               |

## LLM Tool

`code_analyzer` actions:

| Action                | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| `doctor`              | Check setup prerequisites.                                               |
| `recipes`             | Show scan recipes and Herdr handoff guidance.                            |
| `run`                 | Run `sf code-analyzer run` and parse JSON output.                        |
| `rules`               | Run `sf code-analyzer rules` and parse JSON output.                      |
| `config`              | Run `sf code-analyzer config` and write YAML config output.              |
| `apexguru`            | Run explicit ApexGuru analysis for one Apex file.                        |
| `apexguru_setup_help` | Show the HIL-gated SF Browser setup-check runbook.                       |
| `last_report`         | Summarize the latest Code Analyzer report on the current session branch. |

For `run`, `rules`, `config`, and `last_report`, set `output_mode` to `summary` (default), `inline`, or `file_only` to control prompt-visible detail while keeping the full artifact on disk.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-code-analyzer/
  lib/
    apexguru-guidance.ts    ← implementation module
    apexguru-readiness.ts   ← implementation module
    apexguru.ts             ← implementation module
    artifacts.ts            ← implementation module
    auto-scan-followup.ts   ← implementation module
    auto-scan-plan.ts       ← implementation module
    auto-scan-transcript.ts ← implementation module
    auto-scan.ts            ← implementation module
    cli.ts                  ← implementation module
    code_analyzer-tool.ts   ← implementation module
    config-panel.ts         ← implementation module
    display.ts              ← implementation module
    extension-doctor.ts     ← implementation module
    file-classify.ts        ← implementation module
    manager-action-panels.ts← implementation module
    readiness.ts            ← implementation module
    recipes.ts              ← implementation module
    report-filter.ts        ← implementation module
    settings.ts             ← implementation module
    transcript.ts           ← implementation module
    types.ts                ← implementation module
  tests/
    apexguru-readiness.test.ts← unit / smoke test
    auto-scan-followup.test.ts← unit / smoke test
    auto-scan-orchestration.test.ts← unit / smoke test
    auto-scan-plan.test.ts  ← unit / smoke test
    auto-scan-transcript.test.ts← unit / smoke test
    config-panel.test.ts    ← unit / smoke test
    display.test.ts         ← unit / smoke test
    recipes.test.ts         ← unit / smoke test
    report-filter.test.ts   ← unit / smoke test
    settings.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    tool-actions.test.ts    ← unit / smoke test
    transcript-format.test.ts← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Run:

```bash
npm test -- extensions/sf-code-analyzer/tests
npm run check
```

- `display.test.ts` covers the quality-biased finding selection and report
  summary text.
- `smoke.test.ts` verifies the extension and tool modules export their entry
  points.
- CLI execution is wrapped behind `ExecFn` so later slices can add focused unit
  tests without shelling out.

## Troubleshooting

**`code_analyzer doctor` says the plugin is missing:**
Run `sf plugins install code-analyzer`, then rerun `/sf-code-analyzer doctor`.

**PMD, CPD, or SFGE rules fail:**
Install Java 11 or later. The doctor output shows Java readiness.

**Flow Scanner rules fail:**
Install Python 3.10 or later. The doctor output checks `python3` and `python`.

**A scan wrote files I did not expect:**
By default SF Pi writes its own JSON report under the global SF Pi artifact
directory. User-supplied `output_files` are passed directly to Code Analyzer and
can write into the project if requested.
