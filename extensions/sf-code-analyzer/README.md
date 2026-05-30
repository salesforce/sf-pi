# SF Code Analyzer — Code Walkthrough

## What It Does

SF Code Analyzer gives pi a Salesforce Code Analyzer workflow surface. It wraps
the supported `sf code-analyzer` CLI commands with:

- `/sf-code-analyzer` status, doctor, and help panel
- one `code_analyzer` LLM tool with `doctor`, `run`, `rules`, `config`,
  `apexguru`, and `last_report` actions
- session-scoped report artifacts outside the project tree by default
- `/sf-pi doctor` contribution for setup readiness
- deferred post-agent local quality scans on supported file edits
- explicit ApexGuru analysis for one Apex file when the target org supports it
- ApexGuru automatic insights that are default-on when cached org readiness is enabled

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
  is cache-first and default-on when cached availability is enabled. See ADR 0026.

## Behavior Matrix

| Event/Trigger                 | Condition         | Result                                                                   |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------ |
| extension load                | always            | Register `/sf-code-analyzer` and `/sf-pi doctor` provider.               |
| session_start                 | extension enabled | Register the `code_analyzer` tool.                                       |
| session_shutdown              | always            | Clear the tool-registration latch.                                       |
| `/sf-code-analyzer`           | interactive       | Open the status & controls panel.                                        |
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
| `/sf-code-analyzer`        | Open the status & controls panel.                                           |
| `/sf-code-analyzer status` | Print extension and tool status.                                            |
| `/sf-code-analyzer doctor` | Check Salesforce CLI, Code Analyzer plugin, Java, and Python prerequisites. |
| `/sf-code-analyzer help`   | Print command and tool usage.                                               |

## LLM Tool

`code_analyzer` actions:

| Action        | Description                                                              |
| ------------- | ------------------------------------------------------------------------ |
| `doctor`      | Check setup prerequisites.                                               |
| `run`         | Run `sf code-analyzer run` and parse JSON output.                        |
| `rules`       | Run `sf code-analyzer rules` and parse JSON output.                      |
| `config`      | Run `sf code-analyzer config` and write YAML config output.              |
| `apexguru`    | Run explicit ApexGuru analysis for one Apex file.                        |
| `last_report` | Summarize the latest Code Analyzer report on the current session branch. |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-code-analyzer/
  lib/
    apexguru-readiness.ts   ← implementation module
    apexguru.ts             ← implementation module
    artifacts.ts            ← implementation module
    auto-scan.ts            ← implementation module
    cli.ts                  ← implementation module
    code_analyzer-tool.ts   ← implementation module
    display.ts              ← implementation module
    extension-doctor.ts     ← implementation module
    file-classify.ts        ← implementation module
    readiness.ts            ← implementation module
    settings.ts             ← implementation module
    transcript.ts           ← implementation module
    types.ts                ← implementation module
  tests/
    display.test.ts         ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    transcript-format.test.ts← unit / smoke test
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
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
