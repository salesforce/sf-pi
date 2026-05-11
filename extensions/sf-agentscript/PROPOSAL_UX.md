# sf-agentscript — Tool Output UX Proposal

> Goal: make every `agentscript_*` tool result a **delightful, signal-rich** experience for the human watching the chat — without compromising the LLM's tight, structured payload.

---

## TL;DR

| Layer             | Surface                          | Format                            | Goal                                        |
| ----------------- | -------------------------------- | --------------------------------- | ------------------------------------------- |
| 🤖 LLM contract   | `content[0].text` + `details`    | compact text + structured JSON    | unchanged — lean, recover_via, digests      |
| 👀 Human contract | `renderResult` TUI component     | rich Ink boxes, colored timelines | NEW — visual scan, drill-down, copy-paste   |
| 📋 Slash commands | `/sf-agentscript ...` info-panel | Markdown (theme-rendered)         | improved — same renderers, formatted output |
| 📄 Headless mode  | stdout text from `summaryText`   | ANSI-colored, plain-text fallback | improved — same content, no Ink             |

**Key insight:** pi separates `content[]` (what the LLM reads) from `renderResult` (what the human sees). We've been writing only the LLM half. Adding the visual half is **pure upside** — the LLM keeps the exact same compact digest, the human gets a beautiful, scannable display.

---

## Today's audit — what we ship right now

| Tool                    | Default output                                                | Issue                                              |
| ----------------------- | ------------------------------------------------------------- | -------------------------------------------------- |
| `agentscript_compile`   | `❌ path — N issue(s) (NE·NW)` + 5 sample bullets             | flat list; no severity color; line numbers buried  |
| `agentscript_create`    | `✓ scaffolded` text                                           | no preview of what was created                     |
| `agentscript_inspect`   | `JSON.stringify(details, null, 2)` (default) or terse summary | massive JSON blob; no tree view                    |
| `agentscript_mutate`    | `✓ field updated` or error                                    | no before/after diff visible                       |
| `agentscript_preview`   | `🤖 <agent_response>\nplan=8a3f… trace_file=…`                | rich digest **discarded**; no timeline visible     |
| `agentscript_eval`      | flat string report (long), or summary text                    | no badges, no histogram, evaluator failures buried |
| `agentscript_lifecycle` | line-per-step text                                            | no checklist; no Studio deep-link                  |

**The biggest gap:** for `preview send` and `eval run` we already produce a **rich `digest`** — every step type the runtime emits — but the human only sees a one-line summary. The data is there; the rendering isn't.

---

## The Pi rendering surface (what we have to work with)

From the pi SDK (`extensions.md` §Rendering):

```ts
pi.registerTool({
  name: "agentscript_preview",
  parameters: Params,
  execute: async (...) => ({
    content: [{ type: "text", text: "<LLM-readable summary>" }],   // → LLM
    details: { ok: true, digest: { ... }, ... },                    // → state + renderer
  }),
  renderCall:   (args, theme, ctx) => Component,                    // → header during execution
  renderResult: (args, result, theme, ctx) => Component,            // → rich body after settled
});
```

- `content[0].text` is what the LLM consumes — keep it small.
- `details` is structured JSON — kept around for renderers and state replay.
- `renderResult` returns a `Component` (from `@earendil-works/pi-tui`) — full Ink tree: `Box`, `Text`, colored spans.
- Slash-command paths can use `openInfoPanel({ markdown })` to show theme-rendered Markdown for the same data.

We already have a great in-house reference: `extensions/sf-slack/lib/render.ts` (667 lines) — color palettes, hash-to-bucket badges, OSC 8 clickable links, expand/collapse, ANSI fallback.

---

## Strategy

Three guarantees, in priority order:

