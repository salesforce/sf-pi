# SF Plannotator

## What It Does

Human review of Pi replies and local text artifacts using the official Plannotator TUI. Code-diff review remains with Hunk.

## Commands

- `/sf-planreview` opens this extension in the SF Pi Manager.
- `/sf-planreview last` reviews the latest assistant text on the active Pi branch. If nothing is available yet, it suggests drafting a plan or reply first.
- `/sf-planreview history` lets you choose from up to ten recent assistant text replies on the active branch. Canceling opens no review.
- `/sf-planreview file <path>` reviews a local text file (up to 1 MB). Markdown is preserved; other text is displayed in a Markdown code block.
- `/sf-planreview status` shows the current route. `/sf-planreview doctor` performs a fresh readiness check and also contributes to `/sf-pi doctor`.
- `/sf-planreview setup [tui|herdr]` offers explicit, confirmed installation. The managed standalone TUI is pinned to an official release and SHA-256; the Full Herdr plugin is installed by Herdr at a pinned commit. Nothing installs at startup.
- `/sf-planreview cleanup` asks before deleting saved private reviews. Close any open Herdr review first.

Inside Herdr, the official **Full** `plannotator/herdr-annotate` plugin opens a review pane targeted at the current Pi pane. Its Send action delivers feedback to that agent. SF Pi does not duplicate that message. A Lite installation does not support this path.

Outside Herdr, `plannotator-tui` takes the terminal while Pi's renderer is paused. The official binary can be installed separately; an installed Full Herdr plugin also provides a usable local binary. After the TUI exits, SF Pi offers to send exported annotations to the current Pi conversation. Closing without sending is not approval. No browser or automatic plan execution is started.

## Safety and Data Boundaries

Review feedback is not permission to mutate a Salesforce org; SF Guardrail and the owning SF Pi workflow still apply. Every review reads an immutable copy of its source from `<globalAgentDir>/sf-pi/sf-planreview/reviews/`, preserving the reviewed version even if the source changes. Outside Herdr, SF Pi flags a changed source when returning comments and clears the copy after successful delivery or a review with no annotations. Unsupplied annotations remain available until explicitly cleared. Herdr owns feedback delivery and can keep its review pane open after Send; SF Pi retains its private copy until feedback has arrived **and** the review pane is confirmed closed. It checks pane state in the background and after resuming the same Pi branch; if pane state cannot be confirmed, the copy remains available for `/sf-planreview cleanup`. In Herdr, the annotation is matched to a session-scoped review identity before Pi processes it. If the source file has changed, Pi marks the feedback stale; if the session branch changed and the identity is missing, Pi warns rather than guessing a source. The status cache lives under the same extension namespace; a separate pinned binary may be installed there after confirmation.

## Sources and licensing

This extension does not bundle or fork upstream TUI or Herdr plugin code. It optionally downloads one pinned, checksum-verified standalone binary on explicit user confirmation. The welcome status is cache-first and refreshes after first paint; `/sf-planreview doctor` performs fresh checks and differentiates missing, Lite, disabled, damaged and ready runtimes. [Plannotator TUI](https://github.com/plannotator/plannotator-tui) is MIT-licensed; [Herdr Annotate](https://github.com/plannotator/herdr-annotate) owns its plugin installation and binaries. SF Pi only uses their documented runtime surfaces.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-planreview/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
