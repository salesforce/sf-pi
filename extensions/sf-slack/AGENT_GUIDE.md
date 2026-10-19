# SF Slack Agent Guide

Use SF Slack for Slack research, thread/history lookup, channel/user/file/canvas reads, and explicitly requested collaboration writes.

## Research

1. Use `slack_time_range` for relative dates; pass its boundaries through unchanged.
2. Use `slack_resolve` for fuzzy channels or people. Confidence below 0.85 requires clarification.
3. When the user supplies a canonical Slack message permalink, preserve it in `slack` thread `message_url`; do not reduce it to a raw channel ID and timestamp.
4. Prefer `slack_research` for natural-language research and strict-to-broad query fallback. Pass an exact channel ID directly as `channel_ref`; research does not require metadata confirmation, and all fallback queries retain the channel scope. Fuzzy channel references still require clarification when confidence is low.
5. Start with preview or summary fields. Fetch full messages/threads only for high-value results.
6. Use thread context when `reply_count` indicates discussion.

## Writes

- Call `slack_send` only when the user explicitly asked in the current turn.
- If exact wording is absent, draft before opening the confirmation dialog.
- Preserve supplied wording and never add signatures or via-SF-Pi footers.
- Use `slack_schedule` only for explicitly requested future delivery; schedule/delete remains human-confirmed.
- Canvas create/edit is a durable write and remains Guardrail-mediated.

## Public artifacts

Slack is research-only for public repository output. Distill concepts, then write fresh generic examples without names, channels, permalinks, customer details, internal ids, or non-public wording.
