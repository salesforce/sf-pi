# ADR 0003: Slack Send Requires Human Confirmation

## Status

Accepted

## Context

Most Slack tools are read-only research surfaces, but `slack_send` posts a
message as the authenticated user. Message posting is hard to undo and can be
sent to the wrong recipient if fuzzy resolution is wrong.

## Decision

Keep `slack_send` behind explicit human-in-the-loop confirmation in interactive
sessions. In headless mode it refuses to send unless the documented escape hatch
is explicitly set.

## Consequences

- The confirmation dialog is part of the product contract, not an implementation detail.
- New send paths must not bypass recipient confirmation.
- Recipient resolution helpers are shared so read and write tools have consistent
  confidence thresholds and clarification behavior.
