# ADR 0054: Pi Runtime Adoption Ledger

Status: accepted

When Pi Runtime releases add features that overlap with SF Pi, SF Pi will use a **Pi Runtime Adoption Ledger** instead of copying every release note into code. The ledger records whether SF Pi should adopt, defer, ignore, or delete overlapping code for each runtime capability, plus the owning surface and the behavior proof required.

This keeps SF Pi simple and Pi-native: Pi owns runtime concerns such as trust, tool selection, proxy settings, session names, and footer indicators; SF Pi consumes those surfaces only when they improve Salesforce workflows.

## Current ledger

| Pi Runtime capability                                  | SF Pi response                                                                                                                               | Owning surface                                             | Behavior proof                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ctx.mode` and RPC UI protocol                         | Adopt for command/UI routing. Custom TUI requires `ctx.mode === "tui"`; RPC uses Pi dialog/notification methods; print/JSON stay text-first. | `lib/common/command-panel.ts`, command-bearing extensions  | Mode tests show TUI, RPC, and headless behavior without calling `ctx.ui.custom()` outside TUI.        |
| Project Trust and `ctx.isProjectTrusted()`             | Adopt as the only trust boundary for project-local Pi inputs. Do not add an SF Pi trust model.                                               | `sf-skills`, `/sf-pi skills`, future project-local readers | Trusted/untrusted tests prove project-local sources are hidden or blocked when untrusted.             |
| Pi active-tool selection and `--exclude-tools`         | Adopt as authoritative. SF Pi may narrow active tools but must not re-enable excluded tools.                                                 | `sf-brain`, `sf-slack`, tool-gating helpers                | Regression tests prove excluded extension tools stay inactive after SF Pi scope changes.              |
| Provider-scoped `auth.json.env` and global `httpProxy` | Defer code changes; document Pi-native configuration instead of adding SF Pi proxy/env settings.                                             | `sf-llm-gateway-internal` docs/help                        | Config tests prove existing gateway precedence remains stable and no duplicate proxy setting appears. |
| Package asset/path helpers                             | Adopt when replacing asset-only package-root discovery; keep explicit package-filter path comparisons where needed.                          | Shared catalog/state helpers, manager surfaces             | Linked-install and package-install tests resolve bundled assets without path-walking regressions.     |
| Session display names                                  | Adopt passively for display only. Do not create an SF Pi session naming system.                                                              | `sf-welcome`, `sf-devbar` if useful                        | Display tests show Pi-owned names when present and existing fallbacks when absent.                    |
| `ctx.getSystemPromptOptions()`                         | Defer unless a command has a narrow diagnostic need; treat contents as sensitive.                                                            | Future diagnostics only                                    | Tests must prove no context file contents or secrets are exposed.                                     |
| `InputEvent.streamingBehavior`                         | Ignore until a real input-routing need exists.                                                                                               | None                                                       | No tests needed until adopted.                                                                        |
| Pi Runtime release notes                               | Ignore in SF Pi surfaces except freshness/update guidance.                                                                                   | `sf-welcome`                                               | Release-status tests prove SF Pi does not render upstream Pi changelog bullets.                       |

## Consequences

Future release audits should prefer small adoption/deletion slices with behavior tests over broad runtime wrappers. If a Pi Runtime feature raises a deeper product question, such as credential ownership, it gets its own design pass instead of being folded into release-note cleanup.