1. **LLM efficiency unchanged.** No tool call grows the LLM's context. The text in `content[0].text` stays a 1–7 line summary. The rich `digest` keeps its 8× compression.
2. **Single source of truth.** Both `renderResult` (TUI) and the slash-command Markdown panel render from the **same `details` object**. We write one extractor, two emitters (Ink components vs Markdown).
3. **Graceful degradation.** Headless mode (no TUI) shows the same `content[0].text` we always returned — never blank. `renderResult` is additive.

Concretely, every tool gets:

```
lib/render/                  (new)
  timeline.ts                renders a planner timeline waterfall (TUI + Markdown)
  diagnostics-table.ts       compile diagnostics as a sev-colored table
  conversation-card.ts       👤 user · 🤖 agent block with stats footer
  eval-summary.ts            run header + per-test cards + latency strip
  version-table.ts           list_versions output
  inspect-tree.ts            structure tree with line-number gutters
  diff-snippet.ts            mutate before/after preview
  shared.ts                  glyphs, palette, helpers
```

Tool files import `renderCall` / `renderResult` from `lib/render/*.ts` and stay thin.

---

## Tool-by-tool design

### 1. `agentscript_compile check`

**Today:**

```
❌ /path/x.agent — 4 issue(s) (2E·2W), 1 fix(es) ready
  • [E] missing-required-field @ L17
  • [E] unknown-action-ref @ L42
  • [W] empty-template @ L29
  • [W] unused-variable @ L8
```

**Proposed (TUI):**

```
┌─ ⚙  agentscript_compile · /path/x.agent ────────── agentforce-default ─┐
│  ❌ 4 issues   ●● 2 errors   ⚠ 2 warnings   🔧 1 quick-fix ready       │
│                                                                         │
│   Sev   Code                          Line   Message                    │
│   ●     missing-required-field        L17    expected `description`     │
│   ●     unknown-action-ref            L42    @actions.lookup not found  │
│   ⚠     empty-template                L29    instructions evaluate to ""│
│   ⚠     unused-variable               L8     @variables.user_id never…  │
│                                                                         │
│  💡 Apply fix: agentscript_mutate apply_quick_fix L17                   │
└─────────────────────────────────────────────────────────────────────────┘
```

- Severity dot colored (theme `error` / `warning`)
- Line numbers right-aligned, theme `mdCode`
- Quick-fix footer carries the literal recover_via call

**LLM contract unchanged** — same 6-line bullet list as today.

---

### 2. `agentscript_inspect structure`

**Today:** terse 1-line summary + raw `structure` JSON dumped on demand.

**Proposed:** tree view rendered from the same `structure` object.

```
┌─ 🔍 agentscript_inspect · structure · /path/x.agent ────────────────────┐
│  📜 Pi_E2E_Final_Test                                  agentforce-default│
│   ├─ 🪪 system               L4                                          │
│   ├─ ⚙  config               L9                                          │
│   ├─ 🗂  topics (3)                                                      │
│   │   ├─ 📌 Triage           L18  → @topic.Billing, @topic.Account       │
│   │   ├─ 💸 Billing          L41  uses @actions.lookup_balance          │
│   │   └─ 👤 Account          L62  uses @variables.user_id               │
│   ├─ 🔧 actions (2)          L84   lookup_balance, send_password         │
│   └─ 🪣 variables (1)        L91   user_id                              │
│                                                                          │
│  185 lines · 0 parse errors · 6 @-references                            │
└──────────────────────────────────────────────────────────────────────────┘
```

- Each row renders the named block with a theme color and a line-number gutter.
- Edges (`→` / `uses`) reflect cross-references already in `inspect`'s output.

---

### 3. `agentscript_mutate set_field` (and `apply_quick_fix`)

**Proposed:** show the change as a 3-line diff card with re-compile result.

```
┌─ 🧬 agentscript_mutate · set_field · topic.Triage.description ──────────┐
│                                                                         │
│   - description: "Initial routing topic"                                │
│   + description: "Triage incoming requests and route to a sub-agent"    │
│                                                                         │
│   ✅ recompile clean (10ms · agentforce-default · 0 issues)             │
└─────────────────────────────────────────────────────────────────────────┘
```

