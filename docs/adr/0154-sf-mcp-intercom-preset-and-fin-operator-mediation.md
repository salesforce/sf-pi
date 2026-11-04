---
id: "0154"
status: accepted
date: 2026-11-03
---

# ADR 0154: SF MCP Intercom preset and Fin Operator mediation

SF MCP adds an `intercom` preset in a new **Fin** category for the Intercom MCP server published by Fin (formerly Intercom). The preset targets `https://mcp.intercom.com/mcp` (US, default) or `https://mcp.eu.intercom.com/mcp` (EU). AU-hosted workspaces are refused because the server does not support them. The entry carries no client id or header. Pi's native MCP runtime discovers the protected-resource and authorization-server metadata, registers a public PKCE client dynamically, and owns consent, token storage, and refresh. The entry requests `scope: "mcp operator"`, the two scopes the server advertises, so the Fin Operator tools can appear for eligible teammates. Bearer-header and fixed-client entries are not adopted, because Intercom does not expose Operator tools to bearer connections.

The reviewed contract is the published list of 14 data tools plus 5 Fin Operator tools, using hidden server exposure and exact per-tool policy (ADR 0128). Operator tools are advertised only when the teammate has Operator access. Otherwise they become locked-hidden unavailable tools rather than drift. Risk classes follow the published annotations: `apply_proposals` is destructive, `send_operator_message` is mixed, `reject_proposals` and the article and note tools are writes, and the rest are reads.

The preset declares a partial overlap with SF Fin (ADR 0153). It never disables SF Fin. Because SF Guardrail mediates both Operator mutations, the recommendation keeps every reviewed tool in Code Mode even when SF Fin is enabled.

SF Guardrail classifies two Intercom tools on any server named `intercom` or `intercom_*`, following ADR 0074:

- **`apply_proposals`** becomes `native-sf-mcp-fin-operator-apply`. The approval is exact: it binds the chat, proposal ids, apply modes, and a payload fingerprint, and never grants session approval, because some applied changes cannot be undone.
- **`send_operator_message`** becomes `native-sf-mcp-fin-operator-turn`. It may be session-approved for messages and answers, because a turn only starts work and its proposals still need apply approval. An `approval` answer is never session-approved, because it approves a specific Operator action.

Neither subject involves a Salesforce org. Both join the existing Power Tool Mode `fin` family, now labeled "Fin CLI and Operator", so a user who selects that family, or all confirm-class decisions, gets auto-approval without the production/unknown-org opt-in. Hard blocks and audit still apply. Reads, `reject_proposals`, internal notes, and article drafts remain prompt-free, and their exposure is governed by the reviewed tool policy.

Sources: [Intercom MCP](https://developers.intercom.com/docs/guides/mcp), [Fin Operator MCP tools](https://developers.intercom.com/docs/guides/fin-operator-mcp).

## Addendum: tools available by default

Every other SF MCP preset saves new connections in Quarantine, with every tool Hidden. The Intercom preset deliberately departs from this. It declares `initialToolProfile: "all-approved"`, so a new connection (from the Manager or `connection.plan`) exposes all 19 reviewed tools in Code Mode, including `apply_proposals`, `send_operator_message`, and the article and note writes. This is safe for Intercom alone because:

- the only irreversible tool, `apply_proposals`, needs exact per-proposal Guardrail approval and is never session-approved;
- Operator turns are Guardrail-confirmed;
- the remaining writes are Help Center drafts, internal notes, or proposal rejections.

Power Tool Mode set to all confirm-class decisions, or to native tools with the `fin` family selected, auto-approves both Operator subjects. No production/unknown-org opt-in is needed, so users who chose Power Tool Mode are never prompted for them. Hard blocks and audit still apply. Existing entries keep their configured exposure, and other presets keep the Quarantine default. `status` and `login.handoff` now warn when a managed, enabled connection exposes zero reviewed tools, because sign-in alone makes nothing callable.
