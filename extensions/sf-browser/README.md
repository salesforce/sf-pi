# SF Browser

## What It Does

SF Browser handles Salesforce UI last-mile work that APIs cannot complete. It
uses [`agent-browser`](https://www.npmjs.com/package/agent-browser) lazily to:

- open authenticated Salesforce pages without exposing session-bearing URLs;
- resolve curated Setup Destinations and verified structured Lightning routes;
- capture compact accessibility snapshots and short-lived element refs;
- perform small click, fill, select, key, editor, and wait interactions;
- store private, session-scoped Browser Evidence screenshots and metadata.

It is not a general browser framework or a replacement for repeatable UI test
suites. Use API-native SF Pi tools first and use purpose-built UI testing
frameworks for durable CI regression coverage.

## Commands

| Command                          | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `/sf-browser`                    | Open SF Browser in the SF Pi Manager                      |
| `/sf-browser status`             | Show cache-first runtime status without probing           |
| `/sf-browser doctor`             | Verify `agent-browser` installation and refresh its cache |
| `/sf-browser open [path\|setup]` | Open the active org, path, or Setup Destination           |
| `/sf-browser setup`              | Open Salesforce Setup home                                |
| `/sf-browser screenshot [label]` | Capture private Browser Evidence                          |
| `/sf-browser evidence [limit]`   | List current-session evidence artifacts                   |
| `/sf-browser guidance`           | Print the Salesforce Browser contract                     |
| `/sf-browser help`               | Print command and tool usage                              |

## Agent tools

The hot path comprises `sf_browser_open_org`, `sf_browser_snapshot`,
`sf_browser_click`, `sf_browser_fill`, `sf_browser_select`, `sf_browser_press`,
`sf_browser_editor`, `sf_browser_wait`, `sf_browser_capture_evidence`, and
`sf_browser_resolve_path`.

Snapshots default to compact summaries and save the full tree as an artifact.
Refs become stale after page changes. Editor writes replace visible content but
never click Save or Apply. Direct `agent-browser` commands remain the long-tail
path for scrolling, hover, drag, uploads, tabs, console/network inspection,
tracing, video, HAR, or advanced CDP work.

## Configuration

Browser Evidence defaults live under `sfPi.browser`:

- `evidenceImageMode`: `artifact`, `thumbnail` (default), or `full`;
- `dismissOverlays`: best-effort dismissal of known ambient overlays;
- `includeSetupAuditTrail`: optional recent Setup Audit Trail enrichment.

Explicit tool arguments win for one capture.

Install the external runtime explicitly; SF Browser never auto-installs it:

```bash
npm install --global agent-browser
agent-browser install
```

Homebrew installations should be updated through Homebrew. Run
`/sf-browser doctor` after installation or upgrade.

## Safety and Data Boundaries

- No startup browser or org probe runs. Detection occurs only through explicit
  doctor, command, tool, or deferred version-check actions.
- Salesforce APIs remain the preferred setup and verification path.
- Run a fresh snapshot before acting and again after navigation, modal changes,
  saves, tab switches, or Lightning rerenders.
- SF Guardrail can classify committing refs such as Save, Delete, Activate,
  Assign, Submit, or Deploy from the latest snapshot label.
- Browser Evidence is artifact-first and stored outside the project by default.
  Use `artifact` for batches and `thumbnail` only when the model must inspect the
  current screen.
- Session-bearing org URLs are passed to the browser process but never echoed in
  tool results.
- Ambiguous waits, Setup matches, list views, and related lists fail closed or
  return candidates; they are not success assertions.

## References

Use [`docs/README.md`](./docs/README.md) to select the current setup destination,
Data 360 destination, or live-smoke reference. Agent ordering and recovery live
in [`AGENT_GUIDE.md`](./AGENT_GUIDE.md). The generated E2E inventory documents
the opt-in navigation hardening harness.

## Troubleshooting

**`agent-browser` is missing:** Run the install commands above and then
`/sf-browser doctor`.

**Chrome cannot launch in a container:** Point `AGENT_BROWSER_EXECUTABLE_PATH`
at a working Chrome/Chromium binary and use appropriate container-safe
`AGENT_BROWSER_ARGS`, then verify the runtime with `/sf-browser doctor`.

**A snapshot ref fails:** Capture a new snapshot. If the compact summary omits
the control, add focused terms or request `outputMode: "full"`.

**Screenshots are too heavy:** Use `imageMode: "artifact"` and inspect paths with
`/sf-browser evidence`; reserve thumbnails for model-visible review.

**The action is outside the hot path:** Use direct `agent-browser` commands and
return to SF Browser for authenticated opening, snapshots, simple actions,
Lightning waits, and evidence.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-browser/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