For `apply_quick_fix`: include the originating diagnostic at the top.

For `dry_run: true`: same card with a `(dry-run, not written)` ribbon.

For `emit_regression` rollback: red banner with hint to inspect the source.

---

### 4. `agentscript_preview start` / `send` — **the showpiece**

This is where we get the most leverage. The trace digest already has every step type — we just need to draw it.

**Proposed `send` result:**

```
┌─ 🎬 agentscript_preview · send · session 8a3f7d1e ──────── 1.4s ────────┐
│                                                                          │
│  👤 user                                                                 │
│     I think someone broke into my account, can you help                  │
│                                                                          │
│  🤖 agent                                                                │
│     I'm sorry to hear that. Let me help you secure your account…         │
│                                                                          │
│  ─── Timeline ───────────────────────────────────────────────────────── │
│                                                                          │
│   t+0ms   ▶  UserInput               "I think someone broke…"            │
│   t+12    🧠  Reasoning(Triage)       agent=Triage  iter=1                │
│   t+498   🧠  LLM(Triage/router)      488ms · 7,183 → 406 chars          │
│                                       ▸ tool_calls: [transition_topic]    │
│   t+512   🔀  Transition              Triage → AccountSecurity           │
│   t+520   🧠  LLM(AccountSecurity)    342ms · 4,128 → 298 chars          │
│                                       ▸ tool_calls: [reset_password]     │
│   t+870   🛠  Function                reset_password({user_id:"…"})      │
│           ↳   {sent:true, channel:"email"}                                │
│   t+882   📦  VariableUpdate          verified_check = true              │
│   t+901   💬  PlannerResponse         Inform · safe ✓ · 312 chars        │
│                                                                          │
│  ─── Stats ────────────────────────────────────────────────────────────  │
│   8 steps · 2 LLM calls · 1 fn call · 1 var change · 1 transition       │
│                                                                          │
│  📄 trace_file: .sfdx/agents/Pi_E2E_Final_Test/sessions/8a3f.../t3.json │
│  💡 Drill: agentscript_preview trace plan_id=…                          │
└─────────────────────────────────────────────────────────────────────────┘
```

Glyph mapping (single source of truth in `lib/render/shared.ts`):

| Step type                        | Glyph | Color token       |
| -------------------------------- | ----- | ----------------- |
| `UserInputStep`                  | `▶`   | `accent`          |
| `LLMStep` / `LLMExecutionStep`   | `🧠`  | `mdHeading`       |
| `BeforeReasoningIterationStep`   | `🧠`  | `mdHeading` (dim) |
| `TransitionStep`                 | `🔀`  | `success`         |
| `UpdateTopicStep`                | `📌`  | `mdHeading`       |
| `FunctionStep`                   | `🛠`  | `toolTitle`       |
| `VariableUpdateStep`             | `📦`  | `mdCode`          |
| `EnabledToolsStep`               | `🧰`  | `mdListBullet`    |
| `NodeEntryStateStep`             | `🟦`  | `mdListBullet`    |
| `PlannerResponseStep`            | `💬`  | `success`         |
| `OutputEvaluationStep`           | `🛡`  | `warning`         |
| `PlatformNotificationStep`       | `🔔`  | `warning`         |
| safety dip / error               | `⚠`   | `error`           |
| unknown step type (fallback row) | `❔`  | `mdComment`       |

Colors come from the active theme via `theme.fg(token)` — same pattern sf-slack uses.

**LLM contract unchanged:** `content[0].text` is still:

```
🤖 <agent_response>
→ Triage → AccountSecurity · 2 LLM calls · 1.4s · 1 fn call
plan=8a3f7d1e… trace_file=...
```

The rich timeline lives in `details.digest.timeline[]` (already there) and is rendered visually only.

---

### 5. `agentscript_eval run` — the dashboard

**Proposed run header:**

