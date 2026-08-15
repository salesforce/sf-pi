# SF LSP

## What It Does

SF LSP returns real-time language-server diagnostics after successful Pi file
writes and edits for Apex, LWC, and Agent Script. Diagnostics join the tool
result so the agent can correct errors in the same turn; the visible working
indicator, transcript row, Welcome readiness row, and Manager detail remain
human-only presentation.

When SF Agent Script is enabled, it owns `.agent` diagnostics in process and SF
LSP yields those files. Otherwise SF LSP can use its discovered Agent Script LSP
server.

## Supported languages

| Language     | Files                 | Server                                          |
| ------------ | --------------------- | ----------------------------------------------- |
| Apex         | `.cls`, `.trigger`    | Apex Jorje LSP; Java 11+                        |
| LWC          | bundle `.js`, `.html` | LWC language server                             |
| Agent Script | `.agent`              | Agent Script LSP when SF Agent Script is absent |

The first available source wins. Environment overrides are checked before
project `.pi/lsp/`, global `~/.pi/agent/lsp/`, VS Code Salesforce extensions,
and applicable PATH binaries.

## Commands

| Command                           | Purpose                                       |
| --------------------------------- | --------------------------------------------- |
| `/sf-lsp`                         | Open SF LSP in the SF Pi Manager              |
| `/sf-lsp doctor`                  | Probe language-server readiness               |
| `/sf-lsp install`                 | Review and run the managed Apex/LWC installer |
| `/sf-lsp install status`          | Show installed versus available server state  |
| `/sf-lsp verbose on\|off\|toggle` | Control human transcript row verbosity        |

No permanent LSP HUD or keyboard shortcut is added. SF Welcome shows one
readiness row; recent activity and controls stay on demand.

## Configuration

**SF Pi Manager → SF LSP → Settings** stores
`sfPi.sfLsp.verbose`. Balanced mode reports errors, recovery transitions, and
the first unavailable result per language/session; verbose mode reports every
check. This setting changes human transcript rows only, not diagnostics returned
to the agent.

Discovery overrides include `SF_LSP_APEX_JAR`, `SF_LSP_LWC_COMMAND`, and
`SF_LSP_AGENTSCRIPT_SERVER` (plus their documented legacy aliases).

The opt-in installer writes managed Apex and LWC servers under
`~/.pi/agent/lsp/` after one confirmation. It does not install Java, use sudo,
change PATH, or overwrite environment/project/VS Code-provided servers. Declined
version decisions are remembered until a newer upstream version appears. Native
Windows receives manual instructions; macOS, Linux, and WSL use the managed
installer when prerequisites are available.

## Safety and Data Boundaries

- SF LSP never re-registers or wraps Pi's built-in `write` or `edit` tools.
- Unsupported files and failed edits remain silent.
- Agent Script files are delegated to SF Agent Script when that owner is active.
- Startup readiness and update lookup are bounded; installation always requires
  confirmation and writes only under the managed LSP directory.
- Human transcript entries never add extra model-visible content beyond the
  diagnostic feedback already attached to the edit result.

## Troubleshooting

**The Welcome row stays unknown:** Run `/sf-lsp doctor`. SF Welcome reads shared
state and never starts a duplicate language-server probe.

**Transcript rows are too chatty or quiet:** Change the Manager preference or
use `/sf-lsp verbose toggle`.

**Setup guidance appears once and then stops:** No server was found. Run the
doctor for the exact discovery chain and configure the corresponding environment
or managed/project path.

**Apex diagnostics never appear:** Verify Java 11+ and the Apex JAR discovery
reported by the doctor.

**LWC diagnostics never appear:** Verify the file is inside an LWC bundle and
that the LWC server is available. `/sf-lsp install` can install a managed copy.

**The first-boot prompt did not appear:** Everything may already be current, the
current version may have been declined, the registry lookup may be unavailable,
or an external server may already satisfy discovery. Use `install status` and
run `install` explicitly when desired.

**Installation appears slow:** Apex downloads and first-time npm installation can
take up to a few minutes. Inspect proxy settings if the bounded action does not
complete.

**`.agent` diagnostics are absent:** When SF Agent Script is enabled, inspect its
status instead. Otherwise verify Agent Script LSP discovery with the SF LSP
doctor.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-lsp/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
