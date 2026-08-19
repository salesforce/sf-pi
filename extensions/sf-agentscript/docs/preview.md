# Agent Script preview

Use `agentscript_preview`. Return to [`../AGENT_GUIDE.md`](../AGENT_GUIDE.md) for the preferred loop.

`agentscript_preview action="start"` accepts either `agent_file` or `agent_api_name`.

- `agent_file`: local compile first, then server preview; supports context-variable patching for linked/state variables.
- `agent_api_name`: converse with a published active agent; surface digest only.

After a single preview session is active on the branch, `send` and `end` may omit `agent_name` and `session_id`. If more than one session is active, pass both explicitly.

Use `context_variables` to seed deterministic session state for preview or per-turn sends.

Preview send output uses two surfaces: the human renderer shows a rich Preview Trace Report (turn summary, complete parsed LLM response sequence, route path, state changes, key state, function activity, connected-agent invocations, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers), while `content[0].text` stays compact for LLM context efficiency. Ending a multi-turn Preview session renders a bounded Conversation Replay with every user/agent utterance, per-turn path, latency, and response-integrity proof. Response rows distinguish tool-only, intermediate candidate content, and final matching content; multiple non-empty completions are advisory and do not prove what TTS streamed. `RelatedAgentStep` counts as a connected-agent invocation, not a function call. Use `details.digest` for structured signals and `agentscript_preview trace` with the returned `plan_id` when the full raw trace is needed.