```
┌─ 🧪 agentscript_eval · run · spec=billing_v3 (10 tests, 2 turns each) ──┐
│                                                                          │
│  ✅ 8/10 tests passed     ✅ 24/30 evaluators passed     ⚠ 2 failures    │
│                                                                          │
│  Latency (per turn, ms)                                                  │
│   p50  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░  1240                    │
│   p95  ████████████████████████████░░░░░░░░░░░  2380                    │
│   p99  ███████████████████████████████░░░░░░░░  2680                    │
│   max  █████████████████████████████████████░░  2950                    │
│                                                                          │
│  ─── Tests ──────────────────────────────────────────────────────────── │
│  ✅  test_billing_lookup       (3/3 evaluators passed)                  │
│  ✅  test_password_reset       (3/3 evaluators passed)                  │
│  …                                                                       │
│  ❌  test_unauthorized_access  (1/3 evaluators passed)         [expand] │
│  ❌  test_topic_routing        (2/3 evaluators passed)         [expand] │
└─────────────────────────────────────────────────────────────────────────┘
```

**Per-test failure card (expanded):**

```
┌─ ❌ test_unauthorized_access ──────────────────────────────────────────┐
│                                                                         │
│   Failed evaluators                                                     │
│   ▌ topic_match              score=0.42  expected="Billing"            │
│   ▌ response_contains_phrase score=0.0   expected match for "verified" │
│                                                                         │
│   Turn 1 · t1                          plan=2c4d… · 1280ms              │
│     👤 "Show me last month's bill"                                      │
│     🤖 "I can't help with billing without verification…"                │
│     ▶ → 🧠 Triage(488ms) → 🧠 NoMatch(342ms) → 💬 PlannerResponse       │
│     vars: { verified_check:false }                                      │
│                                                                         │
│   Turn 2 · t2                          plan=4f7e… · 1100ms              │
│     ...                                                                 │
│                                                                         │
│   📄 traces: .sfdx/agents/.../traces/2c4d…json, .../4f7e…json          │
│   💡 Drill: agentscript_eval get_failure run_id=… test_id=…            │
└─────────────────────────────────────────────────────────────────────────┘
```

- Latency histogram = unicode bar chart from `totals.latencies`.
- Per-test mini-timeline reuses the same `lib/render/timeline.ts` extractor — collapsed to one line in the run summary, expanded into the full waterfall in `get_failure`.
- LLM-side `details` is the existing `failures[]` + `totals` (no growth).

---

### 6. `agentscript_eval trace` & `agentscript_eval get_failure`

Single-plan or single-test deep dive: full timeline waterfall (same renderer as `preview send`), plus the failed-evaluator analysis on top.

---

### 7. `agentscript_lifecycle publish`

**Proposed:**

```
┌─ 🚀 agentscript_lifecycle · publish · Pi_E2E_Final_Test ──────── 6.2s ─┐
│                                                                         │
│   ✓ Local compile clean                       (10ms)                    │
│   ✓ Server compile clean                      (820ms)                   │
│   ✓ AiAuthoringBundle deploy via SDR          (3,210ms · 2 files)       │
│   ✓ Activate v3                               (2,140ms)                 │
│                                                                         │
│   📌 Now Active: v3                                                     │
│   🪟 Open in Studio: https://…/agent-script/Pi_E2E_Final_Test          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- Steps as a checklist, each with measured duration.
- Studio deep-link clickable in TUI (OSC 8) — same pattern as sf-slack permalinks.

### 8. `agentscript_lifecycle list_versions`

```
┌─ 📚 agentscript_lifecycle · list_versions · Pi_E2E_Final_Test ──────────┐
│   v   Status     Created            Activated          DeveloperName    │
│   3   ✅ Active  2026-05-10 19:14   2026-05-10 19:14   v3               │
│   2      Inactive 2026-05-10 18:02  2026-05-10 18:02   v2               │
│   1      Inactive 2026-05-10 17:30  —                  v1               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What stays in `content[0].text` (LLM contract)

| Tool                  | LLM-facing text (max budget)                                  |
| --------------------- | ------------------------------------------------------------- |
| `compile check` clean | 1 line                                                        |
| `compile check` dirty | header + 5 sample bullets (≤ 6 lines)                         |
| `inspect structure`   | 3 lines: counts + cross-ref totals                            |
| `mutate set_field`    | 2 lines: change + recompile result                            |
| `preview start`       | 3 lines: session_id + initial response                        |
| `preview send`        | 4 lines: agent response + summary_line + plan + trace pointer |
| `eval run` (small)    | header + per-test row (≤ 1 + N lines)                         |
| `eval run` (large)    | totals + summary line + recover_via for `get_failure`         |
| `lifecycle publish`   | 1 line per step + Studio URL                                  |

The rich rendering only affects the **human-visible TUI surface**. The LLM continues to see exactly what it sees today.

---

## Headless / non-TUI fallback

When `ctx.hasUI === false` (CI, scripts, piped output), we still want the human (or a downstream tool) to read something nice. Two paths:

1. **Stdout text:** the same `content[0].text` we ship to the LLM. Already concise and structured.
2. **`/sf-agentscript ... --md`:** save a full Markdown report to `.sfdx/agents/<agent>/reports/<ts>.md` and print the path. The Markdown is generated by the **same extractors** used by the TUI renderer (one source, two emitters).

---

## Implementation phases

| Phase | Scope                                                                                                       | Risk | Token impact |
| ----- | ----------------------------------------------------------------------------------------------------------- | ---- | ------------ |
| **1** | Build `lib/render/timeline.ts` + `lib/render/shared.ts`. Wire into `preview send` and `preview trace`.      | Low  | 0 (additive) |
| **2** | Build `lib/render/diagnostics-table.ts`, `inspect-tree.ts`, `diff-snippet.ts`. Wire compile/inspect/mutate. | Low  | 0            |
| **3** | Build `lib/render/eval-summary.ts` with histogram + per-test cards. Wire eval run/get_failure/trace.        | Med  | 0            |
| **4** | Build `lib/render/version-table.ts` + `lifecycle publish` checklist. OSC 8 Studio deep-link.                | Low  | 0            |
| **5** | Markdown emitters next to each renderer. Wire `--md` flag on `/sf-agentscript`.                             | Low  | 0            |

Each phase is independent and shippable on its own.

---

## Test surface additions

- **Snapshot tests** for each renderer: feed a fixture digest, assert the produced Ink tree (or its serialized form) matches.
- **Markdown emitter tests:** same fixtures, assert the Markdown output is stable.
- **Color-fallback tests:** force `process.env.NO_COLOR=1` and assert the output has no ANSI codes but identical structure.
- **Headless test:** `summaryText` budget assertion for every tool — fails the build if any text grows past its documented cap.

Target: +12 tests across renderers, keeps total at 196/196.

---

## Why this is high-leverage now

1. **The data already exists.** `digest.timeline[]` is fully populated; we currently throw it away in the UI.
2. **The pi APIs are stable.** `renderResult` is well-documented and we already use it in sf-slack — no plumbing risk.
3. **Zero LLM cost.** Everything is additive on the rendering surface only.
4. **Live-demo-able.** A 6-second walkthrough — compile → inspect → mutate → preview → eval — becomes visually striking, not just text-on-text.
5. **Differentiator.** No other Salesforce LLM tooling shows a planner waterfall in the chat surface today; we'd be first.

---

## Recommendation

Ship Phase 1 first — `preview send` timeline waterfall — as a single PR. It hits the highest-signal moment in the workflow (debugging an agent turn) and proves out the rendering pipeline. Phases 2–5 follow, one tool at a time, each in its own commit.

End state: every `agentscript_*` tool result is something the human **wants** to look at, and the LLM still gets the exact same compact, recover_via-laden envelope it has today.
